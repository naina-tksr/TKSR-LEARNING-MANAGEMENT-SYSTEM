import type { RequestHandler } from 'express'
import bcryptjs from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config, getJwtSecret } from '../config.js'
import { get } from '../db/helpers.js'
import type { Role } from '../db/types.js'
import { ApiError } from './error.js'

export type { Role }

export interface AuthUser {
  id: number
  name: string
  email: string
  role: Role
  roleId: number
  status: 'active' | 'disabled'
}

export function hashPassword(plain: string): Promise<string> {
  return bcryptjs.hash(plain, 10)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcryptjs.compare(plain, hash)
}

interface TokenPayload extends jwt.JwtPayload {
  sub?: string
  role?: string
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, getJwtSecret(), {
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  })
}

export function findAuthUser(userId: number): AuthUser | undefined {
  return get<AuthUser>(
    `SELECT u.id, u.name, u.email, u.role_id AS roleId, u.status, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    userId,
  )
}

/** Verifies the `Authorization: Bearer <jwt>` header and loads a fresh user row. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    next(new ApiError(401, 'Authentication required'))
    return
  }
  try {
    const token = header.slice('Bearer '.length).trim()
    const payload = jwt.verify(token, getJwtSecret()) as TokenPayload
    const userId = Number(payload.sub)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid subject')
    const user = findAuthUser(userId)
    if (!user) throw new Error('user not found')
    if (user.status !== 'active') {
      next(new ApiError(403, 'This account has been disabled'))
      return
    }
    req.user = user
    next()
  } catch {
    next(new ApiError(401, 'Session expired or invalid. Please sign in again.'))
  }
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new ApiError(401, 'Authentication required'))
      return
    }
    if (!roles.includes(req.user.role)) {
      next(new ApiError(403, 'You do not have permission to perform this action'))
      return
    }
    next()
  }
}

export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw new ApiError(401, 'Authentication required')
  return req.user
}
