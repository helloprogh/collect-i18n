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

function evidence(): CollectedEvidence {
  return {
    key: "form.save",
    text: "保存",
    route: "http://127.0.0.1:5173/form",
    rect: { x: 1, y: 2, width: 30, height: 20 },
    screenshotPath: "D:/evidence/form.save.png",
    capturedAt: new Date().toISOString(),
    source: "deterministic",
  };
}

describe("StateStore transactions", () => {
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
});
