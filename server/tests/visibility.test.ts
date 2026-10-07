import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  seedAssignment,
  seedFixture,
  seedProgram,
  startTestServer,
  type Fixture,
  type TestContext,
} from './helpers.js'

/**
 * Regression tests for two visibility/security fixes:
 *
 * 1. Draft programs must stay completely invisible to enrolled students
 *    (dashboards, /my lists, progress totals, direct access) until an admin
 *    publishes them — mirroring programAccess().
 * 2. Submissions are stored with an absolute file path on disk; that path must
 *    never appear in any API response. Only GET /api/submissions/:id/file
 *    hands out the file, to authorized users.
 */
describe('visibility rules', () => {
  let ctx: TestContext
  let fixture: Fixture

  beforeAll(async () => {
    ctx = await startTestServer()
    fixture = await seedFixture(ctx)
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('keeps a draft program invisible to enrolled students until published', async () => {
    // Build a DRAFT program (create API never publishes) with content and a
    // published assignment, then enroll student2.
    const created = await ctx.api<{ program: { id: number } }>('POST', '/api/programs', {
      token: fixture.admin.token,
      body: { title: 'Draft Visibility Program', description: 'Stays draft at first.', level: 'beginner' },
    })
    expect(created.status).toBe(201)
    const programId = created.body.program.id

    const cohort = await ctx.api<{ cohort: { id: number } }>('POST', '/api/cohorts', {
      token: fixture.admin.token,
      body: { programId, name: 'Draft Cohort' },
    })
    expect(cohort.status).toBe(201)

    const enrolled = await ctx.api('POST', `/api/cohorts/${cohort.body.cohort.id}/enrollments`, {
      token: fixture.admin.token,
      body: { studentIds: [fixture.student2.id] },
    })
    expect(enrolled.status).toBe(201)

    const moduleRes = await ctx.api<{ module: { id: number } }>(
      'POST',
      `/api/programs/${programId}/modules`,
      { token: fixture.admin.token, body: { title: 'Draft Module', description: '' } },
    )
    expect(moduleRes.status).toBe(201)

    const lesson = await ctx.api('POST', `/api/modules/${moduleRes.body.module.id}/lessons`, {
      token: fixture.admin.token,
      body: { title: 'Draft Lesson', content: 'Hidden content.', durationMinutes: 5 },
    })
    expect(lesson.status).toBe(201)

    const assignment = await ctx.api<{ assignment: { id: number } }>(
      'POST',
      `/api/programs/${programId}/assignments`,
      { token: fixture.admin.token, body: { title: 'Draft Phase Assignment', maxMarks: 10 } },
    )
    expect(assignment.status).toBe(201)
    const assignmentId = assignment.body.assignment.id

    const publishedAssignment = await ctx.api('POST', `/api/assignments/${assignmentId}/publish`, {
      token: fixture.admin.token,
    })
    expect(publishedAssignment.status).toBe(200)

    // ---- Still draft: student2 must see none of it --------------------------

    const programs = await ctx.api<{ data: { id: number }[]; meta: { total: number } }>(
      'GET',
      '/api/my/programs?page=1&limit=15',
      { token: fixture.student2.token },
    )
    expect(programs.status).toBe(200)
    expect(programs.body.meta.total).toBe(0)
    expect(programs.body.data.some((p) => p.id === programId)).toBe(false)

    const myAssignments = await ctx.api<{ data: { id: number }[]; meta: { total: number } }>(
      'GET',
      '/api/my/assignments?page=1&limit=15&status=all',
      { token: fixture.student2.token },
    )
    expect(myAssignments.body.meta.total).toBe(0)
    expect(myAssignments.body.data.some((a) => a.id === assignmentId)).toBe(false)

    const dashboard = await ctx.api<{
      stats: { programs: number; pendingAssignments: number }
      programs: { id: number }[]
      pendingAssignments: { id: number }[]
    }>('GET', '/api/dashboard', { token: fixture.student2.token })
    expect(dashboard.body.stats.programs).toBe(0)
    expect(dashboard.body.stats.pendingAssignments).toBe(0)
    expect(dashboard.body.programs.some((p) => p.id === programId)).toBe(false)
    expect(dashboard.body.pendingAssignments.some((a) => a.id === assignmentId)).toBe(false)

    const progress = await ctx.api<{ programCount: number }>('GET', '/api/my/progress', {
      token: fixture.student2.token,
    })
    expect(progress.body.programCount).toBe(0)

    // The generic student program list hides drafts too.
    const catalog = await ctx.api<{ data: { id: number }[] }>('GET', '/api/programs?limit=100', {
      token: fixture.student2.token,
    })
    expect(catalog.body.data.some((p) => p.id === programId)).toBe(false)

    // Direct access is a 403 while the program is a draft.
    const direct = await ctx.api('GET', `/api/programs/${programId}`, { token: fixture.student2.token })
    expect(direct.status).toBe(403)

    // ---- Publish: everything appears at once -------------------------------

    const published = await ctx.api('PATCH', `/api/programs/${programId}`, {
      token: fixture.admin.token,
      body: { status: 'published' },
    })
    expect(published.status).toBe(200)

    const programsAfter = await ctx.api<{ data: { id: number }[]; meta: { total: number } }>(
      'GET',
      '/api/my/programs?page=1&limit=15',
      { token: fixture.student2.token },
    )
    expect(programsAfter.body.meta.total).toBe(1)
    expect(programsAfter.body.data.some((p) => p.id === programId)).toBe(true)

    const myAssignmentsAfter = await ctx.api<{ data: { id: number }[]; meta: { total: number } }>(
      'GET',
      '/api/my/assignments?page=1&limit=15&status=all',
      { token: fixture.student2.token },
    )
    expect(myAssignmentsAfter.body.meta.total).toBe(1)
    expect(myAssignmentsAfter.body.data.some((a) => a.id === assignmentId)).toBe(true)

    const dashboardAfter = await ctx.api<{
      stats: { programs: number; pendingAssignments: number }
      programs: { id: number }[]
    }>('GET', '/api/dashboard', { token: fixture.student2.token })
    expect(dashboardAfter.body.stats.programs).toBe(1)
    expect(dashboardAfter.body.stats.pendingAssignments).toBe(1)
    expect(dashboardAfter.body.programs.some((p) => p.id === programId)).toBe(true)

    const progressAfter = await ctx.api<{ programCount: number }>('GET', '/api/my/progress', {
      token: fixture.student2.token,
    })
    expect(progressAfter.body.programCount).toBe(1)

    const directAfter = await ctx.api('GET', `/api/programs/${programId}`, {
      token: fixture.student2.token,
    })
    expect(directAfter.status).toBe(200)
  })

  it('never exposes the server file path in submission responses', async () => {
    const programId = await seedProgram(ctx, fixture)
    const assignmentId = await seedAssignment(ctx, fixture, programId)

    // Submit text + a text/plain attachment exactly like the browser does.
    const form = new FormData()
    form.append('text', 'My answer with an attachment.')
    form.append('file', new Blob(['attachment body'], { type: 'text/plain' }), 'answer.txt')

    const submitted = await ctx.api<{ submission: Record<string, unknown> }>(
      'POST',
      `/api/assignments/${assignmentId}/submissions`,
      { token: fixture.student1.token, form },
    )
    expect(submitted.status).toBe(201)
    expect(submitted.body.submission).not.toHaveProperty('filePath')
    expect(JSON.stringify(submitted.body)).not.toContain('filePath')
    expect(JSON.stringify(submitted.body)).not.toContain('uploads')

    // Trainer grading detail: same redaction.
    const queue = await ctx.api<{ data: { id: number; assignmentId: number }[] }>(
      'GET',
      '/api/submissions?page=1&limit=15',
      { token: fixture.trainer1.token },
    )
    const row = queue.body.data.find((r) => r.assignmentId === assignmentId)
    expect(row).toBeTruthy()
    const submissionId = row!.id

    const detail = await ctx.api<{ submission: Record<string, unknown> }>(
      'GET',
      `/api/submissions/${submissionId}`,
      { token: fixture.trainer1.token },
    )
    expect(detail.status).toBe(200)
    expect(detail.body.submission).not.toHaveProperty('filePath')
    expect(JSON.stringify(detail.body)).not.toContain('filePath')

    // Student's own list stays clean as well.
    const mine = await ctx.api<{ data: Record<string, unknown>[] }>(
      'GET',
      '/api/my/submissions?page=1&limit=15',
      { token: fixture.student1.token },
    )
    expect(mine.status).toBe(200)
    expect(JSON.stringify(mine.body)).not.toContain('filePath')

    // The owner can still download the file through the dedicated endpoint…
    const download = await fetch(`${ctx.baseUrl}/api/submissions/${submissionId}/file`, {
      headers: { Authorization: `Bearer ${fixture.student1.token}` },
    })
    expect(download.status).toBe(200)
    expect(await download.text()).toBe('attachment body')

    // …but an unrelated student cannot.
    const forbidden = await fetch(`${ctx.baseUrl}/api/submissions/${submissionId}/file`, {
      headers: { Authorization: `Bearer ${fixture.student2.token}` },
    })
    expect(forbidden.status).toBe(403)
  })
})
