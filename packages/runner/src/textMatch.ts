export interface ExactTextRow { text?: string }
export interface ExactTextHit { needle: string }
export function isExactTextMatch(row: ExactTextRow, needle: string): boolean {
  return typeof row.text === 'string' && row.text.trim() === needle
}
export function pickExactTextRows<T extends ExactTextRow>(rows: T[], needle: string): T[] {
  return rows.filter((row) => isExactTextMatch(row, needle))
}
/**
 * Production decision for the transient-toast exact-text fallback: leaf hits
 * arrive ordered by imperative-host priority, and the first hit whose needle
 * exactly matches a registered text wins.
 */
export function pickExactTextMatch<T extends ExactTextRow, H extends ExactTextHit>(
  rows: T[],
  hits: H[],
): { row: T; hit: H } | undefined {
  for (const hit of hits) {
    const row = pickExactTextRows(rows, hit.needle)[0]
    if (row) return { row, hit }
  }
  return undefined
}
