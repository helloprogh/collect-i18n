import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportTranslationWorkbook } from "./export-workbook.js";
import { importTranslationWorkbook } from "./import-workbook.js";
import { WORKBOOK_HEADERS, type LocaleCatalogEntry } from "./types.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "collect-i18n-excel-"));
  const englishRoot = join(root, "en-us");
  const targetFile = join(englishRoot, "users.json");
  const catalog: LocaleCatalogEntry[] = [
    { keyPath: "users.create.title", chinese: "新建用户", targetFile, jsonPath: ["users", "create", "title"] },
    { keyPath: "users.create.save", chinese: "保存", targetFile, jsonPath: ["users", "create", "save"] },
  ];
  return { root, englishRoot, targetFile, catalog, workbookPath: join(root, "translations.xlsx") };
}

async function workbookRows(workbookPath: string): Promise<{
  workbook: ExcelJS.Workbook;
  sheet: ExcelJS.Worksheet;
  rows: Map<string, number>;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.worksheets[0]!;
  const rows = new Map<string, number>();
  for (let index = 2; index <= sheet.actualRowCount; index += 1) {
    rows.set(sheet.getCell(index, 4).text, index);
  }
  return { workbook, sheet, rows };
}

describe("four-column translation workbook export", () => {
  it("exports exactly one visible sheet and always initializes English from Chinese", async () => {
    const item = await fixture();
    await exportTranslationWorkbook([
      { ...item.catalog[0]!, english: "" },
      { ...item.catalog[1]!, english: "Save" },
    ], item.workbookPath);

    const { workbook, sheet, rows } = await workbookRows(item.workbookPath);
    expect(workbook.worksheets).toHaveLength(1);
    expect(sheet.state).toBe("visible");
    expect(sheet.actualColumnCount).toBe(4);
    expect([1, 2, 3, 4].map((column) => sheet.getCell(1, column).text)).toEqual(WORKBOOK_HEADERS);
    expect(sheet.getCell(1, 5).text).toBe("");
    expect(sheet.getCell(rows.get("users.create.title")!, 2).text).toBe("新建用户");
    expect(sheet.getCell(rows.get("users.create.save")!, 2).text).toBe("保存");
  });

  it("embeds a real PNG in the screenshot column and can replace an existing output atomically", async () => {
    const item = await fixture();
    const screenshotPath = join(item.root, "title.png");
    await writeFile(screenshotPath, ONE_PIXEL_PNG);
    const rows = [{ ...item.catalog[0]!, screenshotPath }];
    await exportTranslationWorkbook(rows, item.workbookPath);
    await exportTranslationWorkbook(rows, item.workbookPath);

    const { workbook, sheet } = await workbookRows(item.workbookPath);
    expect(sheet.getImages()).toHaveLength(1);
    expect((workbook as unknown as { model: { media: unknown[] } }).model.media).toHaveLength(1);
    expect(sheet.getCell(2, 3).text).toBe("");
  });

  it("rejects duplicate keys and screenshots whose bytes do not match the extension", async () => {
    const item = await fixture();
    await expect(exportTranslationWorkbook(
      [item.catalog[0]!, item.catalog[0]!],
      item.workbookPath,
    )).rejects.toThrow("Duplicate Key Path");

    const screenshotPath = join(item.root, "not-an-image.png");
    await writeFile(screenshotPath, "not a png", "utf8");
    await expect(exportTranslationWorkbook(
      [{ ...item.catalog[0]!, screenshotPath }],
      item.workbookPath,
    )).rejects.toThrow("does not match its extension");
  });
});

