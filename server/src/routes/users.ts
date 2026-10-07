import { Router } from 'express'
import { z } from 'zod'
import { all, get, run } from '../db/helpers.js'
import type { Role, UserRow } from '../db/types.js'
import { hashPassword, requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import { recordAudit } from '../services/audit.js'
import { camelList, camelKeys } from '../utils/camel.js'
import { isEmailUnique, paramId } from '../utils/http.js'
import { paginate, paginationSchema, toPagination } from '../utils/pagination.js'

export const usersRouter = Router()
usersRouter.use(requireAuth, requireRole('admin'))

const listQuerySchema = paginationSchema.extend({
  role: z.enum(['admin', 'trainer', 'student']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  q: z.string().trim().max(100).optional(),
})

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'trainer', 'student']),
})

const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().toLowerCase().email().max(200).optional(),
    password: z.string().min(8).max(200).optional(),
    role: z.enum(['admin', 'trainer', 'student']).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No changes provided' })

function roleExists(role: Role): boolean {
  return Boolean(get<{ id: number }>('SELECT id FROM roles WHERE name = ?', role))
}

// GET /api/users?page&limit&role&status&q
usersRouter.get('/', (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query)
    const pagination = toPagination(query)
    const where: string[] = []
    const params: unknown[] = []
    if (query.role) {
      where.push('r.name = ?')
      params.push(query.role)
    }
    if (query.status) {
      where.push('u.status = ?')
      params.push(query.status)
    }
    if (query.q) {
      where.push('(u.name LIKE ? OR u.email LIKE ?)')
      params.push(`%${query.q}%`, `%${query.q}%`)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total =
      get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id ${whereSql}`,
        ...params,
      )?.total ?? 0
    const rows = all(
      `SELECT u.id, u.name, u.email, u.status, u.created_at, u.updated_at, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       ${whereSql}
       ORDER BY u.created_at DESC, u.id DESC
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

// POST /api/users
usersRouter.post('/', validateBody(createUserSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createUserSchema>
    if (!roleExists(body.role)) throw new ApiError(400, `Unknown role: ${body.role}`)
    if (!isEmailUnique(body.email)) throw new ApiError(409, 'An account with this email already exists')

    const passwordHash = await hashPassword(body.password)
    const roleId = get<{ id: number }>('SELECT id FROM roles WHERE name = ?', body.role)!.id
    const result = run(
      'INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)',
      body.name,
      body.email,
      passwordHash,
      roleId,
    )
    const row = get<UserRow & { role: string }>(
      `SELECT u.id, u.name, u.email, u.status, u.created_at, u.updated_at, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      result.lastInsertRowid,
    )!
    recordAudit({
      userId: req.user!.id,
      action: 'user.create',
      entityType: 'user',
      entityId: result.lastInsertRowid,
      metadata: { name: body.name, email: body.email, role: body.role },
      ip: req.ip,
    })
    res.status(201).json({ user: camelKeys(row) })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/users/:id
usersRouter.patch('/:id', validateBody(updateUserSchema), async (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const body = req.body as z.infer<typeof updateUserSchema>
    const target = get<UserRow & { role: string }>(
      `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      id,
    )
    if (!target) throw new ApiError(404, 'User not found')

    const actor = req.user!
    if ((body.role !== undefined && body.role !== target.role) || (body.status && body.status !== target.status)) {
      if (actor.id === id) throw new ApiError(400, 'You cannot change your own role or status')
    }
    if (body.email && !isEmailUnique(body.email, id)) {
      throw new ApiError(409, 'An account with this email already exists')
    }
    if (body.role && !roleExists(body.role)) throw new ApiError(400, `Unknown role: ${body.role}`)

    const updates: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) {
      updates.push('name = ?')
      params.push(body.name)
    }
    if (body.email !== undefined) {
      updates.push('email = ?')
      params.push(body.email)
    }
    if (body.role !== undefined) {
      updates.push('role_id = (SELECT id FROM roles WHERE name = ?)')
      params.push(body.role)
    }
    if (body.status !== undefined) {
      updates.push('status = ?')
      params.push(body.status)
    }
    if (body.password !== undefined) {
      updates.push('password_hash = ?')
      params.push(await hashPassword(body.password))
    }
    updates.push('updated_at = ?')
    params.push(new Date().toISOString())

    run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params, id)
    const row = get<UserRow & { role: string }>(
      `SELECT u.id, u.name, u.email, u.status, u.created_at, u.updated_at, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      id,
    )!
    recordAudit({
      userId: actor.id,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      metadata: { fields: Object.keys(body) },
      ip: req.ip,
    })
    res.json({ user: camelKeys(row) })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/users/:id
usersRouter.delete('/:id', (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const target = get<UserRow & { role: string }>(
      `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      id,
    )
    if (!target) throw new ApiError(404, 'User not found')
    if (req.user!.id === id) throw new ApiError(400, 'You cannot delete your own account')
    if (target.role === 'admin') {
      const adminCount =
        get<{ total: number }>(
          `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.status = 'active'`,
        )?.total ?? 0
      if (adminCount <= 1) throw new ApiError(409, 'Cannot delete the last admin account')
    }
    run('DELETE FROM users WHERE id = ?', id)
    recordAudit({
      userId: req.user!.id,
      action: 'user.delete',
      entityType: 'user',
      entityId: id,
      metadata: { name: target.name, email: target.email, role: target.role },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})
