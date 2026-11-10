import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { apiCsrf } from '../api/csrf'
import { registerApiRoutes } from '../api/routes'
import { countMaterialsForPrompt, listMaterialsForPrompt } from '../db/queries'
import * as moderation from '../moderation/service'

const auth = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; image: null }
    role: 'user' | 'admin'
    banned: boolean
    nameChangeCooldownDays: null
  },
}))

vi.mock('../auth/authorization', () => ({
  tryGetAuthContext: vi.fn(async () => auth.current),
  hasDuplicateDisplayName: vi.fn(async () => false),
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
}))
vi.mock('../auth/createAuth', () => ({ createAuth: vi.fn(() => ({ api: {} })) }))
vi.mock('../moderation/service', () => ({
  moderateSubmission: vi.fn(async () => ({ outcome: 'allow' })),
  moderationReasonForPolicy: vi.fn(() => 'hate_speech'),
  moderateSubmissionWithDiagnostics: vi.fn(),
}))

const migrations = readdirSync(new URL('../../migrations/', import.meta.url))
  .filter(name => name.endsWith('.sql'))
  .sort()
  .map(name => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))

const user = { user: { id: 'user-1', name: 'User', email: 'user@example.test', image: null }, role: 'user' as const, banned: false, nameChangeCooldownDays: null }
const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost' }
type TestApp = Hono<{ Bindings: { DB: D1Database; DB_AUTH: D1Database } }>
let sqlite: DatabaseSync
let db: D1Database
let app: TestApp
let issueId: number
let readResults: unknown[]

