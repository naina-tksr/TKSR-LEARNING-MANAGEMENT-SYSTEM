import { Router } from 'express'
import { z } from 'zod'
import { all, get, run } from '../db/helpers.js'
import type { AssignmentRow, CohortRow, ProgramRow } from '../db/types.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import {
  requireProgramAccess,
  requireProgramManager,
  requireProgramRow,
} from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import { notify } from '../services/notifications.js'
import { getCompletedLessonIds, getProgramProgress, getNextLesson } from '../services/progress.js'
import { camelKeys } from '../utils/camel.js'
import { paramId } from '../utils/http.js'
import { paginate, paginationSchema, toPagination } from '../utils/pagination.js'

export const programsRouter = Router()
programsRouter.use(requireAuth)

const listQuerySchema = paginationSchema.extend({
  status: z.enum(['draft', 'published']).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  q: z.string().trim().max(120).optional(),
})

const createProgramSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(4000).default(''),
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  trainerId: z.number().int().positive().nullable().optional(),
})

const updateProgramSchema = z
  .object({
    title: z.string().trim().min(3).max(150).optional(),
    description: z.string().trim().max(4000).optional(),
    level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    status: z.enum(['draft', 'published']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No changes provided' })

function assertTrainerExists(trainerId: number): void {
  const row = get<{ id: number; role: string }>(
    `SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    trainerId,
  )
  if (!row || row.role !== 'trainer') throw new ApiError(400, 'trainerId must reference a trainer account')
}

// GET /api/programs — role-scoped list
programsRouter.get('/', (req, res, next) => {
  try {
    const user = req.user!
    const query = listQuerySchema.parse(req.query)
    const pagination = toPagination(query)
    const where: string[] = []
    const params: unknown[] = []

    if (user.role === 'trainer') {
      where.push('p.trainer_id = ?')
      params.push(user.id)
    } else if (user.role === 'student') {
      where.push(`p.status = 'published' AND EXISTS (
        SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
        WHERE c.program_id = p.id AND e.student_id = ? AND e.status = 'active')`)
      params.push(user.id)
    }
    if (query.status) {
      where.push('p.status = ?')
      params.push(query.status)
    }
    if (query.level) {
      where.push('p.level = ?')
      params.push(query.level)
    }
    if (query.q) {
      where.push('p.title LIKE ?')
      params.push(`%${query.q}%`)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const total =
      get<{ total: number }>(`SELECT COUNT(*) AS total FROM programs p ${whereSql}`, ...params)
        ?.total ?? 0
    const rows = all<Record<string, unknown>>(
      `SELECT p.id, p.title, p.description, p.level, p.status, p.trainer_id, p.created_at, p.updated_at,
              t.name AS trainer_name,
              (SELECT COUNT(*) FROM modules m WHERE m.program_id = p.id) AS module_count,
              (SELECT COUNT(*) FROM lessons l JOIN modules m2 ON m2.id = l.module_id WHERE m2.program_id = p.id) AS lesson_count,
              (SELECT COUNT(*) FROM cohorts c JOIN enrollments e ON e.cohort_id = c.id
                WHERE c.program_id = p.id AND e.status = 'active') AS student_count
       FROM programs p
       LEFT JOIN users t ON t.id = p.trainer_id
       ${whereSql}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      ...params,
      pagination.limit,
      pagination.offset,
    )
    const data = rows.map((row) => {
      const dto = camelKeys(row)
      if (user.role === 'student') {
        const progress = getProgramProgress(user.id, Number(row.id))
        return { ...dto, ...progress }
      }
      return dto
    })
    res.json(paginate(data, total, pagination))
  } catch (error) {
    next(error)
  }
})

// POST /api/programs (admin)
programsRouter.post('/', requireRole('admin'), validateBody(createProgramSchema), (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createProgramSchema>
    if (body.trainerId != null) assertTrainerExists(body.trainerId)
    const result = run(
      `INSERT INTO programs (title, description, level, status, trainer_id, created_by)
       VALUES (?, ?, ?, 'draft', ?, ?)`,
      body.title,
      body.description,
      body.level,
      body.trainerId ?? null,
      req.user!.id,
    )
    recordAudit({
      userId: req.user!.id,
      action: 'program.create',
      entityType: 'program',
      entityId: result.lastInsertRowid,
      metadata: { title: body.title, trainerId: body.trainerId ?? null },
      ip: req.ip,
    })
    const program = get<ProgramRow>('SELECT * FROM programs WHERE id = ?', result.lastInsertRowid)!
    res.status(201).json({ program: camelKeys(program) })
  } catch (error) {
    next(error)
  }
})

