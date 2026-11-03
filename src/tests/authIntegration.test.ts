import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { makeSignature } from 'better-auth/crypto'
import { Hono } from 'hono'
import { registerAuthRoutes } from '../api/auth'
import type { AppBindings } from '../api/types'
import { createAuth } from '../auth/createAuth'

// Better Auth 在 test mode 預設略過 origin 檢查；匯入前恢復實際開發環境的安全邊界。
vi.hoisted(() => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('TEST', 'false')
})

afterAll(() => vi.unstubAllEnvs())

const ORIGIN = 'https://auth-integration.example.invalid'
const SECRET = 'auth-integration-only-7e9fa2dca0c945ebb0f60ea93d276a81'

async function createFixture() {
  // 每個案例獨立資料；僅在 fixture 將官方 adapter 放入本站的 D1 binding 型別。
  const DB_AUTH = memoryAdapter({ user: [], session: [], account: [], verification: [] }) as unknown as AppBindings['DB_AUTH']
  const env: AppBindings = {
    DB_AUTH,
    DB: DB_AUTH,
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'integration-google-client',
    GOOGLE_CLIENT_SECRET: 'integration-google-secret',
    GITHUB_CLIENT_ID: 'integration-github-client',
    GITHUB_CLIENT_SECRET: 'integration-github-secret',
    FACT_CHECK_CORE: {
      async fetch() {
        throw new Error('認證整合測試不得呼叫事實查核服務')
      },
      connect() {
        throw new Error('認證整合測試不得建立外部連線')
      },
    },
  }
  const auth = createAuth(env)
  const context = await auth.$context
  const app = new Hono<{ Bindings: AppBindings }>()
  registerAuthRoutes(app)

  function request(path: string, init?: RequestInit) {
    return app.request(`${ORIGIN}/api/auth${path}`, init, env)
  }

  function post(path: string, body: unknown, cookie?: string) {
    return request(path, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    })
  }

  async function signedIn(role: 'user' | 'admin' | 'super-admin' = 'user') {
    const user = await context.internalAdapter.createUser({ name: `${role} 測試使用者`, email: `${crypto.randomUUID()}@example.invalid`, emailVerified: true, role }, { method: 'admin' })
    const session = await context.internalAdapter.createSession(user.id)
    const signature = await makeSignature(session.token, SECRET)
    const cookieName = context.authCookies.sessionToken.name
    const cookie = `${cookieName}=${encodeURIComponent(`${session.token}.${signature}`)}`
    return { user, session, signature, cookieName, cookie, headers: new Headers({ Cookie: cookie, Origin: ORIGIN }) }
  }

  return { auth, context, request, post, signedIn }
}

