import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SessionEvent } from "./api.js";

function response(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Studio API client", () => {
  it("loads every event page instead of stopping at the service page limit", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index): SessionEvent => ({
      id: index + 1,
      type: "agent.plan_saved",
      created_at: new Date(index).toISOString(),
      data: {},
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: firstPage, nextAfter: 200, hasMore: true }))
      .mockResolvedValueOnce(response({ items: [{ id: 201, type: "task.captured", created_at: new Date(201).toISOString(), data: {} }], nextAfter: 201, hasMore: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.events("session_test")).resolves.toHaveLength(201);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/events?session=session_test&after=0&limit=500", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/events?session=session_test&after=200&limit=500", undefined);
  });

  it("loads all task cursor pages", async () => {
    const task = (keyPath: string) => ({ id: keyPath, sessionId: "session_test", keyPath, status: "captured", stage: "agent", chinese: keyPath, relativeFile: "page.json", routeHints: [], actionHints: [], attempts: 1 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [task("a")], nextAfterKey: "a", hasMore: true }))
      .mockResolvedValueOnce(response({ items: [task("b")], nextAfterKey: null, hasMore: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.tasks("session_test")).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/tasks?session=session_test&limit=250&afterKey=a", undefined);
  });

  it("reports a clear error when health data has no session id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({})));
    await expect(api.health()).rejects.toThrow("sessionId");
  });
});
