import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as authorization from '../auth/authorization'
import app from '../index'

const auth = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; image: null }
    role: 'user' | 'admin'
    banned: boolean
    nameChangeCooldownDays: null
  },
}))

vi.mock('../auth/authorization', async () => {
  const actual = await vi.importActual<typeof authorization>('../auth/authorization')
  return { ...actual, tryGetAuthContext: vi.fn(async () => auth.current) }
})

const jobId = '00000000-0000-0000-0000-000000000001'
const endpoints = [
  ['POST', '/api/issues/7/evidence-jobs'],
  ['GET', '/api/issues/7/evidence-summary?language=zh-TW'],
  ['POST', '/api/issues/7/evidence-summary'],
  ['GET', `/api/evidence-jobs/${jobId}`],
  ['GET', `/api/evidence-jobs/${jobId}/revisions`],
  ['POST', `/api/evidence-jobs/${jobId}/revisions`],
  ['POST', '/api/evidence-maintenance/reconcile'],
  ['POST', '/api/evidence-maintenance/erase'],
] as const

function bindings(db: unknown = { prepare: vi.fn() }) {
  return {
    EVIDENCE_API_ENABLED: '1',
    DB: db,
    DB_AUTH: { prepare: vi.fn() },
    AI: { run: vi.fn() },
    EVIDENCE_WORKFLOW: { create: vi.fn(), get: vi.fn() },
    BETTER_AUTH_URL: 'http://localhost',
    BETTER_AUTH_SECRET: 'unit-test-secret',
    GOOGLE_CLIENT_ID: 'unit-test-google',
    GOOGLE_CLIENT_SECRET: 'unit-test-google-secret',
    GITHUB_CLIENT_ID: 'unit-test-github',
    GITHUB_CLIENT_SECRET: 'unit-test-github-secret',
  }
}

