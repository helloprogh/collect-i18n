import fs from 'node:fs'
import path from 'node:path'
import type { OccurrenceDescriptor } from '@collect-i18n/runtime'
import type { Plugin } from 'vite'
import { instrumentScriptModule, instrumentVueSfc } from './instrument.js'
import {
  resolveRuntimeImport,
  runtimeImportFilePath,
} from './runtime-import.js'
import type {
  CollectI18nVuePluginOptions,
  OccurrenceManifest,
} from './types.js'

export * from './instrument.js'
export * from './runtime-import.js'
export * from './types.js'

const PUBLIC_BOOTSTRAP_ID = 'virtual:collect-i18n/bootstrap'
const RESOLVED_BOOTSTRAP_ID = `\0${PUBLIC_BOOTSTRAP_ID}`

function enabledFor(
  enabled: CollectI18nVuePluginOptions['enabled'],
  command: 'build' | 'serve',
): boolean {
  if (enabled === false) return false
  if (enabled === true || enabled === 'always') return true
  if (enabled === 'serve') return command === 'serve'
  return command === 'serve' || process.env.COLLECT_I18N === '1'
}

function matches(
  matcher: RegExp | ((id: string) => boolean) | undefined,
  id: string,
  fallback: boolean,
): boolean {
  if (!matcher) return fallback
  if (typeof matcher === 'function') return matcher(id)
  matcher.lastIndex = 0
  return matcher.test(id)
}

function manifestOutput(
  options: CollectI18nVuePluginOptions,
  projectRoot: string,
): string | undefined {
  const selected = options.output ?? (typeof options.manifest === 'string' ? options.manifest : undefined)
  if (selected) return path.resolve(projectRoot, selected)
  if (options.manifest === true) {
    return path.join(projectRoot, '.collect-i18n', 'instrumentation-manifest.json')
  }
  return undefined
}

function writeManifest(
  destination: string,
  projectRoot: string,
  byFile: Map<string, OccurrenceDescriptor[]>,
): void {
  const occurrences = [...byFile.values()]
    .flat()
    .sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId))
  const manifest: OccurrenceManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    occurrences,
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, destination)
}

export function collectI18nVuePlugin(options: CollectI18nVuePluginOptions = {}): Plugin {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd())
  const output = manifestOutput(options, projectRoot)
  const runtimeImport = resolveRuntimeImport(options.runtimeImport)
  const runtimeFile = runtimeImportFilePath(runtimeImport)
  const occurrencesByFile = new Map<string, OccurrenceDescriptor[]>()

  return {
    name: 'collect-i18n:vue',
    enforce: 'pre',
    apply(_config, environment) {
      return enabledFor(options.enabled, environment.command)
    },
    config() {
      if (!runtimeFile) return undefined
      return {
        server: {
          fs: {
            // Supplying an allow list disables Vite's implicit project allowance.
            allow: [projectRoot, path.dirname(runtimeFile)],
          },
        },
      }
    },
    buildStart() {
      occurrencesByFile.clear()
    },
    resolveId(id) {
      if (id === PUBLIC_BOOTSTRAP_ID) return RESOLVED_BOOTSTRAP_ID
      return undefined
    },
    load(id) {
      if (id !== RESOLVED_BOOTSTRAP_ID) return undefined
      return (
        `import { installCollectorRuntime } from ${JSON.stringify(runtimeImport)};\n` +
        `installCollectorRuntime({ overlay: ${options.overlay !== false} });\n`
      )
    },
    transform(source, id) {
      const cleanId = id.split('?')[0]!
      if (!matches(options.include, id, true) || matches(options.exclude, id, false)) return undefined
      const resolvedId = path.resolve(cleanId)
      if (resolvedId !== projectRoot && !resolvedId.startsWith(`${projectRoot}${path.sep}`)) return undefined
      const instrumentOptions = {
        ...options,
        projectRoot,
        runtimeImport,
      }
      const result = cleanId.endsWith('.vue')
        ? instrumentVueSfc(source, id, instrumentOptions)
        : /\.[cm]?[jt]sx?$/.test(cleanId)
          ? instrumentScriptModule(source, id, instrumentOptions)
          : undefined
      if (!result) return undefined
      occurrencesByFile.set(cleanId, result.occurrences)
      if (output) writeManifest(output, projectRoot, occurrencesByFile)
      // Rollup accepts a serialized sourcemap and this avoids the historical
      // magic-string 0.30.0 `sourcesContent: null[]` typing incompatibility.
      return { code: result.code, map: result.map.toString() }
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: `import ${JSON.stringify(PUBLIC_BOOTSTRAP_ID)};`,
            injectTo: 'head-prepend',
          },
        ]
      },
    },
    buildEnd() {
      if (output) writeManifest(output, projectRoot, occurrencesByFile)
    },
  }
}

export default collectI18nVuePlugin
