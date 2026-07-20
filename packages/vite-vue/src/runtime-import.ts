import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VITE_FS_PREFIX = '/@fs/'
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/

/** Convert a CLI/runtime filesystem path into a specifier handled by Vite's fs plugin. */
export function normalizeRuntimeImport(specifier: string): string {
  if (specifier.startsWith(VITE_FS_PREFIX)) {
    return `${VITE_FS_PREFIX}${specifier.slice(VITE_FS_PREFIX.length).replaceAll('\\', '/')}`
  }
  if (specifier.startsWith('file:')) return normalizeRuntimeImport(fileURLToPath(specifier))
  if (WINDOWS_ABSOLUTE_PATH.test(specifier) || path.isAbsolute(specifier)) {
    return `${VITE_FS_PREFIX}${specifier.replaceAll('\\', '/')}`
  }
  return specifier
}

/**
 * Resolve from the plugin installation, rather than the analyzed project's node_modules.
 * The CLI can override this with a source or built runtime path.
 */
export function resolveRuntimeImport(specifier?: string): string {
  if (specifier) return normalizeRuntimeImport(specifier)
  try {
    return normalizeRuntimeImport(import.meta.resolve('@collect-i18n/runtime'))
  } catch {
    return '@collect-i18n/runtime'
  }
}

/** Return the local path represented by a normalized Vite fs specifier. */
export function runtimeImportFilePath(specifier: string): string | undefined {
  if (!specifier.startsWith(VITE_FS_PREFIX)) return undefined
  const value = decodeURIComponent(specifier.slice(VITE_FS_PREFIX.length))
  return path.normalize(value)
}