describe("four-column translation workbook import", () => {
  it("writes only non-empty English values that differ from Chinese", async () => {
    const item = await fixture();
    await exportTranslationWorkbook(item.catalog, item.workbookPath);
    const { workbook, sheet, rows } = await workbookRows(item.workbookPath);
    sheet.getCell(rows.get("users.create.title")!, 2).value = " Create user ";
    sheet.getCell(rows.get("users.create.save")!, 2).value = "保存";
    await workbook.xlsx.writeFile(item.workbookPath);

    const dryRun = await importTranslationWorkbook({ ...item, apply: false });
    expect(dryRun.canApply).toBe(true);
    expect(dryRun.changes.map((change) => change.keyPath)).toEqual(["users.create.title"]);

    const result = await importTranslationWorkbook({ ...item, apply: true, backup: false });
    expect(result.applied).toBe(true);
    const saved = JSON.parse(await readFile(item.targetFile, "utf8"));
    expect(saved.users.create.title).toBe(" Create user ");
    expect(saved.users.create.save).toBeUndefined();
  });

  it("blocks duplicate, unknown, changed-Chinese and fifth-column content", async () => {
    const item = await fixture();
    await exportTranslationWorkbook(item.catalog, item.workbookPath);
    const { workbook, sheet } = await workbookRows(item.workbookPath);
    sheet.getCell(2, 1).value = "被修改";
    sheet.getCell(2, 5).value = "不允许的状态列";
    sheet.addRow(["未知", "Unknown", "", "unknown.key"]);
    sheet.addRow(["新建用户", "Create", "", "users.create.title"]);
    await workbook.xlsx.writeFile(item.workbookPath);

    const result = await importTranslationWorkbook({ ...item, apply: true });
    expect(result.canApply).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "invalid_headers",
      "chinese_changed",
      "unknown_key",
      "duplicate_key",
    ]));
  });

  it("reports a missing key without blocking valid translations", async () => {
    const item = await fixture();
    await exportTranslationWorkbook(item.catalog, item.workbookPath);
    const { workbook, sheet, rows } = await workbookRows(item.workbookPath);
    sheet.getCell(rows.get("users.create.title")!, 2).value = "Create user";
    sheet.spliceRows(rows.get("users.create.save")!, 1);
    await workbook.xlsx.writeFile(item.workbookPath);

    const result = await importTranslationWorkbook({ ...item, apply: false });
    expect(result.canApply).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "missing_key",
      keyPath: "users.create.save",
      fatal: false,
    }));
  });

  it("blocks target paths outside the en-us root during dry-run and apply", async () => {
    const item = await fixture();
    const outsideFile = resolve(item.englishRoot, "..", "outside.json");
    const catalog = [{ ...item.catalog[0]!, targetFile: outsideFile }];
    await exportTranslationWorkbook(catalog, item.workbookPath);
    const { workbook, sheet } = await workbookRows(item.workbookPath);
    sheet.getCell(2, 2).value = "Create user";
    await workbook.xlsx.writeFile(item.workbookPath);

    const result = await importTranslationWorkbook({
      workbookPath: item.workbookPath,
      catalog,
      englishRoot: item.englishRoot,
      apply: true,
    });
    expect(result.canApply).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_target" }));
    await expect(access(outsideFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks non-JSON targets even when they are inside the locale root", async () => {
    const item = await fixture();
    const targetFile = join(item.englishRoot, "notes.txt");
    const catalog = [{ ...item.catalog[0]!, targetFile }];
    await exportTranslationWorkbook(catalog, item.workbookPath);
    const { workbook, sheet } = await workbookRows(item.workbookPath);
    sheet.getCell(2, 2).value = "Create user";
    await workbook.xlsx.writeFile(item.workbookPath);

    const result = await importTranslationWorkbook({
      workbookPath: item.workbookPath,
      catalog,
      englishRoot: item.englishRoot,
      apply: true,
    });
    expect(result.canApply).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_target" }));
    await expect(access(targetFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prepares every target before writing so invalid JSON cannot cause a partial import", async () => {
    const item = await fixture();
    const firstFile = join(item.englishRoot, "a.json");
    const secondFile = join(item.englishRoot, "b.json");
    await mkdir(item.englishRoot, { recursive: true });
    await writeFile(firstFile, "{\"existing\":\"unchanged\"}\n", "utf8");
    await writeFile(secondFile, "not json", "utf8");
    const catalog: LocaleCatalogEntry[] = [
      { keyPath: "a.title", chinese: "标题甲", targetFile: firstFile, jsonPath: ["title"] },
      { keyPath: "b.title", chinese: "标题乙", targetFile: secondFile, jsonPath: ["title"] },
    ];
    await exportTranslationWorkbook(catalog, item.workbookPath);
    const { workbook, sheet } = await workbookRows(item.workbookPath);
    sheet.getCell(2, 2).value = "Title A";
    sheet.getCell(3, 2).value = "Title B";
    await workbook.xlsx.writeFile(item.workbookPath);

    const result = await importTranslationWorkbook({
      workbookPath: item.workbookPath,
      catalog,
      englishRoot: item.englishRoot,
      apply: true,
      backup: false,
    });
    expect(result.applied).toBe(false);
    expect(result.canApply).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "write_failed" }));
    expect(await readFile(firstFile, "utf8")).toBe("{\"existing\":\"unchanged\"}\n");
  });

  it("preserves BOM and CRLF while safely writing a __proto__ JSON key", async () => {
    const item = await fixture();
    await mkdir(item.englishRoot, { recursive: true });
    await writeFile(item.targetFile, "\uFEFF{\r\n  \"existing\": \"value\"\r\n}\r\n", "utf8");
    const catalog: LocaleCatalogEntry[] = [{
      keyPath: "security.polluted",
      chinese: "安全值",
      targetFile: item.targetFile,
      jsonPath: ["__proto__", "polluted"],
    }];
    await exportTranslationWorkbook(catalog, item.workbookPath);
    const { workbook, sheet } = await workbookRows(item.workbookPath);
    sheet.getCell(2, 2).value = "safe";
    await workbook.xlsx.writeFile(item.workbookPath);

    const result = await importTranslationWorkbook({
      workbookPath: item.workbookPath,
      catalog,
      englishRoot: item.englishRoot,
      apply: true,
      backup: false,
    });
    expect(result.applied).toBe(true);
    const saved = await readFile(item.targetFile, "utf8");
    expect(saved.startsWith("\uFEFF")).toBe(true);
    expect(saved.replaceAll("\r\n", "")).not.toContain("\n");
    const parsed = JSON.parse(saved.slice(1));
    expect(parsed.__proto__.polluted).toBe("safe");
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("preserves JSON arrays, sibling fields and other elements when writing an indexed path", async () => {
    const item = await fixture();
    await mkdir(item.englishRoot, { recursive: true });
    await writeFile(item.targetFile, JSON.stringify({
      items: [
        { label: "old", keep: "preserve" },
        { label: "second" },
      ],
      sibling: "untouched",
    }, null, 2), "utf8");
    const catalog: LocaleCatalogEntry[] = [{
      keyPath: "users.items.0.label",
      chinese: "第一项",
      targetFile: item.targetFile,
      jsonPath: ["items", "0", "label"],
    }];
    await exportTranslationWorkbook(catalog, item.workbookPath);
    const { workbook, sheet } = await workbookRows(item.workbookPath);
    sheet.getCell(2, 2).value = "First item";
    await workbook.xlsx.writeFile(item.workbookPath);

    const result = await importTranslationWorkbook({
      workbookPath: item.workbookPath,
      catalog,
      englishRoot: item.englishRoot,
      apply: true,
      backup: false,
    });

    expect(result.applied).toBe(true);
    expect(result.issues).toEqual([]);
    expect(JSON.parse(await readFile(item.targetFile, "utf8"))).toEqual({
      items: [
        { label: "First item", keep: "preserve" },
        { label: "second" },
      ],
      sibling: "untouched",
    });
  });

  it.runIf(process.platform === "win32")("groups differently-cased Windows paths as one target file", async () => {
    const item = await fixture();
    const catalog: LocaleCatalogEntry[] = [
      { keyPath: "users.title", chinese: "标题", targetFile: item.targetFile, jsonPath: ["title"] },
      { keyPath: "users.save", chinese: "保存", targetFile: item.targetFile.toUpperCase(), jsonPath: ["save"] },
    ];
    await exportTranslationWorkbook(catalog, item.workbookPath);
    const { workbook, sheet, rows } = await workbookRows(item.workbookPath);
    sheet.getCell(rows.get("users.title")!, 2).value = "Title";
    sheet.getCell(rows.get("users.save")!, 2).value = "Save";
    await workbook.xlsx.writeFile(item.workbookPath);

    const result = await importTranslationWorkbook({
      workbookPath: item.workbookPath,
      catalog,
      englishRoot: item.englishRoot,
      apply: true,
      backup: false,
    });
    expect(result.applied).toBe(true);
    expect(result.writtenFiles).toHaveLength(1);
    expect(JSON.parse(await readFile(item.targetFile, "utf8"))).toMatchObject({ title: "Title", save: "Save" });
  });
});
