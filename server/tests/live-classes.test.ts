import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedFixture, seedProgram, startTestServer, type Fixture, type TestContext } from './helpers.js'

const MEET = 'https://meet.google.com/abc-defg-hij'
const FUTURE = '2099-01-15'

interface LiveClassBody {
  id: number
  status: string
  durationMinutes: number
  meetUrl: string | null
  trainerName: string | null
  programId: number
}

describe('live classes', () => {
  let ctx: TestContext
  let fixture: Fixture
  let programA: number
  let programB: number
  let publishedClassId = 0

  const createClass = (token: string, programId: number, body: Record<string, unknown>) =>
    ctx.api<{ liveClass: LiveClassBody; error: { message: string } }>('POST', `/api/programs/${programId}/classes`, {
      token,
      body: { title: 'Live session', classDate: FUTURE, startTime: '10:00', timezone: 'UTC', ...body },
    })

  beforeAll(async () => {
    ctx = await startTestServer()
    fixture = await seedFixture(ctx)
    programA = await seedProgram(ctx, fixture, { trainerId: fixture.trainer1.id, enrollStudents: [fixture.student1.id] })
    programB = await seedProgram(ctx, fixture, { trainerId: fixture.trainer2.id, enrollStudents: [fixture.student2.id] })
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('admin and the assigned trainer can schedule a class with a 60-minute default', async () => {
    const asAdmin = await createClass(fixture.admin.token, programA, { title: 'Admin class' })
    expect(asAdmin.status).toBe(201)
    expect(asAdmin.body.liveClass).toMatchObject({ status: 'draft', durationMinutes: 60 })

    const asTrainer = await createClass(fixture.trainer1.token, programA, { title: 'Trainer class' })
    expect(asTrainer.status).toBe(201)
    expect(asTrainer.body.liveClass.trainerName).toBe(fixture.trainer1.name)
  })

  it('rejects scheduling by an unassigned trainer or a student', async () => {
    const otherTrainer = await createClass(fixture.trainer2.token, programA, { title: 'Nope' })
    expect(otherTrainer.status).toBe(403)

    const student = await createClass(fixture.student1.token, programA, { title: 'Nope' })
    expect(student.status).toBe(403)
  })

  it('rejects non-Google-Meet links and requires a link to publish', async () => {
    const badUrl = await createClass(fixture.trainer1.token, programA, {
      title: 'Bad link',
      meetUrl: 'https://zoom.us/j/123456789',
    })
    expect(badUrl.status).toBe(400)
    expect(badUrl.body.error.message).toMatch(/google meet/i)

    const draft = await createClass(fixture.trainer1.token, programA, { title: 'Draft without link' })
    expect(draft.status).toBe(201)
    const draftId = draft.body.liveClass.id

    const publishWithout = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/live-classes/${draftId}/publish`,
      { token: fixture.trainer1.token },
    )
    expect(publishWithout.status).toBe(400)
    expect(publishWithout.body.error.message).toMatch(/meet link/i)

    const publishWith = await ctx.api<{ liveClass: LiveClassBody }>(
      'POST',
      `/api/live-classes/${draftId}/publish`,
      { token: fixture.trainer1.token, body: { meetUrl: MEET } },
    )
    expect(publishWith.status).toBe(200)
    expect(publishWith.body.liveClass).toMatchObject({ status: 'scheduled', meetUrl: MEET })
    publishedClassId = publishWith.body.liveClass.id
  })

  it('shows upcoming classes to enrolled students only', async () => {
    const mine = await ctx.api<{ data: LiveClassBody[] }>('GET', '/api/my/classes', {
      token: fixture.student1.token,
    })
    expect(mine.body.data.map((item) => item.id)).toContain(publishedClassId)

    const otherProgram = await createClass(fixture.trainer2.token, programB, {
      title: 'Program B class',
      meetUrl: MEET,
      status: 'scheduled',
    })
    expect(otherProgram.status).toBe(201)

    const student1 = await ctx.api<{ data: LiveClassBody[] }>('GET', '/api/my/classes', {
      token: fixture.student1.token,
    })
    const student2 = await ctx.api<{ data: LiveClassBody[] }>('GET', '/api/my/classes', {
      token: fixture.student2.token,
    })
    expect(student1.body.data.every((item) => item.programId === programA)).toBe(true)
    expect(student2.body.data.every((item) => item.programId === programB)).toBe(true)
  })

  it('blocks students from reading a program schedule they are not enrolled in', async () => {
    const denied = await ctx.api<{ error: { message: string } }>('GET', `/api/programs/${programA}/classes`, {
      token: fixture.student2.token,
    })
    expect(denied.status).toBe(403)
  })

  it('hides draft classes from students but shows them to staff', async () => {
    const hiddenDraft = await createClass(fixture.trainer1.token, programA, { title: 'Unpublished draft' })
    expect(hiddenDraft.status).toBe(201)
    const hiddenDraftId = hiddenDraft.body.liveClass.id

    const studentView = await ctx.api<{ data: LiveClassBody[] }>('GET', `/api/programs/${programA}/classes`, {
      token: fixture.student1.token,
    })
    const studentIds = studentView.body.data.map((item) => item.id)
    expect(studentIds).toContain(publishedClassId)
    expect(studentIds).not.toContain(hiddenDraftId)

    const staffView = await ctx.api<{ data: LiveClassBody[] }>('GET', `/api/programs/${programA}/classes`, {
      token: fixture.trainer1.token,
    })
    expect(staffView.body.data.some((item) => item.id === hiddenDraftId && item.status === 'draft')).toBe(true)
  })

  it('removes cancelled classes from the student view', async () => {
    const cancelled = await ctx.api('POST', `/api/live-classes/${publishedClassId}/cancel`, {
      token: fixture.trainer1.token,
    })
    expect(cancelled.status).toBe(200)

    const mine = await ctx.api<{ data: LiveClassBody[] }>('GET', '/api/my/classes', {
      token: fixture.student1.token,
    })
    expect(mine.body.data.map((item) => item.id)).not.toContain(publishedClassId)
  })
})
