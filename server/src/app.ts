import fs from 'node:fs'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { requireAuth } from './middleware/auth.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'
import { aiRouter } from './routes/ai.js'
import { assignmentsRouter } from './routes/assignments.js'
import { authRouter } from './routes/auth.js'
import { cohortsRouter, enrollmentsRouter } from './routes/cohorts.js'
import { modulesRouter } from './routes/content.js'
import { dashboardRouter } from './routes/dashboard.js'
import { auditRouter, healthRouter, notificationsRouter } from './routes/misc.js'
import { myRouter } from './routes/my.js'
import { programsRouter } from './routes/programs.js'
import { submissionsRouter } from './routes/submissions.js'
import { usersRouter } from './routes/users.js'

export function createApp(): express.Express {
  const app = express()
  app.set('trust proxy', true)

  app.use(cors({ origin: config.corsOrigins }))
  app.use(express.json({ limit: '1mb' }))

  // Public routes (mounted before the auth gate)
  app.use('/api/health', healthRouter)
  app.use('/api/auth', authRouter)

  // Everything under /api requires a valid JWT from here on
  app.use('/api', requireAuth)
  app.use('/api/users', usersRouter)
  app.use('/api/programs', programsRouter)
  app.use('/api/cohorts', cohortsRouter)
  app.use('/api/enrollments', enrollmentsRouter)
  app.use('/api', modulesRouter)
  app.use('/api', assignmentsRouter)
  app.use('/api', submissionsRouter)
  app.use('/api/my', myRouter)
  app.use('/api/ai', aiRouter)
  app.use('/api/dashboard', dashboardRouter)
  app.use('/api/notifications', notificationsRouter)
  app.use('/api/audit', auditRouter)
  app.use('/api', notFoundHandler)

  // Serve the built SPA (npm run build) with a history-API fallback
  const dist = config.clientDist
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist))
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next()
        return
      }
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
