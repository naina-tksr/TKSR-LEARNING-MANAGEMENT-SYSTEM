import type { AuthUser } from '../middleware/auth.js'

declare global {
  namespace Express {
    interface Request {
      /** Set by the `requireAuth` middleware after a valid JWT is verified. */
      user?: AuthUser
    }
  }
}

export {}
