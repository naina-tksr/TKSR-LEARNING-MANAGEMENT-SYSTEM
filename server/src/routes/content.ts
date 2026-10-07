import { Router } from 'express'
import { z } from 'zod'
import { all, get, run } from '../db/helpers.js'
import type { LessonRow, ModuleRow } from '../db/types.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import { requireProgramAccess, requireProgramManager } from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import { camelKeys } from '../utils/camel.js'
import { paramId } from '../utils/http.js'

export const modulesRouter = Router()
modulesRouter.use(requireAuth)

const moduleSchema = z.object({
  title: z.string().trim().min(2).max(150),
  description: z.string().trim().max(2000).default(''),
  position: z.number().int().min(0).max(1000).optional(),
})

const lessonSchema = z.object({
  title: z.string().trim().min(2).max(150),
  content: z.string().trim().max(50_000).default(''),
  durationMinutes: z.number().int().min(1).max(1000).default(10),
  position: z.number().int().min(0).max(1000).optional(),
})

function moduleRow(id: number): ModuleRow | undefined {
  return get<ModuleRow>('SELECT * FROM modules WHERE id = ?', id)
}

function nextPosition(table: 'modules' | 'lessons', column: 'program_id' | 'module_id', parentId: number): number {
  const row = get<{ next: number }>(
    `SELECT COALESCE(MAX(position) + 1, 0) AS next FROM ${table} WHERE ${column} = ?`,
    parentId,
  )
  return row?.next ?? 0
}

// POST /api/programs/:id/modules — admin or assigned trainer
modulesRouter.post(
  '/programs/:id/modules',
  requireRole('admin', 'trainer'),
  validateBody(moduleSchema),
  (req, res, next) => {
    try {
      const programId = paramId(req.params.id)
      requireProgramManager(req.user!, programId)
      const body = req.body as z.infer<typeof moduleSchema>
      const position = body.position ?? nextPosition('modules', 'program_id', programId)
      const result = run(
        'INSERT INTO modules (program_id, title, description, position) VALUES (?, ?, ?, ?)',
        programId,
        body.title,
        body.description,
        position,
      )
      recordAudit({
        userId: req.user!.id,
        action: 'module.create',
        entityType: 'module',
        entityId: result.lastInsertRowid,
        metadata: { title: body.title, programId },
        ip: req.ip,
      })
      const row = moduleRow(result.lastInsertRowid)!
      res.status(201).json({ module: camelKeys(row) })
    } catch (error) {
      next(error)
    }
  },
)

