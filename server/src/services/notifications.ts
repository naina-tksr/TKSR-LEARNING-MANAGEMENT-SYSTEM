import { all, get, run } from '../db/helpers.js'
import type { NotificationRow } from '../db/types.js'
import { type Paginated, paginate, type Pagination } from '../utils/pagination.js'

export type NotificationType = 'info' | 'grade' | 'assignment' | 'enrollment' | 'system'

export interface NotifyInput {
  userId: number
  title: string
  body?: string
  type?: NotificationType
  link?: string | null
}

/** Creates a notification for a user (best-effort, never throws). */
export function notify(input: NotifyInput): void {
  try {
    run(
      `INSERT INTO notifications (user_id, title, body, type, link) VALUES (?, ?, ?, ?, ?)`,
      input.userId,
      input.title,
      input.body ?? '',
      input.type ?? 'info',
      input.link ?? null,
    )
  } catch (error) {
    console.error('[notifications] Failed to create notification:', error)
  }
}

export function listNotifications(
  userId: number,
  pagination: Pagination,
  options: { unreadOnly?: boolean } = {},
): Paginated<NotificationRow> {
  const where = options.unreadOnly
    ? 'user_id = ? AND read_at IS NULL'
    : 'user_id = ?'
  const total =
    get<{ total: number }>(`SELECT COUNT(*) AS total FROM notifications WHERE ${where}`, userId)
      ?.total ?? 0
  const rows = all<NotificationRow>(
    `SELECT * FROM notifications WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    userId,
    pagination.limit,
    pagination.offset,
  )
  return paginate(rows, total, pagination)
}

export function unreadNotificationCount(userId: number): number {
  return (
    get<{ total: number }>(
      'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL',
      userId,
    )?.total ?? 0
  )
}

export function markNotificationRead(userId: number, id: number): boolean {
  const result = run(
    'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL',
    new Date().toISOString(),
    id,
    userId,
  )
  return result.changes > 0
}

export function markAllNotificationsRead(userId: number): number {
  const result = run(
    'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
    new Date().toISOString(),
    userId,
  )
  return result.changes
}
