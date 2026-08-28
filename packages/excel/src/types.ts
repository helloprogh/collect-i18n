export const WORKSHEET_NAME = "Translations";
export const WORKBOOK_HEADERS = ["中文", "英文", "截图", "Key Path"] as const;

export interface LocaleCatalogEntry {
  keyPath: string;
  chinese: string;
  /** Absolute path to the corresponding file below the en-us locale root. */
  targetFile: string;
  /** Nested JSON property path inside targetFile. */
  jsonPath: string[];
  screenshotPath?: string;
  /** SHA-256 captured with the evidence; verified again before Excel embedding. */
  screenshotSha256?: string;
}

export interface WorkbookExportRow extends LocaleCatalogEntry {
  english?: string;
  /**
   * True when the key was classified as deprecated at finalize
   * (no source occurrence and no unresolved dynamic rendering). Deprecated
   * rows are moved to the end of the sheet and the 截图 column shows
   * 「词条废弃」 instead of an empty cell.
   */
  deprecated?: boolean;
  /**
   * True when every occurrence of the key is non-visual
   * (skip_reason non_visual_source_only: aria attributes or native title
   * properties only). Non-visual rows keep their alphabetical position and
   * the 截图 column shows 「非可视」 instead of an empty cell.
   */
  nonVisual?: boolean;
  /**
   * True when the key landed in the manual queue with zero source
   * occurrences (needs_manual + no occurrences): unreachable dead weight
   * the dynamic-reference guard kept out of the deprecated skip. Dead-key
   * rows are grouped after the normal rows and the 截图 column shows
   * 「死键」 instead of an empty cell.
   */
  deadKey?: boolean;
  /** Why the key sits in the manual queue (unresolved_dynamic_source, ...).
   * Rendered as the 截图 column annotation for manual rows that are not
   * dead keys, so batch processing can group identical causes. */
  manualReason?: string;
}

export type ImportIssueCode =
  | "invalid_workbook"
  | "invalid_headers"
  | "duplicate_key"
  | "unknown_key"
  | "missing_key"
  | "chinese_changed"
  | "invalid_key"
  | "invalid_target"
  | "write_failed";

export interface ImportIssue {
  code: ImportIssueCode;
  keyPath?: string;
  row?: number;
  message: string;
  fatal: boolean;
}

export interface TranslationChange {
  keyPath: string;
  chinese: string;
  english: string;
  targetFile: string;
  jsonPath: string[];
  row: number;
}

export interface WorkbookImportReport {
  workbookPath: string;
  totalRows: number;
  translatedRows: number;
  unchangedRows: number;
  changes: TranslationChange[];
  issues: ImportIssue[];
  canApply: boolean;
  applied: boolean;
  writtenFiles: string[];
}

export interface ImportWorkbookOptions {
  workbookPath: string;
  catalog: LocaleCatalogEntry[];
  englishRoot: string;
  apply?: boolean;
  backup?: boolean;
}
