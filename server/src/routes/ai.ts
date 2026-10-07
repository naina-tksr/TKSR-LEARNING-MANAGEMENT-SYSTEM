import { Router } from 'express'
import { z } from 'zod'
import { all, get, run } from '../db/helpers.js'
import { requireAuth } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import { getAIProvider } from '../services/ai/index.js'
import type { ChatMessage } from '../services/ai/types.js'
import { recordAudit } from '../services/audit.js'
import { camelKeys, camelList } from '../utils/camel.js'
import { paramId } from '../utils/http.js'
import { paginate, paginationSchema, toPagination } from '../utils/pagination.js'

export const aiRouter = Router()
aiRouter.use(requireAuth)

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  programId: z.number().int().positive().nullable().optional(),
})

const messageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
})

function ownedConversation(userId: number, id: number) {
  const row = get<{ id: number; user_id: number; title: string; program_id: number | null }>(
    'SELECT id, user_id, title, program_id FROM ai_conversations WHERE id = ?',
    id,
  )
  if (!row || row.user_id !== userId) throw new ApiError(404, 'Conversation not found')
  return row
}

function enrolledProgramTitles(userId: number): string[] {
  return all<{ title: string }>(
    `SELECT DISTINCT p.title
     FROM enrollments e
     JOIN cohorts c ON c.id = e.cohort_id AND e.student_id = ? AND e.status = 'active'
     JOIN programs p ON p.id = c.program_id AND p.status = 'published'
     ORDER BY p.title COLLATE NOCASE`,
    userId,
  ).map((row) => row.title)
}

// GET /api/ai/conversations — own conversations
aiRouter.get('/conversations', (req, res, next) => {
  try {
    const pagination = toPagination(paginationSchema.parse(req.query))
    const total =
      get<{ total: number }>('SELECT COUNT(*) AS total FROM ai_conversations WHERE user_id = ?', req.user!.id)
        ?.total ?? 0
    const rows = camelList(
      all(
        `SELECT c.id, c.title, c.program_id, c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM ai_conversations c
         WHERE c.user_id = ?
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        req.user!.id,
        pagination.limit,
        pagination.offset,
      ),
    )
    res.json(paginate(rows, total, pagination))
  } catch (error) {
    next(error)
  }
})

// POST /api/ai/conversations
aiRouter.post('/conversations', validateBody(createConversationSchema), (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createConversationSchema>
    const result = run(
      'INSERT INTO ai_conversations (user_id, title, program_id) VALUES (?, ?, ?)',
      req.user!.id,
      body.title ?? 'New conversation',
      body.programId ?? null,
    )
    const row = get('SELECT id, title, program_id, created_at, updated_at FROM ai_conversations WHERE id = ?', result.lastInsertRowid)
    res.status(201).json({ conversation: camelKeys(row) })
  } catch (error) {
    next(error)
  }
})

// GET /api/ai/conversations/:id — with messages
aiRouter.get('/conversations/:id', (req, res, next) => {
  try {
    const conversation = ownedConversation(req.user!.id, paramId(req.params.id))
    const messages = camelList(
      all('SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY id', conversation.id),
    )
    res.json({ conversation: camelKeys(conversation), messages })
  } catch (error) {
    next(error)
  }
})

// POST /api/ai/conversations/:id/messages — ask the tutor
aiRouter.post(
  '/conversations/:id/messages',
  validateBody(messageSchema),
  async (req, res, next) => {
    try {
      const user = req.user!
      const conversation = ownedConversation(user.id, paramId(req.params.id))
      const { content } = req.body as z.infer<typeof messageSchema>

      run(
        'INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)',
        conversation.id,
        'user',
        content,
      )

      const history = all<{ role: 'user' | 'assistant'; content: string }>(
        'SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 14',
        conversation.id,
      ).reverse()
      const programs = enrolledProgramTitles(user.id)
      const programTitle = conversation.program_id
        ? get<{ title: string }>('SELECT title FROM programs WHERE id = ?', conversation.program_id)?.title
        : undefined

      const provider = getAIProvider()
      let reply: string
      try {
        reply = await provider.tutorChat({
          messages: history.map(
            (row): ChatMessage => ({ role: row.role, content: row.content }),
          ),
          context: {
            userName: user.name,
            role: user.role,
            programs,
            currentProgram: programTitle,
          },
        })
      } catch (error) {
        throw new ApiError(502, `AI tutor is unavailable: ${(error as Error).message}`)
      }

      const nowIso = new Date().toISOString()
      run(
        'INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)',
        conversation.id,
        'assistant',
        reply,
      )
      const messageCount =
        get<{ total: number }>('SELECT COUNT(*) AS total FROM ai_messages WHERE conversation_id = ?', conversation.id)
          ?.total ?? 0
      run(
        'UPDATE ai_conversations SET updated_at = ? WHERE id = ?',
        nowIso,
        conversation.id,
      )
      if (messageCount <= 2 && conversation.title === 'New conversation') {
        const title = content.length > 60 ? `${content.slice(0, 57)}...` : content
        run('UPDATE ai_conversations SET title = ? WHERE id = ?', title, conversation.id)
      }

      recordAudit({
        userId: user.id,
        action: 'ai.tutor_message',
        entityType: 'ai_conversation',
        entityId: conversation.id,
        metadata: { provider: provider.name },
        ip: req.ip,
      })

      const saved = get(
        'SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
        conversation.id,
      )
      res.status(201).json({
        message: camelKeys(saved),
        conversation: camelKeys(
          get('SELECT id, title, program_id, created_at, updated_at FROM ai_conversations WHERE id = ?', conversation.id),
        ),
      })
    } catch (error) {
      next(error)
    }
  },
)

// DELETE /api/ai/conversations/:id
aiRouter.delete('/conversations/:id', (req, res, next) => {
  try {
    const conversation = ownedConversation(req.user!.id, paramId(req.params.id))
    run('DELETE FROM ai_conversations WHERE id = ?', conversation.id)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})
