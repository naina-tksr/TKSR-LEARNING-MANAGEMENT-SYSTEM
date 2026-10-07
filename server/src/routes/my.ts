import { Router } from 'express'
import { z } from 'zod'
import { all, get, run } from '../db/helpers.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { requireProgramAccess } from '../services/access.js'
import { getNextLesson, getProgramProgress, getStudentOverallProgress } from '../services/progress.js'
import { camelKeys, camelList } from '../utils/camel.js'
import { paramId } from '../utils/http.js'
import { paginate, paginationSchema, toPagination } from '../utils/pagination.js'

export const myRouter = Router()
myRouter.use(requireAuth, requireRole('student'))

// GET /api/my/programs — enrolled programs with progress + continue-lesson
myRouter.get('/programs', (req, res, next) => {
  try {
    const user = req.user!
    const query = paginationSchema.parse(req.query)
    const pagination = toPagination(query)
    const total =
      get<{ total: number }>(
        `SELECT COUNT(DISTINCT c.program_id) AS total
         FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
         JOIN programs p ON p.id = c.program_id AND p.status = 'published'
         WHERE e.student_id = ? AND e.status = 'active'`,
        user.id,
      )?.total ?? 0
    const rows = all<{
      id: number
      title: string
      description: string
      level: string
      status: string
      trainer_name: string | null
      cohort_names: string
      updated_at: string
    }>(
      `SELECT p.id, p.title, p.description, p.level, p.status, p.updated_at,
              t.name AS trainer_name,
              GROUP_CONCAT(DISTINCT c.name) AS cohort_names
       FROM enrollments e
       JOIN cohorts c ON c.id = e.cohort_id AND e.student_id = ? AND e.status = 'active'
       JOIN programs p ON p.id = c.program_id AND p.status = 'published'
       LEFT JOIN users t ON t.id = p.trainer_id
       GROUP BY p.id
       ORDER BY p.title COLLATE NOCASE
       LIMIT ? OFFSET ?`,
      user.id,
      pagination.limit,
      pagination.offset,
    )
    const data = rows.map((row) => ({
      ...camelKeys(row),
      cohortNames: (row.cohort_names ?? '').split(',').filter(Boolean),
      progress: getProgramProgress(user.id, row.id),
      nextLesson: getNextLesson(user.id, row.id),
    }))
    res.json(paginate(data, total, pagination))
  } catch (error) {
    next(error)
  }
})

