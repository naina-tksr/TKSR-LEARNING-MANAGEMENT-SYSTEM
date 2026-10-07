import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Router, type Request, type RequestHandler } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { config } from '../config.js'
import { all, get, run } from '../db/helpers.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import {
  requireAssignmentManager,
  requireProgramAccess,
  requireSubmissionAccess,
} from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import { getAIProvider } from '../services/ai/index.js'
import { notify } from '../services/notifications.js'
import { camelKeys, camelList } from '../utils/camel.js'
import { paramId } from '../utils/http.js'
import { paginate, paginationSchema, toPagination } from '../utils/pagination.js'

export const submissionsRouter = Router()
submissionsRouter.use(requireAuth)

// ---------------------------------------------------------------------------
// File upload (validated: extension + mime + size, random stored filename)
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.zip',
])
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'text/plain', 'text/markdown', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip', 'application/x-zip-compressed',
])

const uploadDir = path.join(config.uploadDir, 'submissions')
fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 12)
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new ApiError(400, `Files of type "${ext || 'unknown'}" are not allowed`))
      return
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new ApiError(400, `Files of type "${file.mimetype}" are not allowed`))
      return
    }
    cb(null, true)
  },
})

/** Wraps multer so its errors flow through the normal error handler. */
const uploadSingle: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      next(error)
      return
    }
    next()
  })
}

function removeFileQuietly(filePath: string | null | undefined): void {
  if (!filePath) return
  try {
    fs.unlinkSync(filePath)
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const submitSchema = z.object({
  text: z.string().trim().max(20_000).optional(),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => value === '' || /^https?:\/\//i.test(value), {
      message: 'URL must start with http:// or https://',
    })
    .optional(),
})

const gradeSchema = z.object({
  score: z.number().int().min(0),
  feedback: z.string().trim().max(4000).default(''),
  evaluationId: z.number().int().positive().optional(),
})

// ---------------------------------------------------------------------------
// Student submission (text / URL / file)
// ---------------------------------------------------------------------------

function assertCanSubmit(req: Request, assignmentId: number) {
  const user = req.user!
  const assignment = get<{ id: number; program_id: number; title: string; status: string; due_at: string | null; max_marks: number }>(
    'SELECT id, program_id, title, status, due_at, max_marks FROM assignments WHERE id = ?',
    assignmentId,
  )
  if (!assignment) throw new ApiError(404, 'Assignment not found')
  const { access } = requireProgramAccess(user, assignment.program_id)
  if (access !== 'student') throw new ApiError(403, 'Only enrolled students can submit assignments')
  if (assignment.status !== 'published') throw new ApiError(403, 'This assignment is not published')
  return assignment
}

