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
