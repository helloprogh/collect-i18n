import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProjectAnalysis } from "@collect-i18n/analyzer";
import type { CollectedEvidence } from "@collect-i18n/runner";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveStateRoot } from "./state-root.js";
import { agentActionScore, agentTaskPriority, preferredAgentRoute, representativeRouteTasks, StateStore, type StoredTask } from "./store.js";

const temporaryRoots: string[] = [];

// Volatile state lives in an external root; tests redirect it to a temp dir
// so the suite never writes to the real user home.
beforeEach(() => {
  const base = join(tmpdir(), `collect-i18n-state-${randomUUID()}`);
  temporaryRoots.push(base);
  process.env.COLLECT_I18N_STATE_DIR = base;
});

afterEach(() => {
  delete process.env.COLLECT_I18N_STATE_DIR;
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function root(): string {
  const value = join(tmpdir(), `collect-i18n-store-${randomUUID()}`);
  temporaryRoots.push(value);
  return value;
}

function analysis(chinese = "保存", duplicate = false): ProjectAnalysis {
  const key = {
    id: "locale_save",
    keyPath: "form.save",
    namespace: "form",
    relativeFile: "form.json",
    jsonPath: ["save"],
    sourceText: chinese,
    sourceLocale: "zh-cn" as const,
    targetLocale: "en-us" as const,
  };
  return {
    catalog: { keys: duplicate ? [key, { ...key, id: "duplicate" }] : [key], files: [], diagnostics: [] },
    source: {
      occurrences: [{
        id: "occ_form_save",
        keyPath: "form.save",
        kind: "text_range",
        location: { file: "src/views/JobsView.vue", line: 1, column: 0 },
        expression: "t('form.save')",
        teleported: false,
        dynamic: false,
        confidence: 0.99,
        routeHints: [],
        actionHints: [],
      }],
      routeHints: [],
      actionHints: [],
      diagnostics: [],
      scannedFiles: [],
    },
    unusedKeys: [key],
    unknownKeys: [],
  };
}

function database(store: StateStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db;
}

function analysisForKeys(keyPaths: string[]): ProjectAnalysis {
  const seed = analysis();
  const keys = keyPaths.map((keyPath, index) => ({
    ...seed.catalog.keys[0]!,
    id: `locale_${index}`,
    keyPath,
    namespace: keyPath.split(".")[0] ?? "fixture",
    relativeFile: `${keyPath.split(".")[0] ?? "fixture"}.json`,
    jsonPath: keyPath.split("."),
    sourceText: `text-${index}`,
  }));
  return { ...seed, catalog: { ...seed.catalog, keys }, unusedKeys: keys };
}

function analysisWithOccurrence(
  kind: "native_dom" | "text_range" | "component_prop" | "imperative_service",
  routeConfidence?: number,
): ProjectAnalysis {
  const seed = analysis()
  const key = seed.catalog.keys[0]!
  return {
    ...seed,
    source: {
      ...seed.source,
      occurrences: [{
        id: "occ_fixture",
        keyPath: key.keyPath,
        kind,
        location: { file: "src/views/JobsView.vue", line: 1, column: 0 },
        expression: "t('form.save')",
        component: kind === "component_prop" ? "el-table-column" : undefined,
        property: kind === "component_prop" ? "label" : undefined,
        teleported: kind === "imperative_service",
        dynamic: false,
        confidence: 0.99,
        routeHints: routeConfidence === undefined ? [] : [{ path: "/jobs", source: "router_config", confidence: routeConfidence }],
        actionHints: [],
      }],
    },
  }
}

function analysisForAgentQueue(): ProjectAnalysis {
  const seed = analysisForKeys([
    "static.title",
    "static.chart",
    "users.form.submit",
    "users.table.delete",
    "orders.form.save",
  ]);
  return {
    ...seed,
    source: {
      ...seed.source,
      occurrences: [
        {
          id: "occ_users_submit",
          keyPath: "users.form.submit",
          kind: "imperative_service",
          location: { file: "src/views/UsersView.vue", line: 1, column: 0 },
          expression: "t('users.form.submit')",
          teleported: true,
          dynamic: false,
          confidence: 0.99,
          routeHints: [{ path: "/users", source: "router_config", confidence: 0.99 }],
          actionHints: [{ kind: "click", selector: "[data-testid=users-submit]", source: "template", confidence: 0.99 }],
        },
        {
          id: "occ_users_delete",
          keyPath: "users.table.delete",
          kind: "imperative_service",
          location: { file: "src/views/UsersView.vue", line: 2, column: 0 },
          expression: "t('users.table.delete')",
          teleported: true,
          dynamic: false,
          confidence: 0.99,
          routeHints: [{ path: "/users", source: "router_config", confidence: 0.99 }],
          actionHints: [],
        },
        {
          id: "occ_orders_save",
          keyPath: "orders.form.save",
          kind: "component_prop",
          location: { file: "src/views/OrdersView.vue", line: 1, column: 0 },
          expression: "t('orders.form.save')",
          component: "el-button",
          property: "label",
          teleported: false,
          dynamic: false,
          confidence: 0.99,
          routeHints: [{ path: "/orders", source: "router_config", confidence: 0.99 }],
          actionHints: [{ kind: "click", source: "template", confidence: 0.99 }],
        },
      ],
    },
  };
}
function analysisForFinalize(): ProjectAnalysis {
  const seed = analysisForKeys([
    "fixture.unused",
    "fixture.accessible",
    "fixture.nativeTitle",
    "fixture.visible",
  ]);
  return {
    ...seed,
    source: {
      ...seed.source,
      occurrences: [
        {
          id: "occ_accessible",
          keyPath: "fixture.accessible",
          kind: "native_dom",
          location: { file: "src/views/FixtureView.vue", line: 1, column: 0 },
          expression: "t('fixture.accessible')",
          property: "aria-label",
          teleported: false,
          dynamic: false,
          confidence: 0.99,
          routeHints: [],
          actionHints: [],
        },
        {
          id: "occ_native_title",
          keyPath: "fixture.nativeTitle",
          kind: "native_dom",
          location: { file: "src/views/FixtureView.vue", line: 2, column: 0 },
          expression: "t('fixture.nativeTitle')",
          property: "title",
          teleported: false,
          dynamic: false,
          confidence: 0.99,
          routeHints: [],
          actionHints: [],
        },
        {
          id: "occ_visible",
          keyPath: "fixture.visible",
          kind: "text_range",
          location: { file: "src/views/FixtureView.vue", line: 3, column: 0 },
          expression: "t('fixture.visible')",
          teleported: false,
          dynamic: false,
          confidence: 0.99,
          routeHints: [],
          actionHints: [],
        },
      ],
    },
  };
}

function evidence(source: CollectedEvidence["source"] = "deterministic"): CollectedEvidence {
  return {
    key: "form.save",
    text: "保存",
    route: "http://127.0.0.1:5173/form",
    rect: { x: 1, y: 2, width: 30, height: 20 },
    screenshotPath: "D:/evidence/form.save.png",
    screenshotSha256: "0".repeat(64),
    capturedAt: new Date().toISOString(),
    source,
    evidenceGrade: source === "deterministic" ? "A" : source === "agent" ? "B" : "C",
    evidenceProof:
      source === "deterministic"
        ? "compiler-text-sink"
        : source === "agent"
          ? "compiler-component-scope"
          : "text-heuristic",
  };
}

describe("StateStore transactions", () => {
  it("prioritizes retryable and actionable Agent tasks over descriptor-only keys", () => {
    const base: StoredTask = {
      id: "task",
      sessionId: "session",
      keyPath: "dialog.body",
      status: "needs_agent",
      stage: "agent",
      chinese: "Body",
      relativeFile: "dialog.json",
      occurrences: [],
      routeHints: [],
      actionHints: [],
      attempts: 0,
    };
    const actionable = {
      ...base,
      occurrences: [{ kind: "text_range" }],
      routeHints: [{ path: "/dialog", confidence: 0.99 }],
      actionHints: [{ kind: "click", selector: "[data-testid=dialog-open]" }],
    };

    expect(agentTaskPriority(actionable)).toBeGreaterThan(agentTaskPriority(base));
    expect(agentTaskPriority({ ...base, attempts: 1 })).toBeGreaterThan(
      agentTaskPriority(actionable),
    );
  });

  it("prefers an explicit router route over a component fallback route", () => {
    const task = {
      id: "task",
      sessionId: "session",
      keyPath: "orders.title",
      status: "needs_agent",
      stage: "agent",
      chinese: "Orders",
      relativeFile: "orders.json",
      occurrences: [],
      routeHints: [
        { path: "/components/OrdersView.vue", source: "component_usage", confidence: 0.9 },
        { path: "/orders", source: "router_config", confidence: 0.8 },
      ],
      actionHints: [],
      attempts: 0,
    } satisfies StoredTask;

    expect(preferredAgentRoute(task)).toBe("/orders");
  });

  it("keeps route planning context small, anchored, and representative", () => {
    const makeTask = (index: number, section: string, kind: string): StoredTask => ({
      id: `task_${index}`,
      sessionId: "session",
      keyPath: `permissions.${section}.key${index}`,
      status: "needs_agent",
      stage: "agent",
      chinese: `Text ${index}`,
      relativeFile: "permissions.json",
      occurrences: [{ kind, service: kind === "imperative_service" ? "ElMessage" : undefined }],
      routeHints: [{ path: "/permissions", source: "router_config", confidence: 0.99 }],
      actionHints: kind === "imperative_service" ? [{ kind: "click" }] : [],
      attempts: 0,
    });
    const tasks = Array.from({ length: 40 }, (_, index) =>
      makeTask(index, ["dialog", "members", "tree", "log"][index % 4]!, ["text_range", "component_prop", "native_dom", "imperative_service"][index % 4]!),
    );
    const anchor = tasks[37]!;

    const selected = representativeRouteTasks(tasks, anchor);

    expect(selected).toHaveLength(12);
    expect(selected[0]).toBe(anchor);
    expect(new Set(selected.map((task) => task.keyPath.split(".")[1])).size).toBeGreaterThan(1);
    expect(new Set(selected.flatMap((task) => task.occurrences.map((item) => (item as { kind: string }).kind))).size).toBeGreaterThan(1);
  });

  it("persists the end-to-end workflow deadline on the session", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const deadlineAt = "2030-01-02T03:04:05.000Z";

    store.setDeadline(sessionId, deadlineAt);

    expect(store.session(sessionId)?.deadline_at).toBe(deadlineAt);
    expect(store.status(sessionId).deadline_at).toBe(deadlineAt);
    store.close();
  });

  it("probes routed component props in the deterministic stage", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const routedProject = store.syncProject(projectRoot, {}, analysisWithOccurrence("component_prop", 0.99));
    const routedSession = store.createSession(routedProject, "http://127.0.0.1:5173");
    expect(store.taskByKey(routedSession, "form.save")).toMatchObject({ status: "pending", stage: "deterministic" });
    store.closeSession(routedSession);

    const unroutedProject = store.syncProject(projectRoot, {}, analysisWithOccurrence("component_prop"));
    const unroutedSession = store.createSession(unroutedProject, "http://127.0.0.1:5173");
    expect(store.taskByKey(unroutedSession, "form.save")).toMatchObject({ status: "needs_agent", stage: "agent" });
    store.close();
  });

  it("resumes an interrupted session and recovers in-flight tasks by stage", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const deterministicProject = store.syncProject(
      projectRoot,
      {},
      analysisWithOccurrence("native_dom", 0.99),
    );
    const deterministicSession = store.createSession(
      deterministicProject,
      "http://127.0.0.1:5173",
    );
    const deterministicTask = store.taskByKey(deterministicSession, "form.save");
    if (!deterministicTask) throw new Error("missing deterministic fixture task");
    store.markTask(deterministicTask.id, "running");
    store.closeSession(deterministicSession, "interrupted");

    store.resumeSession(deterministicSession);
    expect(store.session(deterministicSession)?.status).toBe("running");
    expect(store.task(deterministicTask.id)).toMatchObject({
      status: "pending",
      stage: "deterministic",
      lastError: undefined,
    });
    store.closeSession(deterministicSession);

    const agentProject = store.syncProject(projectRoot, {}, analysis());
    const agentSession = store.createSession(agentProject, "http://127.0.0.1:5173");
    const agentTask = store.taskByKey(agentSession, "form.save");
    if (!agentTask) throw new Error("missing Agent fixture task");
    store.submitPlan(agentTask.id, { version: 1 });
    store.closeSession(agentSession, "interrupted");

    store.resumeSession(agentSession);
    expect(store.task(agentTask.id)).toMatchObject({
      status: "needs_agent",
      stage: "agent",
      attempts: 1,
      lastError: "Agent 执行被中断；重试前请检查已保存的计划",
    });
    expect(store.events(agentSession).find((event) => event.type === "session.resumed")).toMatchObject({
      origin: "system",
      data: { previousStatus: "interrupted", origin: "system" },
    });
    store.close();
  });

  it("does not resume a failed session or displace another active session", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const firstSession = store.createSession(projectId, "http://127.0.0.1:5173");
    store.closeSession(firstSession);
    const activeSession = store.createSession(projectId, "http://127.0.0.1:5173");

    expect(() => store.resumeSession(firstSession)).toThrow(activeSession);
    store.closeSession(activeSession, "failed");
    expect(() => store.resumeSession(activeSession)).toThrow("不能恢复");
    store.close();
  });

  it("rolls back a catalog refresh and protects an active session snapshot", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    expect(() => store.syncProject(projectRoot, {}, analysis("新值"))).toThrow("活动采集会话");
    store.closeSession(sessionId);
    expect(() => store.syncProject(projectRoot, {}, analysis("破坏值", true))).toThrow();
    expect(store.localeCatalog(sessionId, join(projectRoot, "en-us"))[0]?.chinese).toBe("保存");
    store.close();
  });

  it("keeps a closed session catalog stable after the project is rescanned", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const original = analysis("旧文案");
    original.catalog.keys[0]!.targetText = "Old translation";
    const projectId = store.syncProject(projectRoot, {}, original);
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");
    store.closeSession(sessionId);

    const updated = analysis("新文案");
    updated.catalog.keys[0]!.targetText = "New translation";
    updated.catalog.keys[0]!.relativeFile = "renamed.json";
    updated.catalog.keys[0]!.jsonPath = ["renamed"];
    store.syncProject(projectRoot, {}, updated);

    expect(store.task(task.id)).toMatchObject({ chinese: "旧文案", relativeFile: "form.json" });
    expect(store.nextTask(sessionId, ["needs_agent"])).toMatchObject({ chinese: "旧文案", relativeFile: "form.json" });
    expect(store.localeCatalog(sessionId, join(projectRoot, "en-us"))).toEqual([
      expect.objectContaining({
        keyPath: "form.save",
        chinese: "旧文案",
        english: "Old translation",
        relativeFile: "form.json",
        jsonPath: ["save"],
      }),
    ]);

    const newSessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    expect(store.nextTask(newSessionId, ["needs_agent"])).toMatchObject({ chinese: "新文案", relativeFile: "renamed.json" });
    store.close();
  });

  it("backfills session locale snapshots for a legacy database", async () => {
    const projectRoot = root();
    const legacyStore = await StateStore.open(projectRoot);
    const projectId = legacyStore.syncProject(projectRoot, {}, analysis("历史文案"));
    const sessionId = legacyStore.createSession(projectId, "http://127.0.0.1:5173");
    const taskId = legacyStore.taskByKey(sessionId, "form.save")?.id;
    if (!taskId) throw new Error("missing fixture task");
    legacyStore.closeSession(sessionId);
    database(legacyStore).exec("DROP TABLE session_locale_keys");
    legacyStore.close();

    const migratedStore = await StateStore.open(projectRoot);
    expect(migratedStore.task(taskId)).toMatchObject({ chinese: "历史文案", relativeFile: "form.json" });
    expect(migratedStore.localeCatalog(sessionId, join(projectRoot, "en-us"))).toEqual([
      expect.objectContaining({ keyPath: "form.save", chinese: "历史文案" }),
    ]);
    migratedStore.close();
  });

  it("migrates legacy evidence identity columns and removes repeated hashes", async () => {
    const projectRoot = root();
    const legacyStore = await StateStore.open(projectRoot);
    const projectId = legacyStore.syncProject(projectRoot, {}, analysis());
    const sessionId = legacyStore.createSession(projectId, "http://127.0.0.1:5173");
    const task = legacyStore.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");
    legacyStore.addEvidence(task.id, evidence("agent"));
    legacyStore.close();

    const legacyDb = new DatabaseSync(join(resolveStateRoot(projectRoot), "state.sqlite"));
    legacyDb.exec(`
      DROP INDEX idx_evidence_task_sha;
      ALTER TABLE evidence DROP COLUMN screenshot_sha256;
      ALTER TABLE evidence DROP COLUMN evidence_grade;
      ALTER TABLE projects DROP COLUMN has_unresolved_dynamic;
    `);
    legacyDb.prepare(`
      INSERT INTO evidence(id,session_id,task_id,key_path,source,screenshot_path,route,data_json,captured_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      "evidence_legacy_duplicate",
      sessionId,
      task.id,
      task.keyPath,
      "manual",
      "D:/evidence/legacy-duplicate.png",
      "http://127.0.0.1:5173/form",
      JSON.stringify(evidence("manual")),
      new Date().toISOString(),
    );
    legacyDb.close();

    const migratedStore = await StateStore.open(projectRoot);
    expect(migratedStore.listEvidence(sessionId)).toEqual([
      expect.objectContaining({
        source: "agent",
        screenshot_sha256: "0".repeat(64),
        evidence_grade: "B",
      }),
    ]);
    expect(database(migratedStore).prepare("SELECT has_unresolved_dynamic FROM projects WHERE id=?")
      .get(projectId)).toEqual({ has_unresolved_dynamic: 0 });
    migratedStore.close();
  });

  it("rolls back the session row when task creation fails", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    database(store).exec("CREATE TRIGGER reject_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(FAIL, 'reject task'); END;");
    expect(() => store.createSession(projectId, "http://127.0.0.1:5173")).toThrow("reject task");
    expect(store.latestSession()).toBeUndefined();
    store.close();
  });

  it("rolls back evidence when the task transition fails", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");
    database(store).exec("CREATE TRIGGER reject_capture BEFORE UPDATE OF status ON tasks WHEN NEW.status='captured' BEGIN SELECT RAISE(FAIL, 'reject capture'); END;");
    expect(() => store.addEvidence(task.id, evidence())).toThrow("reject capture");
    expect(store.listEvidence(sessionId)).toHaveLength(0);
    expect(store.task(task.id)?.status).toBe("needs_agent");
    store.close();
  });

  it("rejects evidence for a different key without changing task state", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");

    expect(() => store.addEvidence(task.id, { ...evidence(), key: "form.other" }))
      .toThrow("does not match task key");
    expect(store.listEvidence(sessionId)).toHaveLength(0);
    expect(store.task(task.id)?.status).toBe("needs_agent");
    expect(store.events(sessionId).some((event) => event.type === "task.captured")).toBe(false);
    store.close();
  });

  it("selects the newest evidence for the exact task and breaks timestamp ties by insertion order", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const firstSessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const firstTask = store.nextTask(firstSessionId, ["needs_agent"]);
    if (!firstTask) throw new Error("missing fixture task");
    const capturedAt = "2026-07-21T00:00:00.000Z";
    store.addEvidence(firstTask.id, { ...evidence(), screenshotPath: "D:/evidence/first.png", capturedAt });
    store.addEvidence(firstTask.id, { ...evidence(), screenshotPath: "D:/evidence/second.png", capturedAt });
    store.closeSession(firstSessionId);

    const secondSessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const secondTask = store.nextTask(secondSessionId, ["needs_agent"]);
    if (!secondTask) throw new Error("missing second fixture task");
    database(store).prepare(`
      INSERT INTO evidence(id,session_id,task_id,key_path,source,screenshot_path,route,data_json,captured_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      "evidence_cross_task",
      firstSessionId,
      secondTask.id,
      firstTask.keyPath,
      "agent",
      "D:/evidence/wrong-task.png",
      "http://127.0.0.1:5173/form",
      JSON.stringify(evidence("agent")),
      "2026-07-22T00:00:00.000Z",
    );

    expect(store.localeCatalog(firstSessionId, join(projectRoot, "en-us"))[0]?.screenshotPath)
      .toBe("D:/evidence/second.png");
    store.close();
  });

  it("clears a stale error when manual listening restarts", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");

    store.markTask(task.id, "needs_manual", "previous timeout");
    store.startManual(task.id);

    expect(store.task(task.id)).toMatchObject({
      status: "needs_manual",
      stage: "manual",
      lastError: undefined,
    });
    store.close();
  });

  it("pre-classifies no-source and non-visual-only keys as skipped when the session is created", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysisForFinalize());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");

    expect(store.taskByKey(sessionId, "fixture.unused")).toMatchObject({ status: "skipped" });
    expect(store.taskByKey(sessionId, "fixture.accessible")).toMatchObject({ status: "skipped" });
    expect(store.taskByKey(sessionId, "fixture.nativeTitle")).toMatchObject({ status: "skipped" });
    expect(store.taskByKey(sessionId, "fixture.visible")).toMatchObject({ status: "needs_agent" });
    expect(store.status(sessionId)).toMatchObject({
      counts: { total: 4, skipped: 3, needs_agent: 1, pending: 0 },
      exportReady: true,
    });
    const skipReasons = store.events(sessionId)
      .filter((event) => event.type === "task.skipped")
      .map((event) => (event.data as { reason?: string })?.reason)
      .sort();
    expect(skipReasons).toEqual(["no_source_occurrence", "non_visual_source_only", "non_visual_source_only"]);
    store.close();
  });

  it("annotates the locale catalog with deprecated and non-visual screenshot notes", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysisForFinalize());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");

    const catalog = store.localeCatalog(sessionId, join(projectRoot, "en-us"));
    const byKey = new Map(catalog.map((row) => [row.keyPath, row]));
    expect(byKey.get("fixture.unused")?.deprecated).toBe(true);
    expect(byKey.get("fixture.unused")?.nonVisual).toBe(false);
    expect(byKey.get("fixture.accessible")?.deprecated).toBe(false);
    expect(byKey.get("fixture.accessible")?.nonVisual).toBe(true);
    expect(byKey.get("fixture.nativeTitle")?.nonVisual).toBe(true);
    expect(byKey.get("fixture.visible")?.deprecated).toBe(false);
    expect(byKey.get("fixture.visible")?.nonVisual).toBe(false);
    store.close();
  });

  it("keeps no-source keys for manual confirmation when unresolved dynamic calls exist", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const input = analysisForKeys(["dynamic.possible", "static.known"]);
    input.source.occurrences = input.source.occurrences.filter(
      (occurrence) => occurrence.keyPath === "static.known",
    );
    input.source.diagnostics.push({
      code: "dynamic_translation_key",
      severity: "warning",
      message: "dynamic",
    });
    const projectId = store.syncProject(projectRoot, {}, input);
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");

    expect(store.taskByKey(sessionId, "dynamic.possible")).toMatchObject({
      status: "needs_manual",
      stage: "manual",
      lastError: expect.stringContaining("动态 i18n"),
    });
    expect(store.events(sessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "task.needs_manual",
        data: expect.objectContaining({ reason: "unresolved_dynamic_source" }),
      }),
    ]));
    store.close();
  });

  it("finalizes unresolved keys without inventing screenshots for non-visual content", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysisForFinalize());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");

    for (const keyPath of [
      "fixture.unused",
      "fixture.accessible",
      "fixture.nativeTitle",
      "fixture.visible",
    ]) {
      const task = store.taskByKey(sessionId, keyPath);
      if (!task) throw new Error(`missing fixture task: ${keyPath}`);
      store.markTask(task.id, "needs_agent");
    }

    expect(store.finalizeUnresolved(sessionId)).toEqual({
      skippedNoSource: ["fixture.unused"],
      skippedNonVisual: ["fixture.accessible", "fixture.nativeTitle"],
      needsManual: ["fixture.visible"],
      deadKeys: [{ keyPath: "fixture.unused", file: "fixture.json" }],
    });
    expect(store.status(sessionId)).toMatchObject({
      counts: {
        skipped: 3,
        needs_manual: 1,
        needs_agent: 0,
      },
      manualPercent: 25,
      exportReady: true,
    });
    expect(store.taskByKey(sessionId, "fixture.unused")).toMatchObject({
      status: "skipped",
      skipReason: "no_source_occurrence",
    });
    expect(store.taskByKey(sessionId, "fixture.accessible")).toMatchObject({
      status: "skipped",
      skipReason: "non_visual_source_only",
    });
    expect(store.taskByKey(sessionId, "fixture.visible")).toMatchObject({
      status: "needs_manual",
      skipReason: null,
    });
    expect(store.events(sessionId).filter((event) =>
      event.data && typeof event.data === "object" && "reason" in event.data
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "task.skipped",
        origin: "system",
        data: expect.objectContaining({ reason: "no_source_occurrence" }),
      }),
      expect.objectContaining({
        type: "task.skipped",
        origin: "system",
        data: expect.objectContaining({ reason: "non_visual_source_only" }),
      }),
      expect.objectContaining({
        type: "task.needs_manual",
        origin: "system",
        data: expect.objectContaining({ reason: "assisted_manual_fallback" }),
      }),
    ]));
    store.close();
  });

  it("records the execution stage and evidence source on task events", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");

    store.submitPlan(task.id, { version: 1 });
    store.addEvidence(task.id, evidence("agent"));

    expect(store.events(sessionId).find((event) => event.type === "agent.plan_submitted")).toMatchObject({
      origin: "agent",
      data: { taskId: task.id, stage: "agent", origin: "agent" },
    });
    expect(store.events(sessionId).find((event) => event.type === "task.captured")).toMatchObject({
      origin: "agent",
      data: {
        taskId: task.id,
        evidenceId: expect.stringMatching(/^evidence_/),
        stage: "agent",
        source: "agent",
        origin: "agent",
      },
    });
    store.close();
  });

  it("enforces the Agent retry budget and does not reopen manual tasks", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");

    store.submitPlan(task.id, { version: 1 });
    store.markTask(task.id, "needs_agent", "first failure");
    store.submitPlan(task.id, { version: 1 });
    store.markTask(task.id, "needs_manual", "second failure");

    expect(() => store.savePlan(task.id, { version: 1 })).toThrow("needs_manual");
    expect(() => store.submitPlan(task.id, { version: 1 })).toThrow("needs_manual");
    expect(store.task(task.id)).toMatchObject({ status: "needs_manual", attempts: 2 });
    store.close();
  });

  it("deduplicates identical screenshot content and keeps distinct pixels as separate evidence", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");

    const firstId = store.addEvidence(task.id, evidence("agent"));
    const dedupedId = store.addEvidence(task.id, { ...evidence("agent"), screenshotPath: "D:/evidence/form.save-latest.png" });
    expect(dedupedId).toBe(firstId);
    expect(store.status(sessionId)).toMatchObject({
      screenshotCount: 1,
      uniqueScreenshotCount: 1,
      duplicateEvidenceCount: 0,
      evidenceCount: 1,
      capturedKeyCount: 1,
      historicalEvidenceCount: 0,
      duplicateHashCount: 0,
      coveragePercent: 100,
      manualPercent: 0,
      exportReady: true,
      automatic: {
        phase: "complete",
        processed: 1,
        total: 1,
        percent: 100,
        captured: 1,
        deferred: 0,
        failed: 0,
      },
    });

    store.addEvidence(task.id, { ...evidence("agent"), screenshotPath: "D:/evidence/form.save-other.png", screenshotSha256: "1".repeat(64) });
    expect(store.status(sessionId)).toMatchObject({
      screenshotCount: 2,
      uniqueScreenshotCount: 1,
      duplicateEvidenceCount: 0,
      evidenceCount: 2,
      capturedKeyCount: 1,
      historicalEvidenceCount: 1,
      duplicateHashCount: 0,
    });

    const repeatedFirstId = store.addEvidence(task.id, {
      ...evidence("manual"),
      screenshotPath: "D:/evidence/form.save-first-again.png",
    });
    expect(repeatedFirstId).toBe(firstId);
    expect(store.status(sessionId)).toMatchObject({
      evidenceCount: 2,
      historicalEvidenceCount: 1,
      duplicateHashCount: 0,
    });
    const retained = store.listEvidence(sessionId).find((item) => item.id === firstId);
    expect(retained).toMatchObject({ source: "agent", evidence_grade: "B" });
    store.close();
  });

  it("rejects evidence below the minimum grade for its automatic stage", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysisWithOccurrence("native_dom", 0.99));
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["pending"]);
    if (!task) throw new Error("missing deterministic fixture task");

    expect(() => store.addEvidence(task.id, {
      ...evidence("deterministic"),
      evidenceGrade: "B",
      evidenceProof: "compiler-component-scope",
    })).toThrow("requires grade A");

    store.markTask(task.id, "needs_agent");
    expect(() => store.addEvidence(task.id, {
      ...evidence("agent"),
      evidenceGrade: "C",
      evidenceProof: "text-heuristic",
    })).toThrow("requires grade B");
    store.close();
  });

  it("pages tasks by a stable key cursor and applies status filters", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysisForKeys(["z.last", "a.first", "m.middle"]));
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    store.markTask(store.taskByKey(sessionId, "z.last")!.id, "needs_manual");

    const first = store.taskPage(sessionId, undefined, undefined, 2);
    expect(first.items.map((task) => task.keyPath)).toEqual(["a.first", "m.middle"]);
    expect(first).toMatchObject({ nextAfterKey: "m.middle", hasMore: true });
    expect(store.taskPage(sessionId, undefined, first.nextAfterKey ?? undefined, 2)).toMatchObject({
      items: [expect.objectContaining({ keyPath: "z.last" })],
      nextAfterKey: null,
      hasMore: false,
    });
    expect(store.taskPage(sessionId, ["needs_manual"], undefined, 10).items.map((task) => task.keyPath)).toEqual(["z.last"]);

    const taskIndexes = database(store).prepare("PRAGMA index_list('tasks')").all() as Array<{ name: string }>;
    const eventIndexes = database(store).prepare("PRAGMA index_list('events')").all() as Array<{ name: string }>;
    expect(taskIndexes.map((index) => index.name)).toContain("idx_tasks_session_status_key_path");
    expect(eventIndexes.map((index) => index.name)).toContain("idx_events_session_id");
    store.close();
  });

  it("enumerates more than two thousand tasks without truncation", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const keyPaths = Array.from({ length: 2_101 }, (_, index) => `bulk.key_${String(index).padStart(4, "0")}`);
    const projectId = store.syncProject(projectRoot, {}, analysisForKeys(keyPaths));
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const collected: string[] = [];
    let afterKey: string | undefined;

    for (;;) {
      const page = store.taskPage(sessionId, undefined, afterKey, 137);
      collected.push(...page.items.map((task) => task.keyPath));
      if (!page.hasMore) break;
      afterKey = page.nextAfterKey ?? undefined;
    }

    expect(collected).toEqual(keyPaths);
    expect(new Set(collected).size).toBe(2_101);
    expect(store.status(sessionId).counts).toMatchObject({
      needs_agent: 0,
      skipped: 2_101,
      total: 2_101,
    });
    // No-source keys are pre-classified at session creation, so finalize
    // finds nothing left to classify.
    expect(store.finalizeUnresolved(sessionId).skippedNoSource).toHaveLength(0);
    expect(store.finalizeUnresolved(sessionId).deadKeys).toHaveLength(0);
    store.close();
  });

  it("pages events and maps only safe legacy namespaces to an origin", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const insert = database(store).prepare("INSERT INTO events(session_id,type,data_json,created_at) VALUES(?,?,?,?)");
    const now = new Date().toISOString();
    insert.run(sessionId, "agent.legacy", "{}", now);
    insert.run(sessionId, "manual.legacy", "{}", now);
    insert.run(sessionId, "session.legacy", "{}", now);
    insert.run(sessionId, "task.captured", JSON.stringify({ stage: "agent", source: "agent" }), now);
    insert.run(sessionId, "other.legacy", JSON.stringify({ origin: "unsafe" }), now);

    const first = store.eventPage(sessionId, 0, 2);
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextAfter).toBe(first.items[1]!.id);
    const remaining = store.eventPage(sessionId, first.nextAfter, 10);
    expect(remaining.hasMore).toBe(false);
    expect(remaining.nextAfter).toBe(remaining.items.at(-1)!.id);

    const origins = new Map([...first.items, ...remaining.items].map((event) => [event.type, event.origin]));
    expect(origins.get("session.created")).toBe("system");
    expect(origins.get("agent.legacy")).toBe("agent");
    expect(origins.get("manual.legacy")).toBe("manual");
    expect(origins.get("session.legacy")).toBe("system");
    expect(origins.get("task.captured")).toBe("unknown");
    expect(origins.get("other.legacy")).toBe("unknown");
    store.close();
  });
});

  it("scores interaction potential from action and imperative-service hints", () => {
    const base: StoredTask = {
      id: "task",
      sessionId: "session",
      keyPath: "dialog.body",
      status: "needs_agent",
      stage: "agent",
      chinese: "Body",
      relativeFile: "dialog.json",
      occurrences: [],
      routeHints: [],
      actionHints: [],
      attempts: 0,
    };
    expect(agentActionScore(base)).toBe(0);
    expect(agentActionScore({ ...base, actionHints: [{ kind: "click" }, { kind: "click" }] })).toBe(4_000);
    expect(agentActionScore({
      ...base,
      occurrences: [
        { kind: "imperative_service" },
        { kind: "text_range" },
        { kind: "imperative_service" },
      ],
    })).toBe(1_600);
  });

  it("excludes zero-occurrence keys from the Agent anchor queue", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysisForAgentQueue());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    for (const keyPath of [
      "static.title",
      "static.chart",
      "users.form.submit",
      "users.table.delete",
      "orders.form.save",
    ]) {
      const task = store.taskByKey(sessionId, keyPath);
      if (!task) throw new Error(`missing fixture task: ${keyPath}`);
      store.markTask(task.id, "needs_agent");
    }

    const selected: string[] = [];
    for (let i = 0; i < 3; i++) {
      const task = store.nextAgentTask(sessionId);
      if (!task) break;
      selected.push(task.keyPath);
      store.markTask(task.id, "captured");
    }
    expect(selected).toHaveLength(3);
    expect(selected).not.toContain("static.title");
    expect(selected).not.toContain("static.chart");
    expect(selected.sort()).toEqual(["orders.form.save", "users.form.submit", "users.table.delete"]);
    store.close();
  });

  it("prefers static-literal anchors over dynamic-only interpolation keys", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const seed = analysisForKeys([
      "users.form.submit",
      "dashboard.chart.axis.month",
      "orders.rows.1.amount",
    ]);
    const projectId = store.syncProject(projectRoot, {}, {
      ...seed,
      source: {
        ...seed.source,
        occurrences: [
          {
            id: "occ_users_submit",
            keyPath: "users.form.submit",
            kind: "imperative_service",
            location: { file: "src/views/UsersView.vue", line: 1, column: 0 },
            expression: "t('users.form.submit')",
            teleported: true,
            dynamic: false,
            confidence: 0.99,
            routeHints: [{ path: "/users", source: "router_config", confidence: 0.99 }],
            actionHints: [],
          },
          {
            id: "occ_dashboard_axis",
            keyPath: "dashboard.chart.axis.month",
            kind: "text_range",
            location: { file: "src/views/DashboardView.vue", line: 1, column: 0 },
            expression: "t(`dashboard.${section}.${name}`)",
            teleported: false,
            dynamic: true,
            confidence: 0.82,
            routeHints: [{ path: "/dashboard", source: "router_config", confidence: 0.99 }],
            actionHints: [],
          },
          {
            id: "occ_orders_row",
            keyPath: "orders.rows.1.amount",
            kind: "text_range",
            location: { file: "src/views/OrdersView.vue", line: 1, column: 0 },
            expression: "t(`orders.rows.${index}.amount`)",
            teleported: false,
            dynamic: true,
            confidence: 0.82,
            routeHints: [{ path: "/orders", source: "router_config", confidence: 0.99 }],
            actionHints: [],
          },
        ],
      },
    });
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    for (const keyPath of ["users.form.submit", "dashboard.chart.axis.month", "orders.rows.1.amount"]) {
      const task = store.taskByKey(sessionId, keyPath);
      if (!task) throw new Error(`missing fixture task: ${keyPath}`);
      store.markTask(task.id, "needs_agent");
    }

    const first = store.nextAgentTask(sessionId);
    expect(first?.keyPath).toBe("users.form.submit");
    store.markTask(first!.id, "captured");

    const second = store.nextAgentTask(sessionId);
    expect(["dashboard.chart.axis.month", "orders.rows.1.amount"]).toContain(second?.keyPath);
    store.close();
  });

  it("skips saturated routes when selecting the next Agent anchor", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysisForAgentQueue());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    for (const keyPath of [
      "static.title",
      "static.chart",
      "users.form.submit",
      "users.table.delete",
      "orders.form.save",
    ]) {
      const task = store.taskByKey(sessionId, keyPath);
      if (!task) throw new Error(`missing fixture task: ${keyPath}`);
      store.markTask(task.id, "needs_agent");
    }

    store.recordRouteCapture(sessionId, "/users", 0);
    store.recordRouteCapture(sessionId, "/users", 0);
    expect(store.saturatedRoutes(sessionId)).toContain("/users");

    const task = store.nextAgentTask(sessionId, store.saturatedRoutes(sessionId));
    expect(task?.keyPath).toBe("orders.form.save");
    store.close();
  });

  it("tracks consecutive low-yield capture rounds per route", async () => {
    const store = await StateStore.open(root());
    const sessionId = store.createSession(store.syncProject(root(), {}, analysis()), "http://127.0.0.1:5173");
    store.recordRouteCapture(sessionId, "/dashboard", 5);
    expect(store.saturatedRoutes(sessionId)).toEqual([]);
    store.recordRouteCapture(sessionId, "/dashboard", 0);
    expect(store.saturatedRoutes(sessionId)).toEqual([]);
    store.recordRouteCapture(sessionId, "/dashboard", 1);
    expect(store.saturatedRoutes(sessionId)).toContain("/dashboard");
    store.recordRouteCapture(sessionId, "/dashboard", 9);
    expect(store.saturatedRoutes(sessionId)).not.toContain("/dashboard");
    store.close();
  });

