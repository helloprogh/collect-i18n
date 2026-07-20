import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { discoverLocaleFiles } from "@collect-i18n/analyzer";
import { collectI18nVuePlugin } from "@collect-i18n/vite-vue";
import { BrowserCollector, parseTriggerPlan, type MockRule, type TriggerPlan } from "@collect-i18n/runner";
import { exportTranslationWorkbook, importTranslationWorkbook } from "@collect-i18n/excel";
import type { ProjectConfig } from "@collect-i18n/core";
import { StateStore } from "./store.js";

interface ServiceOptions {
  config: ProjectConfig;
  sessionId: string;
  port?: number;
  studioDirectory?: string;
  capability?: string;
  onShutdownRequest?: () => void | Promise<void>;
}

const CAPABILITY_COOKIE_PREFIX = "collect_i18n_cap_";

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

function requestAuthorized(request: IncomingMessage, cookieName: string, capability: string, serviceUrl: string): boolean {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ") && safeEqual(authorization.slice("Bearer ".length), capability)) return true;
  const explicit = request.headers["x-collect-i18n-capability"];
  if (typeof explicit === "string" && safeEqual(explicit, capability)) return true;
  if (!safeEqual(cookieValue(request, cookieName), capability)) return false;
  const origin = request.headers.origin;
  if (origin && origin !== new URL(serviceUrl).origin) return false;
  const fetchSite = request.headers["sec-fetch-site"];
  return fetchSite === undefined || fetchSite === "same-origin" || fetchSite === "none";
}

