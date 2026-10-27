import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import MarkdownIt from 'markdown-it'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import app from '../index'
import type * as Authorization from '../auth/authorization'

const authState = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; image: null }
    role: 'user' | 'admin' | 'super-admin'
    banned: boolean
    nameChangeCooldownDays: null
  },
}))

vi.mock('../auth/authorization', async () => {
  const actual = await vi.importActual<typeof Authorization>('../auth/authorization')
  return { ...actual, tryGetAuthContext: vi.fn(async () => authState.current) }
})

const migrations = readdirSync(new URL('../../migrations/', import.meta.url))
  .filter(name => name.endsWith('.sql'))
  .sort()
  .map(name => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))

let sqlite: DatabaseSync
let db: D1Database

function sqliteD1(): D1Database {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      const prepared = (values: SQLInputValue[]) => ({
        bind(...bound: SQLInputValue[]) {
          return prepared(bound)
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] }
        },
        async first<T>(column?: string) {
          const row = statement.get(...values) as Record<string, unknown> | undefined
          return ((column ? row?.[column] : row) ?? null) as T | null
        },
        async run() {
          const result = statement.run(...values)
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
        },
      })
      return prepared([])
    },
  } as unknown as D1Database
}

const user = {
  user: { id: 'test-session-user', name: 'Test Administrator', email: 'session-private@example.test', image: null },
  role: 'user' as const,
  banned: false,
  nameChangeCooldownDays: null,
}
const admin = { ...user, role: 'admin' as const }
const superAdmin = { ...user, role: 'super-admin' as const }

const privateValues = [
  'issue-author-private-id',
  'issue-author-private-name',
  'issue-author-private@example.test',
  'material-author-private-id',
  'material-author-private-name',
  'material-author-private@example.test',
  'session-private@example.test',
  'test-session-cookie-secret',
]
const excludedMaterials = ['reported-material-sentinel', 'confirmed-material-sentinel', 'hidden-material-sentinel', 'other-issue-material-sentinel']

