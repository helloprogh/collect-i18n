import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPathInside, resolveStateFile } from "./service.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectRoot(): Promise<string> {
  const root = join(tmpdir(), `collect-i18n-path-${randomUUID()}`);
  temporaryRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

describe("service file boundary", () => {
  it("accepts files below .collect-i18n and rejects sibling-prefix traversal", async () => {
    const root = await projectRoot();
    const accepted = await resolveStateFile(root, join(".collect-i18n", "exports", "result.xlsx"), false);
    expect(isPathInside(join(root, ".collect-i18n"), accepted)).toBe(true);
    await expect(resolveStateFile(root, join(".collect-i18n-evil", "result.xlsx"), false)).rejects.toThrow("必须位于项目 .collect-i18n");
    await expect(resolveStateFile(root, join("..", "result.xlsx"), false)).rejects.toThrow("必须位于项目 .collect-i18n");
  });

  it("requires imports to exist inside the state directory", async () => {
    const root = await projectRoot();
    const workbook = join(root, ".collect-i18n", "imports", "return.xlsx");
    await mkdir(join(root, ".collect-i18n", "imports"), { recursive: true });
    await writeFile(workbook, "fixture");
    await expect(resolveStateFile(root, workbook, true)).resolves.toBe(workbook);
    await expect(resolveStateFile(root, join(root, "return.xlsx"), true)).rejects.toThrow("必须位于项目 .collect-i18n");
  });
});
