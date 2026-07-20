import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import ExcelJS from "exceljs";
import {
  WORKBOOK_HEADERS,
  type ImportIssue,
  type ImportWorkbookOptions,
  type LocaleCatalogEntry,
  type TranslationChange,
  type WorkbookImportReport,
} from "./types.js";

function text(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
  }
  return String(value);
}

function targetIsInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== ""
    && !isAbsolute(rel)
    && rel !== ".."
    && !rel.startsWith(`..${sep}`);
}

function targetKey(target: string): string {
  const resolved = resolve(target);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function isJsonTarget(target: string): boolean {
  return extname(target).toLocaleLowerCase("en-US") === ".json";
}

type JsonContainer = Record<string, unknown> | unknown[];

const MAX_ARRAY_INDEX = 0xffff_fffe;

function arrayIndex(segment: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(segment)) return undefined;
  const index = Number(segment);
  return Number.isSafeInteger(index) && index <= MAX_ARRAY_INDEX ? index : undefined;
}

function setOwn(target: JsonContainer, key: string, value: unknown): void {
  const property = Array.isArray(target) ? arrayIndex(key) : key;
  if (property === undefined) {
    throw new Error(`JSON array path segment must be an index: ${key}`);
  }
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function getOwn(target: JsonContainer, key: string): unknown {
  const property = Array.isArray(target) ? arrayIndex(key) : key;
  if (property === undefined) {
    throw new Error(`JSON array path segment must be an index: ${key}`);
  }
  return Object.prototype.hasOwnProperty.call(target, property)
    ? target[property as keyof JsonContainer]
    : undefined;
}

function createContainer(nextSegment: string): JsonContainer {
  return arrayIndex(nextSegment) === undefined
    ? Object.create(null) as Record<string, unknown>
    : [];
}

function setNested(target: JsonContainer, path: string[], value: string): void {
  if (path.length === 0) throw new Error("JSON property path cannot be empty");
  let cursor = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    const current = getOwn(cursor, segment);
    if (current === undefined) {
      setOwn(cursor, segment, createContainer(path[index + 1]!));
    } else if (current === null || typeof current !== "object") {
      throw new Error(`Target locale JSON has a structural conflict at: ${path.slice(0, index + 1).join(".")}`);
    }
    cursor = getOwn(cursor, segment) as JsonContainer;
  }
  setOwn(cursor, path.at(-1)!, value);
}

