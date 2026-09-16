import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { registerApiRoutes } from '../api/routes'

const authContext = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; image: null }
    role: 'user'
    banned: boolean
    nameChangeCooldownDays: null
  },
}))

vi.mock('../auth/authorization', () => ({
  isAdminRole: () => false,
  tryGetAuthContext: vi.fn(async () => authContext.current),
}))

function testApp() {
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  registerApiRoutes(app as never)
  return app
}

function signedInUser(banned = false) {
  return {
    user: { id: 'user-1', name: 'User', email: 'user@example.com', image: null },
    role: 'user' as const,
    banned,
    nameChangeCooldownDays: null,
  }
}

describe('POST /api/fact-check', () => {
  beforeEach(() => {
    authContext.current = null
    vi.restoreAllMocks()
  })

  it('未登入時回 401，且不呼叫核心 Worker', async () => {
    const fetch = vi.fn()
    const response = await testApp().request(
      '/api/fact-check',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '待查核主張' }),
      },
      { FACT_CHECK_CORE: { fetch } } as never
    )

    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('登入後以 Service Binding 串流轉送，不洩漏 session Cookie', async () => {
    authContext.current = signedInUser()
    const coreBody = {
      status: 'completed',
      moderation: { decision: 'allow' },
      verdict: 'supported',
      factuality: 0.9,
      confidence: 0.8,
      feedback: 'ok',
    }
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(_input).toBe('https://fact-check-core/fact-check')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Cookie')).toBeNull()
      expect(new Headers(init?.headers).get('Authorization')).toBeNull()
      await expect(new Response(init?.body).json()).resolves.toEqual({ text: '待查核主張', url: 'https://example.com' })
      return Response.json(coreBody, {
        headers: {
          'Cache-Control': 'no-store',
          'X-Request-Id': 'request-1',
          'X-Fact-Check-Cache': 'MISS',
        },
      })
    })

    const response = await testApp().request(
      '/api/fact-check',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'better-auth.session_token=secret',
        },
        body: JSON.stringify({ text: '待查核主張', url: 'https://example.com' }),
      },
      { FACT_CHECK_CORE: { fetch } } as never
    )

    expect(fetch).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Request-Id')).toBe('request-1')
    expect(response.headers.get('X-Fact-Check-Cache')).toBe('MISS')
    await expect(response.json()).resolves.toEqual(coreBody)
  })

  it('停權帳號回 403', async () => {
    authContext.current = signedInUser(true)
    const fetch = vi.fn()
    const response = await testApp().request('/api/fact-check', { method: 'POST', body: '{}' }, { FACT_CHECK_CORE: { fetch } } as never)

    expect(response.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('Service Binding 故障時回可辨識的 503，且不快取', async () => {
    authContext.current = signedInUser()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetch = vi.fn(async () => {
      throw new Error('binding unavailable')
    })

    const response = await testApp().request('/api/fact-check', { method: 'POST', body: '{}' }, { FACT_CHECK_CORE: { fetch } } as never)

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ status: 'error', error: 'UPSTREAM_UNAVAILABLE' })
  })
})