// GET /api/programs/:id — full detail (content, assignments, cohorts, progress)
programsRouter.get('/:id', (req, res, next) => {
  try {
    const user = req.user!
    const programId = paramId(req.params.id)
    const { program, access } = requireProgramAccess(user, programId)

    const trainer = program.trainer_id
      ? get<{ id: number; name: string; email: string }>(
          'SELECT id, name, email FROM users WHERE id = ?',
          program.trainer_id,
        )
      : undefined

    const modules = all<{ id: number; title: string; description: string; position: number }>(
      'SELECT id, title, description, position FROM modules WHERE program_id = ? ORDER BY position, id',
      programId,
    )
    const lessons = all<{
      id: number
      module_id: number
      title: string
      content: string
      position: number
      duration_minutes: number
    }>(
      `SELECT l.id, l.module_id, l.title, l.content, l.position, l.duration_minutes
       FROM lessons l JOIN modules m ON m.id = l.module_id
       WHERE m.program_id = ? ORDER BY m.position, l.position, l.id`,
      programId,
    )
    const completed = access === 'student' ? getCompletedLessonIds(user.id, programId) : new Set<number>()

    const moduleDtos = modules.map((module) => ({
      ...camelKeys(module),
      lessons: lessons
        .filter((lesson) => lesson.module_id === module.id)
        .map((lesson) => ({
          ...camelKeys(lesson),
          completed: completed.has(lesson.id),
        })),
      progress:
        access === 'student'
          ? getProgramProgressForModule(user.id, module.id)
          : undefined,
    }))

    const assignmentRows = all<AssignmentRow & { submission_count: number; graded_count: number }>(
      `SELECT a.*,
              (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count,
              (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'graded') AS graded_count
       FROM assignments a
       WHERE a.program_id = ?${access === 'student' ? " AND a.status = 'published'" : ''}
       ORDER BY a.due_at IS NULL, a.due_at, a.id`,
      programId,
    )
    const mySubmissions =
      access === 'student'
        ? all<{ id: number; assignment_id: number; status: string; score: number | null; is_late: number; submitted_at: string }>(
            'SELECT id, assignment_id, status, score, is_late, submitted_at FROM submissions WHERE student_id = ? AND assignment_id IN (SELECT id FROM assignments WHERE program_id = ?)',
            user.id,
            programId,
          )
        : []
    const submissionByAssignment = new Map(mySubmissions.map((row) => [row.assignment_id, row]))

    const assignments = assignmentRows.map((row) => {
      const base: Record<string, unknown> = {
        id: row.id,
        title: row.title,
        description: row.description,
        moduleId: row.module_id,
        maxMarks: row.max_marks,
        dueAt: row.due_at,
        status: row.status,
        createdAt: row.created_at,
      }
      if (access === 'student') {
        const mine = submissionByAssignment.get(row.id)
        base.mySubmission = mine
          ? {
              id: mine.id,
              status: mine.status,
              score: mine.score,
              isLate: Boolean(mine.is_late),
              submittedAt: mine.submitted_at,
            }
          : null
      } else {
        base.submissionCount = row.submission_count
        base.gradedCount = row.graded_count
      }
      return base
    })

    const cohortRows =
      access === 'student'
        ? all<CohortRow & { student_count: number }>(
            `SELECT c.*, 0 AS student_count
             FROM cohorts c
             JOIN enrollments e ON e.cohort_id = c.id
             WHERE c.program_id = ? AND e.student_id = ? AND e.status = 'active'
             ORDER BY c.name`,
            programId,
            user.id,
          )
        : all<CohortRow & { student_count: number }>(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM enrollments e WHERE e.cohort_id = c.id AND e.status = 'active') AS student_count
             FROM cohorts c WHERE c.program_id = ? ORDER BY c.name`,
            programId,
          )
    const cohorts = cohortRows.map((row) => ({ ...camelKeys(row), studentCount: row.student_count }))

    const response: Record<string, unknown> = {
      program: { ...camelKeys(program), trainer: trainer ?? null },
      modules: moduleDtos,
      assignments,
      cohorts,
      access,
    }
    if (access === 'student') {
      response.progress = getProgramProgress(user.id, programId)
      response.nextLesson = getNextLesson(user.id, programId)
    }
    res.json(response)
  } catch (error) {
    next(error)
  }
})

function getProgramProgressForModule(studentId: number, moduleId: number) {
  const row = get<{ total: number; completed: number }>(
    `SELECT COUNT(l.id) AS total,
            COUNT(CASE WHEN p.id IS NOT NULL THEN 1 END) AS completed
     FROM lessons l
     LEFT JOIN progress p ON p.lesson_id = l.id AND p.student_id = ?
     WHERE l.module_id = ?`,
    studentId,
    moduleId,
  )
  const total = row?.total ?? 0
  const completed = Math.min(row?.completed ?? 0, total)
  return {
    totalLessons: total,
    completedLessons: completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  }
}

// PATCH /api/programs/:id — admin or assigned trainer
programsRouter.patch('/:id', requireRole('admin', 'trainer'), validateBody(updateProgramSchema), (req, res, next) => {
  try {
    const user = req.user!
    const programId = paramId(req.params.id)
    requireProgramManager(user, programId)
    const body = req.body as z.infer<typeof updateProgramSchema>

    const updates: string[] = []
    const params: unknown[] = []
    if (body.title !== undefined) {
      updates.push('title = ?')
      params.push(body.title)
    }
    if (body.description !== undefined) {
      updates.push('description = ?')
      params.push(body.description)
    }
    if (body.level !== undefined) {
      updates.push('level = ?')
      params.push(body.level)
    }
    if (body.status !== undefined) {
      updates.push('status = ?')
      params.push(body.status)
    }
    updates.push('updated_at = ?')
    params.push(new Date().toISOString())
    run(`UPDATE programs SET ${updates.join(', ')} WHERE id = ?`, ...params, programId)

    recordAudit({
      userId: user.id,
      action: body.status === 'published' ? 'program.publish' : 'program.update',
      entityType: 'program',
      entityId: programId,
      metadata: { fields: Object.keys(body) },
      ip: req.ip,
    })
    const program = requireProgramRow(programId)
    res.json({ program: camelKeys(program) })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/programs/:id (admin)
programsRouter.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const programId = paramId(req.params.id)
    const program = requireProgramRow(programId)
    const enrolled =
      get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id WHERE c.program_id = ?`,
        programId,
      )?.total ?? 0
    if (enrolled > 0) {
      throw new ApiError(409, 'Program has enrolled students. Remove enrollments before deleting it.')
    }
    run('DELETE FROM programs WHERE id = ?', programId)
    recordAudit({
      userId: req.user!.id,
      action: 'program.delete',
      entityType: 'program',
      entityId: programId,
      metadata: { title: program.title },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

// POST /api/programs/:id/trainer — assign/reassign trainer (admin)
const assignTrainerSchema = z.object({ trainerId: z.number().int().positive().nullable() })
programsRouter.post(
  '/:id/trainer',
  requireRole('admin'),
  validateBody(assignTrainerSchema),
  (req, res, next) => {
    try {
      const programId = paramId(req.params.id)
      const program = requireProgramRow(programId)
      const { trainerId } = req.body as z.infer<typeof assignTrainerSchema>
      if (trainerId != null) assertTrainerExists(trainerId)
      run('UPDATE programs SET trainer_id = ?, updated_at = ? WHERE id = ?', trainerId, new Date().toISOString(), programId)
      if (trainerId != null) {
        notify({
          userId: trainerId,
          title: 'Program assigned to you',
          body: `You are now the trainer for "${program.title}".`,
          type: 'info',
          link: `/app/programs/${programId}`,
        })
      }
      recordAudit({
        userId: req.user!.id,
        action: 'program.assign_trainer',
        entityType: 'program',
        entityId: programId,
        metadata: { trainerId },
        ip: req.ip,
      })
      const updated = requireProgramRow(programId)
      res.json({ program: camelKeys(updated) })
    } catch (error) {
      next(error)
    }
  },
)

// GET /api/programs/:id/students — roster (admin or assigned trainer), paginated
programsRouter.get('/:id/students', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const user = req.user!
    const programId = paramId(req.params.id)
    requireProgramManager(user, programId)
    const query = paginationSchema.parse(req.query)
    const pagination = toPagination(query)
    const total =
      get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM enrollments e
         JOIN cohorts c ON c.id = e.cohort_id
         JOIN users u ON u.id = e.student_id
         WHERE c.program_id = ? AND e.status = 'active'`,
        programId,
      )?.total ?? 0
    const rows = all<{
      id: number
      name: string
      email: string
      cohort_id: number
      cohort_name: string
      enrolled_at: string
    }>(
      `SELECT u.id, u.name, u.email, c.id AS cohort_id, c.name AS cohort_name, e.enrolled_at
       FROM enrollments e
       JOIN cohorts c ON c.id = e.cohort_id
       JOIN users u ON u.id = e.student_id
       WHERE c.program_id = ? AND e.status = 'active'
       ORDER BY u.name COLLATE NOCASE
       LIMIT ? OFFSET ?`,
      programId,
      pagination.limit,
      pagination.offset,
    )
    const data = rows.map((row) => ({
      ...camelKeys(row),
      progress: getProgramProgress(row.id, programId),
    }))
    res.json(paginate(data, total, pagination))
  } catch (error) {
    next(error)
  }
})
