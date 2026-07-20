import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createStableId, type LocaleKey } from '@collect-i18n/core'
import fg from 'fast-glob'

import type {
  AnalysisDiagnostic,
  LocaleCatalog,
  LocaleFile,
} from './types.js'

const ignoredDirectories = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.collect-i18n/**',
]

function portable(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

function normalizeLocale(segment: string): 'zh-cn' | 'en-us' | undefined {
  const normalized = segment.toLowerCase().replaceAll('_', '-')
  return normalized === 'zh-cn' || normalized === 'en-us'
    ? normalized
    : undefined
}

function localeFileFromPath(
  projectRoot: string,
  absolutePath: string,
): LocaleFile | undefined {
  const relative = path.relative(projectRoot, absolutePath)
  const segments = relative.split(path.sep)
  const localeIndex = segments.findIndex((segment) => normalizeLocale(segment))
  if (localeIndex < 0) return undefined

  const locale = normalizeLocale(segments[localeIndex])
  if (!locale) return undefined

  const localeDirectory = path.join(projectRoot, ...segments.slice(0, localeIndex + 1))
  const relativeFile = portable(segments.slice(localeIndex + 1).join(path.sep))
  const namespace = relativeFile
    .replace(/\.json$/i, '')
    .split('/')
    .filter(Boolean)
    .join('.')

  return {
    locale,
    absolutePath,
    localeDirectory,
    relativeFile,
    namespace,
  }
}

export interface DiscoverLocaleFilesOptions {
  projectRoot: string
  roots?: string[]
}

/** Discover locale JSON by directory identity, independent of nesting depth. */
export async function discoverLocaleFiles(
  options: DiscoverLocaleFilesOptions,
): Promise<LocaleFile[]> {
  const projectRoot = path.resolve(options.projectRoot)
  const patterns = options.roots?.length
    ? options.roots.map(
        (root) => `${portable(root).replace(/\/$/, '')}/**/*.json`,
      )
    : ['**/*.json']
  const files = await fg(patterns, {
    absolute: true,
    cwd: projectRoot,
    onlyFiles: true,
    unique: true,
    ignore: ignoredDirectories,
  })

  return files
    .map((file) => localeFileFromPath(projectRoot, path.resolve(file)))
    .filter((file): file is LocaleFile => file !== undefined)
    .sort(
      (left, right) =>
        left.relativeFile.localeCompare(right.relativeFile) ||
        left.locale.localeCompare(right.locale),
    )
}

export function flattenLocaleObject(
  input: unknown,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {}

  const visit = (value: unknown, currentPath: string): void => {
    if (typeof value === 'string') {
      if (currentPath) result[currentPath] = value
      return
    }

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        const childPath = currentPath ? `${currentPath}.${index}` : `${index}`
        visit(child, childPath)
      })
      return
    }

    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const childPath = currentPath ? `${currentPath}.${key}` : key
        visit(child, childPath)
      }
    }
  }

  visit(input, prefix)
  return result
}

/** Rebuild nested JSON while retaining array-shaped numeric branches. */
export function unflattenLocaleObject(
  input: Record<string, string>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {}

  type Container = Record<string, unknown> | unknown[]
  const read = (container: Container, key: string): unknown =>
    Array.isArray(container) ? container[Number(key)] : container[key]
  const write = (container: Container, key: string, value: unknown): void => {
    if (Array.isArray(container)) container[Number(key)] = value
    else container[key] = value
  }

  for (const [keyPath, value] of Object.entries(input)) {
    const segments = keyPath.split('.').filter(Boolean)
    if (!segments.length) continue

    let cursor: Container = root
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      const isLast = index === segments.length - 1
      if (isLast) {
        write(cursor, segment, value)
        continue
      }

      const nextIsArrayIndex = /^\d+$/.test(segments[index + 1])
      const existing = read(cursor, segment)
      if (existing === null || typeof existing !== 'object') {
        write(cursor, segment, nextIsArrayIndex ? [] : {})
      }
      cursor = read(cursor, segment) as Container
    }
  }

  return root
}

function invalidLeaves(
  input: unknown,
  prefix = '',
): Array<{ keyPath: string; value: unknown }> {
  if (typeof input === 'string') return []
  if (Array.isArray(input)) {
    return input.flatMap((value, index) =>
      invalidLeaves(value, prefix ? `${prefix}.${index}` : `${index}`),
    )
  }
  if (input !== null && typeof input === 'object') {
    return Object.entries(input).flatMap(([key, value]) =>
      invalidLeaves(value, prefix ? `${prefix}.${key}` : key),
    )
  }
  return [{ keyPath: prefix, value: input }]
}

