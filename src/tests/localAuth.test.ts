import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import app from '../index'
import type { AppBindings } from '../api/types'

const ORIGIN = 'http://localhost:5173'

function isolatedEnv(): AppBindings {
  // 本機停用 Auth 時，即使帶 cookie 也不得碰認證庫或業務寫入。
  const unavailable = new Proxy(
    {},
    {
      get() {
        throw new Error('本機匿名請求不得存取認證資料或執行受保護的寫入')
      },
    }
  )
  return {
    DB: unavailable,
    DB_AUTH: unavailable,
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: 'local-auth-test-only-2ce517ac5cf24440a6d55e765479b419',
    GOOGLE_CLIENT_ID: 'local-google',
    GOOGLE_CLIENT_SECRET: 'local-google-secret',
    GITHUB_CLIENT_ID: 'local-github',
    GITHUB_CLIENT_SECRET: 'local-github-secret',
    FACT_CHECK_CORE: unavailable,
  } as AppBindings
}

function request(path: string, method = 'GET') {
  return app.request(
    `${ORIGIN}${path}`,
    {
      method,
      headers: { Origin: ORIGIN, Cookie: 'better-auth.session_token=must-be-ignored', 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    },
    isolatedEnv()
  )
}

describe('本機開發停用 Auth 的安全邊界', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('MODE', 'development')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('session 查詢回匿名，本站登入狀態回 401，既有 cookie 不會觸發 Auth 初始化', async () => {
    const session = await request('/api/auth/get-session?disableCookieCache=true')
    expect(session.status).toBe(200)
    await expect(session.json()).resolves.toBeNull()
    const me = await request('/api/me')
    expect(me.status).toBe(401)
    await expect(me.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('不啟動登入、OAuth callback 或個人資料更新，auth admin 路徑仍封鎖', async () => {
    for (const [path, method] of [
      ['/api/auth/sign-in/social', 'POST'],
      ['/api/auth/callback/google?state=old-state&code=old-code', 'GET'],
      ['/api/auth/update-user', 'POST'],
    ]) {
      const response = await request(path, method)
      expect(response.status).toBe(503)
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('set-cookie')).toBeNull()
    }
    const admin = await request('/api/auth/admin/list-users')
    expect(admin.status).toBe(404)
  })

  it('停用 Auth 不等於繞過登入，投稿、志願者工具、投票及管理 API 一律拒絕', async () => {
    for (const [path, method] of [
      ['/api/issues', 'POST'],
      ['/api/issues/1/materials', 'POST'],
      ['/api/issues/1/opinions', 'POST'],
      ['/api/issues/1/briefing', 'POST'],
      ['/api/issues/1/prompt', 'GET'],
      ['/api/opinions/1/vote', 'POST'],
      ['/api/fact-check', 'POST'],
      ['/api/admin/stats', 'GET'],
    ]) {
      const response = await request(path, method)
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    }
  })
})
