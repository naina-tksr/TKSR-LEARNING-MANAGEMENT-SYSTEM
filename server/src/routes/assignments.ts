import { Router, type Request } from 'express'
import { z } from 'zod'
import { all, get, run, tx } from '../db/helpers.js'
import type { RubricItemRow } from '../db/types.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import { requireAssignmentManager, requireProgramAccess, requireProgramManager } from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import { notify } from '../services/notifications.js'
import { listTaskResponses, listTasks, replaceTasks, taskView } from '../services/tasks.js'
import { camelKeys, camelList } from '../utils/camel.js'
import { paramId } from '../utils/http.js'
import { paginate, paginationSchema, toPagination } from '../utils/pagination.js'

export const assignmentsRouter = Router()
assignmentsRouter.use(requireAuth)

const assignmentListQuerySchema = paginationSchema.extend({
  status: z.enum(['draft', 'published']).optional(),
  programId: z.coerce.number().int().positive().optional(),
})

// GET /api/assignments — cross-program list (admin: all, trainer: assigned programs)
assignmentsRouter.get('/assignments', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const user = req.user!
    const query = assignmentListQuerySchema.parse(req.query)
    const pagination = toPagination(query)
    const where: string[] = []
    const params: unknown[] = []
    if (user.role === 'trainer') {
      where.push('a.program_id IN (SELECT id FROM programs WHERE trainer_id = ?)')
      params.push(user.id)
    }
    if (query.status) {
      where.push('a.status = ?')
      params.push(query.status)
    }
    if (query.programId) {
      where.push('a.program_id = ?')
      params.push(query.programId)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const base = `FROM assignments a
       JOIN programs p ON p.id = a.program_id
       LEFT JOIN (SELECT assignment_id, COUNT(*) AS c FROM submissions GROUP BY assignment_id) s ON s.assignment_id = a.id`
    const total = get<{ total: number }>(`SELECT COUNT(*) AS total ${base} ${whereSql}`, ...params)?.total ?? 0
    const rows = all(
      `SELECT a.id, a.program_id, a.module_id, a.title, a.description, a.max_marks,
              a.due_at, a.status, a.created_at,
              p.title AS program_title, p.trainer_id AS program_trainer_id,
              COALESCE(s.c, 0) AS submission_count
       ${base}
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      ...params,
      pagination.limit,
      pagination.offset,
    )
    const assignmentDtos = rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      programId: row.program_id,
      moduleId: row.module_id,
      title: row.title,
      description: row.description,
      maxMarks: row.max_marks,
      dueAt: row.due_at,
      status: row.status,
      programTitle: row.program_title,
      submissionCount: (row.submission_count as number) ?? 0,
      rubricItems: [],
    }))
    res.json(paginate(assignmentDtos, total, pagination))
  } catch (error) {
    next(error)
  }
})
const rubricItemSchema = z.object({
  criteria: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).default(''),
  maxMarks: z.number().int().min(1).max(1000),
})

const createAssignmentSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(20_000).default(''),
  maxMarks: z.number().int().min(1).max(1000),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  moduleId: z.number().int().positive().nullable().optional(),
  rubricItems: z.array(rubricItemSchema).max(20).default([]),
})

const updateAssignmentSchema = createAssignmentSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'No changes provided' })

function assertRubricFits(maxMarks: number, items: { maxMarks: number }[]): void {
  const sum = items.reduce((total, item) => total + item.maxMarks, 0)
  if (sum > maxMarks) {
    throw new ApiError(400, `Rubric total (${sum}) exceeds the assignment maximum marks (${maxMarks})`)
  }
}

function replaceRubric(assignmentId: number, items: { criteria: string; description: string; maxMarks: number }[]): void {
  run('DELETE FROM rubric_items WHERE assignment_id = ?', assignmentId)
  items.forEach((item, index) => {
    run(
      'INSERT INTO rubric_items (assignment_id, criteria, description, max_marks, position) VALUES (?, ?, ?, ?, ?)',
      assignmentId,
      item.criteria,
      item.description,
      item.maxMarks,
      index,
    )
  })
}

export function rubricFor(assignmentId: number): RubricItemRow[] {
  return all<RubricItemRow>(
    'SELECT * FROM rubric_items WHERE assignment_id = ? ORDER BY position, id',
    assignmentId,
  )
}

// POST /api/programs/:id/assignments — admin or assigned trainer
assignmentsRouter.post(
  '/programs/:id/assignments',
  requireRole('admin', 'trainer'),
  validateBody(createAssignmentSchema),
  (req, res, next) => {
    try {
      const programId = paramId(req.params.id)
      requireProgramManager(req.user!, programId)
      const body = req.body as z.infer<typeof createAssignmentSchema>
      assertRubricFits(body.maxMarks, body.rubricItems)
      if (body.moduleId != null) {
        const belongs = get<{ id: number }>('SELECT id FROM modules WHERE id = ? AND program_id = ?', body.moduleId, programId)
        if (!belongs) throw new ApiError(400, 'moduleId does not belong to this program')
      }
      const id = tx(() => {
        const result = run(
          `INSERT INTO assignments (program_id, module_id, title, description, max_marks, due_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          programId,
          body.moduleId ?? null,
          body.title,
          body.description,
          body.maxMarks,
          body.dueAt ?? null,
          req.user!.id,
        )
        replaceRubric(result.lastInsertRowid, body.rubricItems)
        return result.lastInsertRowid
      })
      recordAudit({
        userId: req.user!.id,
        action: 'assignment.create',
        entityType: 'assignment',
        entityId: id,
        metadata: { title: body.title, programId },
        ip: req.ip,
      })
      res.status(201).json({ assignment: loadAssignmentDto(id) })
    } catch (error) {
      next(error)
    }
  },
)

