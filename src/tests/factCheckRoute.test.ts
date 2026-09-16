import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vite-plus/test'
import { registerFactCheckRoutes } from '../api/factCheck'
import { FACT_CHECK_TOKEN_HEADER, FACT_CHECK_TOKEN_TTL_SECONDS, issueFactCheckToken, verifyFactCheckToken } from '../lib/factCheckToken'
import { FACT_CHECK_RATE_LIMIT } from '../lib/factCheckRateLimit'

const SECRET = 'test-civic-talk-key'
const ORIGIN = 'https://civic.vtaiwan.tw'
const ENDPOINT = `${ORIGIN}/api/fact-check`
const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'

// session 一律走 tryGetAuthContext mock（照 moderationRoutes.test.ts 的做法），
// 不在測試裡重演 Better Auth 的實際 session 解析。
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
  tryGetAuthContext: vi.fn(async () => authContext.current),
}))

function signedIn(overrides: { id?: string; banned?: boolean } = {}) {
  authContext.current = {
    user: { id: overrides.id ?? USER_ID, name: 'User', email: 'user@example.com', image: null },
    role: 'user',
    banned: overrides.banned ?? false,
    nameChangeCooldownDays: null,
  }
}

function anonymous() {
  authContext.current = null
}

function testApp() {
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  registerFactCheckRoutes(app as never)
  return app
}

function coreBinding(handler: (init: RequestInit) => Promise<Response>) {
  return { fetch: vi.fn((_input: string, init: RequestInit) => handler(init)) }
}

function envWith(overrides: Record<string, unknown> = {}) {
  // 預設給一顆「永遠放行」的假 D1：限流相關的測試自己覆寫 DB；
  // 其餘測試（守門、轉送、fail-closed）不需要限流行為，但也不該噴 fail-open 的錯誤 log。
  const defaultDb = { prepare: () => ({ bind: () => ({ first: async () => ({ count: 1 }) }) }) } as unknown as D1Database
  return { CIVIC_TALK_API_KEY: SECRET, FACT_CHECK_CORE: coreBinding(async () => passthrough()), DB: defaultDb, ...overrides } as never
}

