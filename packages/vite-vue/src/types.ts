import type { OccurrenceDescriptor } from '@collect-i18n/runtime'
import type { SourceMap } from 'magic-string'

export interface CollectI18nVuePluginOptions {
  /** Enable only the Vite development server by default; `always` explicitly instruments builds. */
  enabled?: boolean | 'serve' | 'always'
  /** Root used to create stable, portable source paths and occurrence IDs. */
  projectRoot?: string
  /** Write the collected occurrence manifest. A string is treated as its output path. */
  manifest?: boolean | string
  /** Explicit manifest output path; takes precedence over `manifest`. */
  output?: string
  /** Override the runtime package import for linked or embedded deployments. */
  runtimeImport?: string
  overlay?: boolean
  include?: RegExp | ((id: string) => boolean)
  exclude?: RegExp | ((id: string) => boolean)
}

export interface InstrumentedVueSfc {
  code: string
  map: SourceMap
  occurrences: OccurrenceDescriptor[]
}

export interface OccurrenceManifest {
  schemaVersion: 1
  generatedAt: string
  projectRoot: string
  occurrences: OccurrenceDescriptor[]
}