describe("StateStore Agent anchor hardening (R4)", () => {
  it("returns no anchor when every candidate route is saturated", async () => {
    const store = await StateStore.open(root());
    const projectId = store.syncProject(root(), {}, analysisForAgentQueue());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    for (const keyPath of ["users.form.submit", "users.table.delete", "orders.form.save"]) {
      const task = store.taskByKey(sessionId, keyPath);
      if (!task) throw new Error(`missing fixture task: ${keyPath}`);
      store.markTask(task.id, "needs_agent");
    }
    store.recordRouteCapture(sessionId, "/users", 0);
    store.recordRouteCapture(sessionId, "/users", 0);
    store.recordRouteCapture(sessionId, "/orders", 0);
    store.recordRouteCapture(sessionId, "/orders", 0);
    expect(store.saturatedRoutes(sessionId).sort()).toEqual(["/orders", "/users"]);

    expect(store.nextAgentTask(sessionId)).toBeUndefined();
    store.close();
  });

  it("budgets Agent anchors per route and relaxes only when every route is over budget", async () => {
    const store = await StateStore.open(root());
    const sessionId = store.createSession(store.syncProject(root(), {}, analysisForAgentQueue()), "http://127.0.0.1:5173");
    for (const keyPath of ["users.form.submit", "users.table.delete", "orders.form.save"]) {
      const task = store.taskByKey(sessionId, keyPath);
      if (!task) throw new Error(`missing fixture task: ${keyPath}`);
      store.markTask(task.id, "needs_agent");
    }

    // /users exhausts its 5-plan session budget; anchors move to /orders.
    for (let i = 0; i < 5; i += 1) store.recordRoutePlan(sessionId, "/users");
    expect(store.routePlanCounts(sessionId).get("/users")).toBe(5);
    const next = store.nextAgentTask(sessionId);
    expect(next?.keyPath).toBe("orders.form.save");

    // Every unsaturated route is now over budget: the budget relaxes and a
    // healthy (non-saturated) route provides the anchor again.
    for (let i = 0; i < 5; i += 1) store.recordRoutePlan(sessionId, "/orders");
    const relaxed = store.nextAgentTask(sessionId);
    expect(relaxed).toBeDefined();
    expect(preferredAgentRoute(relaxed!)).toBe("/users");
    store.close();
  });

  it("submitPlan counts the route anchor budget", async () => {
    const store = await StateStore.open(root());
    const projectId = store.syncProject(root(), {}, analysisForAgentQueue());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.taskByKey(sessionId, "users.form.submit");
    if (!task) throw new Error("missing fixture task");
    store.markTask(task.id, "needs_agent");
    store.submitPlan(task.id, {
      version: 1,
      targetKey: "users.form.submit",
      route: "/users",
      steps: [{ type: "wait", milliseconds: 50 }],
    });
    expect(store.routePlanCounts(sessionId).get("/users")).toBe(1);
    store.close();
  });
});