submissionsRouter.post('/assignments/:id/submissions', requireRole('student'), uploadSingle, (req, res, next) => {
  try {
    const user = req.user!
    const assignmentId = paramId(req.params.id)
    const assignment = assertCanSubmit(req, assignmentId)
    const parsed = submitSchema.safeParse({ text: req.body.text, url: req.body.url })
    if (!parsed.success) {
      removeFileQuietly(req.file?.path)
      throw new ApiError(400, 'Validation failed', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
    }
    const text = parsed.data.text ?? ''
    const url = parsed.data.url && parsed.data.url.length > 0 ? parsed.data.url : null
    if (!text && !url && !req.file) {
      throw new ApiError(400, 'Provide a text answer, a URL or a file attachment')
    }

    const existing = get<{ id: number; status: string; file_path: string | null }>(
      'SELECT id, status, file_path FROM submissions WHERE assignment_id = ? AND student_id = ?',
      assignmentId,
      user.id,
    )
    if (existing && existing.status === 'graded') {
      removeFileQuietly(req.file?.path)
      throw new ApiError(409, 'This submission has already been graded and can no longer be changed')
    }

    const isLate = assignment.due_at ? Date.now() > new Date(assignment.due_at).getTime() : false
    const nowIso = new Date().toISOString()
    const file = req.file

    let submissionId: number
    if (existing) {
      submissionId = existing.id
      if (file) {
        run(
          `UPDATE submissions
           SET content = ?, url = ?, file_path = ?, file_name = ?, file_size = ?, file_mime = ?,
               is_late = ?, attempts = attempts + 1, submitted_at = ?, updated_at = ?
           WHERE id = ?`,
          text,
          url,
          file.path,
          file.originalname,
          file.size,
          file.mimetype,
          isLate,
          nowIso,
          nowIso,
          submissionId,
        )
        if (existing.file_path && existing.file_path !== file.path) removeFileQuietly(existing.file_path)
      } else {
        run(
          `UPDATE submissions
           SET content = ?, url = ?, is_late = ?, attempts = attempts + 1, submitted_at = ?, updated_at = ?
           WHERE id = ?`,
          text,
          url,
          isLate,
          nowIso,
          nowIso,
          submissionId,
        )
      }
    } else {
      const result = run(
        `INSERT INTO submissions (assignment_id, student_id, content, url, file_path, file_name, file_size, file_mime, is_late, submitted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        assignmentId,
        user.id,
        text,
        url,
        file?.path ?? null,
        file?.originalname ?? null,
        file?.size ?? null,
        file?.mimetype ?? null,
        isLate,
        nowIso,
        nowIso,
      )
      submissionId = result.lastInsertRowid
    }

    recordAudit({
      userId: user.id,
      action: existing ? 'submission.resubmit' : 'submission.create',
      entityType: 'submission',
      entityId: submissionId,
      metadata: { assignmentId, hasFile: Boolean(file), isLate },
      ip: req.ip,
    })

    const programTrainer = get<{ trainer_id: number | null; title: string }>(
      'SELECT p.trainer_id, p.title FROM programs p WHERE p.id = ?',
      assignment.program_id,
    )
    if (programTrainer?.trainer_id) {
      notify({
        userId: programTrainer.trainer_id,
        title: 'New submission to review',
        body: `${user.name} submitted "${assignment.title}".`,
        type: 'info',
        link: `/app/submissions/${submissionId}`,
      })
    }

    const row = get<Record<string, unknown>>('SELECT * FROM submissions WHERE id = ?', submissionId)!
    res.status(201).json({ submission: serializeSubmission(row) })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Lists (trainer queue + per-assignment submissions)
// ---------------------------------------------------------------------------

/**
 * Submissions are stored with an absolute `file_path` on disk — never expose it
 * to clients (it reveals server filesystem layout). The download endpoint
 * `GET /api/submissions/:id/file` is the only supported way to fetch the file.
 */
function serializeSubmission(row: unknown): Record<string, unknown> {
  const data = camelKeys(row)
  delete data.filePath
  return data
}

const queueQuerySchema = paginationSchema.extend({
  status: z.enum(['submitted', 'graded']).optional(),
  programId: z.coerce.number().int().positive().optional(),
  assignmentId: z.coerce.number().int().positive().optional(),
})

// GET /api/submissions — grading queue (admin: all, trainer: assigned programs only)
submissionsRouter.get('/submissions', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const user = req.user!
    const query = queueQuerySchema.parse(req.query)
    const pagination = toPagination(query)
    const where: string[] = []
    const params: unknown[] = []
    if (user.role === 'trainer') {
      where.push('p.trainer_id = ?')
      params.push(user.id)
    }
    if (query.status) {
      where.push('s.status = ?')
      params.push(query.status)
    }
    if (query.programId) {
      where.push('a.program_id = ?')
      params.push(query.programId)
    }
    if (query.assignmentId) {
      where.push('s.assignment_id = ?')
      params.push(query.assignmentId)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const base = `FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN programs p ON p.id = a.program_id
       JOIN users u ON u.id = s.student_id`
    const total = get<{ total: number }>(`SELECT COUNT(*) AS total ${base} ${whereSql}`, ...params)?.total ?? 0
    const rows = all(
      `SELECT s.id, s.status, s.score, s.is_late, s.attempts, s.submitted_at, s.graded_at,
              u.id AS student_id, u.name AS student_name,
              a.id AS assignment_id, a.title AS assignment_title, a.max_marks, a.due_at,
              p.id AS program_id, p.title AS program_title,
              (SELECT COUNT(*) FROM evaluations e WHERE e.submission_id = s.id AND e.source = 'ai') AS ai_evaluation_count
       ${base}
       ${whereSql}
       ORDER BY CASE WHEN s.status = 'submitted' THEN 0 ELSE 1 END, s.submitted_at DESC, s.id DESC
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

// GET /api/assignments/:id/submissions — submissions for one assignment
submissionsRouter.get('/assignments/:id/submissions', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const user = req.user!
    const assignmentId = paramId(req.params.id)
    const { assignment } = requireAssignmentManager(user, assignmentId)
    const query = paginationSchema.extend({ status: z.enum(['submitted', 'graded']).optional() }).parse(req.query)
    const pagination = toPagination(query)
    const where = ['s.assignment_id = ?']
    const params: unknown[] = [assignmentId]
    if (query.status) {
      where.push('s.status = ?')
      params.push(query.status)
    }
    const whereSql = `WHERE ${where.join(' AND ')}`
    const total =
      get<{ total: number }>(`SELECT COUNT(*) AS total FROM submissions s ${whereSql}`, ...params)?.total ?? 0
    const rows = all(
      `SELECT s.id, s.status, s.score, s.is_late, s.attempts, s.submitted_at, s.graded_at, s.feedback,
              u.id AS student_id, u.name AS student_name, u.email AS student_email
       FROM submissions s JOIN users u ON u.id = s.student_id
       ${whereSql}
       ORDER BY s.submitted_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      ...params,
      pagination.limit,
      pagination.offset,
    )
    res.json({
      assignment: camelKeys(assignment),
      submissions: paginate(camelList(rows), total, pagination),
    })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Submission detail + file
// ---------------------------------------------------------------------------

function submissionDetail(req: Request, submissionId: number) {
  const user = req.user!
  const { submission, assignment, program } = requireSubmissionAccess(user, submissionId)
  const evaluations =
    user.role === 'student'
      ? []
      : camelList(
          all(
            `SELECT e.*, u.name AS reviewed_by_name FROM evaluations e
             LEFT JOIN users u ON u.id = e.reviewed_by
             WHERE e.submission_id = ? ORDER BY e.created_at DESC, e.id DESC`,
            submissionId,
          ),
        )
  const student = get<{ id: number; name: string; email: string }>(
    'SELECT id, name, email FROM users WHERE id = ?',
    submission.student_id,
  )
  const rubric = camelList(
    all('SELECT * FROM rubric_items WHERE assignment_id = ? ORDER BY position, id', assignment.id),
  )
  const gradedBy = submission.graded_by
    ? get<{ id: number; name: string }>('SELECT id, name FROM users WHERE id = ?', submission.graded_by)
    : null
  return {
    submission: serializeSubmission(submission),
    assignment: { ...camelKeys(assignment), rubricItems: rubric },
    program: { id: program.id, title: program.title, status: program.status },
    student: student ? camelKeys(student) : null,
    gradedBy: gradedBy ? camelKeys(gradedBy) : null,
    evaluations,
    canGrade: user.role === 'admin' || (user.role === 'trainer' && program.trainer_id === user.id),
  }
}

// GET /api/submissions/:id
submissionsRouter.get('/submissions/:id', (req, res, next) => {
  try {
    res.json(submissionDetail(req, paramId(req.params.id)))
  } catch (error) {
    next(error)
  }
})

// GET /api/submissions/:id/file — access-checked download
submissionsRouter.get('/submissions/:id/file', (req, res, next) => {
  try {
    const { submission } = requireSubmissionAccess(req.user!, paramId(req.params.id))
    if (!submission.file_path) throw new ApiError(404, 'This submission has no attached file')
    const resolved = path.resolve(submission.file_path)
    if (!resolved.startsWith(config.uploadDir + path.sep)) throw new ApiError(404, 'File not found')
    if (!fs.existsSync(resolved)) throw new ApiError(404, 'File not found')
    const safeName = (submission.file_name ?? path.basename(resolved)).replace(/[^\w.\- ]+/g, '_')
    res.download(resolved, safeName, (error) => {
      if (error && !res.headersSent) next(error)
    })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// AI evaluation + grading (never automatic)
// ---------------------------------------------------------------------------

// POST /api/submissions/:id/evaluate — trainer requests an AI suggestion
submissionsRouter.post('/submissions/:id/evaluate', requireRole('admin', 'trainer'), async (req, res, next) => {
  try {
    const user = req.user!
    const submissionId = paramId(req.params.id)
    const { submission, assignment, program } = requireSubmissionAccess(user, submissionId)

    const rubric = all<{ criteria: string; max_marks: number }>(
      'SELECT criteria, max_marks FROM rubric_items WHERE assignment_id = ? ORDER BY position, id',
      assignment.id,
    )
    const provider = getAIProvider()
    let suggestion
    try {
      suggestion = await provider.evaluate({
        assignmentTitle: assignment.title,
        assignmentDescription: assignment.description,
        maxMarks: assignment.max_marks,
        rubric: rubric.map((item) => ({ criteria: item.criteria, maxMarks: item.max_marks })),
        submissionText: submission.content,
        submissionUrl: submission.url,
        fileName: submission.file_name,
        isLate: Boolean(submission.is_late),
      })
    } catch (error) {
      throw new ApiError(502, `AI evaluation failed: ${(error as Error).message}`)
    }

    const result = run(
      `INSERT INTO evaluations (submission_id, source, suggested_score, strengths, weaknesses, suggestion_feedback, provider, created_by)
       VALUES (?, 'ai', ?, ?, ?, ?, ?, ?)`,
      submissionId,
      suggestion.suggestedScore,
      suggestion.strengths.join('\n'),
      suggestion.weaknesses.join('\n'),
      suggestion.feedback,
      provider.name,
      user.id,
    )
    recordAudit({
      userId: user.id,
      action: 'ai.evaluate',
      entityType: 'submission',
      entityId: submissionId,
      metadata: { evaluationId: result.lastInsertRowid, provider: provider.name, programId: program.id },
      ip: req.ip,
    })
    const evaluation = get('SELECT * FROM evaluations WHERE id = ?', result.lastInsertRowid)
    res.status(201).json({ evaluation: camelKeys(evaluation) })
  } catch (error) {
    next(error)
  }
})

// POST /api/submissions/:id/grade — the ONLY endpoint that releases a grade
submissionsRouter.post('/submissions/:id/grade', requireRole('admin', 'trainer'), validateBody(gradeSchema), (req, res, next) => {
  try {
    const user = req.user!
    const submissionId = paramId(req.params.id)
    const { submission, assignment } = requireSubmissionAccess(user, submissionId)
    const body = req.body as z.infer<typeof gradeSchema>
    if (body.score > assignment.max_marks) {
      throw new ApiError(400, `Score cannot exceed the maximum marks (${assignment.max_marks})`)
    }

    let evaluationStatus: 'accepted' | 'edited' | null = null
    if (body.evaluationId != null) {
      const evaluation = get<{ id: number; submission_id: number; source: string; suggested_score: number | null }>(
        'SELECT id, submission_id, source, suggested_score FROM evaluations WHERE id = ?',
        body.evaluationId,
      )
      if (!evaluation || evaluation.submission_id !== submissionId || evaluation.source !== 'ai') {
        throw new ApiError(400, 'evaluationId must reference an AI evaluation of this submission')
      }
      evaluationStatus = evaluation.suggested_score === body.score ? 'accepted' : 'edited'
      run(
        'UPDATE evaluations SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?',
        evaluationStatus,
        user.id,
        new Date().toISOString(),
        new Date().toISOString(),
        evaluation.id,
      )
    }

    const nowIso = new Date().toISOString()
    run(
      `UPDATE submissions
       SET status = 'graded', score = ?, feedback = ?, graded_by = ?, graded_at = ?, updated_at = ?
       WHERE id = ?`,
      body.score,
      body.feedback,
      user.id,
      nowIso,
      nowIso,
      submissionId,
    )
    notify({
      userId: submission.student_id,
      title: 'Your assignment has been graded',
      body: `${assignment.title}: ${body.score}/${assignment.max_marks}${body.feedback ? ' — feedback available' : ''}`,
      type: 'grade',
      link: `/app/assignments/${assignment.id}`,
    })
    recordAudit({
      userId: user.id,
      action: 'grade.release',
      entityType: 'submission',
      entityId: submissionId,
      metadata: {
        score: body.score,
        maxMarks: assignment.max_marks,
        evaluationStatus,
        assignmentId: assignment.id,
      },
      ip: req.ip,
    })
    res.json(submissionDetail(req, submissionId))
  } catch (error) {
    next(error)
  }
})
