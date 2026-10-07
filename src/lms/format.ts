// Small display helpers shared across views.

const DAY_MS = 24 * 60 * 60 * 1000

/** "12 Mar 2026" — falls back to a dash for null/invalid dates. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "12 Mar 2026, 14:05" */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "in 3 days" / "2 hours ago" / "just now" */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '—'
  const delta = time - Date.now()
  const abs = Math.abs(delta)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 60_000) return delta >= 0 ? 'in a moment' : 'just now'
  if (abs < 60 * 60_000) return rtf.format(Math.round(delta / 60_000), 'minute')
  if (abs < DAY_MS) return rtf.format(Math.round(delta / (60 * 60_000)), 'hour')
  if (abs < 30 * DAY_MS) return rtf.format(Math.round(delta / DAY_MS), 'day')
  return formatDate(value)
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

export function isPast(dueAt: string | null | undefined): boolean {
  if (!dueAt) return false
  const time = new Date(dueAt).getTime()
  return !Number.isNaN(time) && time < Date.now()
}

/** Converts an ISO string to the value an <input type="datetime-local"> expects. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Converts an <input type="datetime-local"> value back to ISO-8601 (UTC). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}