function loadAssignmentDto(id: number): Record<string, unknown> {
  const row = get<Record<string, unknown>>('SELECT * FROM assignments WHERE id = ?', id)!
  return {
    ...camelKeys(row),
    rubricItems: camelList(rubricFor(id)),
    tasks: listTasks(id).map(taskView),
  }
}

// GET /api/assignments/:id — role-aware detail
assignmentsRouter.get('/assignments/:id', (req, res, next) => {
  try {
    const user = req.user!
    const id = paramId(req.params.id)
    const row = get<Record<string, unknown> & { program_id: number; status: string }>(
      'SELECT * FROM assignments WHERE id = ?',
      id,
    )
    if (!row) throw new ApiError(404, 'Assignment not found')
    const { program, access } = requireProgramAccess(user, row.program_id)
    if (access === 'student' && row.status !== 'published') throw new ApiError(404, 'Assignment not found')

    const response: Record<string, unknown> = {
      assignment: {
        ...camelKeys(row),
        rubricItems: camelList(rubricFor(id)),
        tasks: listTasks(id).map(taskView),
      },
      program: { id: program.id, title: program.title, status: program.status },
      access,
    }

    if (access === 'student') {
      const mine = get<Record<string, unknown>>(
        'SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?',
        id,
        user.id,
      )
      response.mySubmission = mine ? camelKeys(mine) : null
      response.myTaskResponses = mine ? camelList(listTaskResponses(Number(mine.id))) : []
    } else {
      const stats = get<{ total: number; graded: number; late: number }>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'graded' THEN 1 ELSE 0 END) AS graded,
                SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) AS late
         FROM submissions WHERE assignment_id = ?`,
        id,
      )
      response.stats = {
        submissionCount: stats?.total ?? 0,
        gradedCount: stats?.graded ?? 0,
        lateCount: stats?.late ?? 0,
      }
    }
    res.json(response)
  } catch (error) {
    next(error)
  }
})

// PATCH /api/assignments/:id — replace rubric by sending `rubricItems`
assignmentsRouter.patch('/assignments/:id', requireRole('admin', 'trainer'), validateBody(updateAssignmentSchema), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const { assignment } = requireAssignmentManager(req.user!, id)
    const body = req.body as z.infer<typeof updateAssignmentSchema>

    const maxMarks = body.maxMarks ?? assignment.max_marks
    if (body.rubricItems) assertRubricFits(maxMarks, body.rubricItems)
    if (body.moduleId != null) {
      const belongs = get<{ id: number }>('SELECT id FROM modules WHERE id = ? AND program_id = ?', body.moduleId, assignment.program_id)
      if (!belongs) throw new ApiError(400, 'moduleId does not belong to this assignment program')
    }

    tx(() => {
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
      if (body.maxMarks !== undefined) {
        updates.push('max_marks = ?')
        params.push(body.maxMarks)
      }
      if (body.dueAt !== undefined) {
        updates.push('due_at = ?')
        params.push(body.dueAt)
      }
      if (body.moduleId !== undefined) {
        updates.push('module_id = ?')
        params.push(body.moduleId)
      }
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      run(`UPDATE assignments SET ${updates.join(', ')} WHERE id = ?`, ...params, id)
      if (body.rubricItems) replaceRubric(id, body.rubricItems)
    })

    recordAudit({
      userId: req.user!.id,
      action: 'assignment.update',
      entityType: 'assignment',
      entityId: id,
      metadata: { fields: Object.keys(body) },
      ip: req.ip,
    })
    res.json({ assignment: loadAssignmentDto(id) })
  } catch (error) {
    next(error)
  }
})

const taskSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  format: z.enum(['text', 'mixed', 'url', 'file']).default('text'),
  required: z.boolean().default(true),
  maxMarks: z.number().int().positive().max(1000),
})

const tasksSchema = z.object({ tasks: z.array(taskSchema).max(50) })

// GET /api/assignments/:id/tasks — task definitions (+ the student's own answers)
assignmentsRouter.get('/assignments/:id/tasks', (req, res, next) => {
  try {
    const user = req.user!
    const id = paramId(req.params.id)
    const row = get<Record<string, unknown> & { program_id: number; status: string }>(
      'SELECT * FROM assignments WHERE id = ?',
      id,
    )
    if (!row) throw new ApiError(404, 'Assignment not found')
    const { access } = requireProgramAccess(user, row.program_id)
    if (access === 'student' && row.status !== 'published') throw new ApiError(404, 'Assignment not found')

    if (access === 'student') {
      const mine = get<{ id: number }>(
        'SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?',
        id,
        user.id,
      )
      res.json({ tasks: listTasks(id).map(taskView), taskResponses: mine ? camelList(listTaskResponses(mine.id)) : [] })
      return
    }
    res.json({ tasks: listTasks(id).map(taskView) })
  } catch (error) {
    next(error)
  }
})

// PUT /api/assignments/:id/tasks — replace the task list (admin/assigned trainer)
assignmentsRouter.put(
  '/assignments/:id/tasks',
  requireRole('admin', 'trainer'),
  validateBody(tasksSchema),
  (req, res, next) => {
    try {
      const id = paramId(req.params.id)
      const { assignment } = requireAssignmentManager(req.user!, id)
      const body = req.body as z.infer<typeof tasksSchema>
      const graded =
        get<{ total: number }>(
          "SELECT COUNT(*) AS total FROM submissions WHERE assignment_id = ? AND status = 'graded'",
          id,
        )?.total ?? 0
      if (graded > 0) {
        throw new ApiError(409, 'Cannot change the task list after a submission has been graded')
      }
      const total = body.tasks.reduce((sum, task) => sum + task.maxMarks, 0)
      if (total > assignment.max_marks) {
        throw new ApiError(400, `Task marks total (${total}) exceeds the assignment maximum marks (${assignment.max_marks})`)
      }
      tx(() => replaceTasks(id, body.tasks))
      recordAudit({
        userId: req.user!.id,
        action: 'assignment.tasks_set',
        entityType: 'assignment',
        entityId: id,
        metadata: { taskCount: body.tasks.length },
        ip: req.ip,
      })
      res.json({ assignment: loadAssignmentDto(id) })
    } catch (error) {
      next(error)
    }
  },
)

function setAssignmentStatus(id: number, status: 'draft' | 'published', req: Request) {
  const { assignment } = requireAssignmentManager(req.user!, id)
  run('UPDATE assignments SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), id)

  if (status === 'published') {
    // Notify every active student enrolled in the program.
    const students = all<{ student_id: number }>(
      `SELECT DISTINCT e.student_id FROM enrollments e
       JOIN cohorts c ON c.id = e.cohort_id
       WHERE c.program_id = ? AND e.status = 'active'
         AND EXISTS (SELECT 1 FROM programs p WHERE p.id = c.program_id AND p.status = 'published')`,
      assignment.program_id,
    )
    for (const student of students) {
      notify({
        userId: student.student_id,
        title: 'New assignment published',
        body: `${assignment.title} is now available (${assignment.max_marks} marks).`,
        type: 'assignment',
        link: `/app/assignments/${id}`,
      })
    }
  }
  recordAudit({
    userId: req.user!.id,
    action: status === 'published' ? 'assignment.publish' : 'assignment.unpublish',
    entityType: 'assignment',
    entityId: id,
    metadata: { title: assignment.title },
    ip: req.ip,
  })
  return loadAssignmentDto(id)
}

assignmentsRouter.post('/assignments/:id/publish', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    res.json({ assignment: setAssignmentStatus(id, 'published', req) })
  } catch (error) {
    next(error)
  }
})

assignmentsRouter.post('/assignments/:id/unpublish', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    res.json({ assignment: setAssignmentStatus(id, 'draft', req) })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/assignments/:id — blocked once submissions exist
assignmentsRouter.delete('/assignments/:id', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const { assignment } = requireAssignmentManager(req.user!, id)
    const submissions =
      get<{ total: number }>('SELECT COUNT(*) AS total FROM submissions WHERE assignment_id = ?', id)?.total ?? 0
    if (submissions > 0) {
      throw new ApiError(409, 'Assignment already has submissions and cannot be deleted')
    }
    run('DELETE FROM assignments WHERE id = ?', id)
    recordAudit({
      userId: req.user!.id,
      action: 'assignment.delete',
      entityType: 'assignment',
      entityId: id,
      metadata: { title: assignment.title },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})
