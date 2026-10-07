import { Router } from 'express'
import { z } from 'zod'
import { all, get } from '../db/helpers.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { getAIProvider } from '../services/ai/index.js'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from '../services/notifications.js'
import { camelList } from '../utils/camel.js'
import { paramId } from '../utils/http.js'
import { paginate, paginationSchema, toPagination } from '../utils/pagination.js'

// ---------------------------------------------------------------------------
// Health (public)
// ---------------------------------------------------------------------------
export const healthRouter = Router()
healthRouter.get('/', (_req, res) => {
  let aiProvider = 'unknown'
  try {
    aiProvider = getAIProvider().name
  } catch {
    aiProvider = 'unavailable'
  }
  res.json({ status: 'ok', service: 'tksr-learning-api', aiProvider })
})

// ---------------------------------------------------------------------------
// Notifications (authenticated, own data only)
// ---------------------------------------------------------------------------
export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

notificationsRouter.get('/', (req, res, next) => {
  try {
    const query = paginationSchema
      .extend({ unread: z.literal('1').optional() })
      .parse(req.query)
    const pagination = toPagination(query)
    const result = listNotifications(req.user!.id, pagination, { unreadOnly: query.unread === '1' })
    res.json({ ...result, data: camelList(result.data), unread: unreadNotificationCount(req.user!.id) })
  } catch (error) {
    next(error)
  }
})

notificationsRouter.post('/:id/read', (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const changed = markNotificationRead(req.user!.id, id)
    if (!changed) throw new ApiError(404, 'Notification not found')
    res.json({ unread: unreadNotificationCount(req.user!.id) })
  } catch (error) {
    next(error)
  }
})

notificationsRouter.post('/read-all', (req, res) => {
  const changed = markAllNotificationsRead(req.user!.id)
  res.json({ updated: changed, unread: unreadNotificationCount(req.user!.id) })
})

// ---------------------------------------------------------------------------
// Audit log (admin)
// ---------------------------------------------------------------------------
export const auditRouter = Router()
auditRouter.use(requireAuth, requireRole('admin'))

const auditQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(60).optional(),
})

auditRouter.get('/', (req, res, next) => {
  try {
    const query = auditQuerySchema.parse(req.query)
    const pagination = toPagination(query)
    const where: string[] = []
    const params: unknown[] = []
    if (query.action) {
      where.push('a.action = ?')
      params.push(query.action)
    }
    if (query.entityType) {
      where.push('a.entity_type = ?')
      params.push(query.entityType)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total =
      get<{ total: number }>(`SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`, ...params)?.total ?? 0
    const rows = all(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.ip, a.created_at, u.name AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      ...params,
      pagination.limit,
      pagination.offset,
    )
    res.json(paginate(camelList(rows), total, pagination))
  } catch (error) {
    next(error)
  }
})

auditRouter.get('/actions', (_req, res) => {
  const rows = all<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action')
  res.json({ actions: rows.map((row) => row.action) })
})
