export interface ExactTextRow { text?: string }
export function isExactTextMatch(row: ExactTextRow, needle: string): boolean {
  return typeof row.text === 'string' && row.text.trim() === needle
}
export function pickExactTextRows<T extends ExactTextRow>(rows: T[], needle: string): T[] {
  return rows.filter((row) => isExactTextMatch(row, needle))
}
