#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
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
  if (executable.endsWith(".ts")) throw new Error("后台模式需要先构建 CLI；开发时请使用 start --foreground");
  const logPath = join(projectRoot, ".collect-i18n", "service.log");
  const log = openSync(logPath, "a");
  const child = spawn(process.execPath, [executable, "--project", projectRoot, "serve", "--session", sessionId], {
    cwd: projectRoot,
    detached: true,
    // The service itself has no inherited stdio, so it does not need a console
    // window. Keeping the Windows process visible is intentional: a manual
    // fallback session must be able to show the Playwright-owned browser for
    // the operator to act in it.
    windowsHide: false,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  return waitForDescriptor(projectRoot, sessionId);
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}

async function prepareWorkflow(projectRoot: string): Promise<{ descriptor: ServiceDescriptor; config: ProjectConfig; reused: boolean }> {
  const existing = await descriptorAlive(projectRoot);
  if (existing) return { descriptor: existing, config: await loadConfig(projectRoot), reused: true };

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
  } finally { store.close(); }
  try {
    return { descriptor: await startBackground(projectRoot, sessionId), config, reused: false };
  } catch (error) {
    const failedStore = await StateStore.open(projectRoot);
    try { failedStore.closeSession(sessionId, "failed"); } finally { failedStore.close(); }
    throw error;
  }
}

async function waitForDeterministicQueue(projectRoot: string, sessionId: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const store = await StateStore.open(projectRoot);
    const status = store.status(sessionId);
    store.close();
    const counts = status.counts as Record<string, number>;
    if (counts.pending === 0 && counts.running === 0) return status;
    if (Date.now() >= deadline) return { ...status, deterministicWaitTimedOut: true };
    await new Promise((done) => setTimeout(done, 500));
  }
}

const program = new Command();
program
  .name("collect-i18n")
  .description("Vue 国际化词条运行时证据采集、截图与四列 Excel 往返工具")
  .version("0.2.2")
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
  .action(async (options: { foreground?: boolean }, command) => {
    const projectRoot = projectOf(command);
    const existing = await descriptorAlive(projectRoot);
    if (existing) { output(command, "start", { ...existing, reused: true }); return; }
    await new Promise((done) => setTimeout(done, 250));
    const recovered = await descriptorAlive(projectRoot);
    if (recovered) { output(command, "start", { ...recovered, reused: true }); return; }
    await retireStaleDescriptor(projectRoot);
    const config = await loadConfig(projectRoot);
    if (!config.instrumentation.enabled) throw new Error("运行时采集要求 instrumentation.enabled=true，请修改 .collect-i18n/config.json");
    const analysis = await analyze(config);
    const store = await StateStore.open(projectRoot);
    let sessionId: string;
    try {
      const projectId = store.syncProject(projectRoot, config, analysis);
      sessionId = store.createSession(projectId, config.app.baseUrl);
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
        try { failedStore.closeSession(sessionId, "failed"); } finally { failedStore.close(); }
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
      try { failedStore.closeSession(sessionId, "failed"); } finally { failedStore.close(); }
      throw error;
    }
  });

program.command("run")
  .description("为 Skill 初始化、启动、等待静态采集并生成可立即交付的进度 Excel")
  .option("--output <file>", "Excel 输出路径")
  .option("--deadline-minutes <minutes>", "完整工作流截止时间", "120")
  .option("--deterministic-timeout-minutes <minutes>", "等待静态队列的最长时间", "15")
  .action(async (options: { output?: string; deadlineMinutes: string; deterministicTimeoutMinutes: string }, command) => {
    const projectRoot = projectOf(command);
    const deadlineMinutes = Math.max(1, Number(options.deadlineMinutes) || 120);
    const deterministicTimeoutMinutes = Math.max(1, Number(options.deterministicTimeoutMinutes) || 15);
    const workflow = await prepareWorkflow(projectRoot);
    const status = await waitForDeterministicQueue(projectRoot, workflow.descriptor.sessionId, deterministicTimeoutMinutes * 60_000);
    const englishRoot = await findEnglishRoot(workflow.config);
    const store = await StateStore.open(projectRoot);
    const rows = store.localeCatalog(workflow.descriptor.sessionId, englishRoot);
    store.close();
    const outputPath = resolve(options.output ?? join(projectRoot, ".collect-i18n", "collect-i18n-translations.xlsx"));
    const exported = await exportTranslationWorkbook(rows, outputPath);
    const counts = status.counts as Record<string, number>;
    const nextAction = counts.failed > 0 ? "failed" : counts.needs_agent > 0 ? "agent" : counts.needs_manual > 0 ? "manual" : "complete";
    output(command, "run", {
      sessionId: workflow.descriptor.sessionId,
      studioUrl: workflow.descriptor.studioUrl,
      appUrl: workflow.descriptor.appUrl,
      reused: workflow.reused,
      deadlineAt: new Date(Date.now() + deadlineMinutes * 60_000).toISOString(),
      nextAction,
      status,
      workbook: exported,
    });
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

const agent = program.command("agent").description("由 Agent/Skill 消费的严格任务协议");
agent.command("next")
  .requiredOption("--session <id>")
  .action(async (options: { session: string }, command) => {
    const store = await StateStore.open(projectOf(command));
    const task = store.nextTask(options.session, ["needs_agent"]); const status = store.status(options.session); store.close();
    output(command, "agent.next", { done: !task, task, status });
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
  .action(async (_options, command) => {
    const projectRoot = projectOf(command);
    let descriptor: ServiceDescriptor;
    try { descriptor = await readServiceDescriptor(projectRoot); }
    catch {
      await retireStaleDescriptor(projectRoot);
      output(command, "stop", { stopped: false, alreadyStopped: true });
      return;
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