/** core 的成功回應：本站必須原樣轉出，只加上同源 CORS 與 no-store。 */
function passthrough() {
  return new Response(JSON.stringify({ status: 'completed', moderation: { decision: 'allow' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-Id': 'req-1', 'X-Fact-Check-Cache': 'MISS' },
  })
}

describe('fact-check token', () => {
  it('簽發的 token 可以通過驗證，且每次簽發都不同', async () => {
    const first = await issueFactCheckToken(SECRET, USER_ID)
    const second = await issueFactCheckToken(SECRET, USER_ID)

    expect(await verifyFactCheckToken(SECRET, first, { subject: USER_ID })).toBe('ok')
    expect(first).not.toBe(second)
    expect(first.startsWith('v1.')).toBe(true)
  })

  it('拒絕缺少、格式錯誤、換過密鑰與逾期簽發的 token', async () => {
    const valid = await issueFactCheckToken(SECRET, USER_ID)

    expect(await verifyFactCheckToken(SECRET, null, { subject: USER_ID })).toBe('missing')
    expect(await verifyFactCheckToken(SECRET, 'not-a-token', { subject: USER_ID })).toBe('invalid')
    expect(await verifyFactCheckToken(SECRET, `${valid}x`, { subject: USER_ID })).toBe('invalid')
    expect(await verifyFactCheckToken('another-key', valid, { subject: USER_ID })).toBe('invalid')
    // 逾時：簽發時間往前推超過 TTL
    const stale = await issueFactCheckToken(SECRET, USER_ID, Date.now() - (FACT_CHECK_TOKEN_TTL_SECONDS + 60) * 1000)
    expect(await verifyFactCheckToken(SECRET, stale, { subject: USER_ID })).toBe('expired')
    // 期限超過 TTL（時鐘異常或密鑰外流才會出現）直接視為無效
    const future = await issueFactCheckToken(SECRET, USER_ID, Date.now() + 60_000)
    expect(await verifyFactCheckToken(SECRET, future, { subject: USER_ID })).toBe('invalid')
  })

  it('sub 與驗證時的身分不符一律 invalid：偷來的 token 在別人 session 下無效', async () => {
    const mine = await issueFactCheckToken(SECRET, USER_ID)

    expect(await verifyFactCheckToken(SECRET, mine, { subject: OTHER_USER_ID })).toBe('invalid')
    expect(await verifyFactCheckToken(SECRET, mine, { subject: '' })).toBe('invalid')
  })
})

describe('/api/fact-check', () => {
  it('同源預檢回 204 與可帶自訂標頭的 CORS 標頭', async () => {
    const response = await testApp().request(
      ENDPOINT,
      { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Headers': FACT_CHECK_TOKEN_HEADER } },
      envWith()
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(FACT_CHECK_TOKEN_HEADER)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('擋掉非同源與缺 Origin 的呼叫，且兩者都不會打到 core', async () => {
    anonymous()
    const binding = coreBinding(async () => passthrough())
    const env = envWith({ FACT_CHECK_CORE: binding })
    const token = await issueFactCheckToken(SECRET, USER_ID)

    const foreign = await testApp().request(
      ENDPOINT,
      { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: token }, body: '{"text":"測試"}' },
      env
    )
    const missing = await testApp().request(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"測試"}' }, env)

    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ error: 'FORBIDDEN_ORIGIN' })
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(missing.status).toBe(403)
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('未登入一律 401 UNAUTHORIZED，且不會打到 core', async () => {
    anonymous()
    const binding = coreBinding(async () => passthrough())
    const env = envWith({ FACT_CHECK_CORE: binding })
    const token = await issueFactCheckToken(SECRET, USER_ID)

    const response = await testApp().request(
      ENDPOINT,
      { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: token }, body: '{"text":"測試"}' },
      env
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' })
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('停權帳號回 403 FORBIDDEN，且不會打到 core', async () => {
    signedIn({ banned: true })
    const binding = coreBinding(async () => passthrough())
    const env = envWith({ FACT_CHECK_CORE: binding })
    const token = await issueFactCheckToken(SECRET, USER_ID)

    const response = await testApp().request(
      ENDPOINT,
      { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: token }, body: '{"text":"測試"}' },
      env
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'FORBIDDEN' })
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('token 是別的 user 簽的一律 401 INVALID_TOKEN', async () => {
    signedIn({ id: OTHER_USER_ID })
    const binding = coreBinding(async () => passthrough())
    const env = envWith({ FACT_CHECK_CORE: binding })
    const token = await issueFactCheckToken(SECRET, USER_ID)

    const response = await testApp().request(
      ENDPOINT,
      { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: token }, body: '{"text":"測試"}' },
      env
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'INVALID_TOKEN' })
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('同源但沒有有效 token 一律 401，逾時另回 TOKEN_EXPIRED', async () => {
    signedIn()
    const binding = coreBinding(async () => passthrough())
    const env = envWith({ FACT_CHECK_CORE: binding })

    const withoutToken = await testApp().request(
      ENDPOINT,
      { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{"text":"測試"}' },
      env
    )
    const expired = await testApp().request(
      ENDPOINT,
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          'Content-Type': 'application/json',
          [FACT_CHECK_TOKEN_HEADER]: await issueFactCheckToken(SECRET, USER_ID, Date.now() - (FACT_CHECK_TOKEN_TTL_SECONDS + 60) * 1000),
        },
        body: '{"text":"測試"}',
      },
      env
    )

    expect(withoutToken.status).toBe(401)
    expect(await withoutToken.json()).toEqual({ error: 'INVALID_TOKEN' })
    expect(expired.status).toBe(401)
    expect(await expired.json()).toEqual({ error: 'TOKEN_EXPIRED' })
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('同源＋登入＋有效 token 時把請求轉給 core，並原樣轉出回應與 no-store', async () => {
    signedIn()
    const binding = coreBinding(async (init) => {
      // core 只接受 JSON、只認 POST；body 必須是原封不動的串流
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect(await new Response(init.body).text()).toBe('{"text":"台北市是台灣的首都"}')
      return passthrough()
    })
    const response = await testApp().request(
      ENDPOINT,
      {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: await issueFactCheckToken(SECRET, USER_ID) },
        body: '{"text":"台北市是台灣的首都"}',
      },
      envWith({ FACT_CHECK_CORE: binding })
    )

    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(binding.fetch.mock.calls[0][0]).toBe('https://fact-check-core/fact-check')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('X-Request-Id')).toBe('req-1')
    expect(response.headers.get('X-Fact-Check-Cache')).toBe('MISS')
    expect(await response.json()).toEqual({ status: 'completed', moderation: { decision: 'allow' } })
  })

  it('core 回應錯誤時原樣轉出狀態碼與錯誤內容', async () => {
    signedIn()
    const binding = coreBinding(async () =>
      new Response(JSON.stringify({ status: 'error', error: 'UPSTREAM_UNAVAILABLE', message: '上游服務暫時無法使用。', request_id: 'req-2' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    )
    const response = await testApp().request(
      ENDPOINT,
      {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: await issueFactCheckToken(SECRET, USER_ID) },
        body: '{"text":"測試"}',
      },
      envWith({ FACT_CHECK_CORE: binding })
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'error', error: 'UPSTREAM_UNAVAILABLE', message: '上游服務暫時無法使用。', request_id: 'req-2' })
  })

  it('缺密鑰或 binding 時 fail closed，core 例外時回 502', async () => {
    signedIn()
    const token = await issueFactCheckToken(SECRET, USER_ID)
    const init = { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: token }, body: '{"text":"測試"}' }

    const withoutKey = await testApp().request(ENDPOINT, init, envWith({ CIVIC_TALK_API_KEY: undefined }) as never)
    const withoutBinding = await testApp().request(ENDPOINT, init, envWith({ FACT_CHECK_CORE: undefined }) as never)
    const throwing = await testApp().request(ENDPOINT, init, envWith({ FACT_CHECK_CORE: coreBinding(async () => { throw new Error('binding down') }) }) as never)

    expect(withoutKey.status).toBe(503)
    expect(await withoutKey.json()).toEqual({ error: 'FACT_CHECK_NOT_CONFIGURED' })
    expect(withoutBinding.status).toBe(503)
    expect(await withoutBinding.json()).toEqual({ error: 'FACT_CHECK_UNAVAILABLE' })
    expect(throwing.status).toBe(502)
    expect(await throwing.json()).toEqual({ error: 'FACT_CHECK_UNAVAILABLE' })
  })

  // 照 moderationRoutes.test.ts 的 prepare/bind/first 手法做一顆假 D1；
  // count 序列是「每次查詢回傳的計數」，模擬單一原子敘述的累計行為。
  function fakeDb(counts: number[]) {
    let call = 0
    const prepare = vi.fn((_sql: string) => ({
      bind() {
        return this
      },
      async first() {
        const count = counts[Math.min(call, counts.length - 1)]
        call += 1
        return { count }
      },
    }))
    return { prepare } as unknown as D1Database
  }

  it('限流未超過時照常打到 core（60 次／60 秒，防洪而非配額）', async () => {
    signedIn()
    const binding = coreBinding(async () => passthrough())
    const response = await testApp().request(
      ENDPOINT,
      {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: await issueFactCheckToken(SECRET, USER_ID) },
        body: '{"text":"測試"}',
      },
      envWith({ FACT_CHECK_CORE: binding, DB: fakeDb([1]) })
    )

    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect((binding.fetch.mock.calls[0][1].headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('超限回 429 RATE_LIMITED 與 Retry-After，且不會打到 core', async () => {
    signedIn()
    const binding = coreBinding(async () => passthrough())
    // 視窗起點對齊 epoch；取時間落在視窗中段，Retry-After 應是視窗剩餘秒數（> 1）。
    const nowMs = (Math.floor(1_800_000_000_000 / 60_000) * 60_000) + 20_000
    const counts = Array.from({ length: FACT_CHECK_RATE_LIMIT + 1 }, (_, i) => i + 1)
    const env = envWith({ FACT_CHECK_CORE: binding, DB: fakeDb(counts) })
    const init = {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: await issueFactCheckToken(SECRET, USER_ID) },
      body: '{"text":"測試"}',
    } as const

    let last: Response | undefined
    for (let i = 0; i < FACT_CHECK_RATE_LIMIT; i += 1) {
      last = await testApp().request(ENDPOINT, init, env)
      expect(last.status).toBe(200)
    }
    last = await testApp().request(ENDPOINT, init, env)

    expect(last.status).toBe(429)
    expect(await last.json()).toEqual({ error: 'RATE_LIMITED' })
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(1)
    expect(last.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(binding.fetch).toHaveBeenCalledTimes(FACT_CHECK_RATE_LIMIT)
  })

  it('D1 拋錯時 fail-open：記 log 後照常打到 core', async () => {
    signedIn()
    const binding = coreBinding(async () => passthrough())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwingDb = {
      prepare() {
        throw new Error('d1 down')
      },
    } as unknown as D1Database
    const response = await testApp().request(
      ENDPOINT,
      {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: await issueFactCheckToken(SECRET, USER_ID) },
        body: '{"text":"測試"}',
      },
      envWith({ FACT_CHECK_CORE: binding, DB: throwingDb })
    )

    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('fact_check_rate_limit_error'))
    errorSpy.mockRestore()
  })

  it('D1 UPSERT 回空時 fail-open：記 log 後照常打到 core', async () => {
    signedIn()
    const binding = coreBinding(async () => passthrough())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const emptyDb = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database
    const response = await testApp().request(
      ENDPOINT,
      {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json', [FACT_CHECK_TOKEN_HEADER]: await issueFactCheckToken(SECRET, USER_ID) },
        body: '{"text":"測試"}',
      },
      envWith({ FACT_CHECK_CORE: binding, DB: emptyDb })
    )

    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('fact_check_rate_limit_error'))
    errorSpy.mockRestore()
  })
})
