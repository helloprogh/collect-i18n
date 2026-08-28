import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Path aliases resolved from the target project's tsconfig/jsconfig. When the
 * router imports components through a custom alias (`@views/...`, `#lib/...`),
 * the route→component→occurrence chain used to break silently and every key
 * in those components lost its deterministic route hint. Reading the same
 * alias table the bundler uses keeps that chain intact without requiring any
 * project configuration of the collector itself.
 */
export interface PathAlias {
  /** Alias prefix matched against import specifiers, without trailing slash (for example `@views`). */
  prefix: string
  /** Absolute target patterns; a `*` receives the specifier remainder after the prefix. */
  targets: string[]
}

/** Strip JSONC noise (comments, trailing commas) so tsconfig parses without a TS toolchain. */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n\r]*/g, '$1')
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, '$1')
  try {
    const parsed = JSON.parse(withoutTrailingCommas) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

async function readConfig(dir: string, name: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await readFile(path.join(dir, name), 'utf8')
    return parseJsonc(text)
  } catch {
    return undefined
  }
}

interface PathsSource {
  options: Record<string, unknown>
  directory: string
}

/**
 * First compilerOptions along the `extends` chain that declares `paths`.
 * Relative extends only: package extends (e.g. @vue/tsconfig) rarely carry
 * project-specific aliases and would need module resolution to locate.
 */
async function findPathsDeclaration(
  directory: string,
  name: string,
  depth: number,
  visited: Set<string>,
): Promise<PathsSource | undefined> {
  const file = path.join(directory, name)
  if (visited.has(file) || depth > 3) return undefined
  visited.add(file)
  const config = await readConfig(directory, name)
  if (!config) return undefined
  const options = config.compilerOptions
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    const record = options as Record<string, unknown>
    if (record.paths && typeof record.paths === 'object') {
      return { options: record, directory }
    }
  }
  if (typeof config.extends !== 'string') return undefined
  const parentDir = path.resolve(directory, path.dirname(config.extends))
  const parentName = path.basename(config.extends)
  return findPathsDeclaration(parentDir, parentName, depth + 1, visited)
}

function aliasesFromOptions(options: Record<string, unknown>, directory: string): PathAlias[] {
  const rawPaths = options.paths
  if (!rawPaths || typeof rawPaths !== 'object' || Array.isArray(rawPaths)) return []
  // With no baseUrl, TypeScript resolves paths relative to the config file.
  const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : '.'
  const aliases: PathAlias[] = []
  for (const [key, value] of Object.entries(rawPaths as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const targets = value.filter((entry): entry is string => typeof entry === 'string')
    if (!targets.length) continue
    const prefix = key.replace(/\/\*$/, '')
    if (!prefix) continue
    aliases.push({
      prefix,
      targets: targets.map((target) => path.resolve(directory, baseUrl, target)),
    })
  }
  // Longest prefix wins when aliases overlap (for example `@ui/*` before `@/*`).
  return aliases.sort((left, right) => right.prefix.length - left.prefix.length)
}

export async function detectPathAliases(projectRoot: string): Promise<PathAlias[]> {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const found = await findPathsDeclaration(projectRoot, name, 0, new Set())
    if (found) return aliasesFromOptions(found.options, found.directory)
  }
  return []
}

/**
 * Resolve an import specifier through the alias table. Returns undefined when
 * no alias matches so the caller can fall back to its built-in resolution.
 */
export function resolveAliasSpecifier(specifier: string, aliases: PathAlias[]): string[] | undefined {
  for (const alias of aliases) {
    const rest =
      specifier === alias.prefix
        ? ''
        : specifier.startsWith(`${alias.prefix}/`)
          ? specifier.slice(alias.prefix.length + 1)
          : undefined
    if (rest === undefined) continue
    return alias.targets.map((target) =>
      target.includes('*') ? target.replace(/\*[^/]*$/, rest) : path.join(target, rest),
    )
  }
  return undefined
}
