import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { message: `Not found: ${req.method} ${req.originalUrl}` } })
}

interface MulterLikeError extends Error {
  code?: string
  type?: string
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { message: error.message, details: error.details } })
    return
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        message: 'Validation failed',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    })
    return
  }
  const multerError = error as MulterLikeError
  if (multerError?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { message: 'Uploaded file is too large' } })
    return
  }
  if (multerError?.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({ error: { message: 'Unexpected file field' } })
    return
  }
  // Body parser malformed JSON
  if (multerError?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { message: 'Malformed JSON body' } })
    return
  }
  console.error('[api] Unhandled error:', error)
  res.status(500).json({ error: { message: 'Internal server error' } })
}
