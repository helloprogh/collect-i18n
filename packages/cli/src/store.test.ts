import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProjectAnalysis } from "@collect-i18n/analyzer";
import type { CollectedEvidence } from "@collect-i18n/runner";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "./store.js";

const temporaryRoots: string[] = [];

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
    source: { occurrences: [], routeHints: [], actionHints: [], diagnostics: [], scannedFiles: [] },
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

function evidence(source: CollectedEvidence["source"] = "deterministic"): CollectedEvidence {
  return {
    key: "form.save",
    text: "保存",
    route: "http://127.0.0.1:5173/form",
    rect: { x: 1, y: 2, width: 30, height: 20 },
    screenshotPath: "D:/evidence/form.save.png",
    capturedAt: new Date().toISOString(),
    source,
  };
}

describe("StateStore transactions", () => {
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

  it("reports unique screenshots separately from duplicate evidence", async () => {
    const projectRoot = root();
    const store = await StateStore.open(projectRoot);
    const projectId = store.syncProject(projectRoot, {}, analysis());
    const sessionId = store.createSession(projectId, "http://127.0.0.1:5173");
    const task = store.nextTask(sessionId, ["needs_agent"]);
    if (!task) throw new Error("missing fixture task");

    store.addEvidence(task.id, evidence("agent"));
    store.addEvidence(task.id, { ...evidence("agent"), screenshotPath: "D:/evidence/form.save-latest.png" });

    expect(store.status(sessionId)).toMatchObject({
      screenshotCount: 2,
      uniqueScreenshotCount: 1,
      duplicateEvidenceCount: 1,
      coveragePercent: 100,
      manualPercent: 0,
      exportReady: true,
    });
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