function seedIssue(flag = 0) {
  const issue = sqlite
    .prepare('INSERT INTO ct_issues (title, description, abuse_flagged, author_id, author_name, author_email, show_email) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('議題：道路安全', '討論道路安全改善方式', flag, privateValues[0], privateValues[1], privateValues[2], 1)
  return Number(issue.lastInsertRowid)
}

function seedMaterial(issueId: number, content: string, flag = 0, sourceName = '安全資料來源', sourceUrl = 'https://example.test/source', createdAt = '2026-10-01 00:00:00') {
  const material = sqlite
    .prepare('INSERT INTO ct_materials (issue_id, source_name, source_url, content, abuse_flagged, author_id, author_name, author_email, show_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(issueId, sourceName, sourceUrl, content, flag, privateValues[3], privateValues[4], privateValues[5], 1, createdAt)
  return Number(material.lastInsertRowid)
}

function runFailingModel() {
  return vi.fn(async (_model: string, _input: unknown) => {
    throw new Error('test-ai-binding-unavailable')
  })
}

type ModelRun = (model: string, input: unknown) => Promise<unknown>

type FieldName =
  | 'consensus_overview'
  | 'consensus_opinion'
  | 'disputes_overview'
  | 'disputes_opinion'
  | 'positions_overview'
  | 'position_name'
  | 'position_core_concern'
  | 'position_opinion'

type ModelAnswer = { value: string | null; span?: number[]; confidence?: number; p_null?: number; guess?: string }
type Preview = {
  issue_id: number
  model: string
  candidate: boolean
  markdown: string
  material_count: number
  extractions: {
    material_id: number
    fields: Record<FieldName, { value: string | null; span: number[] | null; source_match: 'unique' | 'ambiguous' | null }>
    usage: { input_tokens: number; output_tokens: number }
  }[]
}

type Evidence = {
  value: string | null
  material_ids: number[]
  span: [number, number] | null
  confidence: number | null
  p_null: number | null
  source_match: 'unique' | 'ambiguous' | null
}

type ListDiagnostics = { confidence: number | null; p_null: number | null }
type IssuePreview = {
  issue_id: number
  model: string
  candidate: boolean
  scope: 'issue'
  selection: 'all' | 'selected'
  material_count: number
  material_ids: number[]
  usage: Record<string, number>
  analysis: {
    consensus: { overview: Evidence; opinions: Evidence[]; opinions_diagnostics: ListDiagnostics }
    disputes: { overview: Evidence; opinions: Evidence[]; opinions_diagnostics: ListDiagnostics }
    position_map: {
      overview: Evidence
      positions: {
        material_id: number
        source: { title: string | null; href: string | null }
        name: Evidence
        core_concern: Evidence
        opinions: Evidence[]
        opinions_diagnostics: ListDiagnostics
      }[]
    }
  }
  markdown: string
}

function modelResult(values: Partial<Record<FieldName, ModelAnswer>> = {}) {
  const names: FieldName[] = [
    'consensus_overview',
    'consensus_opinion',
    'disputes_overview',
    'disputes_opinion',
    'positions_overview',
    'position_name',
    'position_core_concern',
    'position_opinion',
  ]
  return {
    model: 'clairic',
    answers: Object.fromEntries(names.map(name => [name, { type: 'text', value: null, ...values[name] }])),
    truncated: false,
    usage: { input_tokens: 200, output_tokens: 0, debug: 'model-debug-private-sentinel', input: 'model-input-private-sentinel' },
  }
}

function corpusModelResult(materialIds: number[], values: Record<string, unknown> = {}) {
  const textFields = [
    'consensus_overview',
    'disputes_overview',
    'positions_overview',
    ...materialIds.flatMap(id => [`position_${id}_name`, `position_${id}_core_concern`]),
  ]
  const listFields = ['consensus_opinions', 'disputes_opinions', ...materialIds.map(id => `position_${id}_opinions`)]
  return {
    model: 'clairic',
    answers: {
      ...Object.fromEntries(textFields.map(name => [name, { type: 'text', value: null }])),
      ...Object.fromEntries(listFields.map(name => [name, { type: 'list', value: null }])),
      ...values,
    },
    truncated: false,
    usage: { input_tokens: 234, output_tokens: 0, passes: 3, debug: 'model-usage-private-sentinel' },
    debug: 'model-metadata-private-sentinel',
  }
}

function modelState(input: unknown): string {
  if (!input || typeof input !== 'object' || !('state' in input) || typeof input.state !== 'string') {
    throw new Error('Expected a string model state')
  }
  return input.state
}

function preview(id: number, run?: ModelRun, body: string | null = '{}') {
  return app.request(
    `https://civic.test/api/issues/${id}/extraction-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://civic.test', Cookie: 'better-auth.session_token=test-session-cookie-secret' },
      body,
    },
    { DB: db, DB_AUTH: {} as D1Database, ...(run ? { AI: { run } } : {}) } as never
  )
}

function snapshot() {
  const tables = ['ct_issues', 'ct_materials', 'ct_briefings', 'ct_opinions', 'ct_abuse_reports', 'ct_moderation_appeals', 'ct_opinion_votes', 'ct_feedback']
  return Object.fromEntries(tables.map(table => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]))
}

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('Vary')?.toLowerCase().split(/\s*,\s*/)).toContain('cookie')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  authState.current = null
  sqlite = new DatabaseSync(':memory:')
  for (const migration of migrations) sqlite.exec(migration)
  db = sqliteD1()
})

afterEach(() => {
  sqlite.close()
  vi.restoreAllMocks()
})

describe('POST /api/issues/:id/extraction-preview', () => {
  it('拒絕匿名、一般使用者與停權管理員，不呼叫 AI 或改寫資料', async () => {
    const issueId = seedIssue()
    seedMaterial(issueId, '應加強路口照明')
    const run = runFailingModel()
    const before = snapshot()
    const cases = [
      { context: null, status: 401 },
      { context: user, status: 403 },
      { context: { ...admin, banned: true }, status: 403 },
      { context: { ...superAdmin, banned: true }, status: 403 },
    ]

    for (const { context, status } of cases) {
      authState.current = context
      for (const body of ['{}', JSON.stringify({ scope: 'issue' })]) {
        const response = await preview(issueId, run, body)
        expect(response.status).toBe(status)
        expectPrivate(response)
        expect(response.headers.get('Content-Type')).toContain('application/json')
        await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
      }
    }
    expect(run).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  for (const [context, issueFlag] of [[admin, 0], [superAdmin, 1]] as const) {
    it(`允許 ${context.role} 進行只讀抽取，對外只傳可用素材且不傳作者快照`, async () => {
      const issueId = seedIssue(issueFlag)
      seedMaterial(issueId, '應加強路口照明')
      for (const [index, flag] of [1, 2, 3].entries()) seedMaterial(issueId, excludedMaterials[index], flag)
      const otherIssueId = seedIssue()
      seedMaterial(otherIssueId, excludedMaterials[3])
      authState.current = context
      const run = runFailingModel()
      const fetch = vi.spyOn(globalThis, 'fetch')
      const before = snapshot()

      for (const requestBody of ['{}', JSON.stringify({ scope: 'issue' })]) {
        const response = await preview(issueId, run, requestBody)
        expect(response.status).toBe(502)
        expectPrivate(response)
        expect(response.headers.get('Content-Type')).toContain('application/json')
        const body = await response.json()
        expect(body).toMatchObject({ error: expect.any(String) })
        for (const value of [...privateValues, ...excludedMaterials]) {
          expect(JSON.stringify(body)).not.toContain(value)
        }
      }
      expect(run).toHaveBeenCalledTimes(2)
      const outbound = JSON.stringify(run.mock.calls)
      for (const value of [...privateValues, ...excludedMaterials]) expect(outbound).not.toContain(value)
      expect(fetch).not.toHaveBeenCalled()
      expect(snapshot()).toEqual(before)
    })
  }

  for (const flag of [2, 3]) {
    it(`拒絕狀態 ${flag} 的隱藏議題，不呼叫 AI`, async () => {
      const issueId = seedIssue(flag)
      seedMaterial(issueId, '不應傳出之素材')
      authState.current = admin
      const run = runFailingModel()
      const before = snapshot()
      for (const body of ['{}', JSON.stringify({ scope: 'issue' })]) {
        const response = await preview(issueId, run, body)
        expect(response.status).toBe(404)
        expectPrivate(response)
        await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
      }
      expect(run).not.toHaveBeenCalled()
      expect(snapshot()).toEqual(before)
    })
  }

  it('不存在議題或沒有可用素材時不呼叫 AI', async () => {
    const emptyIssueId = seedIssue()
    for (const [index, flag] of [1, 2, 3].entries()) seedMaterial(emptyIssueId, excludedMaterials[index], flag)
    authState.current = admin
    const run = runFailingModel()
    const before = snapshot()

    for (const [issueId, status] of [[999999, 404], [emptyIssueId, 400]] as const) {
      for (const body of ['{}', JSON.stringify({ scope: 'issue' })]) {
        const response = await preview(issueId, run, body)
        expect(response.status).toBe(status)
        expectPrivate(response)
        await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
      }
    }
    expect(run).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('依素材個別抽取並以素材 ID 關聯原文，null 不採 guess，Markdown 保留安全層級', async () => {
    const issueId = seedIssue()
    const injectedText = '# 偽造章節 [危險連結](https://payload.example/) <img src=x onerror=alert(1)>'
    const firstText = `重複證據。🚸 行人安全優先。改善照明。重複證據。照明團體。夜間視線差。\n${injectedText}`
    const secondText = '🚏 公車團體 Costs are 1.5 dollars. Keep the source intact. 站牌距離過遠。'
    const secondId = seedMaterial(issueId, secondText, 0, '來源乙', 'javascript:alert(1)', '2026-10-02 00:00:00')
    const firstId = seedMaterial(issueId, firstText, 0, '來源甲 <script>alert(1)</script> [偽連結](https://evil.example/)', 'https://example.test/source-a', '2026-10-01 00:00:00')
    authState.current = admin
    const run = vi
      .fn(async (_model: string, _input: unknown) => modelResult())
      .mockResolvedValueOnce(
        modelResult({
          consensus_overview: { value: '重複證據', span: [1, 2], confidence: 0.9 },
          consensus_opinion: { value: '行人安全優先。改善照明。', span: [1, 2], confidence: 0.8 },
          disputes_overview: { value: injectedText },
          disputes_opinion: { value: null, guess: 'pretend-guess-secret', span: [1, 2], p_null: 0.9 },
          positions_overview: { value: '夜間視線差' },
          position_name: { value: '照明團體' },
          position_core_concern: { value: '夜間視線差' },
          position_opinion: { value: '行人安全優先。改善照明。' },
        })
      )
      .mockResolvedValueOnce(
        modelResult({
          consensus_opinion: { value: 'Costs are 1.5 dollars. Keep the source intact.', span: [2, 3] },
          positions_overview: { value: '站牌距離過遠' },
          position_name: { value: '公車團體' },
          position_core_concern: { value: '站牌距離過遠' },
          position_opinion: { value: 'Costs are 1.5 dollars. Keep the source intact.' },
        })
      )
    const before = snapshot()

    const response = await preview(issueId, run, JSON.stringify({ material_ids: [secondId, firstId] }))
    expect(response.status).toBe(200)
    expectPrivate(response)
    const result = (await response.json()) as Preview
    expect(result).toMatchObject({ issue_id: issueId, model: '@cf/cloudflare/clairic', candidate: true, material_count: 2 })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0][0]).toBe('@cf/cloudflare/clairic')
    expect(run.mock.calls[0][1]).toMatchObject({ state: firstText })
    expect(run.mock.calls[1][1]).toMatchObject({ state: secondText })
    expect(JSON.stringify(run.mock.calls[0][1])).not.toContain(secondText)
    expect(JSON.stringify(run.mock.calls[1][1])).not.toContain(firstText)
    expect(result.extractions.map(item => item.material_id)).toEqual([firstId, secondId])
    expect(result.extractions[0]).toMatchObject({
      material_id: firstId,
      fields: {
        consensus_overview: { value: '重複證據', span: [1, 2], source_match: 'ambiguous' },
        consensus_opinion: { value: '行人安全優先。改善照明。', span: [1, 2], source_match: 'unique' },
        disputes_opinion: { value: null, span: null, source_match: null },
      },
      usage: { input_tokens: expect.any(Number), output_tokens: expect.any(Number) },
    })
    expect(result.extractions[1]).toMatchObject({
      material_id: secondId,
      fields: { position_opinion: { value: 'Costs are 1.5 dollars. Keep the source intact.', source_match: 'unique' } },
    })
    expect(JSON.stringify(result)).not.toContain('pretend-guess-secret')
    expect(JSON.stringify(result)).not.toContain('model-debug-private-sentinel')
    expect(JSON.stringify(result)).not.toContain('model-input-private-sentinel')
    for (const value of privateValues) {
      expect(JSON.stringify(run.mock.calls)).not.toContain(value)
      expect(JSON.stringify(result)).not.toContain(value)
    }

    const markdown = result.markdown
    expect(markdown).toMatch(/# 共識[\s\S]*## Overview[\s\S]*## Opinion 清單[\s\S]*# 爭點[\s\S]*## Overview[\s\S]*## Opinion 清單[\s\S]*# 立場地圖[\s\S]*## Overview[\s\S]*## 各方立場/)
    const positionList = markdown.slice(markdown.indexOf('## 各方立場'))
    const firstPosition = positionList.indexOf('照明團體')
    const secondPosition = positionList.indexOf('公車團體')
    expect(firstPosition).toBeGreaterThanOrEqual(0)
    expect(secondPosition).toBeGreaterThan(firstPosition)
    const firstSection = positionList.slice(firstPosition, secondPosition)
    const secondSection = positionList.slice(secondPosition)
    expect(firstSection).toContain('來源甲')
    expect(firstSection).toContain('https://example.test/source-a')
    expect(firstSection).toContain(String(firstId))
    expect(firstSection).not.toContain('來源乙')
    expect(firstSection).toMatch(/Title[\s\S]*行人安全優先。[\s\S]*description[\s\S]*行人安全優先。改善照明。/)
    expect(secondSection).toContain('來源乙')
    expect(secondSection).toContain(String(secondId))
    expect(secondSection).not.toContain('來源甲')
    const positionHtml = new MarkdownIt({ html: true }).render(secondSection)
    const opinionsStart = positionHtml.indexOf('主要主張與論據')
    expect(opinionsStart).toBeGreaterThanOrEqual(0)
    const opinionHtml = positionHtml.slice(opinionsStart)
    const descriptionStart = opinionHtml.indexOf('description')
    expect(descriptionStart).toBeGreaterThan(0)
    expect(opinionHtml.slice(0, descriptionStart)).toContain('Costs are 1.5 dollars.')
    expect(opinionHtml.slice(0, descriptionStart)).not.toContain('Keep the source intact.')
    expect(opinionHtml.slice(descriptionStart)).toContain('Costs are 1.5 dollars. Keep the source intact.')
    expect(markdown).not.toContain('javascript:alert(1)')
    const html = new MarkdownIt({ html: true }).render(markdown)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="https://evil.example/')
    expect(html).not.toContain('<h1>偽造章節')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="https://payload.example/')
    expect(html).not.toContain('href="javascript:')
    expect(snapshot()).toEqual(before)
  })

  it('舊模式 Opinion Title 保留引號內問號與第一個完整句子', async () => {
    const issueId = seedIssue()
    const firstSentence = '「這樣安全嗎？」這個問題需要討論。'
    const candidate = `${firstSentence}後續還要評估。`
    seedMaterial(issueId, candidate)
    authState.current = admin
    const run = vi.fn(async (_model: string, _input: unknown) => modelResult({ consensus_opinion: { value: candidate } }))

    const response = await preview(issueId, run)
    expect(response.status).toBe(200)
    const result = (await response.json()) as Preview
    const html = new MarkdownIt({ html: true }).render(result.markdown)
    const title = html.indexOf('Title')
    const description = html.indexOf('description', title)
    expect(title).toBeGreaterThanOrEqual(0)
    expect(description).toBeGreaterThan(title)
    expect(html.slice(title, description)).toContain(firstSentence)
    expect(html.slice(title, description)).not.toContain('後續還要評估。')
    expect(html.slice(description)).toContain(candidate)
  })

  it('驗證素材選取與 JSON 輸入，不得部分處理隱藏或其他議題素材', async () => {
    const issueId = seedIssue()
    const valid = seedMaterial(issueId, '有效素材')
    const hidden = seedMaterial(issueId, '隱藏素材', 3)
    const reported = seedMaterial(issueId, '待審素材', 1)
    const confirmed = seedMaterial(issueId, '確認違規素材', 2)
    const other = seedMaterial(seedIssue(), '其他議題素材')
    authState.current = admin
    const run = runFailingModel()
    const before = snapshot()

    const invalidBodies: (string | null)[] = [null, '', '{', '[]', '{"material_ids":[]}', '{"material_ids":[0]}', '{"material_ids":[1.5]}', JSON.stringify({ material_ids: [valid, valid] })]
    for (const body of invalidBodies) {
      const response = await preview(issueId, run, body)
      expect(response.status).toBe(400)
      expectPrivate(response)
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
    }
    for (const material_ids of [[], [0], [1.5], [valid, valid], 'invalid', null]) {
      const response = await preview(issueId, run, JSON.stringify({ scope: 'issue', material_ids }))
      expect(response.status).toBe(400)
      expectPrivate(response)
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
    }
    for (const scope of [undefined, 'issue']) {
      const errors = []
      for (const id of [hidden, reported, confirmed, other, 999999]) {
        const response = await preview(issueId, run, JSON.stringify({ scope, material_ids: [valid, id] }))
        expect(response.status).toBe(404)
        expectPrivate(response)
        const body = await response.json()
        expect(body).toMatchObject({ error: expect.any(String) })
        errors.push(body)
      }
      for (const error of errors.slice(1)) expect(error).toEqual(errors[0])
    }
    expect(run).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('拒絕未知或型別錯誤的 scope，且不呼叫 AI 或改寫資料', async () => {
    const issueId = seedIssue()
    seedMaterial(issueId, '有效素材')
    authState.current = admin
    const run = runFailingModel()
    const before = snapshot()

    for (const scope of ['', 'ISSUE', 'corpus', 'material', null, true, 1, [], {}]) {
      const response = await preview(issueId, run, JSON.stringify({ scope }))
      expect(response.status).toBe(400)
      expectPrivate(response)
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
    }
    expect(run).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('限制八份素材及每份 4000 UTF-8 bytes，超出時不靜默截斷', async () => {
    const issueId = seedIssue()
    const ids: number[] = []
    for (let i = 0; i < 12; i++) ids.push(seedMaterial(issueId, i === 11 ? 'a'.repeat(4000) : `有效素材 ${i}`))
    const longIssue = seedIssue()
    seedMaterial(longIssue, '漢'.repeat(1334))
    authState.current = admin
    const run = vi.fn(async (_model: string, _input: unknown) => modelResult())
    const before = snapshot()

    const selected = ids.slice(-8)
    const permitted = await preview(issueId, run, JSON.stringify({ material_ids: [...selected].reverse() }))
    expect(permitted.status).toBe(200)
    expectPrivate(permitted)
    const body = (await permitted.json()) as Preview
    expect(body.material_count).toBe(8)
    expect(body.extractions.map(item => item.material_id)).toEqual(selected)
    expect(run).toHaveBeenCalledTimes(8)
    run.mockClear()
    for (const [id, body] of [
      [issueId, '{}'],
      [issueId, JSON.stringify({ material_ids: ids.slice(0, 9) })],
      [longIssue, '{}'],
    ] as const) {
      const response = await preview(id, run, body)
      expect(response.status).toBe(413)
      expectPrivate(response)
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
    }
    expect(run).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('AI binding 缺失、失敗、截斷和不符原文的結果都不是成功', async () => {
    const issueId = seedIssue()
    const privateText = '測試素材不應出現在錯誤或日誌'
    seedMaterial(issueId, privateText)
    authState.current = admin
    const before = snapshot()
    const missing = await preview(issueId)
    expect(missing.status).toBe(503)
    expectPrivate(missing)
    await expect(missing.json()).resolves.toMatchObject({ error: expect.any(String) })

    const results: unknown[] = [
      { ...modelResult(), truncated: true },
      modelResult({ consensus_overview: { value: '不是素材原文' } }),
      { ...modelResult(), answers: {} },
    ]
    const runs: ModelRun[] = [
      runFailingModel(),
      ...results.map(result => vi.fn(async (_model: string, _input: unknown) => result)),
    ]
    for (const run of runs) {
      const response = await preview(issueId, run)
      expect(response.status).toBe(502)
      expectPrivate(response)
      const body = await response.json()
      expect(body).toMatchObject({ error: expect.any(String) })
      expect(JSON.stringify(body)).not.toContain(privateText)
      expect(JSON.stringify(body)).not.toContain('test-ai-binding-unavailable')
    }
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(privateText)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('test-ai-binding-unavailable')
    expect(snapshot()).toEqual(before)
  })
})

describe('POST /api/issues/:id/extraction-preview scope issue', () => {
  it('一次傳送完整選取原文並回傳逐項歸因的全批候選與單次用量', async () => {
    const issueId = seedIssue()
    const quote = '「這樣安全嗎？」這個問題需要討論。後續還要評估。'
    const injected = '# 偽造章節 [危險連結](https://payload.example/) <img src=x onerror=alert(1)>'
    const firstText = `共同疑慮。重複片段。${quote}步行居民。缺少無障礙通道。重複片段。\n${injected}`
    const secondText = '共同疑慮。夜間居民。缺少夜間照明。改善照明可以降低風險。'
    const firstTitle = '來源甲 <script>alert(1)</script> [偽連結](https://evil.example/)'
    const secondId = seedMaterial(issueId, secondText, 0, '來源乙', 'javascript:alert(1)', '2026-10-02 00:00:00')
    const omittedId = seedMaterial(issueId, '未選取素材的私有內容', 0, '未選來源', 'https://example.test/omitted', '2026-10-03 00:00:00')
    const firstId = seedMaterial(issueId, firstText, 0, firstTitle, 'https://example.test/source-a', '2026-10-01 00:00:00')
    for (const [index, flag] of [1, 2, 3].entries()) seedMaterial(issueId, excludedMaterials[index], flag)
    seedMaterial(seedIssue(), excludedMaterials[3])
    authState.current = superAdmin

    const model = corpusModelResult([firstId, secondId], {
      consensus_overview: { type: 'text', value: '共同疑慮', span: [7, 12], confidence: 0.88, p_null: 0.05, debug: 'model-field-private-sentinel' },
      disputes_overview: { type: 'text', value: '重複片段' },
      positions_overview: { type: 'text', value: null, guess: 'pretend-guess-secret', span: [1, 2], p_null: 0.9 },
      consensus_opinions: {
        type: 'list',
        value: [quote, '改善照明可以降低風險。', '重複片段'],
        spans: [[20, 30], [31, 40], 'invalid-span'],
        confidence: 0.72,
        p_null: 0.13,
        guess: ['pretend-list-guess-secret'],
      },
      disputes_opinions: { type: 'list', value: [injected], confidence: 0.4, p_null: 0.2 },
      [`position_${firstId}_name`]: { type: 'text', value: '步行居民' },
      [`position_${firstId}_core_concern`]: { type: 'text', value: '缺少無障礙通道' },
      [`position_${firstId}_opinions`]: { type: 'list', value: [quote, '重複片段', '共同疑慮'], confidence: 0.6, p_null: 0.1 },
      [`position_${secondId}_name`]: { type: 'text', value: '夜間居民' },
      [`position_${secondId}_core_concern`]: { type: 'text', value: '缺少夜間照明' },
      [`position_${secondId}_opinions`]: { type: 'list', value: ['改善照明可以降低風險。'] },
      ignored_model_field: { type: 'text', value: 'model-extra-field-private-sentinel' },
    })
    const run = vi.fn(async (_model: string, _input: unknown) => model)
    const fetch = vi.spyOn(globalThis, 'fetch')
    const before = snapshot()
    const response = await preview(issueId, run, JSON.stringify({ scope: 'issue', material_ids: [secondId, firstId] }))

    expect(response.status).toBe(200)
    expectPrivate(response)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    const result = (await response.json()) as IssuePreview
    expect(result).toMatchObject({
      issue_id: issueId,
      model: '@cf/cloudflare/clairic',
      candidate: true,
      scope: 'issue',
      selection: 'selected',
      material_count: 2,
      material_ids: [firstId, secondId],
      usage: { input_tokens: expect.any(Number), output_tokens: expect.any(Number), passes: expect.any(Number) },
    })
    expect(result).not.toHaveProperty('extractions')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe('@cf/cloudflare/clairic')
    const state = modelState(run.mock.calls[0][1])
    expect(state.split(firstText)).toHaveLength(2)
    expect(state.split(secondText)).toHaveLength(2)
    expect(state.indexOf(firstText)).toBeLessThan(state.indexOf(secondText))
    expect(state.slice(0, state.indexOf(firstText))).toContain(String(firstId))
    expect(state.slice(state.indexOf(firstText) + firstText.length, state.indexOf(secondText))).toContain(String(secondId))
    expect(state).not.toContain('未選取素材的私有內容')
    expect(result.material_ids).not.toContain(omittedId)
    const outbound = JSON.stringify(run.mock.calls)
    for (const secret of [...privateValues, ...excludedMaterials, firstTitle, '來源乙', 'https://example.test/source-a', 'javascript:alert(1)', 'https://example.test/omitted']) {
      expect(outbound).not.toContain(secret)
    }
    expect(fetch).not.toHaveBeenCalled()

    expect(result.analysis.consensus.overview).toEqual({
      value: '共同疑慮', material_ids: [firstId, secondId], span: [7, 12], confidence: 0.88, p_null: 0.05, source_match: 'ambiguous',
    })
    expect(result.analysis.disputes.overview).toMatchObject({ value: '重複片段', material_ids: [firstId], source_match: 'ambiguous' })
    expect(result.analysis.position_map.overview).toMatchObject({ value: null, material_ids: [], span: null, p_null: 0.9, source_match: null })
    expect(result.analysis.consensus.opinions_diagnostics).toEqual({ confidence: 0.72, p_null: 0.13 })
    expect(result.analysis.consensus.opinions).toEqual([
      { value: quote, material_ids: [firstId], span: [20, 30], confidence: null, p_null: null, source_match: 'unique' },
      { value: '改善照明可以降低風險。', material_ids: [secondId], span: [31, 40], confidence: null, p_null: null, source_match: 'unique' },
      { value: '重複片段', material_ids: [firstId], span: null, confidence: null, p_null: null, source_match: 'ambiguous' },
    ])
    expect(result.analysis.disputes.opinions).toMatchObject([{ value: injected, material_ids: [firstId], source_match: 'unique', confidence: null, p_null: null }])
    expect(result.analysis.disputes.opinions_diagnostics).toEqual({ confidence: 0.4, p_null: 0.2 })
    expect(result.analysis.position_map.positions).toHaveLength(2)
    const [firstPosition, secondPosition] = result.analysis.position_map.positions
    expect(firstPosition).toMatchObject({
      material_id: firstId,
      source: { title: firstTitle, href: 'https://example.test/source-a' },
      name: { value: '步行居民', material_ids: [firstId], source_match: 'unique' },
      core_concern: { value: '缺少無障礙通道', material_ids: [firstId] },
      opinions_diagnostics: { confidence: 0.6, p_null: 0.1 },
      opinions: [
        { value: quote, material_ids: [firstId], confidence: null, p_null: null },
        { value: '重複片段', material_ids: [firstId], confidence: null, p_null: null, source_match: 'ambiguous' },
        { value: '共同疑慮', material_ids: [firstId, secondId], confidence: null, p_null: null, source_match: 'ambiguous' },
      ],
    })
    expect(secondPosition).toMatchObject({
      material_id: secondId,
      source: { title: '來源乙', href: null },
      name: { value: '夜間居民', material_ids: [secondId] },
      opinions: [{ value: '改善照明可以降低風險。', material_ids: [secondId], confidence: null, p_null: null }],
    })
    const serialized = JSON.stringify(result)
    for (const secret of [...privateValues, ...excludedMaterials, 'pretend-guess-secret', 'pretend-list-guess-secret', 'model-field-private-sentinel', 'model-extra-field-private-sentinel', 'model-usage-private-sentinel', 'model-metadata-private-sentinel']) {
      expect(serialized).not.toContain(secret)
    }
    expect(serialized).not.toContain('未選取素材的私有內容')
    expect(snapshot()).toEqual(before)

    const markdown = result.markdown
    expect(markdown).toMatch(/# 共識[\s\S]*## Overview[\s\S]*## Opinion 清單[\s\S]*# 爭點[\s\S]*## Overview[\s\S]*## Opinion 清單[\s\S]*# 立場地圖[\s\S]*## Overview[\s\S]*## 各方立場/)
    const html = new MarkdownIt({ html: true }).render(markdown)
    const title = html.indexOf('Title')
    const description = html.indexOf('description', title)
    expect(title).toBeGreaterThanOrEqual(0)
    expect(description).toBeGreaterThan(title)
    expect(html.slice(title, description)).toContain(quote)
    expect(html.slice(description)).toContain(quote)
    expect(html).toContain('https://example.test/source-a')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<h1>偽造章節')
    expect(html).not.toContain('href="https://evil.example/')
    expect(html).not.toContain('href="https://payload.example/')
    expect(html).not.toContain('href="javascript:')
  })

  it('未指定 IDs 時選取全部可見素材；指定時允許較晚 ID 並仍依資料庫排序', async () => {
    const issueId = seedIssue()
    const contents = Array.from({ length: 12 }, (_, index) => index === 11 ? 'x'.repeat(4000) : `素材內容 ${index}。`)
    const ids = contents.map(text => seedMaterial(issueId, text))
    seedMaterial(issueId, excludedMaterials[2], 3)
    const selectedIds = ids.slice(-8)
    const allIssue = seedIssue()
    const allFirst = seedMaterial(allIssue, '完整選取甲。', 0, '甲', 'https://example.test/first', '2026-10-01 00:00:00')
    seedMaterial(allIssue, excludedMaterials[0], 1)
    const allSecond = seedMaterial(allIssue, '完整選取乙。', 0, '乙', 'https://example.test/second', '2026-10-01 00:00:00')
    authState.current = admin
    const before = snapshot()

    const selectedRun = vi.fn(async (_model: string, _input: unknown) => corpusModelResult(selectedIds))
    const selectedResponse = await preview(issueId, selectedRun, JSON.stringify({ scope: 'issue', material_ids: [...selectedIds].reverse() }))
    expect(selectedResponse.status).toBe(200)
    expectPrivate(selectedResponse)
    const selectedResult = (await selectedResponse.json()) as IssuePreview
    expect(selectedResult).toMatchObject({ scope: 'issue', selection: 'selected', material_count: 8, material_ids: selectedIds })
    expect(selectedResult.analysis.position_map.positions.map(item => item.material_id)).toEqual(selectedIds)
    expect(selectedRun).toHaveBeenCalledTimes(1)
    const selectedState = modelState(selectedRun.mock.calls[0][1])
    for (const text of contents.slice(-8)) expect(selectedState).toContain(text)
    for (const text of contents.slice(0, 4)) expect(selectedState).not.toContain(text)
    expect(selectedState).not.toContain(excludedMaterials[2])

    const allRun = vi.fn(async (_model: string, _input: unknown) => corpusModelResult([allFirst, allSecond]))
    const allResponse = await preview(allIssue, allRun, JSON.stringify({ scope: 'issue' }))
    expect(allResponse.status).toBe(200)
    expectPrivate(allResponse)
    const allResult = (await allResponse.json()) as IssuePreview
    expect(allResult).toMatchObject({ scope: 'issue', selection: 'all', material_count: 2, material_ids: [allFirst, allSecond] })
    expect(allRun).toHaveBeenCalledTimes(1)
    const allState = modelState(allRun.mock.calls[0][1])
    expect(allState).toContain('完整選取甲。')
    expect(allState).toContain('完整選取乙。')
    expect(allState).not.toContain(excludedMaterials[0])
    expect(snapshot()).toEqual(before)
  })

  it('超過素材筆數、個別長度或含標籤的整批 UTF-8 限制時整批拒絕', async () => {
    const countIssue = seedIssue()
    const ids = Array.from({ length: 9 }, (_, index) => seedMaterial(countIssue, `完整素材 ${index}`))
    const lengthIssue = seedIssue()
    seedMaterial(lengthIssue, '可用素材先出現')
    seedMaterial(lengthIssue, '漢'.repeat(1334))
    const stateIssue = seedIssue()
    seedMaterial(stateIssue, '漢'.repeat(1333))
    seedMaterial(stateIssue, 'a'.repeat(4000))
    authState.current = admin
    const before = snapshot()
    const run = vi.fn(async (_model: string, _input: unknown) => corpusModelResult([]))

    for (const [id, body] of [
      [countIssue, { scope: 'issue' }],
      [countIssue, { scope: 'issue', material_ids: ids }],
      [lengthIssue, { scope: 'issue' }],
      [stateIssue, { scope: 'issue' }],
    ] as const) {
      const response = await preview(id, run, JSON.stringify(body))
      expect(response.status).toBe(413)
      expectPrivate(response)
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
    }
    expect(run).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('空 list 與 null 不採 guess，欄位診斷不偽裝成逐項信心', async () => {
    const issueId = seedIssue()
    const id = seedMaterial(issueId, '有效原文')
    authState.current = admin
    const model = corpusModelResult([id], {
      consensus_overview: { type: 'text', value: null, guess: 'private-text-guess', span: [2, 8], confidence: 0.2, p_null: 0.8 },
      consensus_opinions: { type: 'list', value: null, guess: ['private-list-guess'], spans: [[2, 8]], confidence: 0.3, p_null: 0.7 },
      disputes_opinions: { type: 'list', value: [], confidence: 0.4, p_null: 0.6 },
      [`position_${id}_opinions`]: { type: 'list', value: null, guess: ['private-position-guess'] },
    })
    const run = vi.fn(async (_model: string, _input: unknown) => model)
    const response = await preview(issueId, run, JSON.stringify({ scope: 'issue' }))
    expect(response.status).toBe(200)
    expectPrivate(response)
    const result = (await response.json()) as IssuePreview
    expect(result.analysis.consensus.overview).toEqual({
      value: null, material_ids: [], span: null, confidence: 0.2, p_null: 0.8, source_match: null,
    })
    expect(result.analysis.consensus.opinions).toEqual([])
    expect(result.analysis.consensus.opinions_diagnostics).toEqual({ confidence: 0.3, p_null: 0.7 })
    expect(result.analysis.disputes.opinions).toEqual([])
    expect(result.analysis.disputes.opinions_diagnostics).toEqual({ confidence: 0.4, p_null: 0.6 })
    expect(result.analysis.position_map.positions[0]).toMatchObject({
      opinions: [],
      opinions_diagnostics: { confidence: null, p_null: null },
    })
    for (const guess of ['private-text-guess', 'private-list-guess', 'private-position-guess']) {
      expect(JSON.stringify(result)).not.toContain(guess)
    }
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('拒絕未知模型、錯誤 typed output、非字串 list 項目及模型失敗', async () => {
    const issueId = seedIssue()
    const privateText = '測試模型失敗時不公開的素材'
    const id = seedMaterial(issueId, privateText)
    authState.current = admin
    const before = snapshot()
    const missing = await preview(issueId, undefined, JSON.stringify({ scope: 'issue' }))
    expect(missing.status).toBe(503)
    expectPrivate(missing)
    await expect(missing.json()).resolves.toMatchObject({ error: expect.any(String) })

    const valid = corpusModelResult([id])
    const missingField = corpusModelResult([id])
    delete missingField.answers.consensus_overview
    const failures: [string, unknown][] = [
      ['empty response', null],
      ['primitive response', 'private-model-response-sentinel'],
      ['unknown model', { ...valid, model: 'private-unknown-model-sentinel' }],
      ['truncated', { ...valid, truncated: true }],
      ['invalid truncated flag', { ...valid, truncated: null }],
      ['array answers', { ...valid, answers: [] }],
      ['missing field', missingField],
      ['wrong text type', corpusModelResult([id], { consensus_overview: { type: 'number', value: 1 } })],
      ['primitive text answer', corpusModelResult([id], { consensus_overview: '有效原文' })],
      ['wrong list type', corpusModelResult([id], { consensus_opinions: { type: 'text', value: privateText } })],
      ['primitive list value', corpusModelResult([id], { consensus_opinions: { type: 'list', value: privateText } })],
      ['list with number', corpusModelResult([id], { consensus_opinions: { type: 'list', value: [privateText, 1] } })],
      ['list with null item', corpusModelResult([id], { consensus_opinions: { type: 'list', value: [null] } })],
      ['list with object item', corpusModelResult([id], { consensus_opinions: { type: 'list', value: [{ value: privateText }] } })],
      ['empty list item', corpusModelResult([id], { consensus_opinions: { type: 'list', value: [''] } })],
      ['invalid list confidence', corpusModelResult([id], { consensus_opinions: { type: 'list', value: [], confidence: 1.5 } })],
      ['missing list value', corpusModelResult([id], { consensus_opinions: { type: 'list', guess: [privateText] } })],
      ['invalid usage', { ...valid, usage: { input_tokens: -1, output_tokens: 0 } }],
    ]
    const thrown = runFailingModel()
    const runs: [string, ModelRun][] = [
      ['binding failure', thrown],
      ...failures.map(([name, result]): [string, ModelRun] => [name, vi.fn(async (_model: string, _input: unknown) => result)]),
    ]
    for (const [name, run] of runs) {
      const response = await preview(issueId, run, JSON.stringify({ scope: 'issue' }))
      expect(response.status, name).toBe(502)
      expectPrivate(response)
      const body = await response.json()
      expect(body).toMatchObject({ error: expect.any(String) })
      for (const secret of [privateText, 'private-model-response-sentinel', 'private-unknown-model-sentinel', 'test-ai-binding-unavailable']) {
        expect(JSON.stringify(body)).not.toContain(secret)
      }
      expect(run).toHaveBeenCalledTimes(1)
    }
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(privateText)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('test-ai-binding-unavailable')
    expect(snapshot()).toEqual(before)
  })

  it('不把標籤、跨素材邊界或其他素材的內容當成錨定原文', async () => {
    const issueId = seedIssue()
    const firstText = '行人需要清楚的路口標示。'
    const secondText = '夜間需要更多路燈照明。'
    const firstId = seedMaterial(issueId, firstText)
    const secondId = seedMaterial(issueId, secondText)
    const ids = [firstId, secondId]
    authState.current = admin
    const before = snapshot()
    const capture = vi.fn(async (_model: string, _input: unknown) => corpusModelResult(ids))
    const initial = await preview(issueId, capture, JSON.stringify({ scope: 'issue' }))
    expect(initial.status).toBe(200)
    expect(capture).toHaveBeenCalledTimes(1)
    const state = modelState(capture.mock.calls[0][1])
    const firstEnd = state.indexOf(firstText) + firstText.length
    const secondStart = state.indexOf(secondText)
    expect(firstEnd).toBeGreaterThan(firstText.length - 1)
    expect(secondStart).toBeGreaterThan(firstEnd)
    const label = state.slice(firstEnd, secondStart).trim()
    const crossing = firstText.slice(-5) + state.slice(firstEnd, secondStart) + secondText.slice(0, 5)
    expect(label).toContain(String(secondId))
    expect(state).toContain(crossing)
    expect(firstText).not.toContain(label)
    expect(secondText).not.toContain(label)
    expect(firstText).not.toContain(crossing)
    expect(secondText).not.toContain(crossing)

    const attacks = [
      { consensus_overview: { type: 'text', value: label } },
      { consensus_overview: { type: 'text', value: crossing } },
      { disputes_opinions: { type: 'list', value: [firstText, crossing] } },
      { [`position_${firstId}_name`]: { type: 'text', value: secondText } },
      { [`position_${firstId}_opinions`]: { type: 'list', value: [firstText, secondText] } },
    ]
    for (const attack of attacks) {
      const run = vi.fn(async (_model: string, _input: unknown) => corpusModelResult(ids, attack))
      const response = await preview(issueId, run, JSON.stringify({ scope: 'issue' }))
      expect(response.status).toBe(502)
      expectPrivate(response)
      const body = await response.json()
      expect(body).toMatchObject({ error: expect.any(String) })
      expect(JSON.stringify(body)).not.toContain(firstText)
      expect(JSON.stringify(body)).not.toContain(secondText)
      expect(run).toHaveBeenCalledTimes(1)
    }
    expect(snapshot()).toEqual(before)
  })

  it('source 資料只取自資料庫，拒絕含憑證網址並安全呈現來源文字', async () => {
    const issueId = seedIssue()
    const maliciousTitle = '來源 <img src=x onerror=alert(1)> [假連結](https://evil.example/)'
    const safeUrl = 'https://example.test/path?value=%22%3E%3Cscript%3E'
    const credentialUrl = 'https://reader:private-source-password@example.test/private'
    const firstId = seedMaterial(issueId, '甲方原文', 0, maliciousTitle, safeUrl)
    const secondId = seedMaterial(issueId, '乙方原文', 0, '乙方來源', credentialUrl)
    const thirdId = seedMaterial(issueId, '丙方原文')
    sqlite.prepare('UPDATE ct_materials SET source_name = NULL, source_url = NULL WHERE id = ?').run(thirdId)
    authState.current = admin
    const ids = [firstId, secondId, thirdId]
    const model = corpusModelResult(ids, {
      [`position_${firstId}_name`]: { type: 'text', value: '甲方原文' },
      [`position_${secondId}_name`]: { type: 'text', value: '乙方原文' },
      [`position_${thirdId}_name`]: { type: 'text', value: '丙方原文' },
    })
    const run = vi.fn(async (_model: string, _input: unknown) => model)
    const fetch = vi.spyOn(globalThis, 'fetch')
    const before = snapshot()
    const response = await preview(issueId, run, JSON.stringify({ scope: 'issue' }))
    expect(response.status).toBe(200)
    expectPrivate(response)
    const result = (await response.json()) as IssuePreview
    expect(result.analysis.position_map.positions.map(position => position.source)).toEqual([
      { title: maliciousTitle, href: safeUrl },
      { title: '乙方來源', href: null },
      { title: null, href: null },
    ])
    expect(JSON.stringify(result)).not.toContain('private-source-password')
    const outbound = JSON.stringify(run.mock.calls)
    for (const sourceValue of [maliciousTitle, safeUrl, credentialUrl, '乙方來源']) expect(outbound).not.toContain(sourceValue)
    const html = new MarkdownIt({ html: true }).render(result.markdown)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="https://evil.example/')
    expect(html).not.toContain('private-source-password')
    expect(fetch).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledTimes(1)
    expect(snapshot()).toEqual(before)
  })
})
