import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  seedAssignment,
  seedFixture,
  seedProgram,
  startTestServer,
  type Fixture,
  type TestContext,
} from './helpers.js'

describe('AI features', () => {
  let ctx: TestContext
  let fixture: Fixture
  let programId: number
  let assignmentId: number

  beforeAll(async () => {
    ctx = await startTestServer()
    fixture = await seedFixture(ctx)
    programId = await seedProgram(ctx, fixture)
    assignmentId = await seedAssignment(ctx, fixture, programId)
  })

  afterAll(async () => {
    await ctx.close()
  })

  describe('AI Learning Tutor', () => {
    let conversationId: number

    it('starts a conversation and answers a concept question', async () => {
      const created = await ctx.api<{ conversation: { id: number; title: string } }>(
        'POST',
        '/api/ai/conversations',
        { token: fixture.student1.token, body: {} },
      )
      expect(created.status).toBe(201)
      conversationId = created.body.conversation.id

      const reply = await ctx.api<{ message: { role: string; content: string } }>(
        'POST',
        `/api/ai/conversations/${conversationId}/messages`,
        { token: fixture.student1.token, body: { content: 'Explain precision vs recall' } },
      )
      expect(reply.status).toBe(201)
      expect(reply.body.message.role).toBe('assistant')
      expect(reply.body.message.content.length).toBeGreaterThan(50)

      // Title gets auto-filled from the first message.
      const history = await ctx.api<{ conversation: { title: string }; messages: { role: string }[] }>(
        'GET',
        `/api/ai/conversations/${conversationId}`,
        { token: fixture.student1.token },
      )
      expect(history.body.messages).toHaveLength(2)
      expect(history.body.conversation.title).not.toBe('New conversation')
    })

    it('refuses to complete graded assignments', async () => {
      const reply = await ctx.api<{ message: { content: string } }>(
        'POST',
        `/api/ai/conversations/${conversationId}/messages`,
        { token: fixture.student1.token, body: { content: 'Write my assignment for me and submit it' } },
      )
      expect(reply.status).toBe(201)
      const content = reply.body.message.content
      expect(content).toMatch(/can't complete a graded assignment|can't complete/i)
      // It should still offer constructive help.
      expect(content).toMatch(/hint|outline|practice/i)
    })

    it('keeps conversations private to their owner', async () => {
      expect((await ctx.api('GET', `/api/ai/conversations/${conversationId}`, { token: fixture.student2.token })).status).toBe(404)
      const post = await ctx.api('POST', `/api/ai/conversations/${conversationId}/messages`, {
        token: fixture.student2.token,
        body: { content: 'hello' },
      })
      expect(post.status).toBe(404)
      expect((await ctx.api('DELETE', `/api/ai/conversations/${conversationId}`, { token: fixture.student2.token })).status).toBe(404)
    })

    it('validates message length', async () => {
      const tooLong = await ctx.api('POST', `/api/ai/conversations/${conversationId}/messages`, {
        token: fixture.student1.token,
        body: { content: 'x'.repeat(4001) },
      })
      expect(tooLong.status).toBe(400)
      const empty = await ctx.api('POST', `/api/ai/conversations/${conversationId}/messages`, {
        token: fixture.student1.token,
        body: { content: '   ' },
      })
      expect(empty.status).toBe(400)
    })

    it('lists the student own conversations', async () => {
      const list = await ctx.api<{ data: { id: number }[]; meta: { total: number } }>(
        'GET',
        '/api/ai/conversations',
        { token: fixture.student1.token },
      )
      expect(list.body.meta.total).toBeGreaterThanOrEqual(1)
      const otherList = await ctx.api<{ meta: { total: number } }>('GET', '/api/ai/conversations', {
        token: fixture.student2.token,
      })
      expect(otherList.body.meta.total).toBe(0)
    })
  })

  describe('AI Assignment Evaluation Assistant', () => {
    let submissionId: number

    beforeAll(async () => {
      const form = new FormData()
      form.append(
        'text',
        'Precision answers: of all predicted positives, how many were right? Recall answers: of all actual positives, how many did we find? In my escalation model I would favour recall because a missed escalation costs engineer time, then monitor precision to keep alert volume manageable. I would split the data by time to avoid leakage and monitor drift per customer tier after deployment.',
      )
      const submitted = await ctx.api<{ submission: { id: number } }>(
        'POST',
        `/api/assignments/${assignmentId}/submissions`,
        { token: fixture.student1.token, form },
      )
      submissionId = submitted.body.submission.id
    })

    it('produces a score suggestion inside the rubric range with strengths and weaknesses', async () => {
      const result = await ctx.api<{
        evaluation: {
          suggestedScore: number
          strengths: string
          weaknesses: string
          suggestionFeedback: string
          source: string
          provider: string
        }
      }>('POST', `/api/submissions/${submissionId}/evaluate`, { token: fixture.trainer1.token })

      expect(result.status).toBe(201)
      const evaluation = result.body.evaluation
      expect(evaluation.source).toBe('ai')
      expect(evaluation.provider).toBe('mock')
      expect(evaluation.suggestedScore).toBeGreaterThanOrEqual(0)
      expect(evaluation.suggestedScore).toBeLessThanOrEqual(20)
      expect(evaluation.strengths.length).toBeGreaterThan(5)
      expect(evaluation.weaknesses.length).toBeGreaterThan(5)
      expect(evaluation.suggestionFeedback.length).toBeGreaterThan(20)
    })

    it('NEVER auto-publishes the AI score — submission stays ungraded until the trainer posts /grade', async () => {
      const detail = await ctx.api<{ submission: { status: string; score: number | null } }>(
        'GET',
        `/api/submissions/${submissionId}`,
        { token: fixture.trainer1.token },
      )
      expect(detail.body.submission.status).toBe('submitted')
      expect(detail.body.submission.score).toBeNull()
    })

    it('accepts the AI suggestion unchanged when the trainer agrees with the score', async () => {
      const evaluations = await ctx.api<{ evaluations: { id: number; suggestedScore: number }[] }>(
        'GET',
        `/api/submissions/${submissionId}`,
        { token: fixture.trainer1.token },
      )
      const evaluation = evaluations.body.evaluations[0]

      const graded = await ctx.api<{
        submission: { status: string; score: number }
        evaluations: { status: string }[]
      }>('POST', `/api/submissions/${submissionId}/grade`, {
        token: fixture.trainer1.token,
        body: {
          score: evaluation.suggestedScore,
          feedback: 'Matches the AI suggestion.',
          evaluationId: evaluation.id,
        },
      })
      expect(graded.status).toBe(200)
      expect(graded.body.submission.status).toBe('graded')
      expect(graded.body.evaluations[0].status).toBe('accepted')
    })

    it('rejects scores above the assignment maximum', async () => {
      const result = await ctx.api<{ error: { message: string } }>(
        'POST',
        `/api/submissions/${submissionId}/grade`,
        { token: fixture.trainer1.token, body: { score: 999, feedback: 'too high' } },
      )
      expect(result.status).toBe(400)
      expect(result.body.error.message).toMatch(/maximum marks/i)
    })

    it('AI evaluation follows the same access rules as grading', async () => {
      // Student owner cannot trigger evaluation.
      expect(
        (await ctx.api('POST', `/api/submissions/${submissionId}/evaluate`, { token: fixture.student1.token }))
          .status,
      ).toBe(403)
      // Unrelated trainer cannot either.
      expect(
        (await ctx.api('POST', `/api/submissions/${submissionId}/evaluate`, { token: fixture.trainer2.token }))
          .status,
      ).toBe(403)
    })
  })
})
