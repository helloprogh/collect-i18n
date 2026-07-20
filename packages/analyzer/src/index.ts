import { buildLocaleCatalog, type BuildLocaleCatalogOptions } from './locale.js'
import { scanProjectSources, type ScanProjectSourcesOptions } from './source.js'
import type { ProjectAnalysis } from './types.js'

export * from './locale.js'
export * from './source.js'
export * from './types.js'

export async function analyzeProject(
  options: BuildLocaleCatalogOptions & ScanProjectSourcesOptions,
): Promise<ProjectAnalysis> {
  const [catalog, source] = await Promise.all([
    buildLocaleCatalog(options),
    scanProjectSources(options),
  ])
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
  }
}