// GET /api/my/assignments — assignments across enrolled programs
myRouter.get('/assignments', (req, res, next) => {
  try {
    const user = req.user!
    const query = paginationSchema
      .extend({ status: z.enum(['all', 'pending', 'submitted', 'graded']).default('all') })
      .parse(req.query)
    const pagination = toPagination(query)

    const statusFilterSql =
      query.status === 'pending'
        ? 'AND s.id IS NULL'
        : query.status === 'submitted'
          ? "AND s.status = 'submitted'"
          : query.status === 'graded'
            ? "AND s.status = 'graded'"
            : ''

    const whereEnrolled = `a.status = 'published'
      AND EXISTS (SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
                  WHERE c.program_id = a.program_id AND e.student_id = ? AND e.status = 'active')
      AND EXISTS (SELECT 1 FROM programs p WHERE p.id = a.program_id AND p.status = 'published')`

    const total =
      get<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM assignments a
         LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
         WHERE ${whereEnrolled} ${statusFilterSql}`,
        user.id,
        user.id,
      )?.total ?? 0

    const rows = all<{
      id: number
      title: string
      description: string
      max_marks: number
      due_at: string | null
      program_id: number
      program_title: string
      submission_id: number | null
      submission_status: string | null
      score: number | null
      is_late: number | null
      submitted_at: string | null
      graded_at: string | null
      feedback: string | null
    }>(
      `SELECT a.id, a.title, a.description, a.max_marks, a.due_at, a.program_id, p.title AS program_title,
              s.id AS submission_id, s.status AS submission_status, s.score, s.is_late,
              s.submitted_at, s.graded_at, s.feedback
       FROM assignments a
       JOIN programs p ON p.id = a.program_id
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
       WHERE ${whereEnrolled} ${statusFilterSql}
       ORDER BY a.due_at IS NULL, a.due_at, a.id DESC
       LIMIT ? OFFSET ?`,
      user.id,
      user.id,
      pagination.limit,
      pagination.offset,
    )

    const data = rows.map((row) => {
      const now = Date.now()
      const isSubmitted = Boolean(row.submission_id)
      return {
        ...camelKeys(row),
        isSubmitted,
        isOverdue: Boolean(row.due_at && !isSubmitted && now > new Date(row.due_at).getTime()),
        isLate: Boolean(row.is_late),
      }
    })

    res.json(paginate(data, total, pagination))
  } catch (error) {
    next(error)
  }
})

// POST /api/lessons/:id/complete — mark lesson complete
myRouter.post('/lessons/:id/complete', (req, res, next) => {
  try {
    const user = req.user!
    const lessonId = paramId(req.params.id)
    const lesson = get<{ id: number; module_id: number; title: string }>(
      `SELECT l.id, l.module_id, l.title FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?`,
      lessonId,
    )
    if (!lesson) throw new ApiError(404, 'Lesson not found')
    const module = get<{ program_id: number }>('SELECT program_id FROM modules WHERE id = ?', lesson.module_id)!
    const { access } = requireProgramAccess(user, module.program_id)
    if (access !== 'student') throw new ApiError(403, 'Only enrolled students can track lesson progress')

    run(
      'INSERT OR IGNORE INTO progress (student_id, lesson_id) VALUES (?, ?)',
      user.id,
      lessonId,
    )
    const programId = module.program_id
    res.json({
      completed: true,
      progress: getProgramProgress(user.id, programId),
      nextLesson: getNextLesson(user.id, programId),
    })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/lessons/:id/complete — un-mark lesson
myRouter.delete('/lessons/:id/complete', (req, res, next) => {
  try {
    const user = req.user!
    const lessonId = paramId(req.params.id)
    const lesson = get<{ id: number; module_id: number }>(
      'SELECT id, module_id FROM lessons WHERE id = ?',
      lessonId,
    )
    if (!lesson) throw new ApiError(404, 'Lesson not found')
    const module = get<{ program_id: number }>('SELECT program_id FROM modules WHERE id = ?', lesson.module_id)!
    const { access } = requireProgramAccess(user, module.program_id)
    if (access !== 'student') throw new ApiError(403, 'Only enrolled students can track lesson progress')

    run('DELETE FROM progress WHERE student_id = ? AND lesson_id = ?', user.id, lessonId)
    const programId = module.program_id
    res.json({
      completed: false,
      progress: getProgramProgress(user.id, programId),
      nextLesson: getNextLesson(user.id, programId),
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/my/progress — overall progress across programs
myRouter.get('/progress', (req, res) => {
  res.json(getStudentOverallProgress(req.user!.id))
})

// GET /api/my/submissions — recent submissions with grades
myRouter.get('/submissions', (req, res, next) => {
  try {
    const user = req.user!
    const pagination = toPagination(paginationSchema.parse(req.query))
    const total =
      get<{ total: number }>('SELECT COUNT(*) AS total FROM submissions WHERE student_id = ?', user.id)
        ?.total ?? 0
    const rows = camelList(
      all(
        `SELECT s.id, s.status, s.score, s.is_late, s.attempts, s.submitted_at, s.graded_at, s.feedback,
                a.id AS assignment_id, a.title AS assignment_title, a.max_marks, a.due_at,
                p.id AS program_id, p.title AS program_title
         FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
         JOIN programs p ON p.id = a.program_id
         WHERE s.student_id = ?
         ORDER BY s.updated_at DESC, s.id DESC
         LIMIT ? OFFSET ?`,
        user.id,
        pagination.limit,
        pagination.offset,
      ),
    )
    res.json(paginate(rows, total, pagination))
  } catch (error) {
    next(error)
  }
})
