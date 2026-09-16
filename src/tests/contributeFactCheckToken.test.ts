import { describe, expect, it, vi } from 'vite-plus/test'
import app from '../index'
import { issueFactCheckToken, verifyFactCheckToken } from '../lib/factCheckToken'

const SECRET = 'test-civic-talk-key'
const USER_ID = 'user-1'

// 照 factCheckRoute.test.ts 的 hoisted 手法控制 session；getIssue 回固定假議題，
// 讓 /contribute/:id 不需要真的 D1。
const authContext = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; image: null }
    role: 'user' | 'admin' | 'super-admin'
    banned: boolean
    nameChangeCooldownDays: null
  },
}))

vi.mock('../auth/authorization', () => ({
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
  resolveRole: (role: string | null | undefined) => (role === 'admin' || role === 'super-admin' ? role : 'user'),
  tryGetAuthContext: vi.fn(async () => authContext.current),
}))

vi.mock('../db/queries', async importOriginal => {
  const actual = await importOriginal<typeof import('../db/queries')>()
  return {
    ...actual,
    getIssue: vi.fn(async () => ({
      id: 1,
      title: '假議題',
      status: 'collecting',
      summary: null,
      polis_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })),
  }
})

function signedIn() {
  authContext.current = {
    user: { id: USER_ID, name: 'User', email: 'user@example.com', image: null },
    role: 'user',
    banned: false,
    nameChangeCooldownDays: null,
  }
}

function anonymous() {
  authContext.current = null
}

const env = {
  DB: {},
  DB_AUTH: {},
  CIVIC_TALK_API_KEY: SECRET,
  BETTER_AUTH_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: 'test-google-id',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  GITHUB_CLIENT_ID: 'test-github-id',
  GITHUB_CLIENT_SECRET: 'test-github-secret',
} as never

function extractToken(html: string): string {
  // SSR state 以 `factCheckToken:"<token>"` 注入 HTML；匿名時是空字串。
  const match = html.match(/factCheckToken\\?"\s*:\s*"([^"]*)"/)
  return match ? match[1] : ''
}

describe('SSR /contribute/:id 的 factCheckToken 注入（#92）', () => {
  it('已登入時注入的 token 能以該使用者的身分驗過，回應為 private, no-store', async () => {
    signedIn()
    const response = await app.request('/contribute/1', undefined, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')

    const token = extractToken(await response.text())
    expect(token.length).toBeGreaterThan(0)
    expect(await verifyFactCheckToken(SECRET, token, { subject: USER_ID })).toBe('ok')
  })

  it('外站預檢被 fact-check 的同源規則擋掉，而不是被泛用 /api/* 規則接走', async () => {
    // registerFactCheckRoutes 必須排在 registerApiRoutes 的 app.options('/api/*') 之前；
    // 順序被調換或 OPTIONS 路由被刪，這裡會回 204 ＋ ACAO:*（泛用規則），而不是 403。
    const response = await app.request('/api/fact-check', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    }, env)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'FORBIDDEN_ORIGIN' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('同源預檢通過並回 204 與同源 Access-Control-Allow-Origin', async () => {
    const response = await app.request('/api/fact-check', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost' },
    }, env)

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost')
  })

  it('未登入時 factCheckToken 是空字串', async () => {
    anonymous()
    const response = await app.request('/contribute/1', undefined, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(extractToken(await response.text())).toBe('')
  })
})
