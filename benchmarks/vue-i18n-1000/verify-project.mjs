import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(process.argv[2] ?? 'examples/vue-i18n-translation-lab')
const localeRoot = path.join(projectRoot, 'src', 'locales')

function flatten(value, prefix = '', output = new Map()) {
  if (typeof value === 'string') output.set(prefix, value)
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, output)
    }
  }
  return output
}

async function filesBelow(folder, matcher) {
  const output = []
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const absolute = path.join(folder, entry.name)
    if (entry.isDirectory()) output.push(...await filesBelow(absolute, matcher))
    else if (matcher.test(entry.name)) output.push(absolute)
  }
  return output
}

const zhFiles = (await fs.readdir(path.join(localeRoot, 'zh-cn'))).filter((file) => file.endsWith('.json')).sort()
const enFiles = (await fs.readdir(path.join(localeRoot, 'en-us'))).filter((file) => file.endsWith('.json')).sort()
const failures = []
if (JSON.stringify(zhFiles) !== JSON.stringify(enFiles)) failures.push('zh-cn 与 en-us 文件集合不一致')

const keys = new Map()
for (const file of zhFiles) {
  const namespace = file.replace(/\.json$/u, '')
  const zh = flatten(JSON.parse(await fs.readFile(path.join(localeRoot, 'zh-cn', file), 'utf8')))
  const en = flatten(JSON.parse(await fs.readFile(path.join(localeRoot, 'en-us', file), 'utf8')))
  if (JSON.stringify([...zh.keys()].sort()) !== JSON.stringify([...en.keys()].sort())) failures.push(`${file} 的中英文 key 不一致`)
  for (const [key, chinese] of zh) {
    const keyPath = `${namespace}.${key}`
    if (keys.has(keyPath)) failures.push(`重复 key：${keyPath}`)
    if (!chinese.trim() || !en.get(key)?.trim()) failures.push(`空词条：${keyPath}`)
    keys.set(keyPath, chinese)
  }
}

const sourceFiles = await filesBelow(path.join(projectRoot, 'src'), /\.(?:vue|ts|tsx|js|jsx)$/u)
const sourceText = (await Promise.all(sourceFiles.map((file) => fs.readFile(file, 'utf8')))).join('\n')
const scenarioMetrics = {
  sourceFiles: sourceFiles.length,
  vueViews: sourceFiles.filter((file) => file.endsWith('.vue') && file.includes(`${path.sep}views${path.sep}`)).length,
  javascriptTranslationCalls: [...sourceText.matchAll(/\bt\(\s*(?:[A-Z_$][\w$]*\s*\[|[A-Z_$][\w$]*\.)/gu)].length,
  mappedMessageKeys: [...sourceText.matchAll(/['"](?:support|inventory|billing|releases)\.(?:messages|errors)\.[\w]+['"]/gu)].length,
  validationRules: [...sourceText.matchAll(/\bmessage:\s*t\(/gu)].length,
  elementTableColumns: [...sourceText.matchAll(/<el-table-column\b/gu)].length,
  elementImperativeServices: [...sourceText.matchAll(/\bEl(?:Message|Notification|MessageBox)\b/gu)].length,
  stableControls: [...sourceText.matchAll(/data-testid=/gu)].length,
  gatedContainers: [...sourceText.matchAll(/<el-(?:dialog|drawer|collapse-item|tab-pane)\b|\bv-if=/gu)].length,
  routes: [...sourceText.matchAll(/\bpath:\s*['"]\//gu)].length,
}

if (keys.size !== 1000) failures.push(`词条总数应为 1000，实际为 ${keys.size}`)
if (scenarioMetrics.javascriptTranslationCalls < 2) failures.push('缺少 JavaScript 动态映射词条调用')
if (scenarioMetrics.mappedMessageKeys < 60) failures.push('消息与错误映射场景不足')
if (scenarioMetrics.validationRules < 25) failures.push('表单校验词条场景不足')
if (scenarioMetrics.elementTableColumns < 40) failures.push('Element Plus 表格词条场景不足')
if (scenarioMetrics.elementImperativeServices < 30) failures.push('Element Plus 命令式消息场景不足')
if (scenarioMetrics.stableControls < 250) failures.push('可操作控件数量不足')
if (scenarioMetrics.gatedContainers < 60) failures.push('交互后显示的容器场景不足')
if (scenarioMetrics.routes < 12) failures.push('业务路由数量不足')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ ok: true, totalKeys: keys.size, localeFiles: zhFiles.length, scenarioMetrics }))
}
