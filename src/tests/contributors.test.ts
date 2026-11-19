import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { registerContributorRoutes } from '../api/contributors'
import * as authorization from '../auth/authorization'
import type { AppBindings } from '../api/types'
import { getContributorPublicId, getIssue, listContributions, registerContributor } from '../db/queries'

// 使用真實 migration 與 SQLite；adapter 只轉換 D1 的非同步介面。
class SQLiteD1 {
  readonly sqlite = new DatabaseSync(':memory:')

  prepare(sql: string) {
    const statement = (values: SQLInputValue[] = []) => ({
      bind: (...bound: SQLInputValue[]) => statement(bound),
      first: async <T>() => (this.sqlite.prepare(sql).get(...values) ?? null) as T | null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values) as T[] }),
      run: async () => {
        const result = this.sqlite.prepare(sql).run(...values)
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    })
    return statement()
  }

  asD1(): D1Database {
    return this as unknown as D1Database
  }
}

const PUBLIC_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
let business: SQLiteD1
let auth: SQLiteD1
let app: Hono<{ Bindings: AppBindings }>
let bindings: AppBindings

beforeEach(() => {
  business = new SQLiteD1()
  auth = new SQLiteD1()
  const directory = new URL('../../migrations/', import.meta.url)
  for (const file of readdirSync(directory)
    .filter(name => name.endsWith('.sql'))
    .sort()) {
    business.sqlite.exec(readFileSync(new URL(file, directory), 'utf8'))
  }
  business.sqlite.exec('DELETE FROM ct_opinions; DELETE FROM ct_briefings; DELETE FROM ct_materials; DELETE FROM ct_issues; DELETE FROM ct_contributors;')
  auth.sqlite.exec(`CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, createdAt INTEGER, banned INTEGER, banExpires TEXT);
    INSERT INTO "user" VALUES ('owner-secret', '目前名稱', 'private@example.test', 1767225600000, 0, NULL);`)
  business.sqlite.exec(`INSERT INTO ct_contributors VALUES ('owner-secret', '${PUBLIC_ID}');
    INSERT INTO ct_issues (id,title,author_id,author_name,created_at) VALUES
      (1,'公開議題','owner-secret','舊名字','2026-01-02 00:00:00'),
      (2,'隱藏議題','owner-secret','舊名字','2026-01-03 00:00:00');
    UPDATE ct_issues SET abuse_flagged=3 WHERE id=2;
    INSERT INTO ct_materials (id,issue_id,source_name,content,author_id,created_at) VALUES
      (1,1,'來源標題','不要放進軌跡的素材全文','owner-secret','2026-02-02 00:00:00'),
      (2,2,'隱藏議題的來源','私密內容','owner-secret','2026-02-03 00:00:00');
    INSERT INTO ct_briefings (id,issue_id,version,consensus,narrative,author_id,created_at) VALUES
      (1,1,1,'同一共識','第一版說明','owner-secret','2026-03-01 00:00:00'),
      (2,1,2,'同一共識','第二版說明','owner-secret','2026-03-02 00:00:00');
    INSERT INTO ct_opinions (id,issue_id,summary,author_id,created_at) VALUES
      (1,1,'意見全文','owner-secret','2026-04-01 00:00:00'),
      (2,1,'同名但無歸屬',NULL,'2026-04-02 00:00:00');`)
  bindings = { DB: business.asD1(), DB_AUTH: auth.asD1() } as AppBindings
  app = new Hono<{ Bindings: AppBindings }>()
  registerContributorRoutes(app)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  business.sqlite.close()
  auth.sqlite.close()
})

