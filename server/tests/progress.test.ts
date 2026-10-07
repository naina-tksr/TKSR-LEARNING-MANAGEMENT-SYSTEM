import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedFixture, seedProgram, startTestServer, type Fixture, type TestContext } from './helpers.js'

/**
 * Progress calculation unit tests — exercises the service layer directly
 * (getProgramProgress / getNextLesson / getStudentOverallProgress) against
 * rows written through the real API.
 *
 * Signatures: getProgramProgress(studentId, programId), getNextLesson(studentId, programId).
 */
describe('progress service', () => {
  let ctx: TestContext
  let fixture: Fixture
  let programId: number
  let lessonIds: number[]

  beforeAll(async () => {
    ctx = await startTestServer()
    fixture = await seedFixture(ctx)
    programId = await seedProgram(ctx, fixture)

    const detail = await ctx.api<{ modules: { lessons: { id: number }[] }[] }>(
      'GET',
      `/api/programs/${programId}`,
      { token: fixture.student1.token },
    )
    lessonIds = detail.body.modules[0].lessons.map((lesson) => lesson.id)
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('starts at 0% with nothing completed', async () => {
    const { getProgramProgress } = await import('../src/services/progress.js')
    const progress = getProgramProgress(fixture.student1.id, programId)
    expect(progress).toEqual({ totalLessons: 2, completedLessons: 0, percent: 0 })
  })

  it('advances 50% then 100% as lessons complete', async () => {
    const { getProgramProgress } = await import('../src/services/progress.js')

    const first = await ctx.api('POST', `/api/my/lessons/${lessonIds[0]}/complete`, {
      token: fixture.student1.token,
    })
    expect(first.status).toBe(200)

    const half = getProgramProgress(fixture.student1.id, programId)
    expect(half).toEqual({ totalLessons: 2, completedLessons: 1, percent: 50 })

    const second = await ctx.api('POST', `/api/my/lessons/${lessonIds[1]}/complete`, {
      token: fixture.student1.token,
    })
    expect(second.status).toBe(200)

    const full = getProgramProgress(fixture.student1.id, programId)
    expect(full).toEqual({ totalLessons: 2, completedLessons: 2, percent: 100 })
  })

  it('un-completing a lesson rewinds the percentage', async () => {
    const { getProgramProgress } = await import('../src/services/progress.js')

    const undo = await ctx.api('DELETE', `/api/my/lessons/${lessonIds[1]}/complete`, {
      token: fixture.student1.token,
    })
    expect(undo.status).toBe(200)

    const progress = getProgramProgress(fixture.student1.id, programId)
    expect(progress).toEqual({ totalLessons: 2, completedLessons: 1, percent: 50 })

    // Put it back for the remaining tests.
    await ctx.api('POST', `/api/my/lessons/${lessonIds[1]}/complete`, { token: fixture.student1.token })
  })

  it('is per-student: another enrolled student sees 0%', async () => {
    // Enroll student2 as well so both see the same program.
    const cohorts = await ctx.api<{ data: { id: number }[] }>('GET', `/api/cohorts?programId=${programId}`, {
      token: fixture.admin.token,
    })
    expect(cohorts.status).toBe(200)
    const enrolled = await ctx.api('POST', `/api/cohorts/${cohorts.body.data[0].id}/enrollments`, {
      token: fixture.admin.token,
      body: { studentIds: [fixture.student2.id] },
    })
    expect(enrolled.status).toBe(201)

    const { getProgramProgress } = await import('../src/services/progress.js')
    expect(getProgramProgress(fixture.student2.id, programId).percent).toBe(0)
    expect(getProgramProgress(fixture.student1.id, programId).percent).toBe(100)
  })

  it('nextLesson returns the first incomplete lesson', async () => {
    const { getNextLesson } = await import('../src/services/progress.js')

    const next = getNextLesson(fixture.student2.id, programId)
    expect(next?.lessonId).toBe(lessonIds[0])

    await ctx.api('POST', `/api/my/lessons/${lessonIds[0]}/complete`, { token: fixture.student2.token })
    const afterOne = getNextLesson(fixture.student2.id, programId)
    expect(afterOne?.lessonId).toBe(lessonIds[1])

    // A student with everything completed still gets a lesson back (the first).
    await ctx.api('POST', `/api/my/lessons/${lessonIds[1]}/complete`, { token: fixture.student2.token })
    const done = getNextLesson(fixture.student2.id, programId)
    expect(done?.completed).toBe(true)
  })

  it('overall progress aggregates across programs', async () => {
    const { getStudentOverallProgress } = await import('../src/services/progress.js')

    const overall = getStudentOverallProgress(fixture.student1.id)
    expect(overall).toEqual({ totalLessons: 2, completedLessons: 2, percent: 100, programCount: 1 })

    // A user with no enrollments reports zeroes, not NaN.
    const empty = getStudentOverallProgress(fixture.trainer1.id)
    expect(empty).toEqual({ totalLessons: 0, completedLessons: 0, percent: 0, programCount: 0 })
    expect(Number.isNaN(empty.percent)).toBe(false)
  })
})