// 使用真實 migration 和 SQLite 查詢，並記錄查詢回傳的資料以檢查送出流程不讀素材正文。
function sqliteD1(): D1Database {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      return {
        bind(...values: SQLInputValue[]) {
          return {
            async first<T>() {
              const result = statement.get(...values) ?? null
              readResults.push(result)
              return result as T | null
            },
            async all<T>() {
              const results = statement.all(...values) as T[]
              readResults.push(...results)
              return { results }
            },
            async run() {
              const result = statement.run(...values)
              return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

function seedIssue(title = '測試議題'): number {
  const result = sqlite.prepare('INSERT INTO ct_issues (title, description, status, last_activity_at) VALUES (?, ?, ?, ?)').run(title, '議題說明', 'summarizing', '2001-01-01 00:00:00')
  return Number(result.lastInsertRowid)
}

function seedMaterial(id: number, content: string, flag = 0): void {
  sqlite
    .prepare('INSERT INTO ct_materials (issue_id, source_name, source_url, content, abuse_flagged, author_id, author_email) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, '素材來源', 'https://example.test/source', content, flag, 'private-material-author', 'private-material@example.test')
}

function seedBriefing(id: number): void {
  sqlite
    .prepare('INSERT INTO ct_briefings (issue_id, consensus, disputes, positions, narrative, opinion_prompt, version) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(id, '原有共識', '原有爭點', '原有立場', '原有說明', '原有意見引導')
}

function seedOpinion(id: number): void {
  sqlite.prepare('INSERT INTO ct_opinions (issue_id, summary) VALUES (?, ?)').run(id, '既有公民意見')
}

function send(method: string, path: string, body?: unknown) {
  const env = { DB: db, DB_AUTH: {} as D1Database, OPEN_ROUTER_API_KEY: 'test-key', ASSETS: { fetch: vi.fn() } } as never
  return app.request(`http://localhost${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
}

function state(id: number) {
  return {
    issue: sqlite.prepare('SELECT status, last_activity_at FROM ct_issues WHERE id = ?').get(id),
    briefings: sqlite.prepare('SELECT * FROM ct_briefings WHERE issue_id = ? ORDER BY version').all(id),
    reports: sqlite.prepare('SELECT * FROM ct_abuse_reports ORDER BY id').all(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.current = user
  readResults = []
  sqlite = new DatabaseSync(':memory:')
  for (const migration of migrations) sqlite.exec(migration)
  db = sqliteD1()
  issueId = seedIssue()
  app = new Hono<{ Bindings: { DB: D1Database; DB_AUTH: D1Database } }>()
  app.use('/api/*', apiCsrf)
  registerApiRoutes(app as never)
})

afterEach(() => sqlite.close())

describe('舊版 Prompt 的素材門檻', () => {
  for (const type of ['summarize', 'synthesis'] as const) {
    it.each([0, 1, 2])(`${type} 在 %i 份素材時符合門檻及回應契約`, async count => {
      if (type === 'synthesis') seedBriefing(issueId)
      seedOpinion(issueId)
      for (let index = 0; index < count; index++) seedMaterial(issueId, `合格素材正文 ${index + 1}`)

      const response = await send('GET', `/api/issues/${issueId}/prompt?type=${type}`)
      if (count < 2) {
        expect(response.status).toBe(422)
        expect(await response.json()).toEqual({ error: 'insufficient_materials', minimum: 2, count })
        expect(JSON.stringify(readResults)).not.toContain('合格素材正文')
        expect(JSON.stringify(readResults)).not.toContain('private-material-author')
        expect(JSON.stringify(readResults)).not.toContain('private-material@example.test')
      } else {
        expect(response.status).toBe(200)
        const result = (await response.json()) as { prompt: string; type: string; material_count: number }
        expect(result).toEqual({ prompt: expect.any(String), type, material_count: 2 })
        expect(result.prompt).toContain('合格素材正文 1')
        expect(result.prompt).toContain('合格素材正文 2')
        if (type === 'synthesis') expect(result.prompt).toContain('既有公民意見')
      }
    })
  }

  it('預設的 Prompt 類型也套用相同門檻', async () => {
    seedMaterial(issueId, '一份素材')
    const response = await send('GET', `/api/issues/${issueId}/prompt`)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'insufficient_materials', minimum: 2, count: 1 })
  })

  it.each([1, 2, 3])('flag=%i 與其他議題的素材不計入 Prompt 或提交門檻', async flag => {
    const otherIssue = seedIssue('另一個議題')
    seedMaterial(issueId, '本議題合格素材')
    seedMaterial(issueId, '被標記素材', flag)
    seedMaterial(otherIssue, '其他議題素材')
    seedOpinion(issueId)
    seedBriefing(issueId)

    expect(await countMaterialsForPrompt(db, issueId)).toBe(1)
    expect(await listMaterialsForPrompt(db, issueId)).toHaveLength(1)
    for (const type of ['summarize', 'synthesis']) {
      const response = await send('GET', `/api/issues/${issueId}/prompt?type=${type}`)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'insufficient_materials', minimum: 2, count: 1 })
    }
    const before = state(issueId)
    const rejected = await send('POST', `/api/issues/${issueId}/briefing`, { consensus: '彙整內容' })
    expect(rejected.status).toBe(422)
    expect(await rejected.json()).toEqual({ error: 'insufficient_materials', minimum: 2, count: 1 })
    expect(state(issueId)).toEqual(before)
    expect(moderation.moderateSubmission).not.toHaveBeenCalled()

    seedMaterial(issueId, '第二份合格素材')
    for (const type of ['summarize', 'synthesis']) {
      const response = await send('GET', `/api/issues/${issueId}/prompt?type=${type}`)
      expect(response.status).toBe(200)
      const result = (await response.json()) as { prompt: string; material_count: number }
      expect(result.material_count).toBe(2)
      expect(result.prompt).toContain('第二份合格素材')
      expect(result.prompt).not.toContain('被標記素材')
      expect(result.prompt).not.toContain('其他議題素材')
    }
    const accepted = await send('POST', `/api/issues/${issueId}/briefing`, { consensus: '彙整內容' })
    expect(accepted.status).toBe(201)
    expect(await accepted.json()).toEqual({ version: 2 })
  })

  it('沿用舊素材清單口徑，歷史空正文素材不另外排除', async () => {
    seedMaterial(issueId, '有正文的素材')
    seedMaterial(issueId, '')
    expect(await countMaterialsForPrompt(db, issueId)).toBe(2)
    expect(await listMaterialsForPrompt(db, issueId)).toHaveLength(2)
    const prompt = await send('GET', `/api/issues/${issueId}/prompt?type=summarize`)
    expect(prompt.status).toBe(200)
    expect(await prompt.json()).toEqual({ prompt: expect.any(String), type: 'summarize', material_count: 2 })
    const briefing = await send('POST', `/api/issues/${issueId}/briefing`, { positions: '立場' })
    expect(briefing.status).toBe(201)
    expect(await briefing.json()).toEqual({ version: 1 })
  })

  it('narrative Prompt 仍在零素材回舊錯誤，一份素材且有彙整時仍可產生', async () => {
    seedBriefing(issueId)
    const empty = await send('GET', `/api/issues/${issueId}/prompt?type=narrative`)
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ error: '尚無素材，請先新增素材再生成 Prompt。' })

    seedMaterial(issueId, '一份素材')
    const response = await send('GET', `/api/issues/${issueId}/prompt?type=narrative`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ prompt: expect.any(String), type: 'narrative', material_count: 1 })
  })
})

describe('舊版 briefing 投稿的素材門檻', () => {
  for (const hasBriefing of [false, true]) {
    for (const count of [0, 1]) {
      it.each(['consensus', 'disputes', 'positions'] as const)(`${hasBriefing ? '再彙整' : '初次彙整'} %s 在 ${count} 份素材時不能藉由附帶說明頁繞過門檻`, async field => {
        if (hasBriefing) seedBriefing(issueId)
        if (count === 1) seedMaterial(issueId, 'private-material-body')
        const before = state(issueId)
        const response = await send('POST', `/api/issues/${issueId}/briefing`, { [field]: '更新彙整', narrative: '附帶說明頁', opinion_prompt: '附帶引導' })

        expect(response.status).toBe(422)
        expect(await response.json()).toEqual({ error: 'insufficient_materials', minimum: 2, count })
        expect(moderation.moderateSubmission).not.toHaveBeenCalled()
        expect(state(issueId)).toEqual(before)
        expect(JSON.stringify(readResults)).not.toContain('private-material-body')
        expect(JSON.stringify(readResults)).not.toContain('private-material-author')
        expect(JSON.stringify(readResults)).not.toContain('private-material@example.test')
      })
    }
  }

  it.each([false, true])('兩份合格素材可正常提交及建立預期版本（既有彙整：%s）', async hasBriefing => {
    if (hasBriefing) seedBriefing(issueId)
    seedMaterial(issueId, 'private-material-body 1')
    seedMaterial(issueId, 'private-material-body 2')
    const response = await send('POST', `/api/issues/${issueId}/briefing`, { consensus: '新共識', disputes: '新爭點', positions: '新立場' })
    const version = hasBriefing ? 2 : 1
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ version })
    expect(moderation.moderateSubmission).toHaveBeenCalledTimes(1)
    expect(sqlite.prepare('SELECT consensus, disputes, positions FROM ct_briefings WHERE issue_id = ? AND version = ?').get(issueId, version)).toEqual({
      consensus: '新共識',
      disputes: '新爭點',
      positions: '新立場',
    })
    expect(sqlite.prepare('SELECT status FROM ct_issues WHERE id = ?').get(issueId)).toEqual({ status: 'published' })
    expect(JSON.stringify(readResults)).not.toContain('private-material-body')
    expect(JSON.stringify(readResults)).not.toContain('private-material-author')
    expect(JSON.stringify(readResults)).not.toContain('private-material@example.test')
  })

  for (const count of [0, 1]) {
    it.each(['narrative', 'opinion_prompt'] as const)('僅更新 %s 時，素材數為 ' + count + ' 仍沿用原本的提交行為', async field => {
      seedBriefing(issueId)
      if (count === 1) seedMaterial(issueId, '一份素材')
      const response = await send('POST', `/api/issues/${issueId}/briefing`, {
        consensus: '  ',
        disputes: '\n',
        positions: '\t',
        [field]: '新的內容',
      })
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ version: 2 })
      expect(moderation.moderateSubmission).toHaveBeenCalledTimes(1)
      const saved = sqlite.prepare('SELECT consensus, disputes, positions, narrative, opinion_prompt FROM ct_briefings WHERE issue_id = ? AND version = 2').get(issueId)
      expect(saved).toMatchObject({ consensus: '原有共識', disputes: '原有爭點', positions: '原有立場', [field]: '新的內容' })
    })
  }

  it('管理員 PUT 編輯既有 briefing 不新增素材門檻', async () => {
    seedBriefing(issueId)
    auth.current = { ...user, role: 'admin' }
    const response = await send('PUT', `/api/issues/${issueId}/briefing`, { consensus: '管理員修正' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(sqlite.prepare('SELECT consensus FROM ct_briefings WHERE issue_id = ? AND version = 1').get(issueId)).toEqual({ consensus: '管理員修正' })
    expect(moderation.moderateSubmission).not.toHaveBeenCalled()
  })

  it('登入、停權與 CSRF 守衛仍先於素材門檻', async () => {
    auth.current = null
    expect((await send('GET', `/api/issues/${issueId}/prompt`)).status).toBe(401)
    expect((await send('POST', `/api/issues/${issueId}/briefing`, { consensus: '共識' })).status).toBe(401)
    auth.current = { ...user, banned: true }
    expect((await send('GET', `/api/issues/${issueId}/prompt`)).status).toBe(403)
    expect((await send('POST', `/api/issues/${issueId}/briefing`, { consensus: '共識' })).status).toBe(403)
    auth.current = user
    const crossOrigin = await app.request(
      `http://localhost/api/issues/${issueId}/briefing`,
      { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'http://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ consensus: '共識' }) },
      { DB: db, DB_AUTH: {} as D1Database } as never
    )
    expect(crossOrigin.status).toBe(403)
    expect(await crossOrigin.json()).toEqual({ error: 'Forbidden: cross-site request blocked' })
    expect(moderation.moderateSubmission).not.toHaveBeenCalled()
  })
})