export function isPathInside(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let current = path;
  for (;;) {
    try {
      const info = await stat(current);
      return info.isDirectory() ? current : dirname(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error(`无法解析路径：${path}`);
      current = parent;
    }
  }
}

export async function resolveStateFile(projectRoot: string, input: string, mustExist: boolean): Promise<string> {
  const stateRoot = resolve(projectRoot, ".collect-i18n");
  await mkdir(stateRoot, { recursive: true });
  const candidate = resolve(projectRoot, input);
  if (!isPathInside(stateRoot, candidate)) throw new Error("导入/导出文件必须位于项目 .collect-i18n 目录中");
  const realProjectRoot = await realpath(resolve(projectRoot));
  const realRoot = await realpath(stateRoot);
  if (!isPathInside(realProjectRoot, realRoot)) throw new Error("项目 .collect-i18n 目录不能指向项目外部");
  if (mustExist) {
    const realCandidate = await realpath(candidate);
    if (!isPathInside(realRoot, realCandidate)) throw new Error("导入文件不能通过符号链接离开项目 .collect-i18n 目录");
    return realCandidate;
  }
  const existingParent = await nearestExistingDirectory(dirname(candidate));
  const realParent = await realpath(existingParent);
  if (!isPathInside(realRoot, realParent)) throw new Error("导出文件不能通过符号链接离开项目 .collect-i18n 目录");
  try {
    const existingCandidate = await realpath(candidate);
    if (!isPathInside(realRoot, existingCandidate)) throw new Error("导出文件不能通过符号链接离开项目 .collect-i18n 目录");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return candidate;
}

async function bodyJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((sum, value) => sum + value.length, 0) > 2_000_000) throw new Error("Request body is too large");
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function bodyBuffer(request: IncomingMessage, limit = 100 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > limit) throw new Error("Uploaded workbook is too large");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function contentType(file: string): string {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  return "text/html; charset=utf-8";
}

function fallbackStudio(sessionId: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collect I18n</title><style>body{font-family:Inter,"Microsoft YaHei",sans-serif;margin:0;background:#f3f6fb;color:#172033}.shell{max-width:1100px;margin:48px auto;padding:0 24px}.card{background:white;border:1px solid #dfe7f3;border-radius:16px;padding:28px;box-shadow:0 8px 30px #20365b12}button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 18px}pre{white-space:pre-wrap;background:#101828;color:#d1e9ff;padding:18px;border-radius:10px}</style></head><body><main class="shell"><h1>Collect I18n</h1><div class="card"><p>工作台资源尚未构建，核心服务已运行。</p><button onclick="load()">刷新会话</button><pre id="status">正在读取…</pre></div></main><script>const session=${JSON.stringify(sessionId)};async function load(){const r=await fetch('/api/status?session='+encodeURIComponent(session));document.getElementById('status').textContent=JSON.stringify(await r.json(),null,2)}load();setInterval(load,3000)</script></body></html>`;
}

export class LocalService {
  private readonly collectors = new Map<string, BrowserCollector>();
  private readonly capability: string;
  private readonly capabilityCookie: string;
  private vite?: ViteDevServer;
  private store?: StateStore;
  private http?: ReturnType<typeof createHttpServer>;
  private serviceUrl?: string;
  private executionTail: Promise<void> = Promise.resolve();
  private manualGeneration = 0;
  private manualActive = false;
  private deterministicRunning = false;
  private stopping = false;
  private stopPromise?: Promise<void>;

  constructor(private readonly options: ServiceOptions) {
    this.capability = options.capability ?? randomBytes(32).toString("base64url");
    this.capabilityCookie = `${CAPABILITY_COOKIE_PREFIX}${createHash("sha256").update(this.capability).digest("hex").slice(0, 16)}`;
  }

  async start(): Promise<{ serviceUrl: string; studioUrl: string; appUrl: string; capability: string }> {
    const { config } = this.options;
    if (!config.instrumentation.enabled) throw new Error("运行时采集要求 instrumentation.enabled=true");
    process.env.COLLECT_I18N = "1";
    process.env.VITE_COLLECT_I18N = "1";
    const appUrl = new URL(config.app.baseUrl);
    const runtimeImport = `/@fs/${fileURLToPath(import.meta.resolve("@collect-i18n/runtime")).replaceAll("\\", "/")}`;
    this.vite = await createViteServer({
      root: config.projectRoot,
      logLevel: "info",
      plugins: [collectI18nVuePlugin({ projectRoot: config.projectRoot, runtimeImport, manifest: true })],
      server: {
        host: appUrl.hostname,
        port: Number(appUrl.port || 5173),
        strictPort: true,
      },
    });
    await this.vite.listen();
    this.store = await StateStore.open(config.projectRoot);
    const session = this.store.session(this.options.sessionId);
    if (!session || session.status !== "running") throw new Error(`采集会话不可启动：${this.options.sessionId}`);

    this.http = createHttpServer((request, response) => {
      void this.route(request, response).catch((error) => {
        sendJson(response, 500, { ok: false, error: { code: "service_error", message: error instanceof Error ? error.message : String(error) } });
      });
    });
    await new Promise<void>((done, reject) => {
      this.http!.once("error", reject);
      this.http!.listen(this.options.port ?? 0, "127.0.0.1", () => done());
    });
    const address = this.http.address();
    if (!address || typeof address === "string") throw new Error("Unable to determine service port");
    this.serviceUrl = `http://127.0.0.1:${address.port}`;
    this.store.updateService(this.options.sessionId, this.serviceUrl);
    void this.runDeterministicQueue(this.options.sessionId).catch((error) => {
      // The background queue is best-effort. A navigation/compiler failure must
      // never take down the Studio/API that the Agent and human fallback use.
      console.error("[collect-i18n] deterministic queue failed", error);
    });
    const studioUrl = new URL("/auth", this.serviceUrl);
    studioUrl.searchParams.set("capability", this.capability);
    return { serviceUrl: this.serviceUrl, studioUrl: studioUrl.toString(), appUrl: config.app.baseUrl, capability: this.capability };
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.manualGeneration += 1;
    this.manualActive = false;
    this.stopPromise = (async () => {
      // Closing collectors first cancels any in-flight Playwright wait. The
      // serialized queue is then allowed to settle before SQLite is closed.
      for (const collector of this.collectors.values()) await collector.close().catch(() => undefined);
      this.collectors.clear();
      await this.executionTail.catch(() => undefined);
      for (const collector of this.collectors.values()) await collector.close().catch(() => undefined);
      this.collectors.clear();
      await this.vite?.close().catch(() => undefined);
      if (this.store) {
        try { this.store.closeSession(this.options.sessionId, "stopped"); }
        catch (error) { console.error("[collect-i18n] failed to finalize session state", error); }
        finally { this.store.close(); this.store = undefined; }
      }
      if (this.http) {
        const server = this.http;
        this.http = undefined;
        await new Promise<void>((done) => {
          server.close(() => done());
          server.closeIdleConnections?.();
        });
      }
    })();
    return this.stopPromise;
  }

  private async collector(sessionId: string): Promise<BrowserCollector> {
    if (sessionId !== this.options.sessionId) throw new Error(`服务不管理该采集会话：${sessionId}`);
    const existing = this.collectors.get(sessionId);
    if (existing) return existing;
    const { config } = this.options;
    const collector = new BrowserCollector({
      baseUrl: config.app.baseUrl,
      artifactDir: join(config.projectRoot, config.stateDirectory, "evidence", sessionId),
      // Keep a versioned persistent profile so cookies survive sessions while
      // avoiding legacy/corrupted layouts created by pre-release collectors.
      userDataDir: join(config.projectRoot, config.stateDirectory, "browser-profile", "v1"),
      headless: config.browser.headless,
      defaultTimeoutMs: config.browser.timeoutMs,
      viewport: config.browser.viewport,
      locale: config.browser.locale,
      cookies: config.browser.cookies,
      channel: "chrome",
    });
    await collector.start();
    if (this.stopping) {
      await collector.close().catch(() => undefined);
      throw new Error("采集服务正在停止");
    }
    this.collectors.set(sessionId, collector);
    return collector;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopping) throw new Error("采集服务正在停止");
    const previous = this.executionTail;
    let release!: () => void;
    this.executionTail = new Promise<void>((done) => { release = done; });
    await previous;
    try {
      if (this.stopping) throw new Error("采集服务正在停止");
      return await operation();
    }
    finally { release(); }
  }

  private cancelManual(): void {
    this.manualGeneration += 1;
    this.manualActive = false;
  }

  private reliableRoute(task: import("./store.js").StoredTask): string | undefined {
    const hinted = task.routeHints
      .filter((hint): hint is { path: string; confidence: number } =>
        typeof hint === "object" && hint !== null &&
        "path" in hint && typeof hint.path === "string" &&
        "confidence" in hint && Number(hint.confidence) >= 0.8,
      )
      .sort((left, right) => Number(right.confidence) - Number(left.confidence))[0]?.path;
    if (hinted) return hinted;
    const appOccurrence = task.occurrences.some((occurrence) =>
      typeof occurrence === "object" && occurrence !== null &&
      "location" in occurrence && typeof occurrence.location === "object" && occurrence.location !== null &&
      "file" in occurrence.location && /(?:^|\/)src\/App\.vue$/i.test(String((occurrence.location as { file?: unknown }).file)),
    );
    return appOccurrence ? "/" : undefined;
  }

  private async runDeterministicQueue(sessionId: string): Promise<void> {
    if (this.deterministicRunning || this.stopping) return;
    this.deterministicRunning = true;
    const store = this.store!;
    try {
      for (;;) {
        if (this.manualActive) break;
        const seed = store.nextTask(sessionId, ["pending"]);
        if (!seed) break;
        const route = this.reliableRoute(seed);
        if (!route) { store.markTask(seed.id, "needs_agent", "No high-confidence route is available"); continue; }
        const group = store.listTasks(sessionId, ["pending"]).filter((task) => this.reliableRoute(task) === route);
        try {
          await this.exclusive(async () => {
            const collector = await this.collector(sessionId);
            collector.setMockRules([]);
            await collector.open(route);
            for (const task of group) {
              if (this.manualActive) break;
              store.markTask(task.id, "running");
              try {
                const target = await collector.waitForKey(task.keyPath, 2_500);
                const evidence = await collector.capture(target, "deterministic");
                store.addEvidence(task.id, evidence);
              } catch (error) {
                store.markTask(task.id, "needs_agent", error instanceof Error ? error.message : String(error));
              }
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const task of group.filter((candidate) => candidate.status === "pending" || candidate.status === "running")) {
            const current = store.task(task.id);
            if (current?.status === "pending" || current?.status === "running") store.markTask(task.id, "needs_agent", `Route ${route} failed: ${message}`);
          }
          console.error(`[collect-i18n] deterministic route ${route} failed`, error);
        }
      }
    } finally { this.deterministicRunning = false; }
  }

  private async executeAgent(taskId: string, planValue: unknown): Promise<Record<string, unknown>> {
    const store = this.store!;
    const task = store.task(taskId);
    if (!task) throw new Error(`任务不存在：${taskId}`);
    const plan = parseTriggerPlan(planValue);
    if (plan.targetKey !== task.keyPath) throw new Error(`计划目标 ${plan.targetKey} 与任务 ${task.keyPath} 不一致`);
    this.cancelManual();
    store.submitPlan(taskId, plan);
    try {
      const evidence = await this.exclusive(async () => (await this.collector(task.sessionId)).executePlan(plan, "agent"));
      const evidenceId = store.addEvidence(taskId, evidence);
      return { taskId, evidenceId, evidence };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const next = task.attempts >= 1 ? "needs_manual" : "needs_agent";
      store.markTask(taskId, next, message);
      throw new Error(message);
    } finally {
      void this.runDeterministicQueue(task.sessionId);
    }
  }

  private async startManual(sessionId: string, keyPath: string, route?: string, mocks: MockRule[] = []): Promise<Record<string, unknown>> {
    const store = this.store!;
    const task = store.taskByKey(sessionId, keyPath);
    if (!task) throw new Error(`会话中不存在词条：${keyPath}`);
    const generation = ++this.manualGeneration;
    this.manualActive = true;
    store.startManual(task.id);
    try {
      await this.exclusive(async () => {
        if (generation !== this.manualGeneration) return;
        const collector = await this.collector(sessionId);
        collector.setMockRules(mocks);
        if (route) await collector.open(route);
      });
    } catch (error) {
      if (generation === this.manualGeneration) {
        this.manualActive = false;
        store.markTask(task.id, "needs_manual", error instanceof Error ? error.message : String(error));
        void this.runDeterministicQueue(sessionId);
      }
      throw error;
    }
    void this.runManualListener(task.id, sessionId, keyPath, generation);
    return {
      taskId: task.id,
      keyPath,
      chinese: task.chinese,
      sourceFile: task.relativeFile,
      routeHints: task.routeHints,
      actionHints: task.actionHints,
      listening: true,
      generation,
      appUrl: this.options.config.app.baseUrl,
    };
  }

  private async runManualListener(taskId: string, sessionId: string, keyPath: string, generation: number): Promise<void> {
    const deadline = Date.now() + 30 * 60_000;
    while (!this.stopping && generation === this.manualGeneration && Date.now() < deadline) {
      try {
        const captured = await this.exclusive(async () => {
          if (generation !== this.manualGeneration) return false;
          const collector = await this.collector(sessionId);
          const target = await collector.waitForKey(keyPath, 750);
          if (generation !== this.manualGeneration) return false;
          const evidence = await collector.capture(target, "manual");
          if (generation !== this.manualGeneration) return false;
          this.store!.addEvidence(taskId, evidence);
          return true;
        });
        if (captured) {
          if (generation === this.manualGeneration) this.manualActive = false;
          void this.runDeterministicQueue(sessionId);
          return;
        }
      } catch (error) {
        if (this.stopping || generation !== this.manualGeneration) return;
        const message = error instanceof Error ? error.message : String(error);
        if (!/timed out|timeout/i.test(message)) {
          // Navigation can briefly replace the execution context; keep the
          // listener alive, but retain the latest diagnostic for the operator.
          this.store?.markTask(taskId, "needs_manual", message);
        }
      }
      await new Promise((done) => setTimeout(done, 150));
    }
    if (!this.stopping && generation === this.manualGeneration) {
      this.manualActive = false;
      this.store?.markTask(taskId, "needs_manual", `人工监听超时：${keyPath}`);
      void this.runDeterministicQueue(sessionId);
    }
  }

  private async localeRoots(sessionId: string) {
    const store = this.store!;
    const session = store.session(sessionId);
    if (!session) throw new Error(`会话不存在：${sessionId}`);
    const projectRoot = session.project_root as string;
    const files = await discoverLocaleFiles({ projectRoot, roots: this.options.config.locales.roots });
    const targetDirectories = [...new Set(files.filter((file) => file.locale === "en-us").map((file) => file.localeDirectory))];
    if (targetDirectories.length > 1) throw new Error(`检测到多个 en-us 目录，请缩小 locales.roots：${targetDirectories.join("、")}`);
    if (targetDirectories.length === 1) return { projectRoot, englishRoot: targetDirectories[0]! };
    const chineseDirectory = files.find((file) => file.locale === "zh-cn")?.localeDirectory;
    if (!chineseDirectory) throw new Error("未找到 zh-cn 语言包目录");
    return { projectRoot, englishRoot: join(dirname(chineseDirectory), "en-us") };
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.serviceUrl ?? "http://127.0.0.1");
    if (url.pathname === "/auth" && request.method === "GET") {
      const supplied = url.searchParams.get("capability") ?? undefined;
      if (!safeEqual(supplied, this.capability)) {
        sendJson(response, 401, { ok: false, error: { code: "unauthorized", message: "服务令牌无效" } });
        return;
      }
      response.writeHead(303, {
        location: "/",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "set-cookie": `${this.capabilityCookie}=${encodeURIComponent(this.capability)}; HttpOnly; SameSite=Strict; Path=/`,
      });
      response.end();
      return;
    }
    if (url.pathname.startsWith("/api/") && !requestAuthorized(request, this.capabilityCookie, this.capability, this.serviceUrl ?? url.origin)) {
      sendJson(response, 401, { ok: false, error: { code: "unauthorized", message: "缺少有效的本地服务令牌" } });
      return;
    }
    const store = this.store!;
    if (url.pathname === "/api/health") {
      const data = { sessionId: this.options.sessionId };
      sendJson(response, 200, { ok: true, ...data, data });
      return;
    }
    if (url.pathname === "/api/shutdown" && request.method === "POST") {
      sendJson(response, 202, { ok: true, data: { stopping: true, sessionId: this.options.sessionId } });
      setImmediate(() => {
        void (async () => {
          try { await this.stop(); }
          catch (error) { console.error("[collect-i18n] graceful shutdown failed", error); }
          try { await this.options.onShutdownRequest?.(); }
          catch (error) { console.error("[collect-i18n] shutdown finalizer failed", error); }
        })();
      });
      return;
    }
    if (url.pathname === "/api/status") { sendJson(response, 200, { ok: true, data: store.status(url.searchParams.get("session") ?? this.options.sessionId) }); return; }
    if (url.pathname === "/api/events") { sendJson(response, 200, { ok: true, data: store.events(url.searchParams.get("session") ?? this.options.sessionId, Number(url.searchParams.get("after") ?? 0)) }); return; }
    if (url.pathname === "/api/tasks") {
      const rawStatuses = url.searchParams.get("status")?.split(",").filter(Boolean) as import("./store.js").TaskStatus[] | undefined;
      sendJson(response, 200, { ok: true, data: store.listTasks(url.searchParams.get("session") ?? this.options.sessionId, rawStatuses, Number(url.searchParams.get("limit") ?? 500)) }); return;
    }
    if (url.pathname === "/api/evidence") { sendJson(response, 200, { ok: true, data: store.listEvidence(url.searchParams.get("session") ?? this.options.sessionId, Number(url.searchParams.get("limit") ?? 500)) }); return; }
    if (url.pathname === "/api/runtime") {
      const sessionId = url.searchParams.get("session") ?? this.options.sessionId;
      const inspection = await this.exclusive(async () => (await this.collector(sessionId)).inspectRuntime(Number(url.searchParams.get("limit") ?? 200)));
      sendJson(response, 200, { ok: true, data: inspection }); return;
    }
    if (url.pathname === "/api/artifact") {
      const evidence = store.evidence(url.searchParams.get("id") ?? "");
      if (!evidence) { sendJson(response, 404, { ok: false, error: { message: "证据不存在" } }); return; }
      const root = resolve(this.options.config.projectRoot, this.options.config.stateDirectory, "evidence");
      const file = resolve(String(evidence.screenshot_path));
      if (!isPathInside(root, file)) { sendJson(response, 403, { ok: false }); return; }
      response.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=300" }); response.end(await readFile(file)); return;
    }
    if (url.pathname.startsWith("/api/task/") && request.method === "GET") {
      const task = store.task(decodeURIComponent(url.pathname.slice("/api/task/".length)));
      sendJson(response, task ? 200 : 404, task ? { ok: true, data: task } : { ok: false, error: { code: "not_found", message: "任务不存在" } }); return;
    }
    if (url.pathname === "/api/agent/execute" && request.method === "POST") {
      const body = await bodyJson(request);
      sendJson(response, 200, { ok: true, data: await this.executeAgent(String(body.taskId ?? ""), body.plan) }); return;
    }
    if (url.pathname === "/api/manual/open" && request.method === "POST") {
      const body = await bodyJson(request);
      sendJson(response, 200, { ok: true, data: await this.startManual(String(body.sessionId ?? this.options.sessionId), String(body.keyPath ?? ""), typeof body.route === "string" ? body.route : undefined, Array.isArray(body.mocks) ? body.mocks as MockRule[] : []) }); return;
    }
    if (url.pathname === "/api/export" && request.method === "POST") {
      const body = await bodyJson(request);
      const sessionId = String(body.sessionId ?? this.options.sessionId);
      const roots = await this.localeRoots(sessionId);
      const rows = store.localeCatalog(sessionId, roots.englishRoot);
      const output = await resolveStateFile(roots.projectRoot, String(body.output ?? join(roots.projectRoot, ".collect-i18n", "translations.xlsx")), false);
      sendJson(response, 200, { ok: true, data: await exportTranslationWorkbook(rows, output) }); return;
    }
    if (url.pathname === "/api/export-file" && request.method === "GET") {
      const sessionId = url.searchParams.get("session") ?? this.options.sessionId;
      const roots = await this.localeRoots(sessionId);
      const rows = store.localeCatalog(sessionId, roots.englishRoot);
      const exportDirectory = join(roots.projectRoot, ".collect-i18n", "exports");
      await mkdir(exportDirectory, { recursive: true });
      const output = join(exportDirectory, `${sessionId}.xlsx`);
      await exportTranslationWorkbook(rows, output);
      response.writeHead(200, { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="collect-i18n-${sessionId}.xlsx"` });
      response.end(await readFile(output)); return;
    }
    if (url.pathname === "/api/import" && request.method === "POST") {
      const body = await bodyJson(request);
      const sessionId = String(body.sessionId ?? this.options.sessionId);
      const roots = await this.localeRoots(sessionId);
      const catalog = store.localeCatalog(sessionId, roots.englishRoot);
      const workbookPath = await resolveStateFile(roots.projectRoot, String(body.file ?? ""), true);
      const result = await importTranslationWorkbook({ workbookPath, catalog, englishRoot: roots.englishRoot, apply: body.apply === true, backup: true });
      sendJson(response, 200, { ok: true, data: result }); return;
    }
    if (url.pathname === "/api/import-upload" && request.method === "POST") {
      const sessionId = url.searchParams.get("session") ?? this.options.sessionId;
      const roots = await this.localeRoots(sessionId);
      const uploadDirectory = join(roots.projectRoot, ".collect-i18n", "imports");
      await mkdir(uploadDirectory, { recursive: true });
      const file = join(uploadDirectory, `${Date.now()}-translation-return.xlsx`);
      await writeFile(file, await bodyBuffer(request));
      const catalog = store.localeCatalog(sessionId, roots.englishRoot);
      const result = await importTranslationWorkbook({ workbookPath: file, catalog, englishRoot: roots.englishRoot, apply: url.searchParams.get("apply") === "true", backup: true });
      sendJson(response, 200, { ok: true, data: result }); return;
    }
    if (url.pathname.startsWith("/api/")) { sendJson(response, 404, { ok: false, error: { code: "not_found", message: "接口不存在" } }); return; }
    await this.serveStudio(url.pathname, response);
  }

  private async serveStudio(pathname: string, response: ServerResponse): Promise<void> {
    const root = this.options.studioDirectory ? resolve(this.options.studioDirectory) : undefined;
    if (!root) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fallbackStudio(this.options.sessionId));
      return;
    }
    const relativePath = pathname === "/" ? "index.html" : normalize(pathname).replace(/^([/\\])+/, "");
    const candidate = resolve(root, relativePath);
    if (!isPathInside(root, candidate)) { sendJson(response, 403, { ok: false }); return; }
    let file = candidate;
    try { if (!(await stat(file)).isFile()) file = join(root, "index.html"); } catch { file = join(root, "index.html"); }
    response.writeHead(200, {
      "content-type": contentType(file),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(await readFile(file));
  }
}
