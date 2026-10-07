/** Converts snake_case object keys to camelCase (shallow). */
export function camelKeys(row: unknown): Record<string, unknown>
export function camelKeys<T>(row: unknown): T
export function camelKeys(row: unknown): unknown {
  if (row === null || typeof row !== 'object') return row
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    result[key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase())] = value
  }
  return result
}

export function camelList<T = Record<string, unknown>>(rows: unknown[]): T[] {
  return rows.map((row) => camelKeys<T>(row))
}
