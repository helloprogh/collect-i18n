import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { extname, dirname, resolve } from "node:path";
import ExcelJS from "exceljs";
import {
  WORKBOOK_HEADERS,
  WORKSHEET_NAME,
  type WorkbookExportRow,
} from "./types.js";

function imageExtension(file: string): "png" | "jpeg" | undefined {
  const extension = extname(file).toLowerCase();
  if (extension === ".png") return "png";
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  return undefined;
}

function imageMatchesExtension(buffer: Buffer, extension: "png" | "jpeg"): boolean {
  if (extension === "png") {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
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

  const orderedRows = [...rows].sort((a, b) =>
    a.keyPath.localeCompare(b.keyPath, "en"),
  );
  let imageCount = 0;

  for (const source of orderedRows) {
    const row = worksheet.addRow({
      chinese: source.chinese,
      // Every export is a clean translation task. Existing en-us values are
      // deliberately ignored; the reviewer starts from the Chinese source.
      english: source.chinese,
      screenshot: "",
      keyPath: source.keyPath,
    });
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
      const imageId = workbook.addImage({ base64: buffer.toString("base64"), extension });
      row.height = 88;
      worksheet.addImage(imageId, {
        tl: { col: 2.05, row: row.number - 0.95 },
        ext: { width: 190, height: 108 },
        editAs: "oneCell",
      });
      imageCount += 1;
    }
  }

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
