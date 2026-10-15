import { Router } from 'express'
import { z } from 'zod'
import { all, get, run } from '../db/helpers.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import { requireProgramAccess, requireProgramManager } from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import {
  listProgramClasses,
  normaliseMeetUrl,
  requireLiveClassRow,
  toLiveClassView,
} from '../services/liveClasses.js'
import { notify } from '../services/notifications.js'
import { paramId } from '../utils/http.js'

export const liveClassesRouter = Router()
liveClassesRouter.use(requireAuth)

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const createSchema = z.object({
  moduleId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(2).max(200),
  classDate: z.string().regex(DATE, 'classDate must be YYYY-MM-DD'),
  startTime: z.string().regex(TIME, 'startTime must be HH:MM (24h)'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  durationMinutes: z.number().int().min(5).max(600).default(60),
  meetUrl: z.string().trim().max(500).nullable().optional(),
  trainerId: z.number().int().positive().nullable().optional(),
  instructions: z.string().trim().max(5000).default(''),
  status: z.enum(['draft', 'scheduled']).default('draft'),
})

const updateSchema = z.object({
  moduleId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(2).max(200).optional(),
  classDate: z.string().regex(DATE, 'classDate must be YYYY-MM-DD').optional(),
  startTime: z.string().regex(TIME, 'startTime must be HH:MM (24h)').optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  durationMinutes: z.number().int().min(5).max(600).optional(),
  meetUrl: z.string().trim().max(500).nullable().optional(),
  trainerId: z.number().int().positive().nullable().optional(),
  instructions: z.string().trim().max(5000).optional(),
  status: z.enum(['draft', 'scheduled', 'cancelled']).optional(),
})

function assertTrainer(trainerId: number | null | undefined): void {
  if (trainerId == null) return
  const user = get<{ role: string }>(
    'SELECT r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.status = \'active\'',
    trainerId,
  )
  if (!user || user.role === 'student') {
    throw new ApiError(400, 'trainerId must reference an active trainer or admin')
  }
}

// GET /api/programs/:id/classes — schedule for a program (admin/trainer/student)
liveClassesRouter.get('/programs/:id/classes', (req, res, next) => {
  try {
    const programId = paramId(req.params.id)
    const { access } = requireProgramAccess(req.user!, programId)
    const classes = listProgramClasses(programId)
    res.json({ data: access === 'student' ? classes.filter((item) => item.status === 'scheduled') : classes })
  } catch (error) {
    next(error)
  }
})

// POST /api/programs/:id/classes — schedule a class (admin or assigned trainer)
liveClassesRouter.post(
  '/programs/:id/classes',
  requireRole('admin', 'trainer'),
  validateBody(createSchema),
  (req, res, next) => {
    try {
      const programId = paramId(req.params.id)
      const program = requireProgramManager(req.user!, programId)
      const body = req.body as z.infer<typeof createSchema>
      if (body.moduleId != null) {
        const belongs = get<{ id: number }>(
          'SELECT id FROM modules WHERE id = ? AND program_id = ?',
          body.moduleId,
          programId,
        )
        if (!belongs) throw new ApiError(400, 'moduleId does not belong to this program')
      }
      assertTrainer(body.trainerId)
      const meetUrl = normaliseMeetUrl(body.meetUrl)
      if (body.status === 'scheduled' && !meetUrl) {
        throw new ApiError(400, 'A Google Meet link is required to publish a class')
      }
      const trainerId = body.trainerId ?? program.trainer_id ?? null
      const id = run(
        `INSERT INTO live_classes
           (program_id, module_id, title, class_date, start_time, timezone, duration_minutes,
            meet_url, trainer_id, instructions, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        programId,
        body.moduleId ?? null,
        body.title,
        body.classDate,
        body.startTime,
        body.timezone,
        body.durationMinutes,
        meetUrl,
        trainerId,
        body.instructions,
        body.status,
        req.user!.id,
      ).lastInsertRowid
      recordAudit({
        userId: req.user!.id,
        action: 'live_class.create',
        entityType: 'live_class',
        entityId: id,
        metadata: { programId, title: body.title, status: body.status },
        ip: req.ip,
      })
      if (body.status === 'scheduled') notifyClassStudents(programId, body.title, id)
      res.status(201).json({ liveClass: toLiveClassView(requireLiveClassRow(id)) })
    } catch (error) {
      next(error)
    }
  },
)

// GET /api/live-classes/:id — class detail
liveClassesRouter.get('/live-classes/:id', (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = requireLiveClassRow(id)
    requireProgramAccess(req.user!, row.program_id)
    res.json({ liveClass: toLiveClassView(row) })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/live-classes/:id — edit a class
liveClassesRouter.patch(
  '/live-classes/:id',
  requireRole('admin', 'trainer'),
  validateBody(updateSchema),
  (req, res, next) => {
    try {
      const id = paramId(req.params.id)
      const row = requireLiveClassRow(id)
      requireProgramManager(req.user!, row.program_id)
      const body = req.body as z.infer<typeof updateSchema>
      if (body.moduleId != null) {
        const belongs = get<{ id: number }>(
          'SELECT id FROM modules WHERE id = ? AND program_id = ?',
          body.moduleId,
          row.program_id,
        )
        if (!belongs) throw new ApiError(400, 'moduleId does not belong to this program')
      }
      assertTrainer(body.trainerId)

      const meetUrl = body.meetUrl === undefined ? row.meet_url : normaliseMeetUrl(body.meetUrl)
      const nextStatus = body.status ?? row.status
      if (nextStatus === 'scheduled' && !meetUrl) {
        throw new ApiError(400, 'A Google Meet link is required to publish a class')
      }

      const updates: string[] = []
      const params: unknown[] = []
      const assign = (column: string, value: unknown) => {
        updates.push(`${column} = ?`)
        params.push(value)
      }
      if (body.moduleId !== undefined) assign('module_id', body.moduleId)
      if (body.title !== undefined) assign('title', body.title)
      if (body.classDate !== undefined) assign('class_date', body.classDate)
      if (body.startTime !== undefined) assign('start_time', body.startTime)
      if (body.timezone !== undefined) assign('timezone', body.timezone)
      if (body.durationMinutes !== undefined) assign('duration_minutes', body.durationMinutes)
      if (body.meetUrl !== undefined) assign('meet_url', meetUrl)
      if (body.trainerId !== undefined) assign('trainer_id', body.trainerId)
      if (body.instructions !== undefined) assign('instructions', body.instructions)
      if (body.status !== undefined) assign('status', body.status)
      assign('updated_at', new Date().toISOString())
      params.push(id)
      run(`UPDATE live_classes SET ${updates.join(', ')} WHERE id = ?`, ...params)

      recordAudit({
        userId: req.user!.id,
        action: 'live_class.update',
        entityType: 'live_class',
        entityId: id,
        metadata: { fields: Object.keys(body) },
        ip: req.ip,
      })
      res.json({ liveClass: toLiveClassView(requireLiveClassRow(id)) })
    } catch (error) {
      next(error)
    }
  },
)

// POST /api/live-classes/:id/publish — publish/schedule a class (optionally set its Meet link)
liveClassesRouter.post(
  '/live-classes/:id/publish',
  requireRole('admin', 'trainer'),
  validateBody(z.object({ meetUrl: z.string().trim().max(500).nullable().optional() }).default({})),
  (req, res, next) => {
    try {
      const id = paramId(req.params.id)
      const row = requireLiveClassRow(id)
      requireProgramManager(req.user!, row.program_id)
      const body = req.body as { meetUrl?: string | null }
      const meetUrl = body.meetUrl === undefined ? row.meet_url : normaliseMeetUrl(body.meetUrl)
      if (!meetUrl) throw new ApiError(400, 'A Google Meet link is required to publish a class')
      run(
        "UPDATE live_classes SET status = 'scheduled', meet_url = ?, updated_at = ? WHERE id = ?",
        meetUrl,
        new Date().toISOString(),
        id,
      )
      recordAudit({
        userId: req.user!.id,
        action: 'live_class.publish',
        entityType: 'live_class',
        entityId: id,
        metadata: { title: row.title },
        ip: req.ip,
      })
      notifyClassStudents(row.program_id, row.title, id)
      res.json({ liveClass: toLiveClassView(requireLiveClassRow(id)) })
    } catch (error) {
      next(error)
    }
  },
)

// POST /api/live-classes/:id/cancel — cancel a class
liveClassesRouter.post('/live-classes/:id/cancel', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = requireLiveClassRow(id)
    requireProgramManager(req.user!, row.program_id)
    run("UPDATE live_classes SET status = 'cancelled', updated_at = ? WHERE id = ?", new Date().toISOString(), id)
    recordAudit({
      userId: req.user!.id,
      action: 'live_class.cancel',
      entityType: 'live_class',
      entityId: id,
      metadata: { title: row.title },
      ip: req.ip,
    })
    res.json({ liveClass: toLiveClassView(requireLiveClassRow(id)) })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/live-classes/:id
liveClassesRouter.delete('/live-classes/:id', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = requireLiveClassRow(id)
    requireProgramManager(req.user!, row.program_id)
    run('DELETE FROM live_classes WHERE id = ?', id)
    recordAudit({
      userId: req.user!.id,
      action: 'live_class.delete',
      entityType: 'live_class',
      entityId: id,
      metadata: { title: row.title },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

function notifyClassStudents(programId: number, title: string, classId: number): void {
  const rows = all<{ student_id: number }>(
    `SELECT DISTINCT e.student_id FROM enrollments e
     JOIN cohorts c ON c.id = e.cohort_id
     WHERE c.program_id = ? AND e.status = 'active'`,
    programId,
  )
  for (const student of rows) {
    notify({
      userId: student.student_id,
      title: 'New live class scheduled',
      body: `${title} has been scheduled.`,
      type: 'info',
      link: `/app/classes/${classId}`,
    })
  }
}
