import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import ExcelJS from '../../packages/excel/node_modules/exceljs/excel.js'

const [workbookArgument, databaseArgument] = process.argv.slice(2)
if (!workbookArgument || !databaseArgument) {
  throw new Error('Usage: node evaluate-run.mjs <workbook.xlsx> <state.sqlite>')
}

const workbookPath = resolve(workbookArgument)
const databasePath = resolve(databaseArgument)
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(workbookPath)
const sheet = workbook.getWorksheet('Translations')
if (!sheet) throw new Error('Missing Translations worksheet')

const headers = [1, 2, 3, 4].map((column) => sheet.getCell(1, column).text)
const expectedHeaders = ['中文', '英文', '截图', 'Key Path']
const keys = new Set()
let equalLanguageRows = 0
let populatedRows = 0
for (let row = 2; row <= sheet.rowCount; row += 1) {
  const chinese = sheet.getCell(row, 1).text
  const english = sheet.getCell(row, 2).text
  const keyPath = sheet.getCell(row, 4).text
  if (!keyPath) continue
  populatedRows += 1
  keys.add(keyPath)
  if (chinese === english) equalLanguageRows += 1
}

const database = new DatabaseSync(databasePath, { readOnly: true })
const session = database.prepare('SELECT id, created_at, updated_at, status FROM sessions ORDER BY created_at DESC LIMIT 1').get()
if (!session) throw new Error('No validation session found')
const evidenceRows = database.prepare(`
  SELECT key_path, screenshot_path, data_json, captured_at
  FROM evidence
  WHERE session_id=?
  ORDER BY captured_at DESC
`).all(session.id)
const evidenceHashes = new Map()
for (const row of evidenceRows) {
  const data = JSON.parse(row.data_json)
  const hashes = evidenceHashes.get(row.key_path) ?? new Set()
  if (typeof data.screenshotSha256 === 'string') hashes.add(data.screenshotSha256)
  evidenceHashes.set(row.key_path, hashes)
}

const anchoredKeys = new Set()
const mismatches = []
for (const drawing of sheet.getImages()) {
  const rowNumber = drawing.range.tl.nativeRow + 1
  const keyPath = sheet.getCell(rowNumber, 4).text
  const image = workbook.getImage(Number(drawing.imageId))
  if (!keyPath || !image?.buffer) {
    mismatches.push({ rowNumber, keyPath, reason: 'missing_key_or_image_bytes' })
    continue
  }
  const hash = createHash('sha256').update(Buffer.from(image.buffer)).digest('hex')
  if (!evidenceHashes.get(keyPath)?.has(hash)) {
    mismatches.push({ rowNumber, keyPath, hash, reason: 'image_not_owned_by_row_key' })
  }
  anchoredKeys.add(keyPath)
}

const statusCounts = Object.fromEntries(
  database.prepare(`
    SELECT status, COUNT(*) count
    FROM tasks
    WHERE session_id=?
    GROUP BY status
    ORDER BY status
  `).all(session.id).map((row) => [row.status, Number(row.count)]),
)
const imageCount = sheet.getImages().length
const report = {
  ok:
    JSON.stringify(headers) === JSON.stringify(expectedHeaders) &&
    populatedRows === 1_000 &&
    keys.size === 1_000 &&
    equalLanguageRows === 1_000 &&
    imageCount === anchoredKeys.size &&
    mismatches.length === 0,
  workbookPath,
  headers,
  populatedRows,
  uniqueKeys: keys.size,
  equalLanguageRows,
  imageCount,
  uniqueImageKeys: anchoredKeys.size,
  imageBindingAccuracy: imageCount === 0 ? 1 : (imageCount - mismatches.length) / imageCount,
  mismatches: mismatches.slice(0, 20),
  statusCounts,
  session,
}
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