async function parseLocaleFile(
  file: LocaleFile,
  diagnostics: AnalysisDiagnostic[],
): Promise<Record<string, string>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file.absolutePath, 'utf8')) as unknown
  } catch (error) {
    diagnostics.push({
      code: 'invalid_json',
      severity: 'error',
      message: `无法解析语言包 ${file.absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      details: { file: file.absolutePath },
    })
    return {}
  }

  for (const invalid of invalidLeaves(parsed)) {
    diagnostics.push({
      code: 'invalid_locale_value',
      severity: 'warning',
      message: `词条 ${invalid.keyPath || '<root>'} 不是字符串，已跳过`,
      details: {
        file: file.absolutePath,
        keyPath: invalid.keyPath,
        valueType: invalid.value === null ? 'null' : typeof invalid.value,
      },
    })
  }

  return flattenLocaleObject(parsed)
}

export interface BuildLocaleCatalogOptions extends DiscoverLocaleFilesOptions {
  sourceLocale?: 'zh-cn' | 'en-us'
  targetLocale?: 'zh-cn' | 'en-us'
}

export async function buildLocaleCatalog(
  options: BuildLocaleCatalogOptions,
): Promise<LocaleCatalog> {
  const sourceLocale = options.sourceLocale ?? 'zh-cn'
  const targetLocale = options.targetLocale ?? 'en-us'
  const files = await discoverLocaleFiles(options)
  const diagnostics: AnalysisDiagnostic[] = []
  const parsed = new Map<string, Record<string, string>>()

  await Promise.all(
    files.map(async (file) => {
      parsed.set(file.absolutePath, await parseLocaleFile(file, diagnostics))
    }),
  )

  const targetByRelativeFile = new Map(
    files
      .filter((file) => file.locale === targetLocale)
      .map((file) => [file.relativeFile.toLowerCase(), file]),
  )
  const keys: LocaleKey[] = []
  const firstKeyLocation = new Map<string, LocaleFile>()

  for (const sourceFile of files.filter((file) => file.locale === sourceLocale)) {
    const targetFile = targetByRelativeFile.get(sourceFile.relativeFile.toLowerCase())
    if (!targetFile) {
      diagnostics.push({
        code: 'missing_target_file',
        severity: 'info',
        message: `缺少对应的 ${targetLocale} 文件：${sourceFile.relativeFile}`,
        details: { sourceFile: sourceFile.absolutePath },
      })
    }

    const sourceEntries = parsed.get(sourceFile.absolutePath) ?? {}
    const targetEntries = targetFile
      ? (parsed.get(targetFile.absolutePath) ?? {})
      : {}

    for (const [jsonKeyPath, sourceText] of Object.entries(sourceEntries)) {
      const keyPath = jsonKeyPath === sourceFile.namespace || jsonKeyPath.startsWith(`${sourceFile.namespace}.`)
        ? jsonKeyPath
        : `${sourceFile.namespace}.${jsonKeyPath}`
      const previous = firstKeyLocation.get(keyPath)
      if (previous) {
        diagnostics.push({
          code: 'duplicate_key',
          severity: 'error',
          message: `Key Path ${keyPath} 同时出现在多个中文语言包中`,
          details: {
            keyPath,
            firstFile: previous.absolutePath,
            duplicateFile: sourceFile.absolutePath,
          },
        })
      } else {
        firstKeyLocation.set(keyPath, sourceFile)
      }

      keys.push({
        id: createStableId('key', {
          relativeFile: sourceFile.relativeFile,
          keyPath,
        }),
        keyPath,
        namespace: sourceFile.namespace,
        relativeFile: sourceFile.relativeFile,
        jsonPath: jsonKeyPath.split('.').filter(Boolean),
        sourceText,
        targetText: targetEntries[jsonKeyPath],
        sourceLocale,
        targetLocale,
      })
    }
  }

  return {
    keys: keys.sort(
      (left, right) =>
        left.relativeFile.localeCompare(right.relativeFile) ||
        left.keyPath.localeCompare(right.keyPath),
    ),
    files,
    diagnostics,
  }
}
