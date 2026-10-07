import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// Environment defaults — applied before any server module is imported.
process.env.NODE_ENV ??= 'test'
process.env.AI_PROVIDER ??= 'mock'
process.env.JWT_SECRET ??= 'test-secret'
process.env.DATABASE_PATH ??= ':memory:'
process.env.UPLOAD_DIR ??= 'server/data/test-uploads'

export interface ApiResponse<T = Record<string, unknown> | unknown[]> {
  status: number
  body: T
}

export interface RequestOptions {
  token?: string
  body?: unknown
  form?: FormData
  headers?: Record<string, string>
}

export interface TestContext {
  baseUrl: string
  server: Server
  api: <T = Record<string, unknown>>(method: string, path: string, options?: RequestOptions) => Promise<ApiResponse<T>>
  login: (email: string, password: string) => Promise<{ token: string; user: Record<string, unknown> }>
  close: () => Promise<void>
}

/**
 * Boots the real Express app against a fresh in-memory SQLite database with
 * migrations applied. Every test file gets its own isolated server.
 */
export async function startTestServer(): Promise<TestContext> {
  const { initDatabase, closeDatabase } = await import('../src/db/helpers.js')
  const { runMigrations } = await import('../src/db/migrate.js')
  const { createApp } = await import('../src/app.js')

  initDatabase(process.env.DATABASE_PATH ?? ':memory:')
  runMigrations()

  const app = createApp()
  const server = await new Promise<Server>((resolve) => {
    const created = app.listen(0, '127.0.0.1', () => resolve(created))
  })
  const { port } = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${port}`

  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...options.headers }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    let body: string | FormData | undefined
    if (options.form) {
      body = options.form
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body })
    const text = await response.text()
    let parsed: unknown = null
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    return { status: response.status, body: parsed as T }
  }

  async function login(email: string, password: string) {
    const result = await api<{ token: string; user: Record<string, unknown> }>('POST', '/api/auth/login', {
      body: { email, password },
    })
    if (result.status !== 200) {
      throw new Error(`Login failed for ${email}: ${result.status} ${JSON.stringify(result.body)}`)
    }
    return result.body
  }

  return {
    baseUrl,
    server,
    api,
    login,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      closeDatabase()
    },
  }
}

export interface TestUser {
  id: number
  name: string
  email: string
  password: string
  role: 'admin' | 'trainer' | 'student'
  token: string
}

export interface Fixture {
  admin: TestUser
  trainer1: TestUser
  trainer2: TestUser
  student1: TestUser
  student2: TestUser
}

const USER_SPECS = [
  { key: 'admin', name: 'Ada Admin', email: 'admin@test.local', password: 'Admin@123', role: 'admin' },
  { key: 'trainer1', name: 'Tina Trainer', email: 'trainer1@test.local', password: 'Trainer@123', role: 'trainer' },
  { key: 'trainer2', name: 'Tomas Trainer', email: 'trainer2@test.local', password: 'Trainer@123', role: 'trainer' },
  { key: 'student1', name: 'Sam Student', email: 'student1@test.local', password: 'Student@123', role: 'student' },
  { key: 'student2', name: 'Sara Student', email: 'student2@test.local', password: 'Student@123', role: 'student' },
] as const

/**
 * Creates the base accounts directly in the database (there is no public
 * registration endpoint) and returns them with fresh login tokens.
 */
export async function seedFixture(ctx: TestContext): Promise<Fixture> {
  const { get, run } = await import('../src/db/helpers.js')
  const { hashPassword } = await import('../src/middleware/auth.js')

  const roleIds: Record<string, number> = {}
  for (const spec of [
    { name: 'admin', description: 'Full access' },
    { name: 'trainer', description: 'Manages programs' },
    { name: 'student', description: 'Learns programs' },
  ]) {
    run('INSERT INTO roles (name, description) VALUES (?, ?)', spec.name, spec.description)
    roleIds[spec.name] = get<{ id: number }>('SELECT id FROM roles WHERE name = ?', spec.name)!.id
  }

  const users = {} as Record<(typeof USER_SPECS)[number]['key'], TestUser>
  for (const spec of USER_SPECS) {
    const passwordHash = await hashPassword(spec.password)
    const result = run(
      'INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)',
      spec.name,
      spec.email,
      passwordHash,
      roleIds[spec.role],
    )
    const { token } = await ctx.login(spec.email, spec.password)
    users[spec.key] = {
      id: result.lastInsertRowid,
      name: spec.name,
      email: spec.email,
      password: spec.password,
      role: spec.role,
      token,
    }
  }

  return {
    admin: users.admin,
    trainer1: users.trainer1,
    trainer2: users.trainer2,
    student1: users.student1,
    student2: users.student2,
  }
}

export interface ProgramOptions {
  trainerId?: number | null
  enrollStudents?: number[]
}

/**
 * Creates a published program with one module (two lessons), a cohort, the
 * requested enrollments, all through the real API.
 */
export async function seedProgram(
  ctx: TestContext,
  fixture: Fixture,
  options: ProgramOptions = {},
): Promise<number> {
  const trainerId = options.trainerId === undefined ? fixture.trainer1.id : options.trainerId
  const created = await ctx.api<{ program: { id: number } }>('POST', '/api/programs', {
    token: fixture.admin.token,
    body: {
      title: 'Test AI Program',
      description: 'A program used by the test suite.',
      level: 'intermediate',
      trainerId,
    },
  })
  if (created.status !== 201) throw new Error(`program create failed: ${JSON.stringify(created.body)}`)
  const programId = created.body.program.id

  const cohort = await ctx.api<{ cohort: { id: number } }>('POST', '/api/cohorts', {
    token: fixture.admin.token,
    body: { programId, name: 'Cohort A' },
  })
  if (cohort.status !== 201) throw new Error(`cohort create failed: ${JSON.stringify(cohort.body)}`)
  const students = options.enrollStudents ?? [fixture.student1.id]
  if (students.length > 0) {
    const enrolled = await ctx.api('POST', `/api/cohorts/${cohort.body.cohort.id}/enrollments`, {
      token: fixture.admin.token,
      body: { studentIds: students },
    })
    if (enrolled.status !== 201) throw new Error(`enroll failed: ${JSON.stringify(enrolled.body)}`)
  }

  // Admin can manage any program, so content creation works for both cases
  // (assigned trainer or no trainer at all).
  const contentToken = fixture.admin.token
  const moduleRes = await ctx.api<{ module: { id: number } }>('POST', `/api/programs/${programId}/modules`, {
    token: contentToken,
    body: { title: 'Module One', description: 'First module' },
  })
  if (moduleRes.status !== 201) throw new Error(`module create failed: ${JSON.stringify(moduleRes.body)}`)
  const moduleId = moduleRes.body.module.id

  for (const [index, title] of ['Lesson One', 'Lesson Two'].entries()) {
    const lesson = await ctx.api('POST', `/api/modules/${moduleId}/lessons`, {
      token: contentToken,
      body: { title, content: `Content for ${title}.`, durationMinutes: 10, position: index },
    })
    if (lesson.status !== 201) throw new Error(`lesson create failed: ${JSON.stringify(lesson.body)}`)
  }

  const published = await ctx.api('PATCH', `/api/programs/${programId}`, {
    token: fixture.admin.token,
    body: { status: 'published' },
  })
  if (published.status !== 200) throw new Error(`program publish failed: ${JSON.stringify(published.body)}`)

  return programId
}

/** Creates and publishes an assignment with a small rubric; returns its id. */
export async function seedAssignment(
  ctx: TestContext,
  fixture: Fixture,
  programId: number,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const created = await ctx.api<{ assignment: { id: number } }>(
    'POST',
    `/api/programs/${programId}/assignments`,
    {
      token: fixture.trainer1.token,
      body: {
        title: 'Test Assignment',
        description: 'Answer the question thoughtfully.',
        maxMarks: 20,
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        rubricItems: [
          { criteria: 'Correctness', description: 'Right answer', maxMarks: 12 },
          { criteria: 'Reasoning', description: 'Shows the work', maxMarks: 8 },
        ],
        ...overrides,
      },
    },
  )
  if (created.status !== 201) throw new Error(`assignment create failed: ${JSON.stringify(created.body)}`)
  const assignmentId = created.body.assignment.id
  const published = await ctx.api('POST', `/api/assignments/${assignmentId}/publish`, {
    token: fixture.trainer1.token,
  })
  if (published.status !== 200) throw new Error(`assignment publish failed: ${JSON.stringify(published.body)}`)
  return assignmentId
}
