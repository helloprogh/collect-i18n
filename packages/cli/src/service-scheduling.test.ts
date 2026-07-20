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
