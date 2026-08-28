#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { analyzeProject, discoverLocaleFiles } from "@collect-i18n/analyzer";
import { commandFailure, commandSuccess, type ProjectConfig } from "@collect-i18n/core";
import { exportTranslationWorkbook, importTranslationWorkbook } from "@collect-i18n/excel";
import { parseTriggerPlan } from "@collect-i18n/runner";
import { configPath, createDefaultConfig, doctorProject, loadConfig, saveConfig } from "./config.js";
import { callService, readServiceDescriptor, serviceDescriptorPath, type ServiceDescriptor } from "./service-client.js";
import { LocalService } from "./service.js";
import { resolveStateRoot } from "./state-root.js";
import { StateStore } from "./store.js";

interface GlobalOptions { json?: boolean; project?: string }

function output(command: Command, name: string, data: unknown, warnings: string[] = []): void {
  const options = command.optsWithGlobals<GlobalOptions>();
  if (options.json) process.stdout.write(`${JSON.stringify(commandSuccess(name, data, warnings))}\n`);
  else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function projectOf(command: Command): string {
  return resolve(command.optsWithGlobals<GlobalOptions>().project ?? process.cwd());
}

async function analyze(config: ProjectConfig) {
  return analyzeProject({
    projectRoot: config.projectRoot,
    roots: config.locales.roots,
    include: config.source.include,
    exclude: config.source.exclude,
    translationCallees: config.source.translationCallees,
  });
}

async function findEnglishRoot(config: ProjectConfig): Promise<string> {
  const files = await discoverLocaleFiles({ projectRoot: config.projectRoot, roots: config.locales.roots });
  const directories = [...new Set(files.filter((file) => file.locale === "en-us").map((file) => file.localeDirectory))];
  if (directories.length === 1) return directories[0]!;
  if (directories.length > 1) throw new Error(`检测到多个 en-us 语言包目录，请在项目配置中缩小 locales.roots：${directories.join(", ")}`);
  const chinese = files.find((file) => file.locale === "zh-cn")?.localeDirectory;
  if (chinese) return join(dirname(chinese), "en-us");
  throw new Error("未找到 zh-cn 或 en-us 语言包目录");
}

async function descriptorAlive(projectRoot: string): Promise<ServiceDescriptor | undefined> {
  try {
    const descriptor = await readServiceDescriptor(projectRoot);
    await callService(projectRoot, "/api/health", { signal: AbortSignal.timeout(1_500) });
    return descriptor;
  } catch { return undefined; }
}

async function removeDescriptorIfMatches(projectRoot: string, expected?: ServiceDescriptor): Promise<void> {
  if (!expected) { await rm(serviceDescriptorPath(projectRoot), { force: true }); return; }
  try {
    const current = await readServiceDescriptor(projectRoot);
    if (current.pid === expected.pid && current.sessionId === expected.sessionId && current.capability === expected.capability) {
      await rm(serviceDescriptorPath(projectRoot), { force: true });
    }
  } catch {
    // Missing or malformed descriptors are already unusable.
    await rm(serviceDescriptorPath(projectRoot), { force: true });
  }
}

async function closeDescriptorSession(projectRoot: string, descriptor: ServiceDescriptor, status: "interrupted" | "failed" = "interrupted"): Promise<void> {
  const store = await StateStore.open(projectRoot);
  try {
    const session = store.session(descriptor.sessionId);
    if (session && resolve(String(session.project_root)).toLowerCase() === resolve(projectRoot).toLowerCase()) {
      store.closeSession(descriptor.sessionId, status);
    }
  } finally { store.close(); }
}

async function retireStaleDescriptor(projectRoot: string): Promise<ServiceDescriptor | undefined> {
  try {
    const descriptor = await readServiceDescriptor(projectRoot);
    const store = await StateStore.open(projectRoot);
    try { store.interruptProjectSessions(projectRoot); } finally { store.close(); }
    await removeDescriptorIfMatches(projectRoot, descriptor);
    return descriptor;
  } catch {
    await rm(serviceDescriptorPath(projectRoot), { force: true });
    const store = await StateStore.open(projectRoot);
    try { store.interruptProjectSessions(projectRoot); } finally { store.close(); }
    return undefined;
  }
}

async function writeDescriptor(projectRoot: string, descriptor: ServiceDescriptor): Promise<void> {
  await mkdir(dirname(serviceDescriptorPath(projectRoot)), { recursive: true });
  await writeFile(serviceDescriptorPath(projectRoot), `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function waitForDescriptor(projectRoot: string, sessionId: string): Promise<ServiceDescriptor> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 25_000) {
    try {
      const descriptor = await readServiceDescriptor(projectRoot);
      if (descriptor.sessionId !== sessionId) throw new Error("后台服务描述属于另一个会话");
      await callService(projectRoot, "/api/health", { signal: AbortSignal.timeout(1_000) });
      return descriptor;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`后台服务启动超时。${lastError}`);
}

async function startBackground(projectRoot: string, sessionId: string): Promise<ServiceDescriptor> {
  const executable = fileURLToPath(import.meta.url);
  // Source checkouts run the CLI through tsx; the background daemon then
  // boots the same tsx loader so live source edits apply to the service too.
  const tsxCli = executable.endsWith(".ts")
    ? join(resolve(dirname(executable), "..", "..", ".."), "node_modules", "tsx", "dist", "cli.mjs")
    : undefined;
  const commandLine = tsxCli
    ? [process.execPath, tsxCli, executable, "--project", projectRoot, "serve", "--session", sessionId]
    : [process.execPath, executable, "--project", projectRoot, "serve", "--session", sessionId];
  const logPath = join(resolveStateRoot(projectRoot), "service.log");
  await mkdir(dirname(logPath), { recursive: true });
  const log = openSync(logPath, "a");
  const child = spawn(process.execPath, commandLine, {
    cwd: projectRoot,
    detached: true,
    // The service has no inherited stdio, so no console window is needed.
    // windowsHide:false would force a new console on Windows, which fails
    // silently when the parent is a non-console worker (the watcher host);
    // the Playwright browser still gets its own windows via playwright-core.
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  return waitForDescriptor(projectRoot, sessionId);
}

async function resumeStoredSession(projectRoot: string, sessionId: string): Promise<void> {
  const store = await StateStore.open(projectRoot);
  try {
    const session = store.session(sessionId);
    if (!session) throw new Error(`会话不存在：${sessionId}`);
    if (resolve(String(session.project_root)).toLowerCase() !== resolve(projectRoot).toLowerCase()) {
      throw new Error(`会话不属于当前项目：${sessionId}`);
    }
    store.resumeSession(sessionId);
  } finally {
    store.close();
  }
}

async function ensureSessionService(projectRoot: string, sessionId: string): Promise<ServiceDescriptor> {
  const existing = await descriptorAlive(projectRoot);
  if (existing) {
    if (existing.sessionId !== sessionId) {
      throw new Error(`当前服务正在管理另一采集会话：${existing.sessionId}`);
    }
    return existing;
  }

  await retireStaleDescriptor(projectRoot);
  await resumeStoredSession(projectRoot, sessionId);
  try {
    return await startBackground(projectRoot, sessionId);
  } catch (error) {
    const store = await StateStore.open(projectRoot);
    try { store.closeSession(sessionId, "interrupted"); } finally { store.close(); }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}

async function prepareWorkflow(
  projectRoot: string,
  opts: { foreground?: boolean } = {},
): Promise<{ descriptor: ServiceDescriptor; config: ProjectConfig; reused: boolean; foreground: boolean; sessionId: string }> {
  const existing = await descriptorAlive(projectRoot);
  if (existing) return { descriptor: existing, config: await loadConfig(projectRoot), reused: true, foreground: false, sessionId: existing.sessionId };

  await retireStaleDescriptor(projectRoot);
  const doctor = await doctorProject(projectRoot);
  if (!doctor.ready) {
    throw new Error(`项目环境检查未通过：${doctor.checks.filter((check) => check.required && !check.ok).map((check) => check.label).join("、")}`);
  }
  const config = await pathExists(configPath(projectRoot))
    ? await loadConfig(projectRoot)
    : await createDefaultConfig(projectRoot);
  if (!await pathExists(configPath(projectRoot))) await saveConfig(config);
  if (!config.instrumentation.enabled) throw new Error("运行时采集要求 instrumentation.enabled=true，请修改 .collect-i18n/config.json");

  const analysis = await analyze(config);
  const store = await StateStore.open(projectRoot);
  let sessionId: string;
  try {
    const projectId = store.syncProject(projectRoot, config, analysis);
    sessionId = store.createSession(projectId, config.app.baseUrl);
    store.inheritPlans(sessionId, projectId);
  } finally { store.close(); }
  try {
    if (opts.foreground) {
        // In-process run: the caller boots LocalService itself; return a
        // placeholder descriptor (urls filled once the service has started).
        return { descriptor: { pid: process.pid, projectRoot, sessionId, startedAt: new Date().toISOString() } as ServiceDescriptor, config, reused: false, foreground: true, sessionId };
      }
      return { descriptor: await startBackground(projectRoot, sessionId), config, reused: false, foreground: false, sessionId };
    } catch (error) {
      const failedStore = await StateStore.open(projectRoot);
      try { failedStore.closeSession(sessionId, "failed"); } finally { failedStore.close(); }
      throw error;
    }
  }

interface AutomaticProgress {
  processed: number;
  total: number;
  percent: number;
  captured: number;
  deferred: number;
  failed: number;
  currentKey?: string;
}

function automaticProgress(status: Record<string, unknown>): AutomaticProgress {
  const counts = status.counts as Record<string, number>;
  const automatic = status.automatic as Partial<AutomaticProgress> | undefined;
  const total = Number(automatic?.total ?? counts.total ?? 0);
  const processed = Number(
    automatic?.processed ?? Math.max(0, total - Number(counts.pending ?? 0) - Number(counts.running ?? 0)),
  );
  return {
    processed,
    total,
    percent: Number(automatic?.percent ?? (total === 0 ? 100 : (processed / total) * 100)),
    captured: Number(automatic?.captured ?? counts.captured ?? 0),
    deferred: Number(
      automatic?.deferred ?? Number(counts.needs_agent ?? 0) + Number(counts.needs_manual ?? 0),
    ),
    failed: Number(automatic?.failed ?? counts.failed ?? 0),
    currentKey:
      typeof automatic?.currentKey === "string"
        ? automatic.currentKey
        : typeof (status.current as { key_path?: unknown } | undefined)?.key_path === "string"
          ? String((status.current as { key_path: string }).key_path)
          : undefined,
  };
}

async function waitForDeterministicQueue(
  projectRoot: string,
  sessionId: string,
  timeoutMs: number,
  onProgress?: (progress: AutomaticProgress) => void,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  for (;;) {
    const store = await StateStore.open(projectRoot);
    const status = store.status(sessionId);
    store.close();
    const progress = automaticProgress(status);
    const signature = JSON.stringify(progress);
    if (signature !== previous) {
      previous = signature;
      onProgress?.(progress);
    }
    const counts = status.counts as Record<string, number>;
    if (String(status.status) !== "running") return { ...status, serviceInterrupted: true };
    if (counts.pending === 0 && counts.running === 0) return status;
    if (Date.now() >= deadline) return { ...status, deterministicWaitTimedOut: true };
    await new Promise((done) => setTimeout(done, 500));
  }
}

const program = new Command();
program
  .name("collect-i18n")
  .description("Vue 国际化词条运行时证据采集、截图与四列 Excel 往返工具")
  .version("0.5.0")
  .option("--project <path>", "Vue 项目根目录", process.cwd())
  .option("--json", "输出稳定的 JSON 协议")
  .option("--non-interactive", "禁用交互提示");

program.command("doctor")
  .description("检查项目与运行环境，不写入文件")
  .action(async (_options, command) => output(command, "doctor", await doctorProject(projectOf(command))));

program.command("init")
  .description("初始化配置、扫描语言包和源码")
  .action(async (_options, command) => {
    const projectRoot = projectOf(command);
    const doctor = await doctorProject(projectRoot);
    if (!doctor.ready) throw new Error(`项目环境检查未通过：${doctor.checks.filter((check) => check.required && !check.ok).map((check) => check.label).join("、")}`);
    const config = await createDefaultConfig(projectRoot);
    const configFile = await saveConfig(config);
    const analysis = await analyze(config);
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, config, analysis);
    store.close();
    output(command, "init", {
      projectId,
      projectRoot,
      configFile,
      localeKeys: analysis.catalog.keys.length,
      occurrences: analysis.source.occurrences.length,
      routeHints: analysis.source.routeHints.length,
      actionHints: analysis.source.actionHints.length,
      unusedKeys: analysis.unusedKeys.length,
      unknownKeys: analysis.unknownKeys,
      diagnostics: analysis.catalog.diagnostics.concat(analysis.source.diagnostics),
    });
  });

program.command("scan")
  .description("重新扫描并刷新本地项目索引")
  .action(async (_options, command) => {
    const projectRoot = projectOf(command);
    const config = await loadConfig(projectRoot);
    const analysis = await analyze(config);
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, config, analysis);
    store.close();
    output(command, "scan", { projectId, keys: analysis.catalog.keys.length, occurrences: analysis.source.occurrences.length, routes: analysis.source.routeHints.length, actions: analysis.source.actionHints.length, diagnostics: [...analysis.catalog.diagnostics, ...analysis.source.diagnostics] });
  });

program.command("start")
  .description("启动后台采集服务、项目 Vite 服务和本地工作台")
  .option("--background", "后台运行", true)
  .option("--foreground", "前台运行")
  .option("--session <id>", "恢复指定的已停止或中断会话")
  .action(async (options: { foreground?: boolean; session?: string }, command) => {
    const projectRoot = projectOf(command);
    const existing = await descriptorAlive(projectRoot);
    if (existing) {
      if (options.session && existing.sessionId !== options.session) {
        throw new Error(`当前服务正在管理另一采集会话：${existing.sessionId}`);
      }
      output(command, "start", { ...existing, reused: true });
      return;
    }
    await new Promise((done) => setTimeout(done, 250));
    const recovered = await descriptorAlive(projectRoot);
    if (recovered) {
      if (options.session && recovered.sessionId !== options.session) {
        throw new Error(`当前服务正在管理另一采集会话：${recovered.sessionId}`);
      }
      output(command, "start", { ...recovered, reused: true });
      return;
    }
    await retireStaleDescriptor(projectRoot);
    const config = await loadConfig(projectRoot);
    if (!config.instrumentation.enabled) throw new Error("运行时采集要求 instrumentation.enabled=true，请修改 .collect-i18n/config.json");
    const store = await StateStore.open(projectRoot);
    let sessionId: string;
    try {
      if (options.session) {
        const session = store.session(options.session);
        if (!session) throw new Error(`会话不存在：${options.session}`);
        if (resolve(String(session.project_root)).toLowerCase() !== resolve(projectRoot).toLowerCase()) {
          throw new Error(`会话不属于当前项目：${options.session}`);
        }
        store.resumeSession(options.session);
        sessionId = options.session;
      } else {
        const analysis = await analyze(config);
        const projectId = store.syncProject(projectRoot, config, analysis);
        sessionId = store.createSession(projectId, config.app.baseUrl);
      }
    } finally { store.close(); }
    if (options.foreground) {
      let descriptor: ServiceDescriptor | undefined;
      let finish!: () => void;
      const completion = new Promise<void>((done) => { finish = done; });
      const finalize = async () => {
        await removeDescriptorIfMatches(projectRoot, descriptor);
        finish();
      };
      const service = new LocalService({
        config,
        sessionId,
        studioDirectory: resolve(fileURLToPath(new URL("../../../apps/studio/dist", import.meta.url))),
        onShutdownRequest: finalize,
      });
      try {
        const started = await service.start();
        descriptor = { pid: process.pid, projectRoot, sessionId, ...started, startedAt: new Date().toISOString() };
        await writeDescriptor(projectRoot, descriptor);
        output(command, "start", descriptor);
      } catch (error) {
        await service.stop().catch(() => undefined);
        const failedStore = await StateStore.open(projectRoot);
        try { failedStore.closeSession(sessionId, options.session ? "interrupted" : "failed"); } finally { failedStore.close(); }
        await removeDescriptorIfMatches(projectRoot, descriptor);
        throw error;
      }
      const stop = () => {
        void service.stop()
          .catch((error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`))
          .finally(() => finalize());
      };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      await completion;
      return;
    }
    try {
      output(command, "start", await startBackground(projectRoot, sessionId));
    } catch (error) {
      const failedStore = await StateStore.open(projectRoot);
      try { failedStore.closeSession(sessionId, options.session ? "interrupted" : "failed"); } finally { failedStore.close(); }
      throw error;
    }
  });

