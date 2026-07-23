import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const localeRoot = path.join(root, 'src', 'locales')

function flatten(value, prefix = '', output = new Map()) {
  if (typeof value === 'string') output.set(prefix, value)
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, output)
  }
  return output
}

async function jsonFiles(folder) {
  return (await fs.readdir(folder)).filter((file) => file.endsWith('.json')).sort()
}

const zhDir = path.join(localeRoot, 'zh-cn')
const enDir = path.join(localeRoot, 'en-us')
const zhFiles = await jsonFiles(zhDir)
const enFiles = await jsonFiles(enDir)
const failures = []

if (JSON.stringify(zhFiles) !== JSON.stringify(enFiles)) failures.push(`Locale file sets differ: zh=${zhFiles} en=${enFiles}`)

let totalKeys = 0
for (const file of zhFiles) {
  const zh = flatten(JSON.parse(await fs.readFile(path.join(zhDir, file), 'utf8')))
  const en = flatten(JSON.parse(await fs.readFile(path.join(enDir, file), 'utf8')))
  totalKeys += zh.size
  const zhKeys = [...zh.keys()].sort()
  const enKeys = [...en.keys()].sort()
  if (JSON.stringify(zhKeys) !== JSON.stringify(enKeys)) failures.push(`${file}: key paths differ`)
  for (const [key, value] of zh) {
    if (!value.trim() || !en.get(key)?.trim()) failures.push(`${file}:${key}: blank translation`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ ok: true, files: zhFiles.length, totalKeys, localeFolders: ['zh-cn', 'en-us'] }))
}