function send(method: string, path: string, env: unknown, body: unknown = {}) {
  return app.request(
    `http://localhost${path}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    },
    env as never
  )
}

class TestD1 {
  readonly sqlite = new DatabaseSync(':memory:')

  constructor(sql: string) {
    this.sqlite.exec(sql)
  }

  prepare(sql: string) {
    const sqlite = this.sqlite
    return {
      async all<T>() {
        return { results: sqlite.prepare(sql).all() as T[] }
      },
      bind(...values: SQLInputValue[]) {
        return {
          async first<T>() {
            return (sqlite.prepare(sql).get(...values) ?? null) as T | null
          },
          async all<T>() {
            return { results: sqlite.prepare(sql).all(...values) as T[] }
          },
        }
      },
    }
  }
}

const sourceTables = `
  CREATE TABLE ct_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, abuse_flagged INTEGER);
  CREATE TABLE ct_materials (id INTEGER PRIMARY KEY, issue_id INTEGER, abuse_flagged INTEGER);
`

beforeEach(() => {
  auth.current = null
  vi.clearAllMocks()
})

describe('正式 Worker 的證據 API 邊界', () => {
  it.each([undefined, '0', 'true', '01'])('未明確啟用（%s）時所有操作都是 404，不碰認證或服務', async flag => {
    const touched: string[] = []
    const env = new Proxy(
      { EVIDENCE_API_ENABLED: flag },
      {
        get(target, key, receiver) {
          if (['DB', 'DB_AUTH', 'SOURCE_DB', 'AI', 'EVIDENCE_WORKFLOW'].includes(String(key))) touched.push(String(key))
          return Reflect.get(target, key, receiver)
        },
      }
    )
    for (const [method, path] of endpoints) {
      // 同源請求維持不可見，且不進入認證或任何能力。
      const response = await app.request(
        `http://localhost${path}`,
        {
          method,
          headers: { 'Content-Type': 'text/plain', Origin: 'http://localhost' },
          ...(method === 'GET' ? {} : { body: '{}' }),
        },
        env as never
      )
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    }
    expect(touched).toEqual([])
    expect(authorization.tryGetAuthContext).not.toHaveBeenCalled()
  })

  it('關閉時跨站寫入仍與其他 API 一樣先被全域 CSRF 擋下', async () => {
    const touched: string[] = []
    const env = new Proxy(
      { EVIDENCE_API_ENABLED: '0' },
      {
        get(target, key, receiver) {
          if (['DB', 'DB_AUTH', 'SOURCE_DB', 'AI', 'EVIDENCE_WORKFLOW'].includes(String(key))) touched.push(String(key))
          return Reflect.get(target, key, receiver)
        },
      }
    )
    const paths = endpoints.filter(([method]) => method === 'POST').map(([, path]) => path)
    for (const path of [...paths, '/api/not-an-endpoint']) {
      const response = await app.request(
        `http://localhost${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain', Origin: 'https://other.example' },
          body: '{}',
        },
        env as never
      )
      expect(response.status, path).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden: cross-site request blocked' })
    }
    expect(touched).toEqual([])
    expect(authorization.tryGetAuthContext).not.toHaveBeenCalled()
  })

  it('預設關閉時原有 API 仍使用既有認證與錯誤回應', async () => {
    const env = { EVIDENCE_API_ENABLED: '0' }
    const existing = await send('POST', '/api/fact-check', env)
    expect(existing.status).toBe(401)
    await expect(existing.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(authorization.tryGetAuthContext).toHaveBeenCalledOnce()
    const unknownIssue = await send('GET', '/api/issues/not-an-id', env)
    expect(unknownIssue.status).toBe(400)
    expect(unknownIssue.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('缺少任一必要服務或認證設定時所有操作均 fail closed，且不查使用者', async () => {
    for (const key of ['DB', 'DB_AUTH', 'AI', 'EVIDENCE_WORKFLOW', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) {
      const env: Record<string, unknown> = bindings()
      delete env[key]
      for (const [method, path] of endpoints) {
        const response = await send(method, path, env)
        expect(response.status, `${key}: ${method} ${path}`).toBe(503)
        await expect(response.json()).resolves.toEqual({ error: 'service_unavailable' })
      }
    }
    expect(authorization.tryGetAuthContext).not.toHaveBeenCalled()
  })

  it('啟用且服務齊備後，所有操作共用真實路由的登入守衛', async () => {
    const prepare = vi.fn()
    const env = bindings({ prepare })
    for (const [method, path] of endpoints) {
      const response = await send(method, path, env)
      expect(response.status, `${method} ${path}`).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Vary')).toContain('Cookie')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    }
    expect(authorization.tryGetAuthContext).toHaveBeenCalledTimes(endpoints.length)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('啟用後仍先阻擋跨站寫入；停權使用者也不能進入證據路由', async () => {
    const prepare = vi.fn()
    const env = bindings({ prepare })
    auth.current = { user: { id: 'banned', name: 'Banned', email: 'banned@example.test', image: null }, role: 'user', banned: true, nameChangeCooldownDays: null }
    for (const path of ['/api/issues/7/evidence-jobs', '/api/issues/7/evidence-summary']) {
      const crossSite = await app.request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Origin: 'https://other.example' },
        body: '{}',
      }, env as never)
      expect(crossSite.status).toBe(403)
      expect(authorization.tryGetAuthContext).not.toHaveBeenCalled()
      const banned = await send('POST', path, env, { consent: true, language: 'zh-TW', expected_version: 0 })
      expect(banned.status).toBe(403)
      await expect(banned.json()).resolves.toEqual({ error: 'Forbidden: account is banned' })
      vi.mocked(authorization.tryGetAuthContext).mockClear()
    }
    expect(prepare).not.toHaveBeenCalled()
  })

  it('證據服務錯誤不洩漏細節，也不覆蓋既有 API 的錯誤處理', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      auth.current = { user: { id: 'owner', name: 'Owner', email: 'owner@example.test', image: null }, role: 'user', banned: false, nameChangeCooldownDays: null }
      const env = bindings({
        prepare() {
          throw new Error('internal database detail')
        },
      })
      const evidence = await send('GET', `/api/evidence-jobs/${jobId}`, env)
      expect(evidence.status).toBe(503)
      await expect(evidence.json()).resolves.toEqual({ error: 'service_unavailable' })
      const existing = await send('GET', '/api/issues/7', env)
      expect(existing.status).toBe(500)
      expect(await existing.text()).not.toContain('internal database detail')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('未覆寫時讀 DB 作來源；明確 SOURCE_DB 時只採用指定來源', async () => {
    const migration = readFileSync(new URL('../../migrations/0017_evidence_pipeline.sql', import.meta.url), 'utf8')
    const local = new TestD1(`${migration}\n${sourceTables}\nINSERT INTO ct_issues VALUES (7, '議題', '說明', 0);`)
    const override = new TestD1(sourceTables)
    try {
      auth.current = { user: { id: 'owner', name: 'Owner', email: 'owner@example.test', image: null }, role: 'user', banned: false, nameChangeCooldownDays: null }
      const env = bindings(local)
      const defaultSource = await send('POST', '/api/issues/7/evidence-jobs', env, { consent: true })
      expect(defaultSource.status).toBe(422)
      await expect(defaultSource.json()).resolves.toEqual({ error: 'no_available_materials', exclusions: [] })
      expect(env).not.toHaveProperty('SOURCE_DB')
      const alternateSource = await send('POST', '/api/issues/7/evidence-jobs', { ...env, SOURCE_DB: override }, { consent: true })
      expect(alternateSource.status).toBe(422)
      await expect(alternateSource.json()).resolves.toEqual({ error: 'issue_unavailable' })
      expect(env.AI.run).not.toHaveBeenCalled()
    } finally {
      local.sqlite.close()
      override.sqlite.close()
    }
  })
  it('匿名、摘要擁有者、其他使用者及管理員的公開 API 與 SSR 都不帶私有摘要欄位', async () => {
    const migrations = readdirSync(new URL('../../migrations/', import.meta.url))
      .filter(name => name.endsWith('.sql'))
      .sort()
      .map(name => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
      .join('\n')
    const local = new TestD1(migrations)
    const secret = 'private-summary-only-210'
    local.sqlite.prepare('UPDATE ct_issues SET ai_summaries = ? WHERE id = 1').run(JSON.stringify({ 'zh-TW': { data: { secret }, owner_id: 'owner' } }))
    try {
      const env = bindings(local)
      for (const current of [
        null,
        { user: { id: 'owner', name: 'Owner', email: 'owner@example.test', image: null }, role: 'user' as const, banned: false, nameChangeCooldownDays: null },
        { user: { id: 'other', name: 'Other', email: 'other@example.test', image: null }, role: 'user' as const, banned: false, nameChangeCooldownDays: null },
        { user: { id: 'admin', name: 'Admin', email: 'admin@example.test', image: null }, role: 'admin' as const, banned: false, nameChangeCooldownDays: null },
      ]) {
        auth.current = current
        for (const path of ['/api/issues', '/api/issues/1', '/issues/1', '/']) {
          const response = await app.request(`http://localhost${path}`, {}, env as never)
          expect(response.status, path).toBe(200)
          const text = await response.text()
          expect(text, path).not.toContain('ai_summaries')
          expect(text, path).not.toContain(secret)
        }
      }
    } finally {
      local.sqlite.close()
    }
  })
})