describe('公開貢獻者軌跡', () => {
  it('migration 只新增 ct_ 表，跨投稿去重歸戶且不推測 NULL 作者', () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(`CREATE TABLE ct_issues (author_id TEXT); CREATE TABLE ct_materials (author_id TEXT);
        CREATE TABLE ct_briefings (author_id TEXT); CREATE TABLE ct_opinions (author_id TEXT);
        INSERT INTO ct_issues VALUES ('one'), (NULL);
        INSERT INTO ct_materials VALUES ('one'), ('two');
        INSERT INTO ct_briefings VALUES ('two');`)
      sqlite.exec(readFileSync(new URL('../../migrations/0019_contributors.sql', import.meta.url), 'utf8'))
      expect(sqlite.prepare('SELECT user_id FROM ct_contributors ORDER BY user_id').all()).toEqual([{ user_id: 'one' }, { user_id: 'two' }])
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'ct_%'").all()).toEqual([])
      expect(() => sqlite.prepare("INSERT INTO ct_contributors VALUES ('three', (SELECT public_id FROM ct_contributors WHERE user_id='one'))").run()).toThrow()
    } finally {
      sqlite.close()
    }
  })

  it('同帳號重複及併發取得識別碼不改網址，不同帳號不共用網址', async () => {
    await Promise.all([registerContributor(business.asD1(), 'new-user'), registerContributor(business.asD1(), 'new-user')])
    const first = await getContributorPublicId(business.asD1(), 'new-user')
    await registerContributor(business.asD1(), 'new-user')
    expect(await getContributorPublicId(business.asD1(), 'new-user')).toBe(first)
    expect(first).toMatch(/^[a-f0-9]{32}$/)
    expect(first).not.toBe(PUBLIC_ID)
  })

  it.each([true, false].flatMap(dev => (['issue', 'material', 'briefing', 'opinion'] as const).map(kind => ({ dev, kind }))))(
    'DEV=$dev 的新 $kind 投稿會自動建立穩定公開識別碼',
    async ({ dev, kind }) => {
      vi.stubEnv('DEV', dev)
      // SQL 欄位在模組載入時組合；必須重新載入，才能驗證兩種載入環境的投影。
      vi.resetModules()
      const queries = await import('../db/queries')
      const author = { author_id: 'new-author', author_name: '新作者', author_email: 'never-public@example.test', show_email: false, terms_version: 'test' }
      switch (kind) {
        case 'issue':
          await queries.createIssue(business.asD1(), { ...author, title: '新議題' })
          break
        case 'material':
          await queries.createMaterial(business.asD1(), 1, { ...author, content: '全文' })
          break
        case 'briefing':
          await queries.createBriefing(business.asD1(), 1, author, { narrative: '新說明' })
          break
        case 'opinion':
          await queries.createOpinion(business.asD1(), 1, { ...author, summary: '新意見' })
          break
      }
      const publicId = await queries.getContributorPublicId(business.asD1(), 'new-author')
      expect(publicId).toMatch(/^[a-f0-9]{32}$/)
      expect((await queries.listContributions(business.asD1(), 'new-author')).map(item => item.kind)).toEqual([kind])
      await queries.registerContributor(business.asD1(), 'new-author')
      expect(await queries.getContributorPublicId(business.asD1(), 'new-author')).toBe(publicId)
    }
  )

  it.each([false, true])('自己的識別碼端點拒絕未登入或停權者（停權=%s）', async banned => {
    vi.spyOn(authorization, 'tryGetAuthContext').mockResolvedValue(
      banned
        ? {
            user: { id: 'owner-secret', name: '目前名稱', email: 'private@example.test', image: null },
            role: 'user',
            banned: true,
            nameChangeCooldownDays: null,
          }
        : null
    )
    expect((await app.request('/api/contributors/me', {}, bindings)).status).toBe(banned ? 403 : 401)
  })

  it('登入者取得自己的公開網址而不回傳帳號資料', async () => {
    vi.spyOn(authorization, 'tryGetAuthContext').mockResolvedValue({
      user: { id: 'owner-secret', name: '目前名稱', email: 'private@example.test', image: null },
      role: 'user',
      banned: false,
      nameChangeCooldownDays: null,
    })
    const response = await app.request('/api/contributors/me', {}, bindings)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ public_id: PUBLIC_ID })
  })

  it('每個 briefing 版本各計一次，僅回傳正常公開且確定作者的事件', async () => {
    const response = await app.request(`/api/contributors/${PUBLIC_ID}`, {}, bindings)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.json()).toEqual({
      public_id: PUBLIC_ID,
      name: '目前名稱',
      joined_at: '2026-01-01T00:00:00.000Z',
      contributions: [
        { kind: 'opinion', id: 1, issue_id: 1, title: '公開議題', created_at: '2026-04-01 00:00:00', version: null },
        { kind: 'briefing', id: 2, issue_id: 1, title: '公開議題', created_at: '2026-03-02 00:00:00', version: 2 },
        { kind: 'briefing', id: 1, issue_id: 1, title: '公開議題', created_at: '2026-03-01 00:00:00', version: 1 },
        { kind: 'material', id: 1, issue_id: 1, title: '來源標題', created_at: '2026-02-02 00:00:00', version: null },
        { kind: 'issue', id: 1, issue_id: 1, title: '公開議題', created_at: '2026-01-02 00:00:00', version: null },
      ],
    })
  })

  it.each([1, 2, 3])('子內容被標記 %s 後不保留公開軌跡或計數', async flag => {
    business.sqlite.prepare('UPDATE ct_materials SET abuse_flagged=? WHERE id=1').run(flag)
    expect((await listContributions(business.asD1(), 'owner-secret')).map(item => `${item.kind}:${item.id}`)).toEqual(['opinion:1', 'briefing:2', 'briefing:1', 'issue:1'])
  })

  it('來源刪除後即消失，空軌跡仍保留帳號加入日期', async () => {
    business.sqlite.exec('DELETE FROM ct_opinions; DELETE FROM ct_briefings; DELETE FROM ct_materials; DELETE FROM ct_issues;')
    const response = await app.request(`/api/contributors/${PUBLIC_ID}`, {}, bindings)
    expect(await response.json()).toMatchObject({ joined_at: '2026-01-01T00:00:00.000Z', contributions: [] })
  })

  it.each(['invalid', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'])('未知或格式錯誤識別碼 %s 回 404', async publicId => {
    expect((await app.request(`/api/contributors/${publicId}`, {}, bindings)).status).toBe(404)
  })

  it('不存在及停權帳號不公開軌跡', async () => {
    auth.sqlite.exec('UPDATE "user" SET banned=1;')
    expect((await app.request(`/api/contributors/${PUBLIC_ID}`, {}, bindings)).status).toBe(404)
    auth.sqlite.exec('DELETE FROM "user";')
    expect((await app.request(`/api/contributors/${PUBLIC_ID}`, {}, bindings)).status).toBe(404)
  })

  it('公開議題只增加 publicId，不洩漏作者的內部 ID 或改寫快照', async () => {
    const issue = await getIssue(business.asD1(), 1)
    expect(issue).toMatchObject({ author_public_id: PUBLIC_ID, author_name: '舊名字', author_email: null })
    expect(issue).not.toHaveProperty('author_id')
    expect(issue).not.toHaveProperty('show_email')
  })

  it.each([true, false])('DEV=%s 的真實路由開放頁面與 API，並保留公開投影及登入守門', async dev => {
    vi.stubEnv('DEV', dev)
    // 路由與 SQL 都須在指定 DEV 值後載入；靜態 import 無法涵蓋模組初始化邊界。
    vi.resetModules()
    const currentAuthorization = await import('../auth/authorization')
    const context = vi.spyOn(currentAuthorization, 'tryGetAuthContext').mockResolvedValue(null)
    const { default: worker } = await import('../index')
    const authBefore = auth.sqlite.prepare('SELECT * FROM "user"').all()

    const response = await worker.request(`/api/contributors/${PUBLIC_ID}`, {}, bindings)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Vary')).toContain('Cookie')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const history = await response.json()
    expect(history).toMatchObject({ public_id: PUBLIC_ID, name: '目前名稱' })
    expect(JSON.stringify(history)).not.toMatch(/owner-secret|private@example|素材全文|意見全文|隱藏議題/)

    const page = await worker.request(`/contributors/${PUBLIC_ID}`, {}, bindings)
    expect(page.status).toBe(200)
    expect(page.headers.get('Content-Type')).toContain('text/html')
    expect(page.headers.get('Cache-Control')).toBe('private, no-store')
    expect(page.headers.get('Vary')).toContain('Cookie')
    expect(page.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const html = await page.text()
    expect(html).toContain('window.__PAGE__="contributor"')
    expect(html).toContain(PUBLIC_ID)
    expect(html).not.toMatch(/owner-secret|private@example|素材全文|意見全文|隱藏議題/)

    const detailResponse = await worker.request('/api/issues/1', {}, bindings)
    expect(detailResponse.status).toBe(200)
    type PublicSubmission = { id: number; author_public_id: string | null }
    const detail = await detailResponse.json() as { issue: PublicSubmission; materials: PublicSubmission[]; briefing: PublicSubmission; opinions: PublicSubmission[] }
    expect(detail.opinions.find(item => item.id === 2)).toMatchObject({ author_public_id: null })
    for (const item of [detail.issue, ...detail.materials, detail.briefing, detail.opinions.find(item => item.id === 1)]) {
      expect(item).toMatchObject({ author_public_id: PUBLIC_ID })
      expect(item).not.toHaveProperty('author_id')
      expect(item).not.toHaveProperty('show_email')
    }
    const opinionsResponse = await worker.request('/api/issues/1/opinions', {}, bindings)
    expect(opinionsResponse.status).toBe(200)
    expect(await opinionsResponse.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, author_public_id: PUBLIC_ID })]))

    expect((await worker.request('/api/contributors/me', {}, bindings)).status).toBe(401)
    context.mockResolvedValue({
      user: { id: 'owner-secret', name: '目前名稱', email: 'private@example.test', image: null },
      role: 'user',
      banned: false,
      nameChangeCooldownDays: null,
    })
    const ownResponse = await worker.request('/api/contributors/me', {}, bindings)
    expect(ownResponse.status).toBe(200)
    expect(await ownResponse.json()).toEqual({ public_id: PUBLIC_ID })
    expect((await worker.request('/contributors/invalid', {}, bindings)).status).toBe(404)
    auth.sqlite.exec('UPDATE "user" SET banned=1;')
    expect((await worker.request(`/contributors/${PUBLIC_ID}`, {}, bindings)).status).toBe(404)
    expect((await worker.request(`/api/contributors/${PUBLIC_ID}`, {}, bindings)).status).toBe(404)
    auth.sqlite.exec('UPDATE "user" SET banned=0;')
    expect(auth.sqlite.prepare('SELECT * FROM "user"').all()).toEqual(authBefore)
  })
})
