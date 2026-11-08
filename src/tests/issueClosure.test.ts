import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Hono } from 'hono'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { registerApiRoutes } from '../api/routes'
import type { IssueListItemWithAuthor } from '../db/queries'
import { provideI18n } from '../l10n'
import AdminView from '../views/Admin.vue'

const authState = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; image: null }
    role: 'user' | 'admin' | 'super-admin'
    banned: boolean
    nameChangeCooldownDays: number | null
  },
}))

vi.mock('../auth/authorization', () => ({
  hasDuplicateDisplayName: vi.fn(async () => false),
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
  tryGetAuthContext: vi.fn(async () => authState.current),
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

type TestApp = Hono<{ Bindings: { DB: D1Database; DB_AUTH: D1Database } }>

let sqlite: DatabaseSync
let db: D1Database

function testApp(): TestApp {
  const app = new Hono<{ Bindings: { DB: D1Database; DB_AUTH: D1Database } }>()
  registerApiRoutes(app as never)
  return app
}

function sqliteD1(): D1Database {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      return {
        async all<T>() {
          return { results: statement.all() as T[] }
        },
        bind(...values: SQLInputValue[]) {
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
const user = { user: { id: 'user-1', name: 'User One', email: 'user@example.com', image: null }, role: 'user' as const, banned: false, nameChangeCooldownDays: null }
const admin = { ...user, role: 'admin' as const }
const superAdmin = { ...user, role: 'super-admin' as const }

function seedIssue(status = 'collecting') {
  const seeded = sqlite
    .prepare('INSERT INTO ct_issues (title, description, status, author_id, author_name, author_email, show_email, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('Closure issue', 'Discussion remains available', status, 'issue-author-private-id', 'Issue author', 'private@example.com', 0, '2026-10-20 08:00:00')
  return Number(seeded.lastInsertRowid)
}

function send(app: TestApp, id: number, closed: unknown, reason: unknown) {
  return app.request(`/api/issues/${id}/closure`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ closed, reason }) }, env())
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new DatabaseSync(':memory:')
  for (const migration of migrations) sqlite.exec(migration)
  db = sqliteD1()
  authState.current = null
})

afterEach(() => sqlite.close())

describe('independent issue closure lifecycle', () => {
  it('persists the latest close/reopen reason in public and admin issue projections without changing discussion status', async () => {
    const id = seedIssue('published')
    const app = testApp()
    const hiddenId = seedIssue()
    sqlite.prepare('UPDATE ct_issues SET abuse_flagged = 3, is_closed = 1, closure_reason = ? WHERE id = ?').run('Private moderation reason', hiddenId)
    authState.current = admin

    const close = await send(app, id, true, '  已完成討論  ')
    expect(close.status).toBe(200)
    await expect(close.json()).resolves.toEqual({ ok: true })
    const firstState = sqlite.prepare('SELECT is_closed, closure_reason, closure_changed_at, status, last_activity_at FROM ct_issues WHERE id = ?').get(id) as {
      is_closed: number
      closure_reason: string
      closure_changed_at: string
      status: string
      last_activity_at: string
    }
    expect(firstState).toMatchObject({ is_closed: 1, closure_reason: '已完成討論', status: 'published', last_activity_at: '2026-10-20 08:00:00' })
    expect(firstState.closure_changed_at).toBeTruthy()

    authState.current = null
    const publicList = await app.request('/api/issues', undefined, env())
    const publicIssues = (await publicList.json()) as Record<string, unknown>[]
    const publicIssue = publicIssues.find(issue => issue.id === id)!
    expect(publicIssue).toMatchObject({ is_closed: 1, closure_reason: '已完成討論' })
    expect(publicIssue.closure_changed_at).toBeTruthy()
    expect(publicIssue).not.toHaveProperty('author_id')
    expect(publicIssue).not.toHaveProperty('show_email')
    expect(publicIssue).not.toHaveProperty('terms_version')
    const hiddenPublicIssue = publicIssues.find(issue => issue.id === hiddenId)!
    expect(hiddenPublicIssue).toMatchObject({ is_closed: 1, closure_reason: null })

    const publicDetail = await app.request(`/api/issues/${id}`, undefined, env())
    const publicDetailPayload = (await publicDetail.json()) as { issue: Record<string, unknown> }
    expect(publicDetailPayload.issue).toMatchObject({ is_closed: 1, closure_reason: '已完成討論' })
    expect(publicDetailPayload.issue).not.toHaveProperty('author_id')
    expect(publicDetailPayload.issue).not.toHaveProperty('show_email')

    authState.current = admin
    const adminList = await app.request('/api/issues', undefined, env())
    const adminIssues = (await adminList.json()) as Record<string, unknown>[]
    const adminIssue = adminIssues.find(issue => issue.id === id)!
    expect(adminIssue).toMatchObject({ is_closed: 1, closure_reason: '已完成討論', author_id: 'issue-author-private-id' })
    const hiddenAdminIssue = adminIssues.find(issue => issue.id === hiddenId)!
    expect(hiddenAdminIssue).toMatchObject({ is_closed: 1, closure_reason: 'Private moderation reason', author_id: 'issue-author-private-id' })

    authState.current = superAdmin
    const reopen = await send(app, id, false, '  補充討論重新開放  ')
    expect(reopen.status).toBe(200)
    expect(sqlite.prepare('SELECT is_closed, closure_reason, closure_changed_at, status, last_activity_at FROM ct_issues WHERE id = ?').get(id)).toMatchObject({
      is_closed: 0,
      closure_reason: '補充討論重新開放',
      status: 'published',
      last_activity_at: '2026-10-20 08:00:00',
    })

    const reclose = await send(app, id, true, '最新的結案理由')
    expect(reclose.status).toBe(200)
    const beforeLegacyPut = sqlite.prepare('SELECT is_closed, closure_reason, closure_changed_at FROM ct_issues WHERE id = ?').get(id) as {
      is_closed: number
      closure_reason: string
      closure_changed_at: string
    }
    const legacyPut = await app.request(
      `/api/issues/${id}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Edited issue', status: 'summarizing' }) },
      env()
    )
    expect(legacyPut.status).toBe(200)
    expect(sqlite.prepare('SELECT is_closed, closure_reason, closure_changed_at, status FROM ct_issues WHERE id = ?').get(id)).toEqual({ ...beforeLegacyPut, status: 'summarizing' })
  })

  it('requires admin or super-admin access, validates reason and closed values, and reports missing or stale transitions', async () => {
    const id = seedIssue()
    const app = testApp()

    expect((await send(app, id, true, 'reason')).status).toBe(401)
    authState.current = user
    expect((await send(app, id, true, 'reason')).status).toBe(403)

    authState.current = admin
    const invalidBodies: unknown[] = [null, [], { closed: 'true', reason: 'reason' }, { closed: true, reason: 3 }, { closed: true, reason: '  \t  ' }, { closed: true, reason: '🍎'.repeat(1001) }]
    for (const body of invalidBodies) {
      const response = await app.request(`/api/issues/${id}/closure`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env())
      expect(response.status).toBe(400)
    }
    expect(sqlite.prepare('SELECT is_closed, closure_reason FROM ct_issues WHERE id = ?').get(id)).toEqual({ is_closed: 0, closure_reason: null })

    expect(
      (await app.request('/api/issues/9999/closure', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ closed: true, reason: 'Missing' }) }, env())).status
    ).toBe(404)
    expect((await send(app, id, true, '🍎'.repeat(1000))).status).toBe(200)
    expect((await send(app, id, true, 'Already closed')).status).toBe(409)

    const competingReopens = await Promise.all([send(app, id, false, 'Reopen A'), send(app, id, false, 'Reopen B')])
    expect(competingReopens.map(response => response.status).sort((a, b) => a - b)).toEqual([200, 409])
    expect((await send(app, id, false, 'Already open')).status).toBe(409)
    expect(sqlite.prepare('SELECT is_closed, closure_reason FROM ct_issues WHERE id = ?').get(id)).toMatchObject({
      is_closed: 0,
      closure_reason: expect.stringMatching(/^Reopen [AB]$/),
    })
  })

  it('blocks cancellation and duplicate submission while pending, then preserves the reason across conflict and cancel/reopen', async () => {
    const id = seedIssue('published')
    authState.current = admin
    const app = testApp()
    const response = await app.request('/api/issues', undefined, env())
    const issues = (await response.json()) as IssueListItemWithAuthor[]
    let editor!: {
      issues: IssueListItemWithAuthor[]
      closureIssue: IssueListItemWithAuthor | null
      closureReason: string
      openClosure: (issue: IssueListItemWithAuthor, event: MouseEvent) => void
      closeClosure: () => void
      saveClosure: () => Promise<void>
    }
    const view = createSSRApp(AdminView)
    provideI18n(view, 'zh-TW')
    view.mixin({
      created() {
        if (this.$.parent !== null) return
        // Vue 的公開型別未列出 setupState；沿用後台整合測試的實際操作入口。
        const instance = this.$ as unknown as { setupState: typeof editor }
        editor = instance.setupState
      },
    })
    await renderToString(view)
    // SSR 沒有 DOM，聚焦來源留空；不影響表單與請求操作。
    const event = { currentTarget: null } as unknown as MouseEvent
    editor.issues = issues
    editor.openClosure(
      issues.find(issue => issue.id === id)!,
      event
    )
    editor.closureReason = '仍有補充資料需要討論'

    // 另一位管理員先結案；本機表單仍持有開啟視窗時的進行中狀態。
    expect((await send(app, id, true, '另一位管理員先完成結案')).status).toBe(200)
    const statuses: number[] = []
    let releaseRequest!: () => void
    // 專案的 TypeScript lib 尚未提供 ES2024 Promise.withResolvers。
    const requestGate = new Promise<void>(resolve => {
      releaseRequest = resolve
    })
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') await requestGate
      const result = await app.request(input, init, env())
      if (init?.method === 'PATCH') statuses.push(result.status)
      return result
    })
    try {
      const saving = editor.saveClosure()
      // Escape、取消鈕與霧面都走相同的關閉守門，送出中不得丟失議題與草稿。
      editor.closeClosure()
      await editor.saveClosure()
      expect(editor.closureIssue?.id).toBe(id)
      expect(editor.closureReason).toBe('仍有補充資料需要討論')
      expect(statuses).toEqual([])
      releaseRequest()
      await saving
      expect(statuses).toEqual([409])
      expect(sqlite.prepare('SELECT is_closed, closure_reason FROM ct_issues WHERE id = ?').get(id)).toEqual({ is_closed: 1, closure_reason: '另一位管理員先完成結案' })

      editor.closeClosure()
      editor.openClosure(
        editor.issues.find(issue => issue.id === id)!,
        event
      )
      expect(editor.closureIssue?.is_closed).toBe(1)
      expect(editor.closureReason).toBe('仍有補充資料需要討論')
      await editor.saveClosure()
      expect(statuses).toEqual([409, 200])
      expect(sqlite.prepare('SELECT is_closed, closure_reason FROM ct_issues WHERE id = ?').get(id)).toEqual({ is_closed: 0, closure_reason: '仍有補充資料需要討論' })

      editor.openClosure(
        editor.issues.find(issue => issue.id === id)!,
        event
      )
      expect(editor.closureReason).toBe('')
    } finally {
      vi.unstubAllGlobals()
      releaseRequest()
    }
  })

  it('keeps closed issues available for opinion submission, voting, and CSV export', async () => {
    const id = seedIssue('collecting')
    const app = testApp()
    authState.current = admin
    expect((await send(app, id, true, 'Discussion complete')).status).toBe(200)

    authState.current = user
    const submission = await app.request(
      `/api/issues/${id}/opinions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'A comment on the closed issue', terms_accepted: true, show_email: false }),
      },
      env()
    )
    expect(submission.status).toBe(201)
    const submitted = (await submission.json()) as { id: number }
    const opinionId = submitted.id

    authState.current = { ...user, user: { ...user.user, id: 'voter-2', name: 'Voter Two', email: 'voter@example.com' } }
    const vote = await app.request(`/api/opinions/${opinionId}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 1 }) }, env())
    expect(vote.status).toBe(200)
    await expect(vote.json()).resolves.toMatchObject({ my_vote: 1, can_vote: true })

    const opinions = await app.request(`/api/issues/${id}/opinions`, undefined, env())
    await expect(opinions.json()).resolves.toMatchObject([{ summary: 'A comment on the closed issue' }])
    const csv = await app.request(`/api/issues/${id}/opinions/comments.csv`, undefined, env())
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('A comment on the closed issue')
    expect(sqlite.prepare('SELECT is_closed, status FROM ct_issues WHERE id = ?').get(id)).toEqual({ is_closed: 1, status: 'collecting' })
  })
})
