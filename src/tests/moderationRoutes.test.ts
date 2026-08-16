import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vite-plus/test'
import { registerApiRoutes } from '../api/routes'

const authContext = vi.hoisted(() => ({ current: null as null | { user: { id: string; name: string; email: string; image: null }; role: 'user' | 'admin' | 'super-admin'; banned: boolean; nameChangeCooldownDays: null } }))

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
})
