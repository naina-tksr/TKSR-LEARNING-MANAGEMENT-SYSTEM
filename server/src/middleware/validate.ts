import type { RequestHandler } from 'express'
import { z, type ZodError, type ZodTypeAny } from 'zod'
import { ApiError } from './error.js'

export function validationError(error: ZodError): ApiError {
  return new ApiError(
    400,
    'Validation failed',
    error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  )
}

/** Validates (and replaces) `req.body` with the parsed, coerced value. */
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      next(validationError(result.error))
      return
    }
    req.body = result.data
    next()
  }
}

/** Parses arbitrary data (e.g. `req.query`) or throws a 400 ApiError. */
export function parseWith<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw validationError(result.error)
  return result.data
}
