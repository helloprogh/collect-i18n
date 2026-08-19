import type { ProjectConfig } from "@collect-i18n/core";
import type { CollectedEvidence, RuntimeTargetSnapshot } from "@collect-i18n/runner";
import { describe, expect, it } from "vitest";
import { LocalService } from "./service.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function eventually(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try { assertion(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((done) => setTimeout(done, 5));
    }
  }
}

describe("collector scheduling", () => {
  it("captures unresolved keys at every route-plan checkpoint and the final state", async () => {
    const checkpointCalls: number[] = [];
    const primaryEvidence = {
      key: "route.finalTarget",
      evidenceGrade: "A" as const,
      evidenceProof: "compiler-text-sink",
      text: "Final target",
      route: "http://127.0.0.1:5173/route",
      rect: { x: 10, y: 10, width: 100, height: 24 },
      screenshotPath: "D:/evidence/final.png",
      screenshotSha256: "0".repeat(64),
      capturedAt: new Date().toISOString(),
      source: "agent" as const,
    };
    const fakeStore = {
      task: () => ({ id: "task_final", sessionId: "session_test", keyPath: "route.finalTarget", attempts: 0 }),
      submitPlan: () => undefined,
      addEvidence: () => "evidence_primary",
      markTask: () => undefined,
    };
    const fakeCollector = {
      executePlan: async (_plan: unknown, _source: unknown, checkpoint?: () => Promise<void>) => {
        await checkpoint?.();
        await checkpoint?.();
        return primaryEvidence;
      },
    };
    const config = {
      version: 1,
      projectRoot: "D:/project",
      stateDirectory: ".collect-i18n",
      source: { include: [], exclude: [] },
      locales: { source: "zh-cn", target: "en-us", roots: ["src"] },
      app: { baseUrl: "http://127.0.0.1:5173", devCommand: "pnpm dev", healthPath: "/" },
      browser: { headless: true, viewport: { width: 1440, height: 900 }, locale: "zh-CN", cookies: [], timeoutMs: 15_000 },
      instrumentation: { enabled: true, devOnly: true },
    } as ProjectConfig;
    const service = new LocalService({ config, sessionId: "session_test", capability: "c".repeat(43) });
    const internals = service as unknown as {
      store: typeof fakeStore;
      collector: () => Promise<typeof fakeCollector>;
      executeAgent: (taskId: string, plan: unknown) => Promise<{ additionalEvidence: Array<{ keyPath: string }> }>;
      captureVisibleBatch: () => Promise<Array<{ taskId: string; keyPath: string; evidenceId: string }>>;
      runDeterministicQueue: () => Promise<void>;
    };
    internals.store = fakeStore;
    internals.collector = async () => fakeCollector;
    internals.captureVisibleBatch = async () => {
      const index = checkpointCalls.push(checkpointCalls.length + 1);
      return [{ taskId: `task_${index}`, keyPath: `checkpoint.${index}`, evidenceId: `evidence_${index}` }];
    };
    internals.runDeterministicQueue = async () => undefined;

    const result = await internals.executeAgent("task_final", {
      version: 1,
      targetKey: "route.finalTarget",
      route: "/route",
      steps: [{ type: "capture" }, { type: "waitForKey", key: "route.finalTarget" }],
    });

    expect(checkpointCalls).toHaveLength(3);
    expect(result.additionalEvidence.map((item) => item.keyPath)).toEqual([
      "checkpoint.1",
      "checkpoint.2",
      "checkpoint.3",
    ]);
  });

  it("captures other mounted A/B tasks after one Agent state transition", async () => {
    const added: string[] = [];
    const tasks = [
      { id: "task_a", keyPath: "dialog.title" },
      { id: "task_b", keyPath: "dialog.confirm" },
      { id: "task_c", keyPath: "dialog.heuristic" },
    ];
    const fakeStore = {
      listTasks: () => tasks,
      addEvidence: (taskId: string) => {
        added.push(taskId);
        return `evidence_${taskId}`;
      },
    };
    const rect = { x: 10, y: 10, width: 100, height: 24 };
    const fakeCollector = {
      inspectRuntime: async () => ({
        url: "http://127.0.0.1:5173/dialog",
        collectorInstalled: true,
        markedElements: 2,
        pendingDescriptors: 0,
        snapshots: [
          { key: "dialog.title", evidenceGrade: "A" as const, connected: true, rect },
          { key: "dialog.confirm", evidenceGrade: "B" as const, connected: true, rect },
          { key: "dialog.heuristic", evidenceGrade: "C" as const, connected: true, rect },
        ],
      }),
      waitForKey: async (key: string) => ({
        key,
        evidenceGrade: key === "dialog.title" ? "A" as const : "B" as const,
        evidenceProof: "compiler-vnode-provenance",
        text: key,
        route: "http://127.0.0.1:5173/dialog",
        rect,
      }),
      capture: async (target: RuntimeTargetSnapshot): Promise<CollectedEvidence> => ({
        ...target,
        screenshotPath: `D:/evidence/${target.key}.png`,
        screenshotSha256: "0".repeat(64),
        capturedAt: new Date().toISOString(),
        source: "agent",
      }),
      captureBatch: async (keys: string[]) =>
        keys
          .filter((key) => key !== "dialog.heuristic")
          .map((key) => ({
            key,
            evidence: {
              key,
              evidenceGrade: key === "dialog.title" ? ("A" as const) : ("B" as const),
              evidenceProof: "compiler-vnode-provenance",
              text: key,
              route: "http://127.0.0.1:5173/dialog",
              rect,
              screenshotPath: `D:/evidence/${key}.png`,
              screenshotSha256: "0".repeat(64),
              capturedAt: new Date().toISOString(),
              source: "agent" as const,
            },
          })),
    };
    const config = {
      version: 1,
      projectRoot: "D:/project",
      stateDirectory: ".collect-i18n",
      source: { include: [], exclude: [] },
      locales: { source: "zh-cn", target: "en-us", roots: ["src"] },
      app: { baseUrl: "http://127.0.0.1:5173", devCommand: "pnpm dev", healthPath: "/" },
      browser: { headless: true, viewport: { width: 1440, height: 900 }, locale: "zh-CN", cookies: [], timeoutMs: 15_000 },
      instrumentation: { enabled: true, devOnly: true },
    } as ProjectConfig;
    const service = new LocalService({ config, sessionId: "session_test", capability: "c".repeat(43) });
    const internals = service as unknown as {
      store: typeof fakeStore;
      collector: () => Promise<typeof fakeCollector>;
      captureVisibleBatch: (
        sessionId: string,
        primaryKey: string,
        source: "agent" | "manual",
      ) => Promise<Array<{ keyPath: string }>>;
    };
    internals.store = fakeStore;
    internals.collector = async () => fakeCollector;

    const result = await internals.captureVisibleBatch("session_test", "primary.key", "agent");

    expect(result.map((item) => item.keyPath)).toEqual(["dialog.title", "dialog.confirm"]);
    expect(added).toEqual(["task_a", "task_b"]);
  });

  it("isolates manual listener generations and records only the current target", async () => {
    const first = deferred<RuntimeTargetSnapshot>();
    const second = deferred<RuntimeTargetSnapshot>();
    const waits = [first, second];
    let waitIndex = 0;
    let concurrent = 0;
    let maximumConcurrent = 0;
    const evidenceTaskIds: string[] = [];
    const tasks = new Map([
      ["key.one", { id: "task_one", sessionId: "session_test", keyPath: "key.one", chinese: "一", relativeFile: "one.json", routeHints: [], actionHints: [] }],
      ["key.two", { id: "task_two", sessionId: "session_test", keyPath: "key.two", chinese: "二", relativeFile: "two.json", routeHints: [], actionHints: [] }],
    ]);
    const fakeStore = {
      taskByKey: (_sessionId: string, key: string) => tasks.get(key),
      startManual: () => undefined,
      markTask: () => undefined,
      addEvidence: (taskId: string) => { evidenceTaskIds.push(taskId); return `evidence_${taskId}`; },
      nextTask: () => undefined,
    };
    const fakeCollector = {
      setMockRules: () => undefined,
      open: async () => undefined,
      waitForKey: async () => {
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        try { return await waits[waitIndex++]!.promise; }
        finally { concurrent -= 1; }
      },
      capture: async (target: RuntimeTargetSnapshot): Promise<CollectedEvidence> => ({
        ...target,
        screenshotPath: `D:/evidence/${target.key}.png`,
        screenshotSha256: "0".repeat(64),
        capturedAt: new Date().toISOString(),
        source: "manual",
      }),
    };
    const config = {
      version: 1,
      projectRoot: "D:/project",
      stateDirectory: ".collect-i18n",
      source: { include: [], exclude: [] },
      locales: { source: "zh-cn", target: "en-us", roots: ["src"] },
      app: { baseUrl: "http://127.0.0.1:5173", devCommand: "pnpm dev", healthPath: "/" },
      browser: { headless: true, viewport: { width: 1440, height: 900 }, locale: "zh-CN", cookies: [], timeoutMs: 15_000 },
      instrumentation: { enabled: true, devOnly: true },
    } as ProjectConfig;
    const service = new LocalService({ config, sessionId: "session_test", capability: "c".repeat(43) });
    const internals = service as unknown as {
      store: typeof fakeStore;
      collector: () => Promise<typeof fakeCollector>;
      startManual: (sessionId: string, key: string) => Promise<unknown>;
    };
    internals.store = fakeStore;
    internals.collector = async () => fakeCollector;

    await internals.startManual("session_test", "key.one");
    await eventually(() => expect(waitIndex).toBe(1));
    const secondStart = internals.startManual("session_test", "key.two");
    first.resolve({ key: "key.one", text: "一", route: "http://127.0.0.1:5173", rect: { x: 0, y: 0, width: 10, height: 10 } });
    await secondStart;
    await eventually(() => expect(waitIndex).toBe(2));
    second.resolve({ key: "key.two", text: "二", route: "http://127.0.0.1:5173", rect: { x: 0, y: 0, width: 10, height: 10 } });
    await eventually(() => expect(evidenceTaskIds).toEqual(["task_two"]));
    expect(maximumConcurrent).toBe(1);
  });
});
