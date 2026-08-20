import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as db from '../db/queries'
import { registerApiRoutes } from '../api/routes'

const auth = vi.hoisted(() => ({
  context: {
    user: { id: 'user-1', name: 'User', email: 'user@example.com', image: null },
    role: 'user' as const,
    banned: false,
    nameChangeCooldownDays: null,
  },
}))

vi.mock('../auth/authorization', () => ({
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
  tryGetAuthContext: vi.fn(async () => auth.context),
}))

vi.mock('../db/queries', () => ({
  createAbuseReport: vi.fn(async () => null),
}))

function testApp() {
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  registerApiRoutes(app as never)
  return app
}

describe('abuse report route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 409 when the atomic write finds an existing pending report', async () => {
    const response = await testApp().request(
      '/api/abuse-reports',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ material_id: 4, reason: 'spam' }),
      },
      { DB: {} } as never
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '此內容已有待審核的回報，請等待管理員處理後再回報' })
    expect(vi.mocked(db.createAbuseReport)).toHaveBeenCalledOnce()
  })
})
