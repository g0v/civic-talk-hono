import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Hono } from 'hono'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { registerApiRoutes } from '../api/routes'
import { createIssue } from '../db/queries'
import { normalizeIssueTags, parseIssueTagsInput } from '../lib/issueTags'
import type { IssueListItemWithAuthor } from '../db/queries'
import { provideI18n } from '../l10n'
import AdminView from '../views/Admin.vue'
import { moderateSubmission } from '../moderation/service'

const authState = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; image: null }
    role: 'user' | 'admin' | 'super-admin'
    banned: boolean
    nameChangeCooldownDays: number | null
  },
}))

const moderationState = vi.hoisted(() => ({ outcome: 'allow' as 'allow' | 'violation' }))

vi.mock('../auth/authorization', () => ({
  hasDuplicateDisplayName: vi.fn(async () => false),
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
  tryGetAuthContext: vi.fn(async () => authState.current),
}))

vi.mock('../auth/createAuth', () => ({ createAuth: vi.fn(() => ({ api: {} })) }))

vi.mock('../moderation/service', () => ({
  moderateSubmission: vi.fn(async () => (moderationState.outcome === 'violation' ? { outcome: 'violation', policy_code: 'hate_speech', rationale: '不當內容', confidence: 1 } : { outcome: 'allow' })),
  moderationReasonForPolicy: vi.fn(() => 'hate_speech'),
  moderateSubmissionWithDiagnostics: vi.fn(),
}))

const migrations = readdirSync(new URL('../../migrations/', import.meta.url))
  .filter(name => name.endsWith('.sql'))
  .sort()
  .map(name => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))

let sqlite: DatabaseSync
let db: D1Database

function testApp() {
  const app = new Hono<{ Bindings: { DB: D1Database; DB_AUTH: D1Database } }>()
  registerApiRoutes(app as never)
  return app
}

