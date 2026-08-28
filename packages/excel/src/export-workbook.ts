import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { extname, dirname, resolve } from "node:path";
import ExcelJS from "exceljs";
import {
  WORKBOOK_HEADERS,
  WORKSHEET_NAME,
  type WorkbookExportRow,
} from "./types.js";

const THIN_BORDER = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
} as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function applyCellBorders(
  worksheet: ExcelJS.Worksheet,
  firstRow: number,
  lastRow: number,
  columnCount: number,
): void {
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = 1; column <= columnCount; column += 1) {
      worksheet.getCell(row, column).border = THIN_BORDER;
    }
  }
}

function imageExtension(file: string): "png" | "jpeg" | undefined {
  const extension = extname(file).toLowerCase();
  if (extension === ".png") return "png";
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  return undefined;
}

function imageMatchesExtension(buffer: Buffer, extension: "png" | "jpeg"): boolean {
  if (extension === "png") {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  }
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24) return undefined;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return undefined;
    if (
      marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    ) {
      if (offset + 9 > buffer.length) return undefined;
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + segmentLength;
  }
  return undefined;
}

function imageDimensions(
  buffer: Buffer,
  extension: "png" | "jpeg",
): { width: number; height: number } | undefined {
  return extension === "png" ? pngDimensions(buffer) : jpegDimensions(buffer);
}

function validateRows(rows: WorkbookExportRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.keyPath || row.keyPath !== row.keyPath.trim()) {
      throw new Error(`Invalid Key Path: ${JSON.stringify(row.keyPath)}`);
    }
    if (seen.has(row.keyPath)) {
      throw new Error(`Duplicate Key Path: ${row.keyPath}`);
    }
    seen.add(row.keyPath);
  }
}

export async function exportTranslationWorkbook(
  rows: WorkbookExportRow[],
  outputPath: string,
): Promise<{ outputPath: string; rowCount: number; imageCount: number }> {
  validateRows(rows);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "";
  workbook.lastModifiedBy = "";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  workbook.calcProperties.fullCalcOnLoad = false;

  const worksheet = workbook.addWorksheet(WORKSHEET_NAME, {
    properties: { defaultRowHeight: 22 },
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });

  worksheet.columns = [
    { header: WORKBOOK_HEADERS[0], key: "chinese", width: 36 },
    { header: WORKBOOK_HEADERS[1], key: "english", width: 36 },
    { header: WORKBOOK_HEADERS[2], key: "screenshot", width: 30 },
    { header: WORKBOOK_HEADERS[3], key: "keyPath", width: 48 },
  ];

  const header = worksheet.getRow(1);
  header.height = 28;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2563EB" },
  };
  header.alignment = { vertical: "middle", horizontal: "left" };

  // Deprecated rows (classified at finalize as no-source-occurrence) and
  // dead keys (needs_manual with zero occurrences) are grouped at the very
  // end of the sheet — dead keys first, then deprecated; every other row —
  // including non-visual rows — keeps the alphabetical order.
  const normalRows = rows
    .filter((row) => !row.deprecated && !row.deadKey)
    .sort((a, b) => a.keyPath.localeCompare(b.keyPath, "en"));
  const deadKeyRows = rows
    .filter((row) => row.deadKey && !row.deprecated)
    .sort((a, b) => a.keyPath.localeCompare(b.keyPath, "en"));
  const deprecatedRows = rows
    .filter((row) => row.deprecated)
    .sort((a, b) => a.keyPath.localeCompare(b.keyPath, "en"));
  const orderedRows = [...normalRows, ...deadKeyRows, ...deprecatedRows];
  let imageCount = 0;

  for (const source of orderedRows) {
    const row = worksheet.addRow([
      source.chinese,
      // Every export is a clean translation task. Existing en-us values are
      // deliberately ignored; the reviewer starts from the Chinese source.
      source.chinese,
    ]);
    row.getCell(4).value = source.keyPath;
    row.alignment = { vertical: "middle", wrapText: true };
    row.getCell(4).numFmt = "@";

    if (source.screenshotPath) {
      const extension = imageExtension(source.screenshotPath);
      if (!extension) {
        throw new Error(`Unsupported screenshot format: ${source.screenshotPath}`);
      }
      const buffer = await readFile(resolve(source.screenshotPath));
      if (!imageMatchesExtension(buffer, extension)) {
        throw new Error(`Screenshot content does not match its extension: ${source.screenshotPath}`);
      }
      if (
        source.screenshotSha256 &&
        createHash("sha256").update(buffer).digest("hex") !== source.screenshotSha256
      ) {
        throw new Error(`Screenshot integrity check failed for Key Path: ${source.keyPath}`);
      }
      const imageId = workbook.addImage({ base64: buffer.toString("base64"), extension });
      const dimensions = imageDimensions(buffer, extension);
      if (!dimensions) {
        throw new Error(`Unable to read screenshot dimensions: ${source.screenshotPath}`);
      }
      const columnPixels = Math.round((worksheet.getColumn(3).width ?? 30) * 7 + 5);
      const displayWidth = Math.max(60, columnPixels - 8);
      const displayHeight = Math.max(30, Math.round((displayWidth * dimensions.height) / dimensions.width));
      row.height = displayHeight + 10;
      // Use a fixed one-cell anchor with an explicit pixel size so the
      // embedded screenshot keeps its source aspect ratio instead of being
      // stretched to fill a fixed two-cell span.
      const imageRange = {
        tl: { col: 2.1, row: row.number - 0.95 },
        ext: { width: displayWidth, height: displayHeight },
        editAs: "oneCell",
      } as unknown as Parameters<typeof worksheet.addImage>[1];
      worksheet.addImage(imageId, imageRange);
      imageCount += 1;
    } else if (source.deprecated) {
      // No screenshot can exist for a deprecated key; annotate the cell
      // instead of leaving it empty so the reviewer knows why.
      const cell = row.getCell(3);
      cell.value = "词条废弃";
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.font = { italic: true, color: { argb: "FF6B7280" } };
    } else if (source.nonVisual) {
      // Non-visual keys (aria-*/native title only) cannot be screenshotted;
      // annotate in place with the same visual style as deprecated rows.
      const cell = row.getCell(3);
      cell.value = "非可视";
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.font = { italic: true, color: { argb: "FF6B7280" } };
    } else if (source.deadKey) {
      // Dead keys carry no source occurrence, so no screenshot can exist;
      // annotate with the same visual style as deprecated rows.
      const cell = row.getCell(3);
      cell.value = "死键";
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.font = { italic: true, color: { argb: "FF6B7280" } };
    } else if (source.manualReason) {
      // Remaining manual rows: annotate the cause group (dynamic source,
      // manual fallback...) in the same style so reviewers can batch them.
      const cell = row.getCell(3);
      cell.value = source.manualReason === "unresolved_dynamic_source" ? "动态键" : "人工";
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.font = { italic: true, color: { argb: "FF6B7280" } };
    }
  }

  applyCellBorders(worksheet, 1, worksheet.actualRowCount, 4);
  worksheet.autoFilter = { from: "A1", to: "D1" };
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  const temporary = `${resolvedOutput}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await workbook.xlsx.writeFile(temporary);
    await rename(temporary, resolvedOutput);
  } finally {
    await rm(temporary, { force: true });
  }
  return { outputPath: resolvedOutput, rowCount: orderedRows.length, imageCount };
}
