import type {
  ActionHint,
  LocaleKey,
  Occurrence,
  RouteHint,
  SourceLocation,
} from '@collect-i18n/core'

export interface LocaleFile {
  locale: 'zh-cn' | 'en-us'
  absolutePath: string
  localeDirectory: string
  relativeFile: string
  namespace: string
}

export interface AnalysisDiagnostic {
  code:
    | 'invalid_json'
    | 'invalid_locale_value'
    | 'duplicate_key'
    | 'missing_target_file'
    | 'source_parse_error'
    | 'dynamic_translation_key'
    | 'untranslated_ui_literal'
  severity: 'info' | 'warning' | 'error'
  message: string
  location?: SourceLocation
  details?: Record<string, unknown>
}

export interface LocaleCatalog {
  keys: LocaleKey[]
  files: LocaleFile[]
  diagnostics: AnalysisDiagnostic[]
}

export interface SourceScanResult {
  occurrences: Occurrence[]
  routeHints: RouteHint[]
  actionHints: ActionHint[]
  diagnostics: AnalysisDiagnostic[]
  scannedFiles: string[]
}

export interface ProjectAnalysis {
  catalog: LocaleCatalog
  source: SourceScanResult
  unusedKeys: LocaleKey[]
  unknownKeys: string[]
}