function sqliteD1(): D1Database {
  return {
    prepare(sql: string) {
      return {
        async all<T>() {
          return { results: sqlite.prepare(sql).all() as T[] }
        },
        bind(...values: SQLInputValue[]) {
          const statement = sqlite.prepare(sql)
          return {
            async all<T>() {
              return { results: statement.all(...values) as T[] }
            },
            async first<T>() {
              return (statement.get(...values) ?? null) as T | null
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

const env = () => ({ DB: db, DB_AUTH: {} as D1Database }) as never
const issueBody = (extra: Record<string, unknown> = {}) => JSON.stringify({ title: '公共政策討論', description: '議題背景', terms_accepted: true, show_email: false, ...extra })
const user = { user: { id: 'user-1', name: 'User One', email: 'user@example.com', image: null }, role: 'user' as const, banned: false, nameChangeCooldownDays: null }
const admin = { ...user, role: 'admin' as const }

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new DatabaseSync(':memory:')
  for (const migration of migrations) sqlite.exec(migration)
  db = sqliteD1()
  authState.current = null
  moderationState.outcome = 'allow'
})

afterEach(() => sqlite.close())

describe('issue tag normalization', () => {
  it('trims tags, removes leading hashes, skips empty entries, and de-duplicates case-insensitively', () => {
    expect(normalizeIssueTags(['  #Energy  ', 'energy', '##Climate', '', '  ', '# climate'])).toEqual(['Energy', 'Climate'])
    expect(parseIssueTagsInput(' #Energy, energy, , #Climate , CLIMATE ')).toEqual(['Energy', 'Climate'])
  })
})

describe('issue tag persistence and API behavior', () => {
  it('creates, updates, clears, and preserves tags for legacy PUT bodies', async () => {
    authState.current = user
    const created = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody({ tags: [' #Energy ', 'energy', 'Climate'] }) }, env())

    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: number }
    const persistedTags = sqlite.prepare('SELECT tags FROM ct_issues WHERE id = ?').get(id) as { tags: string }
    expect(JSON.parse(persistedTags.tags)).toEqual(['Energy', 'Climate'])

    authState.current = admin
    const update = (tags?: string[]) =>
      testApp().request(
        `/api/issues/${id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '公共政策討論', ...(tags === undefined ? {} : { tags }) }),
        },
        env()
      )

    expect((await update(['Housing', 'housing', '#Justice'])).status).toBe(200)
    const detailAfterUpdate = await testApp().request(`/api/issues/${id}`, undefined, env())
    await expect(detailAfterUpdate.json()).resolves.toMatchObject({ issue: { tags: ['Housing', 'Justice'] } })

    expect((await update()).status).toBe(200)
    const detailAfterLegacyPut = await testApp().request(`/api/issues/${id}`, undefined, env())
    await expect(detailAfterLegacyPut.json()).resolves.toMatchObject({ issue: { tags: ['Housing', 'Justice'] } })

    expect((await update([])).status).toBe(200)
    const detailAfterClear = await testApp().request(`/api/issues/${id}`, undefined, env())
    await expect(detailAfterClear.json()).resolves.toMatchObject({ issue: { tags: [] } })
  })

  it.each(['legacy-conversation-42', null])('preserves the original Polis value %s when an admin edits an issue', async polisId => {
    const seeded = sqlite.prepare('INSERT INTO ct_issues (title, description, polis_id) VALUES (?, ?, ?)').run('原議題', '原簡介', polisId)
    const id = Number(seeded.lastInsertRowid)
    authState.current = admin
    const app = testApp()
    const response = await app.request('/api/issues', undefined, env())
    const issues = (await response.json()) as IssueListItemWithAuthor[]
    const issue = issues.find(issue => issue.id === id)!

    let editor!: {
      issues: IssueListItemWithAuthor[]
      formTitle: string
      openEdit: (issue: IssueListItemWithAuthor) => void
      saveIssue: () => Promise<void>
    }
    const view = createSSRApp(AdminView)
    provideI18n(view, 'zh-TW')
    view.mixin({
      created() {
        if (this.$.parent !== null) return
        // Vue 的公開型別未列出 setupState；讀取實際元件操作，避免為測試新增產品 API。
        const instance = this.$ as unknown as { setupState: typeof editor }
        editor = instance.setupState
      },
    })
    await renderToString(view)
    editor.issues = issues
    editor.openEdit(issue)
    editor.formTitle = '修改後的議題'

    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => app.request(input, init, env()))
    try {
      await editor.saveIssue()
      expect(sqlite.prepare('SELECT title, polis_id FROM ct_issues WHERE id = ?').get(id)).toEqual({ title: '修改後的議題', polis_id: polisId })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stores an empty array when the API and legacy create callers omit tags', async () => {
    authState.current = user
    const response = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody() }, env())

    expect(response.status).toBe(201)
    const apiIssue = sqlite.prepare('SELECT tags FROM ct_issues ORDER BY id DESC LIMIT 1').get() as { tags: string }
    expect(apiIssue.tags).toBe('[]')

    const id = await createIssue(db, {
      title: 'Legacy query caller',
      author_id: 'legacy-user',
      author_name: null,
      author_email: 'legacy@example.com',
      show_email: false,
      terms_version: '2026-10-19',
    })
    const dbIssue = sqlite.prepare('SELECT tags FROM ct_issues WHERE id = ?').get(id) as { tags: string }
    expect(dbIssue.tags).toBe('[]')
  })

  it('rejects non-string tag arrays on create and update', async () => {
    authState.current = user
    const countBefore = sqlite.prepare('SELECT COUNT(*) AS count FROM ct_issues').get() as { count: number }
    const created = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody({ tags: ['Housing', 1] }) }, env())
    expect(created.status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM ct_issues').get()).toEqual(countBefore)

    const seeded = sqlite.prepare("INSERT INTO ct_issues (title, tags) VALUES ('Existing', '[\"Housing\"]')").run()
    authState.current = admin
    const updated = await testApp().request(
      `/api/issues/${Number(seeded.lastInsertRowid)}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Existing', tags: 'Housing' }) },
      env()
    )
    expect(updated.status).toBe(400)
    expect(sqlite.prepare('SELECT tags FROM ct_issues WHERE id = ?').get(Number(seeded.lastInsertRowid))).toEqual({ tags: '["Housing"]' })
  })

  it('requires login to create and admin access to update', async () => {
    const anonymous = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody({ tags: [] }) }, env())
    expect(anonymous.status).toBe(401)

    const seeded = sqlite.prepare("INSERT INTO ct_issues (title) VALUES ('Existing')").run()
    authState.current = user
    const nonAdmin = await testApp().request(
      `/api/issues/${Number(seeded.lastInsertRowid)}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Existing', tags: [] }) },
      env()
    )
    expect(nonAdmin.status).toBe(403)
  })

  it('persists normalized violation snapshots and masks hidden tags on public reads', async () => {
    authState.current = user
    moderationState.outcome = 'violation'
    const submitted = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody({ tags: [' #Private-Tag ', 'private-tag'] }) }, env())
    expect(submitted.status).toBe(201)
    const { id } = (await submitted.json()) as { id: number }
    const storedTags = sqlite.prepare('SELECT tags FROM ct_issues WHERE id = ?').get(id) as { tags: string }
    expect(JSON.parse(storedTags.tags)).toEqual(['Private-Tag'])
    const report = sqlite.prepare('SELECT content_snapshot FROM ct_abuse_reports WHERE issue_id = ?').get(id) as { content_snapshot: string }
    expect(JSON.parse(report.content_snapshot)).toEqual({ title: '公共政策討論', description: '議題背景', tags: 'Private-Tag' })

    authState.current = null
    const publicList = await testApp().request('/api/issues', undefined, env())
    const publicIssue = ((await publicList.json()) as { id: number; tags: string[] }[]).find(issue => issue.id === id)
    expect(publicIssue?.tags).toEqual([])
    const publicDetailResponse = await testApp().request(`/api/issues/${id}`, undefined, env())
    const publicDetail = (await publicDetailResponse.json()) as { issue: { tags: string[] } }
    expect(publicDetail.issue.tags).toEqual([])

    authState.current = admin
    const adminList = await testApp().request('/api/issues', undefined, env())
    const adminIssue = ((await adminList.json()) as { id: number; tags: string[] }[]).find(issue => issue.id === id)
    expect(adminIssue?.tags).toEqual(['Private-Tag'])
  })
})

describe('議題簡介 API 字數限制（#218）', () => {
  it('接受正好 300 個 code points，完整保存 emoji、空白與換行', async () => {
    authState.current = user
    const description = ' ' + '😀'.repeat(298) + '\n'
    const response = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody({ description }) }, env())

    expect(response.status).toBe(201)
    const result = (await response.json()) as { id: number; title: string }
    expect(result).toEqual({ id: expect.any(Number), title: '公共政策討論' })
    expect(sqlite.prepare('SELECT description FROM ct_issues WHERE id = ?').get(result.id)).toEqual({ description })
  })

  it('拒絕 301 個 code points，且不呼叫模型或寫入議題與審查回報', async () => {
    authState.current = user
    const description = ' ' + '😀'.repeat(299) + '\n'
    const issuesBefore = sqlite.prepare('SELECT id, title, description FROM ct_issues ORDER BY id').all()
    const reportsBefore = sqlite.prepare('SELECT COUNT(*) AS count FROM ct_abuse_reports').get()
    const response = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody({ description }) }, env())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'description must be at most 300 code points' })
    expect(moderateSubmission).not.toHaveBeenCalled()
    expect(sqlite.prepare('SELECT id, title, description FROM ct_issues ORDER BY id').all()).toEqual(issuesBefore)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM ct_abuse_reports').get()).toEqual(reportsBefore)
  })

  it('省略選填簡介仍可正常建立議題', async () => {
    authState.current = user
    const response = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody({ description: undefined }) }, env())

    expect(response.status).toBe(201)
    const { id } = (await response.json()) as { id: number }
    expect(sqlite.prepare('SELECT description FROM ct_issues WHERE id = ?').get(id)).toEqual({ description: '' })
  })

  it('拒絕非字串簡介，不讓錯誤型別繞過字數檢查', async () => {
    authState.current = user
    const issuesBefore = sqlite.prepare('SELECT id, title, description FROM ct_issues ORDER BY id').all()
    const response = await testApp().request('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: issueBody({ description: ['議'.repeat(301)] }) }, env())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'description must be a string' })
    expect(moderateSubmission).not.toHaveBeenCalled()
    expect(sqlite.prepare('SELECT id, title, description FROM ct_issues ORDER BY id').all()).toEqual(issuesBefore)
  })
})
