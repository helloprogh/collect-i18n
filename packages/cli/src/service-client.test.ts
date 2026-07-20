import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callService, readServiceDescriptor, serviceDescriptorPath, type ServiceDescriptor } from "./service-client.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectRoot(): Promise<string> {
  const root = join(tmpdir(), `collect-i18n-client-${randomUUID()}`);
  temporaryRoots.push(root);
  await mkdir(join(root, ".collect-i18n"), { recursive: true });
  return root;
}

describe("service descriptor capability", () => {
  it("automatically authenticates service calls from the descriptor", async () => {
    const capability = "a".repeat(43);
    let receivedAuthorization: string | undefined;
    const server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { authenticated: true } }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test port");
    const root = await projectRoot();
    const serviceUrl = `http://127.0.0.1:${address.port}`;
    const descriptor: ServiceDescriptor = {
      pid: process.pid,
      projectRoot: root,
      sessionId: "session_test",
      serviceUrl,
      studioUrl: `${serviceUrl}/auth?capability=${capability}`,
      appUrl: "http://127.0.0.1:5173",
      startedAt: new Date().toISOString(),
      capability,
    };
    await writeFile(serviceDescriptorPath(root), JSON.stringify(descriptor), "utf8");

    await expect(callService(root, "/api/health")).resolves.toEqual({ authenticated: true });
    expect(receivedAuthorization).toBe(`Bearer ${capability}`);
    await new Promise<void>((done) => server.close(() => done()));
  });

  it("rejects descriptors that point outside loopback", async () => {
    const root = await projectRoot();
    await writeFile(serviceDescriptorPath(root), JSON.stringify({
      pid: process.pid,
      projectRoot: root,
      sessionId: "session_test",
      serviceUrl: "https://example.com",
      studioUrl: "https://example.com",
      appUrl: "http://127.0.0.1:5173",
      startedAt: new Date().toISOString(),
      capability: "b".repeat(43),
    }), "utf8");
    await expect(readServiceDescriptor(root)).rejects.toThrow("后台服务尚未启动");
  });
});