// PATCH /api/modules/:id
modulesRouter.patch('/modules/:id', requireRole('admin', 'trainer'), validateBody(moduleSchema.partial()), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = moduleRow(id)
    if (!row) throw new ApiError(404, 'Module not found')
    requireProgramManager(req.user!, row.program_id)
    const body = req.body as Partial<z.infer<typeof moduleSchema>>
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
    if (body.position !== undefined) {
      updates.push('position = ?')
      params.push(body.position)
    }
    updates.push('updated_at = ?')
    params.push(new Date().toISOString())
    run(`UPDATE modules SET ${updates.join(', ')} WHERE id = ?`, ...params, id)
    recordAudit({
      userId: req.user!.id,
      action: 'module.update',
      entityType: 'module',
      entityId: id,
      metadata: { fields: Object.keys(body) },
      ip: req.ip,
    })
    res.json({ module: camelKeys(moduleRow(id)!) })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/modules/:id (lessons cascade)
modulesRouter.delete('/modules/:id', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = moduleRow(id)
    if (!row) throw new ApiError(404, 'Module not found')
    requireProgramManager(req.user!, row.program_id)
    run('DELETE FROM modules WHERE id = ?', id)
    recordAudit({
      userId: req.user!.id,
      action: 'module.delete',
      entityType: 'module',
      entityId: id,
      metadata: { title: row.title, programId: row.program_id },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

// GET /api/modules/:id/lessons — requires program read access
modulesRouter.get('/modules/:id/lessons', (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = moduleRow(id)
    if (!row) throw new ApiError(404, 'Module not found')
    const { access } = requireProgramAccess(req.user!, row.program_id)
    const rows = all<LessonRow>(
      'SELECT * FROM lessons WHERE module_id = ? ORDER BY position, id',
      id,
    )
    res.json({
      module: camelKeys(row),
      lessons: rows.map((lesson) => ({ ...camelKeys(lesson), completed: isCompleted(req.user!.id, lesson.id, access) })),
    })
  } catch (error) {
    next(error)
  }
})

function isCompleted(userId: number, lessonId: number, access: string): boolean {
  if (access !== 'student') return false
  return Boolean(get<{ id: number }>('SELECT id FROM progress WHERE student_id = ? AND lesson_id = ?', userId, lessonId))
}

// POST /api/modules/:id/lessons — admin or assigned trainer
modulesRouter.post(
  '/modules/:id/lessons',
  requireRole('admin', 'trainer'),
  validateBody(lessonSchema),
  (req, res, next) => {
    try {
      const moduleId = paramId(req.params.id)
      const row = moduleRow(moduleId)
      if (!row) throw new ApiError(404, 'Module not found')
      requireProgramManager(req.user!, row.program_id)
      const body = req.body as z.infer<typeof lessonSchema>
      const position = body.position ?? nextPosition('lessons', 'module_id', moduleId)
      const result = run(
        'INSERT INTO lessons (module_id, title, content, duration_minutes, position) VALUES (?, ?, ?, ?, ?)',
        moduleId,
        body.title,
        body.content,
        body.durationMinutes,
        position,
      )
      run('UPDATE programs SET updated_at = ? WHERE id = ?', new Date().toISOString(), row.program_id)
      recordAudit({
        userId: req.user!.id,
        action: 'lesson.create',
        entityType: 'lesson',
        entityId: result.lastInsertRowid,
        metadata: { title: body.title, moduleId },
        ip: req.ip,
      })
      const lesson = get<LessonRow>('SELECT * FROM lessons WHERE id = ?', result.lastInsertRowid)!
      res.status(201).json({ lesson: camelKeys(lesson) })
    } catch (error) {
      next(error)
    }
  },
)

// PATCH /api/lessons/:id
modulesRouter.patch(
  '/lessons/:id',
  requireRole('admin', 'trainer'),
  validateBody(lessonSchema.partial()),
  (req, res, next) => {
    try {
      const id = paramId(req.params.id)
      const row = get<LessonRow>('SELECT * FROM lessons WHERE id = ?', id)
      if (!row) throw new ApiError(404, 'Lesson not found')
      const module = moduleRow(row.module_id)
      if (!module) throw new ApiError(404, 'Lesson not found')
      requireProgramManager(req.user!, module.program_id)
      const body = req.body as Partial<z.infer<typeof lessonSchema>>
      const updates: string[] = []
      const params: unknown[] = []
      if (body.title !== undefined) {
        updates.push('title = ?')
        params.push(body.title)
      }
      if (body.content !== undefined) {
        updates.push('content = ?')
        params.push(body.content)
      }
      if (body.durationMinutes !== undefined) {
        updates.push('duration_minutes = ?')
        params.push(body.durationMinutes)
      }
      if (body.position !== undefined) {
        updates.push('position = ?')
        params.push(body.position)
      }
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      run(`UPDATE lessons SET ${updates.join(', ')} WHERE id = ?`, ...params, id)
      recordAudit({
        userId: req.user!.id,
        action: 'lesson.update',
        entityType: 'lesson',
        entityId: id,
        metadata: { fields: Object.keys(body) },
        ip: req.ip,
      })
      res.json({ lesson: camelKeys(get<LessonRow>('SELECT * FROM lessons WHERE id = ?', id)!) })
    } catch (error) {
      next(error)
    }
  },
)

// DELETE /api/lessons/:id
modulesRouter.delete('/lessons/:id', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const row = get<LessonRow>('SELECT * FROM lessons WHERE id = ?', id)
    if (!row) throw new ApiError(404, 'Lesson not found')
    const module = moduleRow(row.module_id)
    if (!module) throw new ApiError(404, 'Lesson not found')
    requireProgramManager(req.user!, module.program_id)
    run('DELETE FROM lessons WHERE id = ?', id)
    recordAudit({
      userId: req.user!.id,
      action: 'lesson.delete',
      entityType: 'lesson',
      entityId: id,
      metadata: { title: row.title },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})
