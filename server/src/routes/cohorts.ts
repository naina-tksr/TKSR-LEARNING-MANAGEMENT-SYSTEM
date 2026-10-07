import { Router } from 'express'
import { z } from 'zod'
import { all, get, run, tx } from '../db/helpers.js'
import type { CohortRow } from '../db/types.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import { requireProgramManager, requireProgramRow } from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import { notify } from '../services/notifications.js'
import { camelKeys, camelList } from '../utils/camel.js'
import { paramId } from '../utils/http.js'
import { paginate, paginationSchema, toPagination } from '../utils/pagination.js'

export const cohortsRouter = Router()
cohortsRouter.use(requireAuth)

const dateish = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
  .optional()

const createCohortSchema = z.object({
  programId: z.number().int().positive(),
  name: z.string().trim().min(2).max(100),
  startDate: dateish,
  endDate: dateish,
})

const updateCohortSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No changes provided' })

const enrollSchema = z.object({
  studentIds: z.array(z.number().int().positive()).min(1).max(200),
})

function cohortRow(id: number): CohortRow | undefined {
  return get<CohortRow>('SELECT * FROM cohorts WHERE id = ?', id)
}

// GET /api/cohorts?programId= — admin: all, trainer: own programs only
cohortsRouter.get('/', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const user = req.user!
    const query = paginationSchema
      .extend({ programId: z.coerce.number().int().positive().optional() })
      .parse(req.query)
    const pagination = toPagination(query)
    const where: string[] = []
    const params: unknown[] = []
    if (user.role === 'trainer') {
      where.push('p.trainer_id = ?')
      params.push(user.id)
    }
    if (query.programId) {
      where.push('c.program_id = ?')
      params.push(query.programId)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total =
      get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM cohorts c JOIN programs p ON p.id = c.program_id ${whereSql}`,
        ...params,
      )?.total ?? 0
    const rows = all(
      `SELECT c.id, c.program_id, c.name, c.start_date, c.end_date, c.created_at,
              p.title AS program_title,
              (SELECT COUNT(*) FROM enrollments e WHERE e.cohort_id = c.id AND e.status = 'active') AS student_count
       FROM cohorts c JOIN programs p ON p.id = c.program_id
       ${whereSql}
       ORDER BY c.created_at DESC, c.id DESC
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

// POST /api/cohorts (admin)
cohortsRouter.post('/', requireRole('admin'), validateBody(createCohortSchema), (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createCohortSchema>
    const program = requireProgramRow(body.programId)
    const duplicate = get<{ id: number }>(
      'SELECT id FROM cohorts WHERE program_id = ? AND name = ? COLLATE NOCASE',
      body.programId,
      body.name,
    )
    if (duplicate) throw new ApiError(409, 'A cohort with this name already exists in the program')
    const result = run(
      'INSERT INTO cohorts (program_id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
      body.programId,
      body.name,
      body.startDate ?? null,
      body.endDate ?? null,
    )
    recordAudit({
      userId: req.user!.id,
      action: 'cohort.create',
      entityType: 'cohort',
      entityId: result.lastInsertRowid,
      metadata: { name: body.name, programTitle: program.title },
      ip: req.ip,
    })
    const row = cohortRow(result.lastInsertRowid)!
    res.status(201).json({ cohort: camelKeys(row) })
  } catch (error) {
    next(error)
  }
})

// GET /api/cohorts/:id — with enrolled students (admin or assigned trainer)
cohortsRouter.get('/:id', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = cohortRow(id)
    if (!row) throw new ApiError(404, 'Cohort not found')
    requireProgramManager(req.user!, row.program_id)
    const query = paginationSchema.parse(req.query)
    const pagination = toPagination(query)
    const total =
      get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM enrollments e
         JOIN users u ON u.id = e.student_id
         WHERE e.cohort_id = ? AND e.status = 'active'`,
        id,
      )?.total ?? 0
    const students = camelList(
      all(
        `SELECT u.id, u.name, u.email, e.enrolled_at, e.id AS enrollment_id
         FROM enrollments e JOIN users u ON u.id = e.student_id
         WHERE e.cohort_id = ? AND e.status = 'active'
         ORDER BY u.name COLLATE NOCASE
         LIMIT ? OFFSET ?`,
        id,
        pagination.limit,
        pagination.offset,
      ),
    )
    const program = get<{ id: number; title: string }>(
      'SELECT id, title FROM programs WHERE id = ?',
      row.program_id,
    )
    res.json({
      cohort: camelKeys(row),
      program: program ? camelKeys(program) : null,
      students: paginate(students, total, pagination),
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/cohorts/:id (admin)
cohortsRouter.patch('/:id', requireRole('admin'), validateBody(updateCohortSchema), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = cohortRow(id)
    if (!row) throw new ApiError(404, 'Cohort not found')
    const body = req.body as z.infer<typeof updateCohortSchema>
    const updates: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) {
      updates.push('name = ?')
      params.push(body.name)
    }
    if (body.startDate !== undefined) {
      updates.push('start_date = ?')
      params.push(body.startDate)
    }
    if (body.endDate !== undefined) {
      updates.push('end_date = ?')
      params.push(body.endDate)
    }
    updates.push('updated_at = ?')
    params.push(new Date().toISOString())
    run(`UPDATE cohorts SET ${updates.join(', ')} WHERE id = ?`, ...params, id)
    recordAudit({
      userId: req.user!.id,
      action: 'cohort.update',
      entityType: 'cohort',
      entityId: id,
      metadata: { fields: Object.keys(body) },
      ip: req.ip,
    })
    res.json({ cohort: camelKeys(cohortRow(id)!) })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/cohorts/:id (admin) — blocked while students are enrolled
cohortsRouter.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = cohortRow(id)
    if (!row) throw new ApiError(404, 'Cohort not found')
    const enrolled =
      get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM enrollments WHERE cohort_id = ? AND status = 'active'`,
        id,
      )?.total ?? 0
    if (enrolled > 0) throw new ApiError(409, 'Cohort still has enrolled students')
    run('DELETE FROM cohorts WHERE id = ?', id)
    recordAudit({
      userId: req.user!.id,
      action: 'cohort.delete',
      entityType: 'cohort',
      entityId: id,
      metadata: { name: row.name },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

// POST /api/cohorts/:id/enrollments — enroll students (admin)
cohortsRouter.post('/:id/enrollments', requireRole('admin'), validateBody(enrollSchema), (req, res, next) => {
  try {
    const cohortId = paramId(req.params.id)
    const cohort = cohortRow(cohortId)
    if (!cohort) throw new ApiError(404, 'Cohort not found')
    const { studentIds } = req.body as z.infer<typeof enrollSchema>
    const program = requireProgramRow(cohort.program_id)

    const enrolled: number[] = []
    const skipped: { id: number; reason: string }[] = []

    tx(() => {
      for (const studentId of [...new Set(studentIds)]) {
        const user = get<{ id: number; role: string }>(
          `SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
          studentId,
        )
        if (!user || user.role !== 'student') {
          skipped.push({ id: studentId, reason: 'Not a student account' })
          continue
        }
        const alreadyInCohort = get<{ id: number }>(
          `SELECT id FROM enrollments WHERE cohort_id = ? AND student_id = ?`,
          cohortId,
          studentId,
        )
        if (alreadyInCohort) {
          skipped.push({ id: studentId, reason: 'Already enrolled in this cohort' })
          continue
        }
        const alreadyInProgram = get<{ id: number }>(
          `SELECT e.id FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
           WHERE c.program_id = ? AND e.student_id = ? AND e.status = 'active'`,
          cohort.program_id,
          studentId,
        )
        if (alreadyInProgram) {
          skipped.push({ id: studentId, reason: 'Already enrolled in another cohort of this program' })
          continue
        }
        run(
          'INSERT INTO enrollments (cohort_id, student_id, enrolled_by) VALUES (?, ?, ?)',
          cohortId,
          studentId,
          req.user!.id,
        )
        notify({
          userId: studentId,
          title: 'You have been enrolled',
          body: `You now have access to "${program.title}" (cohort: ${cohort.name}).`,
          type: 'enrollment',
          link: `/app/programs/${cohort.program_id}`,
        })
        enrolled.push(studentId)
      }
    })

    recordAudit({
      userId: req.user!.id,
      action: 'enrollment.create',
      entityType: 'cohort',
      entityId: cohortId,
      metadata: { enrolled, skipped },
      ip: req.ip,
    })
    res.status(201).json({ enrolled, skipped })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/enrollments/:id (admin)
export const enrollmentsRouter = Router()
enrollmentsRouter.use(requireAuth, requireRole('admin'))
enrollmentsRouter.delete('/:id', (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = get<{ id: number; student_id: number; cohort_id: number }>(
      'SELECT id, student_id, cohort_id FROM enrollments WHERE id = ?',
      id,
    )
    if (!row) throw new ApiError(404, 'Enrollment not found')
    run('DELETE FROM enrollments WHERE id = ?', id)
    recordAudit({
      userId: req.user!.id,
      action: 'enrollment.delete',
      entityType: 'enrollment',
      entityId: id,
      metadata: { studentId: row.student_id },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})
