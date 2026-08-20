import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vite-plus/test'
import { registerApiRoutes } from '../api/routes'

const authContext = vi.hoisted(() => ({
  current: null as null | { user: { id: string; name: string; email: string; image: null }; role: 'user' | 'admin' | 'super-admin'; banned: boolean; nameChangeCooldownDays: null },
}))

vi.mock('../auth/authorization', () => ({
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
  tryGetAuthContext: vi.fn(async () => authContext.current),
}))

function testApp() {
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  registerApiRoutes(app as never)
  return app
}

const env = {
  DB: {} as D1Database,
  DB_AUTH: {} as D1Database,
  BETTER_AUTH_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: 'test-google-id',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  GITHUB_CLIENT_ID: 'test-github-id',
  GITHUB_CLIENT_SECRET: 'test-github-secret',
} as never

describe('moderation API authorization', () => {
  it('returns 401 for an anonymous appeal submission', async () => {
    authContext.current = null
    const response = await testApp().request('/api/appeals', { method: 'POST', body: JSON.stringify({ appeal_type: 'account_ban', message: '請複核' }) }, env)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when a signed-in non-admin accesses the appeal queue', async () => {
    authContext.current = {
      user: { id: 'user-1', name: 'User', email: 'user@example.com', image: null },
      role: 'user',
      banned: false,
      nameChangeCooldownDays: null,
    }
    const response = await testApp().request('/api/admin/moderation/appeals', undefined, env)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })

  it('lets a banned user list their appealable reports and account action', async () => {
    authContext.current = {
      user: { id: 'user-1', name: 'User', email: 'user@example.com', image: null },
      role: 'user',
      banned: true,
      nameChangeCooldownDays: null,
    }
    const report = {
      id: 7,
      policy_code: 'spam',
      submission_type: 'opinion',
      content_snapshot: '{"summary":"test"}',
      description: 'test rationale',
      review_status: 'pending',
      created_at: '2026-08-17 00:00:00',
    }
    const fakeDb = {
      prepare(sql: string) {
        return {
          bind() {
            return this
          },
          async all() {
            return { results: sql.includes('FROM ct_abuse_reports r') ? [report] : [] }
          },
          async first() {
            return { cnt: 0 }
          },
        }
      },
    }

    const testEnv = Object.assign({}, env, { DB: fakeDb as unknown as D1Database }) as never
    const response = await testApp().request('/api/me/appealable-moderation-items', undefined, testEnv)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ account_ban: true, reports: [report] })
  })
})
