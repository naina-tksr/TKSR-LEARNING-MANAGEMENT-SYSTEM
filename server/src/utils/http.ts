import { get } from '../db/helpers.js'
import { ApiError } from '../middleware/error.js'

/** Parses a numeric route parameter (`:id`) or throws 400. */
export function paramId(value: string | undefined): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid id parameter')
  return id
}

export function isEmailUnique(email: string, excludeUserId?: number): boolean {
  const row = excludeUserId
    ? get<{ id: number }>(
        'SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?',
        email,
        excludeUserId,
      )
    : get<{ id: number }>('SELECT id FROM users WHERE email = ? COLLATE NOCASE', email)
  return !row
}
