import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import app from '../index'

const authState = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; image: null }
    role: 'user'
    banned: boolean
    nameChangeCooldownDays: null
  },
}))

vi.mock('../auth/authorization', async () => {
  const actual = await vi.importActual<typeof import('../auth/authorization')>('../auth/authorization')
  return {
    ...actual,
    tryGetAuthContext: vi.fn(async () => authState.current),
  }
})

const CROSS_SITE = {
  Origin: 'https://evil.vtaiwan.tw',
  'Sec-Fetch-Site': 'same-site',
  Cookie: 'better-auth.session_token=secret',
}

function testEnv(fetch = vi.fn()) {
  return {
    DB: {
      prepare: vi.fn(() => ({
        all: vi.fn(async () => ({ results: [] })),
      })),
    },
    FACT_CHECK_CORE: { fetch },
  } as never
}

function signedInUser() {
  return {
    user: { id: 'user-1', name: 'User', email: 'user@example.com', image: null },
    role: 'user' as const,
    banned: false,
    nameChangeCooldownDays: null,
  }
}

describe('/api/* 全域 csrf 防護', () => {
  beforeEach(() => {
    authState.current = null
    vi.clearAllMocks()
  })

  it('拒絕 sibling origin 的 text/plain fact-check，且不呼叫核心 Worker', async () => {
    authState.current = signedInUser()
    const fetch = vi.fn(async () => Response.json({ ok: true }))
    const response = await app.request(
      'https://civic.vtaiwan.tw/api/fact-check',
      {
        method: 'POST',
        headers: { ...CROSS_SITE, 'Content-Type': 'text/plain' },
        body: JSON.stringify({ text: '待查核主張' }),
      },
      testEnv(fetch)
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden: cross-site request blocked' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('拒絕 sibling origin 無 Content-Type 的 fact-check，且不呼叫核心 Worker', async () => {
    authState.current = signedInUser()
    const fetch = vi.fn(async () => Response.json({ ok: true }))
    const body = new TextEncoder().encode(JSON.stringify({ text: '待查核主張' }))
    const response = await app.request(
      'https://civic.vtaiwan.tw/api/fact-check',
      {
        method: 'POST',
        headers: CROSS_SITE,
        body,
      },
      testEnv(fetch)
    )

    expect(response.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  for (const path of ['/api/issues', '/api/issues/1/opinions']) {
    it(`拒絕 sibling origin 的 text/plain POST ${path}`, async () => {
      authState.current = signedInUser()
      const response = await app.request(
        `https://civic.vtaiwan.tw${path}`,
        {
          method: 'POST',
          headers: { ...CROSS_SITE, 'Content-Type': 'text/plain' },
          body: '{}',
        },
        testEnv()
      )

      expect(response.status).toBe(403)
    })
  }

  it('同源 simple POST 會進入真實端點並交由登入守衛處理', async () => {
    const response = await app.request(
      'https://civic.vtaiwan.tw/api/fact-check',
      {
        method: 'POST',
        headers: {
          Origin: 'https://civic.vtaiwan.tw',
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'text/plain',
        },
        body: '{}',
      },
      testEnv()
    )

    expect(response.status).toBe(401)
  })

  it('無 Origin 的 JSON server-to-server 請求不被 csrf 擋下', async () => {
    const response = await app.request(
      'https://civic.vtaiwan.tw/api/fact-check',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
      testEnv()
    )

    expect(response.status).toBe(401)
  })

  it('跨來源 GET 不被 csrf 擋下', async () => {
    const response = await app.request('https://civic.vtaiwan.tw/api/issues', { headers: { Origin: 'https://example.org', 'Sec-Fetch-Site': 'cross-site' } }, testEnv())

    expect(response.status).toBe(200)
  })

  it('未知 API 回 JSON 404', async () => {
    const response = await app.request('https://civic.vtaiwan.tw/api/does-not-exist', undefined, testEnv())

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
  })
})

describe('公開 GET CORS 邊界', () => {
  const publicPaths = [
    ['/api/issues', 200],
    ['/api/issues/not-an-id', 400],
    ['/api/issues/not-an-id/materials', 400],
    ['/api/issues/not-an-id/briefing', 400],
    ['/api/issues/not-an-id/opinions', 400],
  ] as const

  for (const [path, status] of publicPaths) {
    it(`${path} 允許匿名跨來源讀取但不開 credentials`, async () => {
      const response = await app.request(`https://civic.vtaiwan.tw${path}`, { headers: { Origin: 'https://example.org' } }, testEnv())

      expect(response.status).toBe(status)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    })
  }

  it('管理端回應不含 CORS 放行標頭', async () => {
    const response = await app.request('https://civic.vtaiwan.tw/api/admin/stats', { headers: { Origin: 'https://example.org' } }, testEnv())

    expect(response.status).toBe(401)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('寫入端點的 preflight 不含 CORS 放行標頭', async () => {
    const response = await app.request(
      'https://civic.vtaiwan.tw/api/fact-check',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.org',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      },
      testEnv()
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden: cross-site request blocked' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Methods')).toBeNull()
  })
})
