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
      taskByKey: () => undefined,
      recordRouteCapture: () => undefined,
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
      source: { include: [], exclude: [], translationCallees: [] },
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

  it("moves a dynamic-only key to manual after its first failed Agent attempt", async () => {
    const transitions: Array<{ status: string; error?: string }> = [];
    const fakeStore = {
      task: () => ({
        id: "task_dynamic",
        sessionId: "session_test",
        keyPath: "orders.rows.249.label",
        attempts: 0,
        occurrences: [{ dynamic: true }],
      }),
      submitPlan: () => undefined,
      markTask: (_taskId: string, status: string, error?: string) => {
        transitions.push({ status, error });
      },
      taskByKey: () => undefined,
      recordRouteCapture: () => undefined,
    };
    const fakeCollector = {
      executePlan: async () => { throw new Error("target timed out"); },
    };
    const config = {
      version: 1,
      projectRoot: "D:/project",
      stateDirectory: ".collect-i18n",
      source: { include: [], exclude: [], translationCallees: [] },
      locales: { source: "zh-cn", target: "en-us", roots: ["src"] },
      app: { baseUrl: "http://127.0.0.1:5173", devCommand: "pnpm dev", healthPath: "/" },
      browser: { headless: true, viewport: { width: 1440, height: 900 }, locale: "zh-CN", cookies: [], timeoutMs: 15_000 },
      instrumentation: { enabled: true, devOnly: true },
    } as ProjectConfig;
    const service = new LocalService({ config, sessionId: "session_test", capability: "c".repeat(43) });
    const internals = service as unknown as {
      store: typeof fakeStore;
      collector: () => Promise<typeof fakeCollector>;
      executeAgent: (taskId: string, plan: unknown) => Promise<unknown>;
      captureVisibleBatch: () => Promise<[]>;
      runDeterministicQueue: () => Promise<void>;
    };
    internals.store = fakeStore;
    internals.collector = async () => fakeCollector;
    internals.captureVisibleBatch = async () => [];
    internals.runDeterministicQueue = async () => undefined;

    await expect(internals.executeAgent("task_dynamic", {
      version: 1,
      targetKey: "orders.rows.249.label",
      steps: [{ type: "waitForKey", key: "orders.rows.249.label", timeoutMs: 100 }],
    })).rejects.toThrow("target timed out");
    expect(transitions).toEqual([
      expect.objectContaining({
        status: "needs_manual",
        error: expect.stringContaining("唯一一次自动尝试"),
      }),
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
      // runDeterministicQueue re-enters via executeAgent's finally; it consumes
      // the paginated variants even though this test drives the agent path.
      listAllTasks: () => [],
      listTaskSummaries: () => [],
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
      source: { include: [], exclude: [], translationCallees: [] },
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
      source: { include: [], exclude: [], translationCallees: [] },
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

describe("deterministic queue throughput (R1/R2/R3)", () => {
  interface FakeTask {
    id: string;
    keyPath: string;
    status: string;
    stage: string;
    sessionId: string;
    chinese: string;
    relativeFile: string;
    occurrences: unknown[];
    routeHints: unknown[];
    actionHints: unknown[];
    attempts: number;
    lastError?: string;
  }

  function pendingTask(id: string, keyPath: string, route?: string, status = "pending"): FakeTask {
    return {
      id, keyPath, status, stage: "deterministic", sessionId: "session_test",
      chinese: keyPath, relativeFile: "src/views/page.vue", occurrences: [],
      routeHints: route ? [{ path: route, confidence: 0.95 }] : [],
      actionHints: [], attempts: 0,
    };
  }

  function sampleEvidence(key: string): CollectedEvidence {
    return {
      key, evidenceGrade: "A", evidenceProof: "compiler-text-sink", text: key,
      route: "http://127.0.0.1:5173/route",
      rect: { x: 10, y: 10, width: 100, height: 24 },
      screenshotPath: "D:/evidence/" + key + ".png",
      screenshotSha256: "0".repeat(64),
      capturedAt: new Date().toISOString(),
      source: "deterministic",
    };
  }

  interface FakeLog {
    opens: string[];
    batchCalls: string[][];
    scrolls: number[];
    waitForKeyCalls: string[];
    captured: string[];
    needsAgent: Array<{ keyPath: string; error?: string }>;
    statusChanges: Array<{ keyPath: string; status: string; error?: string }>;
  }

  function makeLog(): FakeLog {
    return {
      opens: [], batchCalls: [], scrolls: [], waitForKeyCalls: [], captured: [], needsAgent: [],
      statusChanges: [],
    };
  }

  function fakeStore(tasks: FakeTask[], log: FakeLog) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return {
      listTasks: (_sessionId: string, statuses: string[]) => tasks.filter((task) => statuses.includes(task.status)),
      // The queue uses the paginated variants: route grouping needs full tasks
      // (route hints), the sweep passes only consume lightweight rows.
      listAllTasks: (_sessionId: string, statuses: string[]) => tasks.filter((task) => statuses.includes(task.status)),
      listTaskSummaries: (_sessionId: string, statuses: string[]) =>
        tasks
          .filter((task) => statuses.includes(task.status))
          .map((task) => ({ id: task.id, keyPath: task.keyPath, status: task.status, chinese: task.chinese })),
      task: (id: string) => byId.get(id),
      markTask: (id: string, status: string, error?: string) => {
        const task = byId.get(id);
        if (!task) return;
        task.status = status;
        task.lastError = error;
        log.statusChanges.push({ keyPath: task.keyPath, status, error });
        if (status === "needs_agent") log.needsAgent.push({ keyPath: task.keyPath, error });
      },
      addEvidence: (id: string, evidence: CollectedEvidence) => {
        const task = byId.get(id);
        if (!task) return "evidence_" + id;
        task.status = "captured";
        log.captured.push(evidence.key);
        return "evidence_" + id;
      },
    };
  }

  function fakeCollector(handlers: {
    mountedKeys: (inspectionIndex: number, route: string) => Set<string>;
    batchResolver: (keys: string[]) => Array<{ key: string; evidence?: CollectedEvidence; rejected?: string }>;
    log: FakeLog;
    waitForKeyImpl?: (key: string) => Promise<RuntimeTargetSnapshot>;
  }) {
    let inspectionIndex = 0;
    let currentRoute = "";
    return {
      setMockRules: () => undefined,
      open: async (route: string) => { currentRoute = route; handlers.log.opens.push(route); },
      inspectRuntimeSettled: async () => {
        inspectionIndex += 1;
        const mounted = handlers.mountedKeys(inspectionIndex, currentRoute);
        return {
          url: "http://127.0.0.1:5173/route",
          collectorInstalled: true,
          markedElements: 0,
          pendingDescriptors: 0,
          snapshots: [...mounted].map((key) => ({
            key, evidenceGrade: "A" as const, connected: true,
            rect: { x: 10, y: 10, width: 100, height: 24 },
          })),
        };
      },
      captureDeterministicBatch: async (keys: string[]) => {
        handlers.log.batchCalls.push([...keys]);
        return handlers.batchResolver(keys);
      },
      scrollForCapture: async (step: number) => { handlers.log.scrolls.push(step); },
      widgetSweepForCapture: async () => "exhausted" as const,
      interactionSweepStep: async () => false,
      dismissOverlays: async () => undefined,
      mirrorEntries: async () => [],
      waitForKey: async (key: string) => {
        handlers.log.waitForKeyCalls.push(key);
        if (handlers.waitForKeyImpl) return handlers.waitForKeyImpl(key);
        return { key, evidenceGrade: "A" as const, evidenceProof: "compiler-text-sink", text: key, route: "http://127.0.0.1:5173/route", rect: { x: 10, y: 10, width: 100, height: 24 } };
      },
      capture: async (target: RuntimeTargetSnapshot): Promise<CollectedEvidence> => sampleEvidence(target.key),
    };
  }

  async function runQueue(tasks: FakeTask[], collector: ReturnType<typeof fakeCollector>, log: FakeLog) {
    const config = {
      version: 1,
      projectRoot: "D:/project",
      stateDirectory: ".collect-i18n",
      source: { include: [], exclude: [], translationCallees: [] },
      locales: { source: "zh-cn", target: "en-us", roots: ["src"] },
      app: { baseUrl: "http://127.0.0.1:5173", devCommand: "pnpm dev", healthPath: "/" },
      browser: { headless: true, viewport: { width: 1440, height: 900 }, locale: "zh-CN", cookies: [], timeoutMs: 15_000 },
      instrumentation: { enabled: true, devOnly: true },
    } as ProjectConfig;
    const service = new LocalService({ config, sessionId: "session_test", capability: "c".repeat(43) });
    const internals = service as unknown as {
      store: ReturnType<typeof fakeStore>;
      collector: () => Promise<typeof collector>;
      runDeterministicQueue: () => Promise<void>;
    };
    internals.store = fakeStore(tasks, log);
    internals.collector = async () => collector;
    await internals.runDeterministicQueue();
    return { service, log };
  }

  it("visits routes by pending density instead of key-path alphabet (R1)", async () => {
    const tasks = [
      pendingTask("t_alpha_1", "alpha.first", "/alpha"),
      pendingTask("t_alpha_2", "alpha.second", "/alpha"),
      pendingTask("t_bill_1", "bill.key1", "/billing"),
      pendingTask("t_bill_2", "bill.key2", "/billing"),
      pendingTask("t_bill_3", "bill.key3", "/billing"),
    ];
    const log = makeLog();
    const collector = fakeCollector({
      mountedKeys: (_index: number, route: string) =>
        new Set(route === "/billing"
          ? ["bill.key1", "bill.key2", "bill.key3"]
          : ["alpha.first", "alpha.second"]),
      batchResolver: (keys) => keys.map((key) => ({ key, evidence: sampleEvidence(key) })),
      log,
    });

    await runQueue(tasks, collector, log);

    // /billing (3 pending) is visited before /alpha (2 pending) despite
    // being later in the alphabet, and both drain completely.
    expect(log.opens).toEqual(["/billing", "/alpha"]);
    expect(log.captured.sort()).toEqual(["alpha.first", "alpha.second", "bill.key1", "bill.key2", "bill.key3"].sort());
    // The batch path replaces per-key waitForKey + capture entirely.
    expect(log.waitForKeyCalls).toEqual([]);
  });

  it("defers tasks without a high-confidence route immediately (R1)", async () => {
    const tasks = [
      pendingTask("t_no_route_1", "orphan.first"),
      pendingTask("t_no_route_2", "orphan.second"),
    ];
    const log = makeLog();
    const collector = fakeCollector({ mountedKeys: () => new Set(), batchResolver: () => [], log });

    await runQueue(tasks, collector, log);

    expect(log.opens).toEqual([]);
    expect(log.needsAgent).toEqual([
      { keyPath: "orphan.first", error: "No high-confidence route is available" },
      { keyPath: "orphan.second", error: "No high-confidence route is available" },
    ]);
  });

  it("captures mounted keys through the deterministic batch and defers B rejections (R2)", async () => {
    const tasks = [
      pendingTask("t_title", "form.title", "/form"),
      pendingTask("t_valid", "form.valid", "/form"),
    ];
    const log = makeLog();
    const collector = fakeCollector({
      mountedKeys: () => new Set(["form.title", "form.valid"]),
      batchResolver: (keys) => keys.map((key) => key === "form.valid"
        ? { key, rejected: "[deterministic_b_rejected] Deterministic B evidence for form.valid did not pass the isolated causal canary" }
        : { key, evidence: sampleEvidence(key) }),
      log,
    });

    await runQueue(tasks, collector, log);

    expect(log.captured).toEqual(["form.title"]);
    expect(log.needsAgent).toEqual([
      expect.objectContaining({ keyPath: "form.valid", error: expect.stringContaining("deterministic_b_rejected") }),
    ]);
    // Neither key went through the per-key fallback; the batch decided both.
    expect(log.waitForKeyCalls).toEqual([]);
    expect(log.scrolls).toEqual([]);
  });

  it("scroll-captures below-fold/lazy keys and only then defers never-mounted keys (R3)", async () => {
    const tasks = [
      pendingTask("t_visible", "inv.title", "/inventory"),
      pendingTask("t_lazy", "inv.rows.label", "/inventory"),
      pendingTask("t_collapsed", "inv.collapsed", "/inventory"),
    ];
    const log = makeLog();
    const collector = fakeCollector({
      // The lazy row only mounts after the first scroll step.
      mountedKeys: (index) => {
        const mounted = new Set(["inv.title"]);
        if (index >= 2) mounted.add("inv.rows.label");
        return mounted;
      },
      batchResolver: (keys) => keys.map((key) => ({ key, evidence: sampleEvidence(key) })),
      log,
    });

    await runQueue(tasks, collector, log);

    expect(log.opens).toEqual(["/inventory"]);
    expect(log.scrolls).toEqual([1, 2, 3]);
    // The lazy row was captured after scrolling, never handed to Agent.
    expect(log.captured).toEqual(expect.arrayContaining(["inv.rows.label"]));
    expect(log.needsAgent).toEqual([
      expect.objectContaining({ keyPath: "inv.collapsed", error: expect.stringContaining("not mounted in the initial state") }),
    ]);
  });

  it("opportunistically captures needs_agent keys mounted on the visited route", async () => {
    const tasks = [
      pendingTask("t_group", "orders.title", "/orders"),
      pendingTask("t_opp", "orders.rows.label", "/orders", "needs_agent"),
    ];
    const log = makeLog();
    const collector = fakeCollector({
      mountedKeys: () => new Set(["orders.title", "orders.rows.label"]),
      batchResolver: (keys) => keys.map((key) => ({ key, evidence: sampleEvidence(key) })),
      log,
    });

    await runQueue(tasks, collector, log);

    expect(log.captured).toEqual(expect.arrayContaining(["orders.rows.label"]));
    expect(log.captured).toContain("orders.title");
  });

  it("skips zero-yield routes and bounds the per-key fallback (R1+R3)", async () => {
    const aKeys = Array.from({ length: 20 }, (_v, index) => `a.k${index}`);
    const tasks = [
      ...aKeys.map((key) => pendingTask("t_" + key.replaceAll(".", "_"), key, "/a")),
      pendingTask("t_b", "b.k", "/b"),
    ];
    const log = makeLog();
    const collector = fakeCollector({
      mountedKeys: (_index: number, route: string) =>
        new Set(route === "/a" ? aKeys : ["b.k"]),
      // The batch never resolves /a keys (below-fold rows that need manual
      // interaction) and the per-key fallback always times out for them.
      batchResolver: (keys) => keys.filter((key) => key === "b.k")
        .map((key) => ({ key, evidence: sampleEvidence(key) })),
      waitForKeyImpl: async (key: string) => {
        throw new Error("Timed out waiting for i18n key: " + key);
      },
      log,
    });

    await runQueue(tasks, collector, log);

    // /a (20 keys) is densest and visited first but yields zero; the queue
    // then drains /b before ever revisiting /a despite /a still having 8
    // pending keys (the zero-yield skip). The final /a revisit retries once
    // and stops when the sweep produces nothing.
    expect(log.opens).toEqual(["/a", "/b", "/a"]);
    expect(log.captured).toContain("b.k");
    // Round 1 exhausts the 12-key fallback budget (8 keys deferred pending
    // with the budget message); the revisit re-attempts those 8 group keys
    // and 4 mounted opportunistic a.k keys inside a fresh budget of 12.
    expect(log.waitForKeyCalls).toHaveLength(24);
    expect(log.statusChanges.filter((change) => change.status === "pending" && change.error?.includes("fallback budget"))).toHaveLength(8);
    // Every /a key eventually reached the Agent queue with the short-wait
    // timeout (12 + 8 + 4 per-key attempts); the queue never loops forever.
    expect(log.needsAgent.filter((item) => item.keyPath.startsWith("a.k") && item.error?.includes("Timed out waiting"))).toHaveLength(24);
  });
});
