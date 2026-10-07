import { Router } from 'express'
import { z } from 'zod'
import { get } from '../db/helpers.js'
import type { UserRow } from '../db/types.js'
import { findAuthUser, requireAuth, signToken, verifyPassword } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import { recordAudit } from '../services/audit.js'
import { camelKeys } from '../utils/camel.js'

const loginSchema = z.object({
  email: z.string().trim().min(3).max(200).email(),
  password: z.string().min(1).max(200),
})

export const authRouter = Router()

authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>
    const row = get<UserRow & { role_name: string }>(
      `SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.email = ? COLLATE NOCASE`,
      email,
    )
    const invalid = new ApiError(401, 'Invalid email or password')
    if (!row) throw invalid
    const passwordOk = await verifyPassword(password, row.password_hash)
    if (!passwordOk) throw invalid
    if (row.status !== 'active') throw new ApiError(403, 'This account has been disabled')

    const user = findAuthUser(row.id)
    if (!user) throw invalid
    const token = signToken(user)
    recordAudit({ userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip: req.ip })
    res.json({ token, user: camelKeys(user) })
  } catch (error) {
    next(error)
  }
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: camelKeys(req.user) })
})
