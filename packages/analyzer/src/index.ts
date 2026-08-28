import { buildLocaleCatalog, type BuildLocaleCatalogOptions } from './locale.js'
import { scanProjectSources, type ScanProjectSourcesOptions } from './source.js'
import type { ProjectAnalysis } from './types.js'

export * from './aliases.js'
export * from './locale.js'
export * from './source.js'
export * from './types.js'

export async function analyzeProject(
  options: BuildLocaleCatalogOptions & ScanProjectSourcesOptions,
): Promise<ProjectAnalysis> {
  const catalog = await buildLocaleCatalog(options)
  const source = await scanProjectSources({
    ...options,
    catalogKeys: catalog.keys.map((key) => key.keyPath),
  })
  const occurrenceKeys = new Set(
    source.occurrences.map((occurrence) => occurrence.keyPath),
  )
  const catalogKeys = new Set(catalog.keys.map((key) => key.keyPath))

  return {
    catalog,
    source,
    unusedKeys: catalog.keys.filter((key) => !occurrenceKeys.has(key.keyPath)),
    unknownKeys: [...occurrenceKeys]
      .filter((keyPath) => !catalogKeys.has(keyPath))
      .sort(),
    routerMode: source.routerMode,
  }
}
