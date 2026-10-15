import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  seedAssignment,
  seedFixture,
  seedProgram,
  setAssignmentTasks,
  startTestServer,
  submitTaskWork,
  type Fixture,
  type TestContext,
} from './helpers.js'

/**
 * Regression coverage for the grading-integrity defects:
 *   BUG-01 incomplete mixed-format submissions must not be finalized as graded
 *   BUG-02 unknown task ids are rejected and pending/awaiting_review blocks finalization
 *   BUG-03 per-task scores outside the allowed range are rejected with HTTP 400
 */
describe('grading integrity (BUG-01 / BUG-02 / BUG-03)', () => {
  let ctx: TestContext
  let fixture: Fixture
  let programId: number
  let assignmentId: number
  let taskA = 0
  let taskB = 0
  let submissionId = 0

  beforeAll(async () => {
    ctx = await startTestServer()
    fixture = await seedFixture(ctx)
    programId = await seedProgram(ctx, fixture)
    assignmentId = await seedAssignment(ctx, fixture, programId, { maxMarks: 110, rubricItems: [] })
    const tasks = await setAssignmentTasks(ctx, fixture.trainer1.token, assignmentId, [
      { prompt: 'Part A — practical task', format: 'text', maxMarks: 60 },
      { prompt: 'Part B — written explanation', format: 'text', maxMarks: 40 },
      { prompt: 'Optional bonus note', format: 'text', required: false, maxMarks: 10 },
    ])
    taskA = tasks[0].id
    taskB = tasks[1].id
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('rejects unknown task ids when submitting (BUG-02)', async () => {
    const result = await submitTaskWork<{ error: { message: string } }>(
      ctx,
      fixture.student1.token,
      assignmentId,
      [{ taskId: 999999, responseText: 'not a real task' }],
    )
    expect(result.status).toBe(400)
    expect(result.body.error.message).toMatch(/unknown task/i)
  })

  it('blocks finalization until every required task is assessed (BUG-01/02)', async () => {
    const submitted = await submitTaskWork<{ submission: { id: number } }>(
      ctx,
      fixture.student1.token,
      assignmentId,
      [
        { taskId: taskA, responseText: 'Answer for task A.' },
        { taskId: taskB, responseText: 'Answer for task B.' },
      ],
    )
    expect(submitted.status).toBe(201)
    submissionId = submitted.body.submission.id

    const detail = await ctx.api<{ taskCompletion: { complete: boolean; requiredTotal: number; requiredAssessed: number } }>(
      'GET',
      `/api/submissions/${submissionId}`,
      { token: fixture.trainer1.token },
    )
    expect(detail.body.taskCompletion).toMatchObject({ complete: false, requiredTotal: 2, requiredAssessed: 0 })

    const gradedA = await ctx.api(
      'POST',
      `/api/submissions/${submissionId}/task-grades`,
      { token: fixture.trainer1.token, body: { grades: [{ taskId: taskA, score: 55 }] } },
    )
    expect(gradedA.status).toBe(200)

    const blocked = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/submissions/${submissionId}/grade`,
      { token: fixture.trainer1.token, body: { score: 90 } },
    )
    expect(blocked.status).toBe(400)
    expect(blocked.body.error.message).toMatch(/outstanding/i)
  })

  it('rejects unknown task ids and out-of-range scores in per-task grading (BUG-02/03)', async () => {
    const unknown = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/submissions/${submissionId}/task-grades`,
      { token: fixture.trainer1.token, body: { grades: [{ taskId: 999999, score: 1 }] } },
    )
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.message).toMatch(/unknown task/i)

    const tooHigh = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/submissions/${submissionId}/task-grades`,
      { token: fixture.trainer1.token, body: { grades: [{ taskId: taskA, score: 999 }] } },
    )
    expect(tooHigh.status).toBe(400)
    expect(tooHigh.body.error.message).toMatch(/cannot exceed/i)

    const negative = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/submissions/${submissionId}/task-grades`,
      { token: fixture.trainer1.token, body: { grades: [{ taskId: taskA, score: -5 }] } },
    )
    expect(negative.status).toBe(400)
    expect(negative.body.error.message).toMatch(/negative/i)

    const fractional = await ctx.api(
      'POST',
      `/api/submissions/${submissionId}/task-grades`,
      { token: fixture.trainer1.token, body: { grades: [{ taskId: taskA, score: 10.5 }] } },
    )
    expect(fractional.status).toBe(400)
  })

  it('finalizes once every required task is assessed (optional gaps allowed)', async () => {
    const gradedB = await ctx.api(
      'POST',
      `/api/submissions/${submissionId}/task-grades`,
      { token: fixture.trainer1.token, body: { grades: [{ taskId: taskB, score: 35 }] } },
    )
    expect(gradedB.status).toBe(200)

    // The optional task is still unassessed; finalization must still succeed.
    const graded = await ctx.api<{ submission: { status: string; score: number } }>(
      'POST',
      `/api/submissions/${submissionId}/grade`,
      { token: fixture.trainer1.token, body: { score: 90, feedback: 'Strong work.' } },
    )
    expect(graded.status).toBe(200)
    expect(graded.body.submission).toMatchObject({ status: 'graded', score: 90 })
  })

  it('rejects task grading after the submission is graded', async () => {
    const res = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/submissions/${submissionId}/task-grades`,
      { token: fixture.trainer1.token, body: { grades: [{ taskId: taskA, score: 10 }] } },
    )
    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/already been graded/i)
  })

  it('exposes the task list to the enrolled student', async () => {
    const detail = await ctx.api<{
      assignment: { tasks: { id: number; prompt: string }[] }
      myTaskResponses: { taskId: number; status: string }[]
    }>('GET', `/api/assignments/${assignmentId}`, { token: fixture.student1.token })
    expect(detail.status).toBe(200)
    expect(detail.body.assignment.tasks).toHaveLength(3)
    expect(detail.body.myTaskResponses.length).toBeGreaterThan(0)
  })
})
