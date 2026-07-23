import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "./config.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(source: string): Promise<string> {
  const root = join(tmpdir(), `collect-i18n-config-${randomUUID()}`);
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }), "utf8");
  await writeFile(join(root, "src", "i18n.ts"), source, "utf8");
  return root;
}

describe("default project configuration", () => {
  it("detects a source-declared Chinese locale cookie", async () => {
    const root = await project(`
      export const LOCALE_COOKIE = 'x-gde-locale'
      export const locale = readCookie(LOCALE_COOKIE) === 'zh_CN' ? 'zh-CN' : 'en-US'
    `);
    await expect(createDefaultConfig(root)).resolves.toMatchObject({
      browser: { cookies: [{ name: "x-gde-locale", value: "zh_CN" }] },
    });
  });

  it("does not invent a locale cookie when the project does not declare one", async () => {
    const root = await project("export const locale = 'zh-CN'");
    await expect(createDefaultConfig(root)).resolves.toMatchObject({ browser: { cookies: [] } });
  });
});