program.command("run")
  .description("为 Skill 初始化、启动、等待静态采集并生成可立即交付的进度 Excel")
  .option("--output <file>", "Excel 输出路径")
  .option("--deadline-minutes <minutes>", "完整工作流截止时间", "120")
  .option("--deterministic-timeout-minutes <minutes>", "等待静态队列的最长时间(默认 max(15, ceil(词条数/60)) 自适应)")
  .option("--foreground", "在当前进程中运行采集服务(调试/受限环境用，替代后台守护进程)")
  .action(async (options: { output?: string; deadlineMinutes: string; deterministicTimeoutMinutes?: string; foreground?: boolean }, command) => {
    const workflowStartedAt = Date.now();
    const projectRoot = projectOf(command);
    // Mirror startBackground's cwd so a foreground service resolves the
    // project's vite config (index.html, plugins) from the right directory.
    process.chdir(projectRoot);
    const deadlineMinutes = Math.max(1, Number(options.deadlineMinutes) || 120);
    const deadlineAt = new Date(workflowStartedAt + deadlineMinutes * 60_000).toISOString();
    const jsonMode = Boolean((command.optsWithGlobals() as GlobalOptions).json);
    if (!jsonMode) process.stderr.write("[collect-i18n] 正在检查项目并启动采集服务…\n");
    const workflow = await prepareWorkflow(projectRoot, { foreground: options.foreground });
    let foregroundService: LocalService | undefined;
    if (workflow.foreground) {
      const service = new LocalService({
        config: workflow.config,
        sessionId: workflow.sessionId,
        studioDirectory: resolve(fileURLToPath(new URL("../../../apps/studio/dist", import.meta.url))),
        onShutdownRequest: async () => {
          await removeDescriptorIfMatches(projectRoot, workflow.descriptor).catch(() => undefined);
        },
      });
      try {
        const started = await service.start();
        workflow.descriptor = {
          pid: process.pid,
          projectRoot,
          sessionId: workflow.sessionId,
          ...started,
          startedAt: new Date().toISOString(),
        };
        await writeDescriptor(projectRoot, workflow.descriptor);
        foregroundService = service;
      } catch (error) {
        await service.stop().catch(() => undefined);
        const failedStore = await StateStore.open(projectRoot);
        try { failedStore.closeSession(workflow.sessionId, "failed"); } finally { failedStore.close(); }
        throw error;
      }
    }
    const deadlineStore = await StateStore.open(projectRoot);
    deadlineStore.setDeadline(workflow.descriptor.sessionId, deadlineAt);
    // R6: adaptive deterministic window. At the measured 34-87 keys/min a
    // fixed 15min default under-budgets 2000+ key projects (research t1),
    // leaving hundreds of pending tasks every run.
    const sessionStatus = deadlineStore.status(workflow.descriptor.sessionId);
    const totalKeys = Number(((sessionStatus.counts as Record<string, number> | undefined)?.total) ?? 0);
    const adaptiveTimeout = Math.max(15, Math.ceil(totalKeys / 60));
    const deterministicTimeoutMinutes = Math.max(1, Number(options.deterministicTimeoutMinutes) || adaptiveTimeout);
    deadlineStore.close();
    if (!jsonMode) process.stderr.write("[collect-i18n] 自动处理已开始。\n");
    const status = await waitForDeterministicQueue(
      projectRoot,
      workflow.descriptor.sessionId,
      deterministicTimeoutMinutes * 60_000,
      jsonMode
        ? undefined
        : (progress) => {
            const current = progress.currentKey ? ` · 当前 ${progress.currentKey}` : "";
            process.stderr.write(
              `[collect-i18n] 自动处理 ${progress.processed}/${progress.total} (${progress.percent.toFixed(1)}%)` +
              ` · 已截图 ${progress.captured} · 待 Agent/人工 ${progress.deferred}` +
              `${progress.failed ? ` · 失败 ${progress.failed}` : ""}${current}\n`,
            );
          },
    );
    // Auto-drive the Agent queue with generated fallback plans (bounded by
    // the session deadline and route saturation). Plans are deterministic
    // recipes: router-hint goto + waitForKey + capture; the service executes
    // them through the same TriggerPlan pipeline as interactive agents.
    try {
      const driveStore = await StateStore.open(projectRoot);
      const sessionId = workflow.descriptor.sessionId;
      const maxPlans = 120;
      let executed = 0;
      let consecutiveFailures = 0;
      // Settle guard: the deterministic queue dispatches route groups in
      // bursts; a transient pending/running == 0 gap between groups is not
      // completion. Three consecutive calm samples (2s apart) confirm the
      // queue really drained before the auto-drive touches the browser.
      {
        let calm = 0;
        for (let probe = 0; probe < 12; probe += 1) {
          const snapshot = driveStore.status(sessionId);
          const counts = (snapshot.counts ?? {}) as Record<string, number>;
          if (Number(counts.pending ?? 0) === 0 && Number(counts.running ?? 0) === 0) {
            calm += 1;
            if (calm >= 3) break;
          } else {
            calm = 0;
          }
          await new Promise((done) => setTimeout(done, 2_000));
        }
      }
      // The drive is deadline-bounded, so the Anchor route budget (meant for
      // sustained interactive phases) must not cut it off early; pass a higher
      // per-route cap and let the deadline be the real limit.
      const driveAttempted = new Set<string>();
      while (executed < maxPlans) {
        if (Date.now() > Date.parse(deadlineAt) - 30_000) break;
        const saturated = driveStore.saturatedRoutes(sessionId);
        // one-shot picks: nextAgentTask excludes anything already attempted
        const task = driveStore.nextAgentTask(sessionId, saturated, 48, driveAttempted);
        if (!task || (task as { done?: boolean }).done) break;
        driveAttempted.add(String(task.id));
        const planStartedAt = Date.now();
        const occurrences = ((task as { occurrences?: Array<{ routeHints?: Array<{ path?: string; source?: string }> }> }).occurrences ?? []);
        const hints = occurrences.flatMap((occurrence) => occurrence.routeHints ?? []);
        const route = hints.find((hint) => hint.source === "router_config")?.path ?? hints[0]?.path ?? "/";
        const plan = {
          version: 1 as const,
          targetKey: String(task.keyPath),
          route,
          steps: [
            { type: "goto" as const, path: route },
            { type: "wait" as const, milliseconds: 900 },
            { type: "waitForKey" as const, key: String(task.keyPath), timeoutMs: 4_000 },
            { type: "capture" as const },
          ],
          rationale: "run auto-drive: router-hint goto + waitForKey + capture",
        };
        // Persist the plan for cross-session reuse; savePlan keeps the task
        // needs_agent so the service-side executeAgent can submit (mark
        // running) exactly once. An earlier pre-submit here left tasks stuck.
        driveStore.savePlan(String(task.id), plan as never);
        try {
          await callService(projectRoot, "/api/agent/execute", {
            method: "POST",
            body: JSON.stringify({ taskId: task.id, plan }),
          });
          consecutiveFailures = 0;
        } catch (error) {
          // A slow execution failure (waits ran, key not found) is data, not
          // an outage; only fast rejects (connection/route errors) count
          // against the run as likely service problems.
          if (Date.now() - planStartedAt < 2_000) {
            consecutiveFailures += 1;
            if (consecutiveFailures >= 5) break;
          }
          try { driveStore.markTask(String(task.id), "needs_agent", "自动驱动未能执行计划"); } catch { /* best effort */ }
          if (!jsonMode) {
            process.stderr.write(`[collect-i18n] 计划执行失败 ${task.keyPath}: ${error instanceof Error ? error.message : String(error)}\n`);
          }
        }
        executed += 1;
      }
      if (executed > 0 && !jsonMode) process.stderr.write(`[collect-i18n] 自动计划执行 ${executed} 个。\n`);
      driveStore.close();
    } catch (error) {
      if (!jsonMode) process.stderr.write(`[collect-i18n] 自动计划驱动跳过：${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (!jsonMode) process.stderr.write("[collect-i18n] 自动处理已结束，正在生成 Excel…\n");
    const englishRoot = await findEnglishRoot(workflow.config);
    const store = await StateStore.open(projectRoot);
    const rows = store.localeCatalog(workflow.descriptor.sessionId, englishRoot);
    store.close();
    const outputPath = resolve(options.output ?? join(projectRoot, ".collect-i18n", "collect-i18n-translations.xlsx"));
    const exported = await exportTranslationWorkbook(rows, outputPath);
    const counts = status.counts as Record<string, number>;
    const unresolved = counts.pending + counts.running + counts.needs_agent + counts.needs_manual + counts.failed;
    const nextAction = counts.failed > 0 || String(status.status) === "failed"
      ? "failed"
      : String(status.status) !== "running" && unresolved > 0
        ? "restart"
        // R6: deterministic work still pending inside a live session means the
        // window ended early; the Skill continues polling the same session
        // instead of mistaking it for Agent/manual work.
        : counts.pending > 0
          ? "deterministic_continue"
          : counts.needs_agent > 0
            ? "agent"
            : counts.needs_manual > 0
              ? "manual"
              : "complete";
    output(command, "run", {
      sessionId: workflow.descriptor.sessionId,
      studioUrl: workflow.descriptor.studioUrl,
      appUrl: workflow.descriptor.appUrl,
      reused: workflow.reused,
      deadlineAt,
      nextAction,
      status,
      workbook: exported,
    });
    // The workflow is finished: close the session so leftover tasks do not
    // linger in a stale "running" state, and release an in-process service.
    try {
      const finalStore = await StateStore.open(projectRoot);
      finalStore.closeSession(workflow.sessionId, "stopped");
      finalStore.close();
    } catch { /* best effort */ }
    if (foregroundService) {
      await removeDescriptorIfMatches(projectRoot, workflow.descriptor).catch(() => undefined);
      await foregroundService.stop().catch(() => undefined);
    }
  });

program.command("serve", { hidden: true })
  .requiredOption("--session <id>")
  .action(async (options: { session: string }, command) => {
    const projectRoot = projectOf(command);
    const config = await loadConfig(projectRoot);
    let descriptor: ServiceDescriptor | undefined;
    const finalize = async () => {
      await removeDescriptorIfMatches(projectRoot, descriptor);
      process.exit(0);
    };
    const service = new LocalService({
      config,
      sessionId: options.session,
      studioDirectory: resolve(fileURLToPath(new URL("../../../apps/studio/dist", import.meta.url))),
      onShutdownRequest: finalize,
    });
    try {
      const started = await service.start();
      descriptor = { pid: process.pid, projectRoot, sessionId: options.session, ...started, startedAt: new Date().toISOString() };
      await writeDescriptor(projectRoot, descriptor);
    } catch (error) {
      await service.stop().catch(() => undefined);
      const failedStore = await StateStore.open(projectRoot);
      try { failedStore.closeSession(options.session, "failed"); } finally { failedStore.close(); }
      await removeDescriptorIfMatches(projectRoot, descriptor);
      throw error;
    }
    const shutdown = async () => { try { await service.stop(); } finally { await finalize(); } };
    process.once("SIGINT", () => { void shutdown(); }); process.once("SIGTERM", () => { void shutdown(); });
  });

program.command("status")
  .description("查询当前采集进度")
  .option("--session <id>")
  .action(async (options: { session?: string }, command) => {
    const store = await StateStore.open(projectOf(command));
    const sessionId = options.session ?? String(store.latestSession()?.id ?? "");
    if (!sessionId) throw new Error("项目还没有采集会话，请先运行 start");
    const status = store.status(sessionId); store.close(); output(command, "status", status);
  });

program.command("finalize")
  .description("收尾 Agent 队列：无源码/仅非视觉词条留空，其余交给人工兜底")
  .requiredOption("--session <id>")
  .action(async (options: { session: string }, command) => {
    const store = await StateStore.open(projectOf(command));
    try {
      const settled = store.finalizeUnresolved(options.session);
      output(command, "finalize", {
        settled: {
          skippedNoSource: settled.skippedNoSource.length,
          skippedNonVisual: settled.skippedNonVisual.length,
          needsManual: settled.needsManual.length,
          deadKeys: settled.deadKeys.length,
        },
        deadKeys: settled.deadKeys,
        keys: settled,
        status: store.status(options.session),
      });
    } finally {
      store.close();
    }
  });

const agent = program.command("agent").description("由 Agent/Skill 消费的严格任务协议");
agent.command("next")
  .requiredOption("--session <id>")
  .action(async (options: { session: string }, command) => {
    const store = await StateStore.open(projectOf(command));
    const session = store.session(options.session);
    if (!session) throw new Error(`Session does not exist: ${options.session}`);
    const deadlineAt = typeof session.deadline_at === "string" ? session.deadline_at : undefined;
    const remainingSeconds = deadlineAt ? Math.max(0, Math.floor((Date.parse(deadlineAt) - Date.now()) / 1_000)) : undefined;
    const deadlineReached = remainingSeconds === 0;
    const saturatedRoutes = store.saturatedRoutes(options.session);
    const task = deadlineReached ? undefined : store.nextAgentTask(options.session, saturatedRoutes);
    const routeBatch = task ? store.agentRouteBatch(options.session, task) : undefined;
    const status = store.status(options.session); store.close();
    output(command, "agent.next", {
      done: !task,
      reason: deadlineReached ? "deadline_reached" : !task ? "queue_empty" : undefined,
      deadlineAt,
      remainingSeconds,
      saturatedRoutes,
      task,
      routeBatch,
      status,
    });
  });
agent.command("submit")
  .requiredOption("--session <id>")
  .requiredOption("--task <id>")
  .requiredOption("--plan-file <file>")
  .action(async (options: { session: string; task: string; planFile: string }, command) => {
    const plan = parseTriggerPlan(JSON.parse(await readFile(resolve(options.planFile), "utf8")));
    const store = await StateStore.open(projectOf(command));
    const task = store.task(options.task);
    if (!task || task.sessionId !== options.session) throw new Error(`任务不属于会话：${options.task}`);
    if (plan.targetKey !== task.keyPath) throw new Error(`计划目标 ${plan.targetKey} 与任务 ${task.keyPath} 不一致`);
    store.savePlan(task.id, plan); store.close(); output(command, "agent.submit", { accepted: true, taskId: task.id, plan });
  });
agent.command("execute")
  .requiredOption("--session <id>")
  .requiredOption("--task <id>")
  .option("--plan-file <file>")
  .action(async (options: { session: string; task: string; planFile?: string }, command) => {
    const projectRoot = projectOf(command);
    const store = await StateStore.open(projectRoot); const task = store.task(options.task); store.close();
    if (!task || task.sessionId !== options.session) throw new Error(`任务不属于会话：${options.task}`);
    const plan = options.planFile ? parseTriggerPlan(JSON.parse(await readFile(resolve(options.planFile), "utf8"))) : task.plan;
    if (!plan) throw new Error("任务尚未提交 TriggerPlan");
    await ensureSessionService(projectRoot, options.session);
    const result = await callService(projectRoot, "/api/agent/execute", { method: "POST", body: JSON.stringify({ taskId: task.id, plan }) });
    output(command, "agent.execute", result);
  });

const manual = program.command("manual").description("打开人工兜底队列并监听目标 key");
manual.command("open")
  .requiredOption("--session <id>")
  .option("--key <keyPath>")
  .option("--route <path>")
  .action(async (options: { session: string; key?: string; route?: string }, command) => {
    const projectRoot = projectOf(command);
    const store = await StateStore.open(projectRoot);
    const task = options.key ? store.taskByKey(options.session, options.key) : (store.nextTask(options.session, ["needs_manual", "needs_agent", "failed"]));
    store.close();
    if (!task) { output(command, "manual.open", { done: true }); return; }
    await ensureSessionService(projectRoot, options.session);
    const listening = await callService(projectRoot, "/api/manual/open", { method: "POST", body: JSON.stringify({ sessionId: options.session, keyPath: task.keyPath, route: options.route }) });
    const descriptor = await readServiceDescriptor(projectRoot);
    output(command, "manual.open", { done: false, studioUrl: descriptor.studioUrl, ...listening as object });
  });

program.command("export")
  .description("导出只有中文、英文、截图、Key Path 四列的 Excel")
  .requiredOption("--session <id>")
  .requiredOption("--output <file>")
  .action(async (options: { session: string; output: string }, command) => {
    const projectRoot = projectOf(command); const config = await loadConfig(projectRoot); const englishRoot = await findEnglishRoot(config);
    const store = await StateStore.open(projectRoot); const rows = store.localeCatalog(options.session, englishRoot); store.close();
    output(command, "export", await exportTranslationWorkbook(rows, resolve(options.output)));
  });

program.command("import")
  .description("校验回稿并按 Key Path 写入 en-us JSON")
  .requiredOption("--file <file>")
  .option("--session <id>")
  .option("--dry-run", "仅校验，不写入", true)
  .option("--apply", "应用有效翻译")
  .action(async (options: { file: string; session?: string; apply?: boolean }, command) => {
    const projectRoot = projectOf(command); const config = await loadConfig(projectRoot); const englishRoot = await findEnglishRoot(config);
    const store = await StateStore.open(projectRoot); const sessionId = options.session ?? String(store.latestSession()?.id ?? "");
    if (!sessionId) throw new Error("没有可用于匹配 Key Path 的会话索引");
    const catalog = store.localeCatalog(sessionId, englishRoot); store.close();
    output(command, "import", await importTranslationWorkbook({ workbookPath: resolve(options.file), catalog, englishRoot, apply: options.apply === true, backup: true }));
  });

program.command("stop")
  .description("停止后台服务")
  .option("--session <id>", "只停止匹配的会话，避免终止其他执行者的服务")
  .action(async (options: { session?: string }, command) => {
    const projectRoot = projectOf(command);
    let descriptor: ServiceDescriptor;
    try { descriptor = await readServiceDescriptor(projectRoot); }
    catch {
      await retireStaleDescriptor(projectRoot);
      output(command, "stop", { stopped: false, alreadyStopped: true });
      return;
    }
    if (options.session && descriptor.sessionId !== options.session) {
      throw new Error(`拒绝停止另一活动会话：${descriptor.sessionId}`);
    }
    try {
      const accepted = await callService<{ stopping: boolean; sessionId: string }>(projectRoot, "/api/shutdown", {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(5_000),
      });
      const deadline = Date.now() + 15_000;
      let alive = true;
      while (Date.now() < deadline) {
        try {
          await callService(projectRoot, "/api/health", { signal: AbortSignal.timeout(750) });
          await new Promise((done) => setTimeout(done, 150));
        } catch { alive = false; break; }
      }
      if (!alive) await removeDescriptorIfMatches(projectRoot, descriptor);
      output(command, "stop", { stopped: !alive, stopping: alive, accepted: accepted?.stopping === true, pid: descriptor.pid, sessionId: descriptor.sessionId });
    } catch (error) {
      let alive = false;
      try {
        await callService(projectRoot, "/api/health", { signal: AbortSignal.timeout(1_500) });
        alive = true;
      } catch { /* The descriptor is stale or the service has exited. */ }
      if (alive) {
        output(command, "stop", { stopped: false, shutdownFailed: true, pid: descriptor.pid, warning: error instanceof Error ? error.message : String(error) });
      } else {
        // A stale descriptor is safe to retire, but its PID is never signalled:
        // PID reuse could otherwise terminate an unrelated local process.
        await closeDescriptorSession(projectRoot, descriptor);
        await removeDescriptorIfMatches(projectRoot, descriptor);
        output(command, "stop", { stopped: false, staleDescriptor: true, pid: descriptor.pid, warning: error instanceof Error ? error.message : String(error) });
      }
    }
  });

program.parseAsync().catch((error) => {
  const commandName = program.args.join(".") || "collect-i18n";
  const result = commandFailure(commandName, { code: "command_failed", message: error instanceof Error ? error.message : String(error), retryable: false });
  const json = process.argv.includes("--json");
  process.stderr.write(json ? `${JSON.stringify(result)}\n` : `${result.error.message}\n`);
  process.exitCode = 1;
});
