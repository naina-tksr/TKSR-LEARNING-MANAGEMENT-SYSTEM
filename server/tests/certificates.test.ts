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

interface CertificateDto {
  id: number
  certificateId: string
  verificationCode: string
  certificateTitle: string
  certificateType: string
  studentName: string
  programTitle: string
  completionDate: string
  verificationUrl: string
}

interface EligibilityEntry {
  programId: number
  eligible: boolean
  certificateEnabled: boolean
  reasons: string[]
  lessons: { total: number; completed: number; satisfied: boolean }
  assignments: { total: number; satisfied: boolean }
  finalAssessment: { id: number; graded: boolean } | null
}

describe('completion certificates', () => {
  let ctx: TestContext
  let fixture: Fixture
  let programOneDay: number
  let assignmentOneDay: number
  let taskOneDay = 0
  let certificate: CertificateDto

  const configureRules = (programId: number, token: string, body: Record<string, unknown>) =>
    ctx.api('PUT', `/api/programs/${programId}/completion-rules`, { token, body })

  /** Completes every lesson, submits full task answers and releases a passing grade. */
  async function completeAndGrade(
    programId: number,
    assignmentId: number,
    taskId: number,
    studentToken: string,
    score: number,
  ): Promise<void> {
    const program = await ctx.api<{ modules: { lessons: { id: number }[] }[] }>('GET', `/api/programs/${programId}`, {
      token: studentToken,
    })
    for (const module of program.body.modules) {
      for (const lesson of module.lessons) {
        const done = await ctx.api('POST', `/api/my/lessons/${lesson.id}/complete`, { token: studentToken })
        if (done.status !== 200) throw new Error(`lesson complete failed: ${JSON.stringify(done.body)}`)
      }
    }

    const submission = await submitTaskWork<{ submission: { id: number } }>(ctx, studentToken, assignmentId, [
      { taskId, responseText: 'Final deliverable and explanation.' },
    ])
    if (submission.status !== 201) throw new Error(`submit failed: ${JSON.stringify(submission.body)}`)
    const submissionId = submission.body.submission.id

    const graded = await ctx.api('POST', `/api/submissions/${submissionId}/task-grades`, {
      token: fixture.trainer1.token,
      body: { grades: [{ taskId, score: 100 }] },
    })
    if (graded.status !== 200) throw new Error(`task grade failed: ${JSON.stringify(graded.body)}`)

    const released = await ctx.api('POST', `/api/submissions/${submissionId}/grade`, {
      token: fixture.trainer1.token,
      body: { score },
    })
    if (released.status !== 200) throw new Error(`grade failed: ${JSON.stringify(released.body)}`)
  }

  beforeAll(async () => {
    ctx = await startTestServer()
    fixture = await seedFixture(ctx)
    programOneDay = await seedProgram(ctx, fixture, {
      trainerId: fixture.trainer1.id,
      enrollStudents: [fixture.student1.id, fixture.student2.id],
    })
    assignmentOneDay = await seedAssignment(ctx, fixture, programOneDay, { maxMarks: 100, rubricItems: [] })
    const tasks = await setAssignmentTasks(ctx, fixture.trainer1.token, assignmentOneDay, [
      { prompt: 'Submit the completed project deliverable', format: 'url', maxMarks: 100 },
    ])
    taskOneDay = tasks[0].id
    const rules = await configureRules(programOneDay, fixture.admin.token, {
      programKind: 'one_day_project',
      certificateEnabled: true,
      certificateType: '1-Day Project Completion',
      passingPercent: 60,
      requireAllModules: true,
      requireAllAssignments: true,
      requireFinalAssessment: true,
      finalAssignmentId: assignmentOneDay,
      signatoryName: 'Dr. Kavita Nair',
      signatoryTitle: 'Dean, TKSR Learning',
    })
    if (rules.status !== 200) throw new Error(`rules failed: ${JSON.stringify(rules.body)}`)
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('starts ineligible and lists the outstanding requirements', async () => {
    const res = await ctx.api<{ data: EligibilityEntry[] }>('GET', '/api/my/certificate-eligibility', {
      token: fixture.student1.token,
    })
    expect(res.status).toBe(200)
    const entry = res.body.data.find((item) => item.programId === programOneDay)!
    expect(entry).toBeTruthy()
    expect(entry.eligible).toBe(false)
    expect(entry.lessons.satisfied).toBe(false)
    expect(entry.reasons.length).toBeGreaterThan(0)
  })

  it('a partial submission does not unlock eligibility', async () => {
    const partial = await submitTaskWork(ctx, fixture.student1.token, assignmentOneDay, [
      { taskId: taskOneDay, responseText: 'Work in progress.' },
    ])
    expect(partial.status).toBe(201)

    const res = await ctx.api<{ data: EligibilityEntry[] }>('GET', '/api/my/certificate-eligibility', {
      token: fixture.student1.token,
    })
    const entry = res.body.data.find((item) => item.programId === programOneDay)!
    expect(entry.eligible).toBe(false)
    expect(entry.assignments.satisfied).toBe(false)
  })

  it('blocks self-issuance while ineligible', async () => {
    const attempt = await ctx.api<{ error: { message: string } }>(
      'POST',
      `/api/my/programs/${programOneDay}/certificate`,
      { token: fixture.student1.token },
    )
    expect(attempt.status).toBe(409)
    expect(attempt.body.error.message).toMatch(/not eligible/i)
  })

  it('becomes eligible after all lessons and a passing final assessment', async () => {
    await completeAndGrade(programOneDay, assignmentOneDay, taskOneDay, fixture.student1.token, 82)

    const res = await ctx.api<{ data: EligibilityEntry[] }>('GET', '/api/my/certificate-eligibility', {
      token: fixture.student1.token,
    })
    const entry = res.body.data.find((item) => item.programId === programOneDay)!
    expect(entry.eligible).toBe(true)
    expect(entry.lessons.satisfied).toBe(true)
    expect(entry.assignments.satisfied).toBe(true)
  })

  it('issues the personalized 1-Day certificate and is idempotent on re-issue', async () => {
    const first = await ctx.api<{ certificate: CertificateDto; created: boolean }>(
      'POST',
      `/api/my/programs/${programOneDay}/certificate`,
      { token: fixture.student1.token },
    )
    expect(first.status).toBe(201)
    expect(first.body.created).toBe(true)
    certificate = first.body.certificate
    expect(certificate.studentName).toBe(fixture.student1.name)
    expect(certificate.programTitle).toBe('Test AI Program')
    expect(certificate.certificateTitle).toMatch(/1-Day Project Completion Certificate/)
    expect(certificate.certificateId).toMatch(/^TKSR-1D-\d{4}-[0-9A-F]{6}$/)
    expect(certificate.verificationUrl).toContain(certificate.verificationCode)

    const second = await ctx.api<{ certificate: CertificateDto; created: boolean }>(
      'POST',
      `/api/my/programs/${programOneDay}/certificate`,
      { token: fixture.student1.token },
    )
    expect(second.status).toBe(200)
    expect(second.body.created).toBe(false)
    expect(second.body.certificate.certificateId).toBe(certificate.certificateId)
  })

  it('lists issued certificates and eligibility for staff', async () => {
    const res = await ctx.api<{
      certificates: CertificateDto[]
      students: { studentId: number; eligible: boolean; certificateIssued: boolean; certificateId: string | null }[]
    }>('GET', `/api/programs/${programOneDay}/certificates`, { token: fixture.trainer1.token })
    expect(res.status).toBe(200)
    expect(res.body.certificates).toHaveLength(1)
    const mine = res.body.students.find((item) => item.studentId === fixture.student1.id)!
    expect(mine.certificateIssued).toBe(true)
    expect(mine.certificateId).toBe(certificate.certificateId)
    const other = res.body.students.find((item) => item.studentId === fixture.student2.id)!
    expect(other.eligible).toBe(false)
  })

  it('lets only the owner or staff download the PDF', async () => {
    const crossStudent = await fetch(`${ctx.baseUrl}/api/certificates/${certificate.id}/download`, {
      headers: { Authorization: `Bearer ${fixture.student2.token}` },
    })
    expect(crossStudent.status).toBe(403)

    const owner = await fetch(`${ctx.baseUrl}/api/certificates/${certificate.id}/download`, {
      headers: { Authorization: `Bearer ${fixture.student1.token}` },
    })
    expect(owner.status).toBe(200)
    expect(owner.headers.get('content-type')).toContain('application/pdf')
    expect(owner.headers.get('content-disposition')).toContain(certificate.certificateId)
    const bytes = new Uint8Array(await owner.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1000)
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')

    const staff = await fetch(`${ctx.baseUrl}/api/certificates/${certificate.id}/download`, {
      headers: { Authorization: `Bearer ${fixture.admin.token}` },
    })
    expect(staff.status).toBe(200)
  })

  it('serves a public verification page and rejects unknown codes', async () => {
    const verified = await ctx.api<{ verified: boolean; certificate: { studentName: string } }>(
      'GET',
      `/api/public/certificates/${certificate.verificationCode}`,
    )
    expect(verified.status).toBe(200)
    expect(verified.body.certificate.studentName).toBe(fixture.student1.name)

    const unknown = await ctx.api('GET', '/api/public/certificates/NOT-A-REAL-CODE')
    expect(unknown.status).toBe(404)
  })

  it('enforces trainer approval when the program requires it', async () => {
    const program = await seedProgram(ctx, fixture, {
      trainerId: fixture.trainer1.id,
      enrollStudents: [fixture.student1.id],
    })
    const assignment = await seedAssignment(ctx, fixture, program, { maxMarks: 100, rubricItems: [] })
    const tasks = await setAssignmentTasks(ctx, fixture.trainer1.token, assignment, [
      { prompt: 'Approval-gated deliverable', maxMarks: 100 },
    ])
    const configured = await configureRules(program, fixture.admin.token, {
      programKind: 'seven_day_project',
      certificateEnabled: true,
      passingPercent: 50,
      requireAllModules: true,
      requireAllAssignments: true,
      requireFinalAssessment: true,
      finalAssignmentId: assignment,
      requireTrainerApproval: true,
    })
    expect(configured.status).toBe(200)

    await completeAndGrade(program, assignment, tasks[0].id, fixture.student1.token, 90)

    const before = await ctx.api<{ data: EligibilityEntry[] }>('GET', '/api/my/certificate-eligibility', {
      token: fixture.student1.token,
    })
    expect(before.body.data.find((item) => item.programId === program)!.eligible).toBe(false)

    const approval = await ctx.api('POST', `/api/programs/${program}/approvals`, {
      token: fixture.trainer1.token,
      body: { studentId: fixture.student1.id, note: 'Final demo reviewed.' },
    })
    expect(approval.status).toBe(200)

    const after = await ctx.api<{ data: EligibilityEntry[] }>('GET', '/api/my/certificate-eligibility', {
      token: fixture.student1.token,
    })
    expect(after.body.data.find((item) => item.programId === program)!.eligible).toBe(true)

    const issued = await ctx.api<{ certificate: CertificateDto }>(
      'POST',
      `/api/my/programs/${program}/certificate`,
      { token: fixture.student1.token },
    )
    expect(issued.status).toBe(201)
    expect(issued.body.certificate.certificateTitle).toMatch(/7-Day Project Completion Certificate/)
    expect(issued.body.certificate.certificateId).toMatch(/^TKSR-7D-\d{4}-[0-9A-F]{6}$/)
  })

  it('keeps certificates disabled until the program is configured', async () => {
    // A program created without a completion-rules row has `certificate_enabled = 0`.
    // Even when all lessons and assignments are complete, eligibility must stay false
    // and issuance blocked until an admin enables certificates through the API.
    const program = await seedProgram(ctx, fixture, {
      trainerId: fixture.trainer1.id,
      enrollStudents: [fixture.student1.id],
    })
    const assignment = await seedAssignment(ctx, fixture, program, { maxMarks: 100, rubricItems: [] })
    const tasks = await setAssignmentTasks(ctx, fixture.trainer1.token, assignment, [
      { prompt: 'Ungated deliverable', maxMarks: 100 },
    ])
    await completeAndGrade(program, assignment, tasks[0].id, fixture.student1.token, 90)

    const before = await ctx.api<{ data: EligibilityEntry[] }>('GET', '/api/my/certificate-eligibility', {
      token: fixture.student1.token,
    })
    const entry = before.body.data.find((item) => item.programId === program)!
    expect(entry.lessons.satisfied).toBe(true)
    expect(entry.assignments.satisfied).toBe(true)
    expect(entry.certificateEnabled).toBe(false)
    expect(entry.eligible).toBe(false)
    expect(entry.reasons).toContain('Certificates are not enabled for this program.')

    const blocked = await ctx.api('POST', `/api/my/programs/${program}/certificate`, {
      token: fixture.student1.token,
    })
    expect(blocked.status).toBe(409)

    // Enabling is a single-field config change through the existing API.
    const enabled = await configureRules(program, fixture.admin.token, { certificateEnabled: true })
    expect(enabled.status).toBe(200)

    const after = await ctx.api<{ data: EligibilityEntry[] }>('GET', '/api/my/certificate-eligibility', {
      token: fixture.student1.token,
    })
    const afterEntry = after.body.data.find((item) => item.programId === program)!
    expect(afterEntry.certificateEnabled).toBe(true)
    expect(afterEntry.eligible).toBe(true)

    const issued = await ctx.api('POST', `/api/my/programs/${program}/certificate`, {
      token: fixture.student1.token,
    })
    expect(issued.status).toBe(201)
  })
})
