import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedFixture, seedProgram, startTestServer, type Fixture, type TestContext } from './helpers.js'

describe('role-based access control', () => {
  let ctx: TestContext
  let fixture: Fixture
  let programId: number

  beforeAll(async () => {
    ctx = await startTestServer()
    fixture = await seedFixture(ctx)
    programId = await seedProgram(ctx, fixture) // trainer1 assigned, student1 enrolled
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('students cannot list users', async () => {
    const result = await ctx.api<{ error: { message: string } }>('GET', '/api/users', {
      token: fixture.student1.token,
    })
    expect(result.status).toBe(403)
    expect(result.body.error.message).toMatch(/permission/i)
  })

  it('students and trainers cannot read the audit log', async () => {
    expect((await ctx.api('GET', '/api/audit', { token: fixture.student1.token })).status).toBe(403)
    expect((await ctx.api('GET', '/api/audit', { token: fixture.trainer1.token })).status).toBe(403)
  })

  it('students cannot create programs, cohorts or users', async () => {
    expect(
      (await ctx.api('POST', '/api/programs', { token: fixture.student1.token, body: { title: 'Nope' } })).status,
    ).toBe(403)
    expect(
      (
        await ctx.api('POST', '/api/cohorts', {
          token: fixture.student1.token,
          body: { programId, name: 'Nope' },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await ctx.api('POST', '/api/users', {
          token: fixture.student1.token,
          body: { name: 'Hacker', email: 'h@test.local', password: 'Password1', role: 'admin' },
        })
      ).status,
    ).toBe(403)
  })

  it('students cannot create assignments or grade submissions', async () => {
    const assignment = await ctx.api('POST', `/api/programs/${programId}/assignments`, {
      token: fixture.student1.token,
      body: { title: 'Fake assignment', maxMarks: 10 },
    })
    expect(assignment.status).toBe(403)
    expect((await ctx.api('POST', '/api/submissions/1/grade', { token: fixture.student1.token, body: { score: 20 } })).status).toBe(403)
    expect((await ctx.api('POST', '/api/submissions/1/evaluate', { token: fixture.student1.token })).status).toBe(403)
  })

  it('students can only see programs they are enrolled in', async () => {
    // Unenrolled program created by admin.
    const other = await ctx.api<{ program: { id: number } }>('POST', '/api/programs', {
      token: fixture.admin.token,
      body: { title: 'Secret Advanced Program', level: 'advanced' },
    })
    const otherId = other.body.program.id

    const enrolledList = await ctx.api<{ data: { id: number }[]; meta: { total: number } }>(
      'GET',
      '/api/programs',
      { token: fixture.student1.token },
    )
    expect(enrolledList.body.meta.total).toBe(1)
    expect(enrolledList.body.data[0].id).toBe(programId)

    const detail = await ctx.api<{ error: { message: string } }>('GET', `/api/programs/${otherId}`, {
      token: fixture.student1.token,
    })
    expect(detail.status).toBe(403)
  })

  it('students cannot see draft programs even when poking at detail', async () => {
    const draft = await ctx.api<{ program: { id: number } }>('POST', '/api/programs', {
      token: fixture.admin.token,
      body: { title: 'Draft Program', trainerId: fixture.trainer1.id },
    })
    const result = await ctx.api('GET', `/api/programs/${draft.body.program.id}`, {
      token: fixture.student1.token,
    })
    expect(result.status).toBe(403)
  })

  it('trainers only manage their assigned programs', async () => {
    const trainer2Program = await seedProgram(ctx, fixture, {
      trainerId: fixture.trainer2.id,
      enrollStudents: [],
    })

    // trainer1 sees only their own program.
    const list = await ctx.api<{ data: { id: number }[]; meta: { total: number } }>('GET', '/api/programs', {
      token: fixture.trainer1.token,
    })
    expect(list.body.data.some((program) => program.id === trainer2Program)).toBe(false)

    // trainer1 cannot modify trainer2's program.
    const patch = await ctx.api('PATCH', `/api/programs/${trainer2Program}`, {
      token: fixture.trainer1.token,
      body: { title: 'Hijacked' },
    })
    expect(patch.status).toBe(403)

    // trainer1 cannot create content in trainer2's program.
    const module = await ctx.api('POST', `/api/programs/${trainer2Program}/modules`, {
      token: fixture.trainer1.token,
      body: { title: 'Sneaky module' },
    })
    expect(module.status).toBe(403)
  })

  it('students only see their own submissions and grades', async () => {
    // student1 submits to a real assignment.
    const assignmentId = await (async () => {
      const created = await ctx.api<{ assignment: { id: number } }>(
        'POST',
        `/api/programs/${programId}/assignments`,
        {
          token: fixture.trainer1.token,
          body: { title: 'Private Submission Assignment', maxMarks: 10 },
        },
      )
      await ctx.api('POST', `/api/assignments/${created.body.assignment.id}/publish`, {
        token: fixture.trainer1.token,
      })
      return created.body.assignment.id
    })()

    const form = new FormData()
    form.append('text', 'My own work')
    const submitted = await ctx.api<{ submission: { id: number } }>(
      'POST',
      `/api/assignments/${assignmentId}/submissions`,
      { token: fixture.student1.token, form },
    )
    expect(submitted.status).toBe(201)
    const submissionId = submitted.body.submission.id

    // Owner can read it.
    expect((await ctx.api('GET', `/api/submissions/${submissionId}`, { token: fixture.student1.token })).status).toBe(200)
    // Another student cannot.
    expect((await ctx.api('GET', `/api/submissions/${submissionId}`, { token: fixture.student2.token })).status).toBe(403)
    // And cannot submit to an assignment in a program they are not enrolled in.
    const foreignForm = new FormData()
    foreignForm.append('text', 'Sneaky')
    const foreign = await ctx.api('POST', `/api/assignments/${assignmentId}/submissions`, {
      token: fixture.student2.token,
      form: foreignForm,
    })
    expect(foreign.status).toBe(403)
  })

  it('prevents privilege escalation: students cannot change their own role', async () => {
    const result = await ctx.api('PATCH', `/api/users/${fixture.student1.id}`, {
      token: fixture.student1.token,
      body: { role: 'admin' },
    })
    expect(result.status).toBe(403)
  })

  it('admin cannot delete their own account', async () => {
    const result = await ctx.api('DELETE', `/api/users/${fixture.admin.id}`, { token: fixture.admin.token })
    expect(result.status).toBe(400)
  })

  it('unknown API routes return 404 JSON, not HTML', async () => {
    const result = await ctx.api<{ error: { message: string } }>('GET', '/api/definitely-not-a-route', {
      token: fixture.admin.token,
    })
    expect(result.status).toBe(404)
    expect(result.body.error.message).toContain('Not found')
  })
})
