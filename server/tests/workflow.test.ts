import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  seedAssignment,
  seedFixture,
  seedProgram,
  startTestServer,
  type Fixture,
  type TestContext,
} from './helpers.js'

describe('end-to-end learning workflow', () => {
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

  it('admin manages the full chain: program → trainer → cohort → students', async () => {
    // Assign trainer2 temporarily to prove reassignment works, then put trainer1 back.
    const reassigned = await ctx.api<{ program: { trainerId: number } }>(
      'POST',
      `/api/programs/${programId}/trainer`,
      { token: fixture.admin.token, body: { trainerId: fixture.trainer2.id } },
    )
    expect(reassigned.status).toBe(200)
    expect(reassigned.body.program.trainerId).toBe(fixture.trainer2.id)

    const restored = await ctx.api<{ program: { trainerId: number } }>(
      'POST',
      `/api/programs/${programId}/trainer`,
      { token: fixture.admin.token, body: { trainerId: fixture.trainer1.id } },
    )
    expect(restored.body.program.trainerId).toBe(fixture.trainer1.id)

    // Cohort roster shows the enrolled student.
    const cohorts = await ctx.api<{ data: { id: number; studentCount: number }[] }>(
      'GET',
      `/api/cohorts?programId=${programId}`,
      { token: fixture.admin.token },
    )
    expect(cohorts.body.data[0].studentCount).toBe(1)

    // Roster shows the enrolled student with progress attached.
    const roster = await ctx.api<{ data: { id: number; progress: { totalLessons: number; completedLessons: number; percent: number } }[]; meta: { total: number } }>(
      'GET',
      `/api/programs/${programId}/students`,
      { token: fixture.trainer1.token },
    )
    expect(roster.body.meta.total).toBe(1)
    expect(roster.body.data[0].id).toBe(fixture.student1.id)
    expect(roster.body.data[0].progress).toMatchObject({ totalLessons: 2, completedLessons: 0, percent: 0 })
  })

  it('student sees the program, lessons and published assignment', async () => {
    const detail = await ctx.api<{
      program: { id: number }
      modules: { lessons: { id: number; completed: boolean }[] }[]
      assignments: { id: number; mySubmission: unknown }[]
      progress: { percent: number }
      access: string
    }>('GET', `/api/programs/${programId}`, { token: fixture.student1.token })

    expect(detail.status).toBe(200)
    expect(detail.body.access).toBe('student')
    expect(detail.body.modules[0].lessons).toHaveLength(2)
    expect(detail.body.assignments).toHaveLength(1)
    expect(detail.body.assignments[0].mySubmission).toBeNull()
    expect(detail.body.progress).toMatchObject({ totalLessons: 2, percent: 0 })

    const myAssignments = await ctx.api<{ data: { id: number; isSubmitted: boolean; status: string }[] }>(
      'GET',
      '/api/my/assignments',
      { token: fixture.student1.token },
    )
    expect(myAssignments.body.data).toHaveLength(1)
    expect(myAssignments.body.data[0]).toMatchObject({ id: assignmentId, isSubmitted: false })
  })

  it('student submits work (text + file) and can resubmit before grading', async () => {
    const withText = new FormData()
    withText.append('text', 'Here is my answer with a clear explanation and worked reasoning.')
    const first = await ctx.api<{ submission: { id: number; status: string; attempts: number } }>(
      'POST',
      `/api/assignments/${assignmentId}/submissions`,
      { token: fixture.student1.token, form: withText },
    )
    expect(first.status).toBe(201)
    expect(first.body.submission).toMatchObject({ status: 'submitted', attempts: 1 })
    const submissionId = first.body.submission.id

    // Resubmit with a file attached (validated upload).
    const withFile = new FormData()
    withFile.append('text', 'Updated answer after revision.')
    withFile.append(
      'file',
      new Blob(['# My submission\nSome markdown work.'], { type: 'text/markdown' }),
      'submission.md',
    )
    const second = await ctx.api<{ submission: { attempts: number; fileName: string; status: string } }>(
      'POST',
      `/api/assignments/${assignmentId}/submissions`,
      { token: fixture.student1.token, form: withFile },
    )
    expect(second.status).toBe(201)
    expect(second.body.submission.attempts).toBe(2)
    expect(second.body.submission.fileName).toBe('submission.md')

    // The attachment is downloadable by its owner…
    const fileResponse = await fetch(`${ctx.baseUrl}/api/submissions/${submissionId}/file`, {
      headers: { Authorization: `Bearer ${fixture.student1.token}` },
    })
    expect(fileResponse.status).toBe(200)
    expect(await fileResponse.text()).toContain('Some markdown work')

    // …and blocked for others.
    const denied = await fetch(`${ctx.baseUrl}/api/submissions/${submissionId}/file`, {
      headers: { Authorization: `Bearer ${fixture.student2.token}` },
    })
    expect(denied.status).toBe(403)
  })

  it('rejects disallowed file types', async () => {
    const form = new FormData()
    form.append('file', new Blob(['MZbinary'], { type: 'application/x-msdownload' }), 'malware.exe')
    const result = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/assignments/${assignmentId}/submissions`,
      { token: fixture.student1.token, form },
    )
    expect(result.status).toBe(400)
    expect(result.body.error.message).toMatch(/not allowed/i)
  })

  it('trainer sees the queue, requests AI evaluation, then releases the grade manually', async () => {
    const queue = await ctx.api<{ data: { id: number; studentId: number }[]; meta: { total: number } }>(
      'GET',
      '/api/submissions?status=submitted',
      { token: fixture.trainer1.token },
    )
    expect(queue.body.meta.total).toBe(1)
    const submissionId = queue.body.data[0].id

    // AI suggestion arrives but the submission is STILL ungraded (never auto-published).
    const evaluation = await ctx.api<{
      evaluation: { id: number; suggestedScore: number; status: string; source: string }
    }>('POST', `/api/submissions/${submissionId}/evaluate`, { token: fixture.trainer1.token })
    expect(evaluation.status).toBe(201)
    expect(evaluation.body.evaluation).toMatchObject({ source: 'ai', status: 'suggested' })
    expect(evaluation.body.evaluation.suggestedScore).toBeGreaterThanOrEqual(0)
    expect(evaluation.body.evaluation.suggestedScore).toBeLessThanOrEqual(20)

    const afterEval = await ctx.api<{ submission: { status: string } }>(
      'GET',
      `/api/submissions/${submissionId}`,
      { token: fixture.trainer1.token },
    )
    expect(afterEval.body.submission.status).toBe('submitted')

    // Trainer edits the AI suggestion and releases the grade.
    const suggested = evaluation.body.evaluation.suggestedScore
    const score = suggested >= 20 ? suggested - 1 : suggested + 1
    const graded = await ctx.api<{
      submission: { status: string; score: number }
      gradedBy: { id: number } | null
      evaluations: { id: number; status: string; reviewedBy: number | null }[]
    }>('POST', `/api/submissions/${submissionId}/grade`, {
      token: fixture.trainer1.token,
      body: { score, feedback: 'Good work — see feedback.', evaluationId: evaluation.body.evaluation.id },
    })
    expect(graded.status).toBe(200)
    expect(graded.body.submission).toMatchObject({ status: 'graded', score })
    expect(graded.body.gradedBy).toMatchObject({ id: fixture.trainer1.id })
    expect(graded.body.evaluations[0]).toMatchObject({ status: 'edited', reviewedBy: fixture.trainer1.id })

    // Resubmission after grading is blocked.
    const form = new FormData()
    form.append('text', 'One more try')
    const blocked = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/assignments/${assignmentId}/submissions`,
      { token: fixture.student1.token, form },
    )
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.message).toMatch(/graded/i)
  })

  it('student sees the released grade, feedback and a notification', async () => {
    const mine = await ctx.api<{ data: { submissionId: number; score: number; feedback: string }[] }>(
      'GET',
      '/api/my/submissions',
      { token: fixture.student1.token },
    )
    expect(mine.body.data[0]).toMatchObject({ score: expect.any(Number), feedback: expect.stringContaining('Good work') })

    const detail = await ctx.api<{ mySubmission: { status: string; score: number; feedback: string } }>(
      'GET',
      `/api/assignments/${assignmentId}`,
      { token: fixture.student1.token },
    )
    expect(detail.body.mySubmission.status).toBe('graded')
    expect(detail.body.mySubmission.feedback).toContain('Good work')

    const notifications = await ctx.api<{ data: { type: string }[]; unread: number }>(
      'GET',
      '/api/notifications?unread=1',
      { token: fixture.student1.token },
    )
    expect(notifications.body.data.some((note) => note.type === 'grade')).toBe(true)
    expect(notifications.body.unread).toBeGreaterThan(0)
  })

  it('tracks lesson progress and rolls back correctly', async () => {
    const program = await ctx.api<{ modules: { lessons: { id: number; completed: boolean }[] }[] }>(
      'GET',
      `/api/programs/${programId}`,
      { token: fixture.student1.token },
    )
    const [lessonOne, lessonTwo] = program.body.modules[0].lessons

    const complete = await ctx.api<{
      completed: boolean
      progress: { percent: number; completedLessons: number }
      nextLesson: { lessonId: number } | null
    }>('POST', `/api/my/lessons/${lessonOne.id}/complete`, { token: fixture.student1.token })
    expect(complete.status).toBe(200)
    expect(complete.body.completed).toBe(true)
    expect(complete.body.progress).toMatchObject({ percent: 50, completedLessons: 1 })
    expect(complete.body.nextLesson?.lessonId).toBe(lessonTwo.id)

    const completeAll = await ctx.api<{
      progress: { percent: number }
      nextLesson: { lessonId: number } | null
    }>(
      'POST',
      `/api/my/lessons/${lessonTwo.id}/complete`,
      { token: fixture.student1.token },
    )
    expect(completeAll.body.progress.percent).toBe(100)
    expect(completeAll.body.nextLesson).not.toBeNull()

    const undo = await ctx.api<{ progress: { percent: number } }>(
      'DELETE',
      `/api/my/lessons/${lessonTwo.id}/complete`,
      { token: fixture.student1.token },
    )
    expect(undo.body.progress.percent).toBe(50)
  })

  it('admin can enforce deletion rules (program with enrollments cannot be deleted)', async () => {
    const result = await ctx.api<{ error: { message: string } }>('DELETE', `/api/programs/${programId}`, {
      token: fixture.admin.token,
    })
    expect(result.status).toBe(409)
    expect(result.body.error.message).toMatch(/enrolled/i)
  })

  it('records important actions in the audit log for admins', async () => {
    const audit = await ctx.api<{ data: { action: string; userName: string }[]; meta: { total: number } }>(
      'GET',
      '/api/audit?limit=100',
      { token: fixture.admin.token },
    )
    const actions = audit.body.data.map((row) => row.action)
    expect(actions).toContain('program.create')
    expect(actions).toContain('assignment.publish')
    expect(actions).toContain('submission.create')
    expect(actions).toContain('grade.release')
    expect(actions).toContain('ai.evaluate')
    expect(actions).toContain('auth.login')
  })
})