async function nearestExistingPath(input: string): Promise<string> {
  let current = resolve(input);
  while (true) {
    try {
      await stat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

async function targetIsInsideRealRoot(root: string, target: string): Promise<boolean> {
  if (!targetIsInside(root, target)) return false;
  const resolvedRoot = resolve(root);
  const existingRoot = await nearestExistingPath(resolvedRoot);
  const realExistingRoot = await realpath(existingRoot);
  const rootSuffix = relative(existingRoot, resolvedRoot);
  const effectiveRoot = resolve(realExistingRoot, rootSuffix);

  const resolvedTarget = resolve(target);
  const existingTarget = await nearestExistingPath(resolvedTarget);
  const realExistingTarget = await realpath(existingTarget);
  const targetSuffix = relative(existingTarget, resolvedTarget);
  const effectiveTarget = resolve(realExistingTarget, targetSuffix);
  return targetIsInside(effectiveRoot, effectiveTarget);
}

interface StagedFile {
  targetFile: string;
  temporary: string;
  body: string;
  existed: boolean;
  original?: Buffer;
}

function jsonFormatting(original: string | undefined): {
  bom: string;
  indent: string | number;
  newline: "\n" | "\r\n";
  finalNewline: boolean;
} {
  if (original === undefined) {
    return { bom: "", indent: 2, newline: "\n", finalNewline: true };
  }
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const withoutBom = bom ? original.slice(1) : original;
  const newline = withoutBom.includes("\r\n") ? "\r\n" : "\n";
  const indentation = withoutBom.match(/^[\t ]+(?=")/m)?.[0];
  const indent = indentation?.includes("\t") ? "\t" : (indentation?.length ?? 2);
  return { bom, indent, newline, finalNewline: /\r?\n$/.test(withoutBom) };
}

async function writeChanges(
  changes: TranslationChange[],
  englishRoot: string,
  backup: boolean,
): Promise<string[]> {
  const grouped = new Map<string, { targetFile: string; changes: TranslationChange[] }>();
  for (const change of changes) {
    if (!isJsonTarget(change.targetFile) || !await targetIsInsideRealRoot(englishRoot, change.targetFile)) {
      throw new Error(`Target locale file escapes en-us root: ${change.targetFile}`);
    }
    const resolvedTarget = resolve(change.targetFile);
    const key = targetKey(resolvedTarget);
    const group = grouped.get(key) ?? { targetFile: resolvedTarget, changes: [] };
    group.changes.push(change);
    grouped.set(key, group);
  }

  const staged: StagedFile[] = [];
  for (const { targetFile, changes: fileChanges } of grouped.values()) {
    let json: JsonContainer = createContainer(fileChanges[0]!.jsonPath[0]!);
    let original: Buffer | undefined;
    let originalText: string | undefined;
    try {
      original = await readFile(targetFile);
      originalText = original.toString("utf8");
      const parsable = originalText.startsWith("\uFEFF") ? originalText.slice(1) : originalText;
      const parsed = JSON.parse(parsable) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error(`Target locale file must contain a JSON object or array: ${targetFile}`);
      }
      json = parsed as JsonContainer;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    for (const change of fileChanges) setNested(json, change.jsonPath, change.english);
    const format = jsonFormatting(originalText);
    const serialized = JSON.stringify(json, null, format.indent).replaceAll("\n", format.newline);
    const body = `${format.bom}${serialized}${format.finalNewline ? format.newline : ""}`;
    staged.push({
      targetFile,
      temporary: `${targetFile}.${process.pid}.${randomUUID()}.tmp`,
      body,
      existed: original !== undefined,
      original,
    });
  }

  try {
    for (const file of staged) {
      await mkdir(dirname(file.targetFile), { recursive: true });
      await writeFile(file.temporary, file.body, { encoding: "utf8", flag: "wx" });
    }
    if (backup) {
      for (const file of staged) {
        if (file.existed) await copyFile(file.targetFile, `${file.targetFile}.bak`);
      }
    }

    const committed: StagedFile[] = [];
    try {
      for (const file of staged) {
        await rename(file.temporary, file.targetFile);
        committed.push(file);
      }
    } catch (error) {
      for (const file of committed.reverse()) {
        if (file.existed && file.original) {
          const rollback = `${file.targetFile}.${process.pid}.${randomUUID()}.rollback`;
          await writeFile(rollback, file.original, { flag: "wx" });
          await rename(rollback, file.targetFile);
        } else {
          await rm(file.targetFile, { force: true });
        }
      }
      throw error;
    }
  } finally {
    await Promise.all(staged.map((file) => rm(file.temporary, { force: true })));
  }
  return staged.map((file) => resolve(file.targetFile)).sort();
}

function catalogMap(entries: LocaleCatalogEntry[], issues: ImportIssue[]) {
  const result = new Map<string, LocaleCatalogEntry>();
  for (const entry of entries) {
    if (!entry.keyPath || entry.jsonPath.length === 0) {
      issues.push({
        code: "invalid_key",
        keyPath: entry.keyPath,
        message: `目录中的 Key Path 或 JSON 路径无效：${entry.keyPath}`,
        fatal: true,
      });
      continue;
    }
    if (result.has(entry.keyPath)) {
      issues.push({
        code: "duplicate_key",
        keyPath: entry.keyPath,
        message: `语言包中存在重复 Key Path：${entry.keyPath}`,
        fatal: true,
      });
    } else {
      result.set(entry.keyPath, entry);
    }
  }
  return result;
}

export async function importTranslationWorkbook(
  options: ImportWorkbookOptions,
): Promise<WorkbookImportReport> {
  const issues: ImportIssue[] = [];
  const catalog = catalogMap(options.catalog, issues);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(options.workbookPath));

  if (workbook.worksheets.length !== 1 || workbook.worksheets[0]?.state !== "visible") {
    issues.push({
      code: "invalid_workbook",
      message: "回稿必须且只能包含一个可见工作表",
      fatal: true,
    });
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return {
      workbookPath: resolve(options.workbookPath), totalRows: 0, translatedRows: 0,
      unchangedRows: 0, changes: [], issues, canApply: false, applied: false, writtenFiles: [],
    };
  }

  const actualHeaders = [1, 2, 3, 4].map((column) => text(worksheet.getCell(1, column).value));
  let hasExtraColumnContent = false;
  worksheet.eachRow((row) => {
    row.eachCell((cell, column) => {
      if (column > 4 && text(cell.value) !== "") hasExtraColumnContent = true;
    });
  });
  if (actualHeaders.some((header, index) => header !== WORKBOOK_HEADERS[index]) || hasExtraColumnContent) {
    issues.push({
      code: "invalid_headers",
      row: 1,
      message: `表头必须严格为：${WORKBOOK_HEADERS.join("、")}`,
      fatal: true,
    });
  }

  const seen = new Set<string>();
  const changes: TranslationChange[] = [];
  let unchangedRows = 0;
  let totalRows = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const chinese = text(worksheet.getCell(rowNumber, 1).value);
    const english = text(worksheet.getCell(rowNumber, 2).value);
    const keyPath = text(worksheet.getCell(rowNumber, 4).value).trim();
    if (!chinese && !english.trim() && !keyPath) continue;
    totalRows += 1;

    if (!keyPath) {
      issues.push({ code: "invalid_key", row: rowNumber, message: "Key Path 不能为空", fatal: true });
      continue;
    }
    if (seen.has(keyPath)) {
      issues.push({ code: "duplicate_key", keyPath, row: rowNumber, message: `回稿中 Key Path 重复：${keyPath}`, fatal: true });
      continue;
    }
    seen.add(keyPath);

    const expected = catalog.get(keyPath);
    if (!expected) {
      issues.push({ code: "unknown_key", keyPath, row: rowNumber, message: `项目中不存在 Key Path：${keyPath}`, fatal: true });
      continue;
    }
    if (chinese !== expected.chinese) {
      issues.push({ code: "chinese_changed", keyPath, row: rowNumber, message: `中文列已被修改：${keyPath}`, fatal: true });
      continue;
    }
    if (!english.trim() || english === chinese) {
      unchangedRows += 1;
      continue;
    }
    changes.push({
      keyPath,
      chinese,
      english,
      targetFile: expected.targetFile,
      jsonPath: expected.jsonPath,
      row: rowNumber,
    });
  }

  for (const keyPath of catalog.keys()) {
    if (!seen.has(keyPath)) {
      issues.push({ code: "missing_key", keyPath, message: `回稿中缺少 Key Path：${keyPath}`, fatal: false });
    }
  }

  const translatedTargets = new Map(changes.map((change) => [targetKey(change.targetFile), resolve(change.targetFile)]));
  for (const targetFile of translatedTargets.values()) {
    let valid = isJsonTarget(targetFile);
    try {
      valid = valid && await targetIsInsideRealRoot(options.englishRoot, targetFile);
    } catch {
      valid = false;
    }
    if (!valid) {
      issues.push({
        code: "invalid_target",
        message: `目标语言文件超出 en-us 目录：${targetFile}`,
        fatal: true,
      });
    }
  }

  let canApply = !issues.some((issue) => issue.fatal);
  let writtenFiles: string[] = [];
  let applied = false;
  if (options.apply && canApply) {
    try {
      writtenFiles = await writeChanges(changes, options.englishRoot, options.backup ?? true);
      applied = true;
    } catch (error) {
      issues.push({
        code: "write_failed",
        message: error instanceof Error ? error.message : String(error),
        fatal: true,
      });
      canApply = false;
    }
  }

  return {
    workbookPath: resolve(options.workbookPath),
    totalRows,
    translatedRows: changes.length,
    unchangedRows,
    changes,
    issues,
    canApply,
    applied,
    writtenFiles,
  };
}