describe('本站設定的真實 Better Auth 整合', () => {
  // 只封鎖外部傳輸，不替換 Better Auth 或本站 handler；若回調越過 state 驗證便會失敗。
  const networkFetch = vi.fn(async () => {
    throw new Error('認證整合測試不得連線 OAuth provider')
  })

  beforeEach(() => {
    networkFetch.mockClear()
    vi.stubGlobal('fetch', networkFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    expect(networkFetch).not.toHaveBeenCalled()
  })

  it('讀取有效簽章 cookie、拒絕竄改簽章，登出後重播原 cookie 也不能恢復 session', async () => {
    const fixture = await createFixture()
    const actor = await fixture.signedIn()
    const sessionResponse = await fixture.request('/get-session', { headers: actor.headers })
    expect(sessionResponse.status).toBe(200)
    await expect(sessionResponse.json()).resolves.toMatchObject({ user: { id: actor.user.id }, session: { id: actor.session.id } })

    const badSignature = `${actor.signature[0] === 'A' ? 'B' : 'A'}${actor.signature.slice(1)}`
    const tampered = `${actor.cookieName}=${encodeURIComponent(`${actor.session.token}.${badSignature}`)}`
    const rejected = await fixture.request('/get-session', { headers: { Cookie: tampered } })
    expect(rejected.status).toBe(200)
    await expect(rejected.json()).resolves.toBeNull()

    const signOut = await fixture.post('/sign-out', {}, actor.cookie)
    expect(signOut.status).toBe(200)
    await expect(signOut.json()).resolves.toMatchObject({ success: true })
    expect(signOut.headers.get('set-cookie')).toContain(`${actor.cookieName}=`)
    expect(signOut.headers.get('set-cookie')).toContain('Max-Age=0')
    const replay = await fixture.request('/get-session', { headers: actor.headers })
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toBeNull()
  })

  it.each([
    { provider: 'google', authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth', clientId: 'integration-google-client' },
    { provider: 'github', authorizationURL: 'https://github.com/login/oauth/authorize', clientId: 'integration-github-client' },
  ])('$provider 產生真實授權 URL，並將同源返回位置保存在 OAuth state', async ({ provider, authorizationURL, clientId }) => {
    const fixture = await createFixture()
    const callbackURL = `${ORIGIN}/issues/42?tab=comments#opinion-6`
    const response = await fixture.post('/sign-in/social', { provider, callbackURL, disableRedirect: true })
    expect(response.status).toBe(200)
    const result = (await response.json()) as { url: string; redirect: boolean }
    expect(result.redirect).toBe(false)
    const url = new URL(result.url)
    expect(`${url.origin}${url.pathname}`).toBe(authorizationURL)
    expect(url.searchParams.get('client_id')).toBe(clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/${provider}`)
    expect(url.searchParams.get('response_type')).toBe('code')
    const state = url.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(response.headers.get('set-cookie')).toBeTruthy()

    // 直接檢查實際發起流程所寫入的 state，而非重複測設定值；不兌換外部授權碼。
    const verification = await fixture.context.internalAdapter.findVerificationValue(`auth-state:${state}`)
    expect(verification).not.toBeNull()
    expect(JSON.parse(verification!.value)).toMatchObject({ callbackURL, oauthState: state })
  })

  it('拒絕外部 callbackURL，不產生可繼續登入的授權 URL', async () => {
    const fixture = await createFixture()
    const response = await fixture.post('/sign-in/social', { provider: 'google', callbackURL: 'https://attacker.example.invalid/return' })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_CALLBACK_URL' })
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('真實發起取得的有效 state 缺少發起 cookie 時，在兌換授權碼之前拒絕回調且不登入', async () => {
    const fixture = await createFixture()
    const signIn = await fixture.post('/sign-in/social', { provider: 'google', callbackURL: `${ORIGIN}/issues/42`, disableRedirect: true })
    expect(signIn.status).toBe(200)
    const { url } = (await signIn.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')
    expect(state).toBeTruthy()
    expect(signIn.headers.get('set-cookie')).toBeTruthy()
    const verification = await fixture.context.internalAdapter.findVerificationValue(`auth-state:${state}`)
    expect(verification).not.toBeNull()

    const callback = await fixture.request(`/callback/google?${new URLSearchParams({ state: state!, code: 'not-a-real-provider-code' })}`)
    expect(callback.status).toBe(302)
    const location = new URL(callback.headers.get('location')!)
    expect(location.origin).toBe(ORIGIN)
    expect(location.pathname).toBe('/api/auth/error')
    expect(location.searchParams.get('error')).toBe('state_mismatch')
    expect(callback.headers.get('set-cookie') ?? '').not.toContain(`${fixture.context.authCookies.sessionToken.name}=`)
    const session = await fixture.request('/get-session')
    await expect(session.json()).resolves.toBeNull()
  })

  it('server admin API 只有 super-admin 能停權，且停權會撤銷目標的既有 session', async () => {
    const fixture = await createFixture()
    const target = await fixture.signedIn()
    const body = { userId: target.user.id, banReason: '整合測試停權' }

    for (const role of ['user', 'admin'] as const) {
      const actor = await fixture.signedIn(role)
      await expect(fixture.auth.api.banUser({ body, headers: actor.headers })).rejects.toMatchObject({
        status: 'FORBIDDEN',
        body: { code: 'YOU_ARE_NOT_ALLOWED_TO_BAN_USERS' },
      })
    }
    const stillSignedIn = await fixture.request('/get-session', { headers: target.headers })
    await expect(stillSignedIn.json()).resolves.toMatchObject({ user: { id: target.user.id }, session: { id: target.session.id } })

    const superAdmin = await fixture.signedIn('super-admin')
    const result = await fixture.auth.api.banUser({ body, headers: superAdmin.headers })
    expect(result.user).toMatchObject({ id: target.user.id, banned: true, banReason: body.banReason })
    const revoked = await fixture.request('/get-session', { headers: target.headers })
    await expect(revoked.json()).resolves.toBeNull()
  })

  it('已登入 super-admin 仍無法透過本站 HTTP 路由存取任何 admin 端點', async () => {
    const fixture = await createFixture()
    const superAdmin = await fixture.signedIn('super-admin')
    const target = await fixture.signedIn()
    const authenticated = await fixture.request('/get-session', { headers: superAdmin.headers })
    await expect(authenticated.json()).resolves.toMatchObject({ user: { id: superAdmin.user.id, role: 'super-admin' } })

    const list = await fixture.request('/admin/list-users', { headers: superAdmin.headers })
    expect(list.status).toBe(404)
    await expect(list.json()).resolves.toEqual({ error: 'Not found' })
    const ban = await fixture.post('/admin/ban-user', { userId: target.user.id }, superAdmin.cookie)
    expect(ban.status).toBe(404)
    await expect(ban.json()).resolves.toEqual({ error: 'Not found' })
    const unchanged = await fixture.request('/get-session', { headers: target.headers })
    await expect(unchanged.json()).resolves.toMatchObject({ user: { id: target.user.id }, session: { id: target.session.id } })
  })

  it('remote 開發及正式建置保留真實 session，即使正式建置的 mode 名稱是 development', async () => {
    const originalMode = import.meta.env.MODE
    const originalDev = import.meta.env.DEV
    try {
      for (const { mode, dev } of [
        { mode: 'remote', dev: true },
        { mode: 'production', dev: false },
        { mode: 'development', dev: false },
      ]) {
        vi.stubEnv('MODE', mode)
        vi.stubEnv('DEV', dev)
        const fixture = await createFixture()
        const actor = await fixture.signedIn('admin')
        const response = await fixture.request('/get-session', { headers: actor.headers })
        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({ user: { id: actor.user.id, role: 'admin' }, session: { id: actor.session.id } })
      }
    } finally {
      vi.stubEnv('MODE', originalMode)
      vi.stubEnv('DEV', originalDev)
    }
  })
})
