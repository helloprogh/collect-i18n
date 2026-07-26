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

async function sourceFiles(folder) {
  const output = []
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const absolute = path.join(folder, entry.name)
    if (entry.isDirectory()) output.push(...await sourceFiles(absolute))
    else if (/\.(?:vue|ts)$/u.test(entry.name)) output.push(absolute)
  }
  return output
}

const zhDir = path.join(localeRoot, 'zh-cn')
const enDir = path.join(localeRoot, 'en-us')
const zhFiles = await jsonFiles(zhDir)
const enFiles = await jsonFiles(enDir)
const failures = []

if (JSON.stringify(zhFiles) !== JSON.stringify(enFiles)) failures.push(`Locale file sets differ: zh=${zhFiles} en=${enFiles}`)

let totalKeys = 0
const catalogKeys = new Set()
for (const file of zhFiles) {
  const zh = flatten(JSON.parse(await fs.readFile(path.join(zhDir, file), 'utf8')))
  const en = flatten(JSON.parse(await fs.readFile(path.join(enDir, file), 'utf8')))
  totalKeys += zh.size
  const namespace = file.replace(/\.json$/u, '')
  for (const key of zh.keys()) catalogKeys.add(`${namespace}.${key}`)
  const zhKeys = [...zh.keys()].sort()
  const enKeys = [...en.keys()].sort()
  if (JSON.stringify(zhKeys) !== JSON.stringify(enKeys)) failures.push(`${file}: key paths differ`)
  for (const [key, value] of zh) {
    if (!value.trim() || !en.get(key)?.trim()) failures.push(`${file}:${key}: blank translation`)
  }
}

const sources = await sourceFiles(path.join(root, 'src'))
const sourceText = (await Promise.all(sources.map((file) => fs.readFile(file, 'utf8')))).join('\n')
const literalKeys = new Set(
  [...sourceText.matchAll(/\bt\(\s*(['"`])([^'"`$]+)\1/gu)].map((match) => match[2]),
)
const unknownLiteralKeys = [...literalKeys].filter((key) => !catalogKeys.has(key)).sort()
const metrics = {
  literalSourceKeys: literalKeys.size,
  literalCatalogMatches: literalKeys.size - unknownLiteralKeys.length,
  dynamicCallSites: [...sourceText.matchAll(/\bt\(\s*`[^`]*\$\{/gu)].length,
  interactionControls: [...sourceText.matchAll(/data-testid=/gu)].length,
  gatedContainers: [...sourceText.matchAll(/\bv-if=|<el-(?:tab-pane|collapse-item|dialog|drawer)\b/gu)].length,
  imperativeServices: [...sourceText.matchAll(/\bEl(?:Message|Notification|MessageBox)\b/gu)].length,
  localMockHandlers: [
    ...sourceText.matchAll(/\b(?:if|const)\s*\([^)]*\burl\b[^)]*(?:===|\.match\()/gu),
  ].length,
}

if (totalKeys !== 601) failures.push(`Expected exactly 601 locale keys, received ${totalKeys}`)
if (unknownLiteralKeys.length) failures.push(`Literal source keys missing from locale catalog: ${unknownLiteralKeys.join(', ')}`)
if (metrics.literalSourceKeys < 400) failures.push(`Too few statically attributable source keys: ${metrics.literalSourceKeys}`)
if (metrics.dynamicCallSites < 10) failures.push(`Dynamic-key coverage is too small: ${metrics.dynamicCallSites}`)
if (metrics.interactionControls < 120) failures.push(`Too few stable interaction controls: ${metrics.interactionControls}`)
if (metrics.gatedContainers < 30) failures.push(`Too few interaction-gated containers: ${metrics.gatedContainers}`)
if (metrics.imperativeServices < 10) failures.push(`Too few imperative service scenarios: ${metrics.imperativeServices}`)
if (metrics.localMockHandlers < 10) failures.push(`Too few local mock request handlers: ${metrics.localMockHandlers}`)

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    ok: true,
    files: zhFiles.length,
    totalKeys,
    localeFolders: ['zh-cn', 'en-us'],
    metrics,
  }))
}
