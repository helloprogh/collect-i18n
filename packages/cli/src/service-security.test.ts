import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ProjectConfig } from "@collect-i18n/core";
import { describe, expect, it } from "vitest";
import { LocalService } from "./service.js";

function config(): ProjectConfig {
  return {
    version: 1,
    projectRoot: "D:/project",
    stateDirectory: ".collect-i18n",
    source: { include: [], exclude: [] },
    locales: { source: "zh-cn", target: "en-us", roots: ["src"] },
    app: { baseUrl: "http://127.0.0.1:5173", devCommand: "pnpm dev", healthPath: "/" },
    browser: { headless: true, viewport: { width: 1440, height: 900 }, locale: "zh-CN", cookies: [], timeoutMs: 15_000 },
    instrumentation: { enabled: true, devOnly: true },
  };
}

describe("local service capability boundary", () => {
  it("rejects anonymous API calls and bootstraps an HttpOnly same-site cookie", async () => {
    const capability = "z".repeat(43);
    const service = new LocalService({ config: config(), sessionId: "session_test", capability });
    const internals = service as unknown as {
      serviceUrl: string;
      route: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
    };
    const server = createServer((request, response) => {
      void internals.route(request, response);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test port");
    const origin = `http://127.0.0.1:${address.port}`;
    internals.serviceUrl = origin;

    const anonymous = await fetch(`${origin}/api/health`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("access-control-allow-origin")).toBeNull();

    const bootstrap = await fetch(`${origin}/auth?capability=${capability}`, { redirect: "manual" });
    expect(bootstrap.status).toBe(303);
    expect(bootstrap.headers.get("location")).toBe("/");
    const cookie = bootstrap.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const authenticated = await fetch(`${origin}/api/health`, { headers: { cookie: cookie.split(";", 1)[0]! } });
    expect(authenticated.status).toBe(200);
    await expect(authenticated.json()).resolves.toMatchObject({
      ok: true,
      sessionId: "session_test",
      data: { sessionId: "session_test" },
    });
    const crossOrigin = await fetch(`${origin}/api/health`, {
      headers: { cookie: cookie.split(";", 1)[0]!, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-site" },
    });
    expect(crossOrigin.status).toBe(401);
    await new Promise<void>((done) => server.close(() => done()));
  });
});
