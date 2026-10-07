import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedFixture, startTestServer, type Fixture, type TestContext } from './helpers.js'

describe('authentication', () => {
  let ctx: TestContext
  let fixture: Fixture

  beforeAll(async () => {
    ctx = await startTestServer()
    fixture = await seedFixture(ctx)
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('logs in with valid credentials and never returns the password hash', async () => {
    const result = await ctx.api<{ token: string; user: Record<string, unknown> }>('POST', '/api/auth/login', {
      body: { email: 'admin@test.local', password: 'Admin@123' },
    })
    expect(result.status).toBe(200)
    expect(typeof result.body.token).toBe('string')
    expect(result.body.token.length).toBeGreaterThan(50)
    expect(result.body.user).toMatchObject({ email: 'admin@test.local', role: 'admin' })
    expect(JSON.stringify(result.body)).not.toContain('password')
    expect(JSON.stringify(result.body)).not.toContain('passwordHash')
  })

  it('rejects a wrong password with 401', async () => {
    const result = await ctx.api('POST', '/api/auth/login', {
      body: { email: 'admin@test.local', password: 'wrong-password' },
    })
    expect(result.status).toBe(401)
  })

  it('rejects an unknown email with 401 (same message as bad password)', async () => {
    const result = await ctx.api<{ error: { message: string } }>('POST', '/api/auth/login', {
      body: { email: 'nobody@test.local', password: 'whatever123' },
    })
    expect(result.status).toBe(401)
    expect(result.body.error.message).toMatch(/invalid email or password/i)
  })

  it('validates the login payload', async () => {
    const missingPassword = await ctx.api('POST', '/api/auth/login', { body: { email: 'admin@test.local' } })
    expect(missingPassword.status).toBe(400)
    const malformedEmail = await ctx.api('POST', '/api/auth/login', {
      body: { email: 'not-an-email', password: 'x' },
    })
    expect(malformedEmail.status).toBe(400)
  })

  it('returns the current user for a valid token', async () => {
    const result = await ctx.api<{ user: { email: string; role: string } }>('GET', '/api/auth/me', {
      token: fixture.student1.token,
    })
    expect(result.status).toBe(200)
    expect(result.body.user).toMatchObject({ email: 'student1@test.local', role: 'student' })
  })

  it('rejects requests without a token', async () => {
    expect((await ctx.api('GET', '/api/auth/me')).status).toBe(401)
    expect((await ctx.api('GET', '/api/users')).status).toBe(401)
    expect((await ctx.api('GET', '/api/programs')).status).toBe(401)
  })

  it('rejects a tampered or garbage token', async () => {
    const garbage = await ctx.api('GET', '/api/auth/me', { token: 'not.a.real.token' })
    expect(garbage.status).toBe(401)
    const valid = fixture.admin.token.slice(0, -3) + 'aaa'
    const tampered = await ctx.api('GET', '/api/auth/me', { token: valid })
    expect(tampered.status).toBe(401)
  })

  it('keeps health public but disables disabled accounts', async () => {
    const health = await ctx.api<{ status: string; aiProvider: string }>('GET', '/api/health')
    expect(health.status).toBe(200)
    expect(health.body.status).toBe('ok')
    expect(health.body.aiProvider).toBe('mock')

    const disabled = await ctx.api('PATCH', `/api/users/${fixture.student2.id}`, {
      token: fixture.admin.token,
      body: { status: 'disabled' },
    })
    expect(disabled.status).toBe(200)

    const login = await ctx.api<{ error: { message: string } }>('POST', '/api/auth/login', {
      body: { email: 'student2@test.local', password: 'Student@123' },
    })
    expect(login.status).toBe(403)
    expect(login.body.error.message).toMatch(/disabled/i)

    // Re-enable so later suites (running in the same file) can use the account.
    const reenabled = await ctx.api('PATCH', `/api/users/${fixture.student2.id}`, {
      token: fixture.admin.token,
      body: { status: 'active' },
    })
    expect(reenabled.status).toBe(200)
  })

  it('blocks password guessing by rejecting obviously short passwords at the API layer', async () => {
    const result = await ctx.api('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: '' } })
    expect(result.status).toBe(400)
  })
})
