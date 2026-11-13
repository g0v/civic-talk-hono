import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vite-plus/test'
import { registerApiRoutes } from '../api/routes'
import type { OpinionWithVote } from '../db/queries'

const authContext = vi.hoisted(() => ({
  current: null as null | { user: { id: string; name: string; email: string; image: null }; role: 'user' | 'admin'; banned: boolean; nameChangeCooldownDays: null },
}))

vi.mock('../auth/authorization', () => ({
  isAdminRole: (role: string) => role === 'admin',
  tryGetAuthContext: vi.fn(async () => authContext.current),
}))

function appWithDb() {
  const app = new Hono<{ Bindings: { DB: D1Database; DB_AUTH: D1Database } }>()
  registerApiRoutes(app as never)
  return app
}

async function withVoteDatabase(run: (db: D1Database) => Promise<void>) {
  const sqlite = new DatabaseSync(':memory:')
  authContext.current = null
  try {
    sqlite.exec(`
      CREATE TABLE ct_opinions (
        id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL, summary TEXT, created_at TEXT,
        abuse_flagged INTEGER NOT NULL, author_id TEXT, author_name TEXT, author_email TEXT,
        show_email INTEGER NOT NULL DEFAULT 0, terms_version TEXT, terms_accepted_at TEXT
      );
      CREATE TABLE ct_opinion_votes (
        id INTEGER PRIMARY KEY, opinion_id INTEGER NOT NULL, voter_id TEXT NOT NULL,
        value INTEGER NOT NULL, created_at TEXT, updated_at TEXT, UNIQUE(opinion_id, voter_id)
      );
      INSERT INTO ct_opinions (id, issue_id, summary, created_at, abuse_flagged, author_id, author_name, author_email, show_email) VALUES
        (1, 7, 'first', '2026-11-01', 0, 'author', '投稿者', 'private@example.test', 0),
        (2, 7, 'second', '2026-11-02', 0, 'second-author', '第二位', 'public@example.test', 1),
        (3, 8, 'other issue', '2026-11-03', 0, 'foreign-author', NULL, NULL, 0),
        (4, 7, 'legacy', '2026-11-04', 0, NULL, NULL, NULL, 0),
        (5, 7, 'hidden content', '2026-11-05', 3, 'hidden-author', NULL, NULL, 0),
        (6, 7, 'pending review', '2026-11-06', 1, 'pending-author', NULL, NULL, 0),
        (7, 7, 'confirmed abuse', '2026-11-07', 2, 'confirmed-author', NULL, NULL, 0);
      INSERT INTO ct_opinion_votes (opinion_id, voter_id, value) VALUES
        (1, 'voter', 1), (1, 'other', -1), (1, 'passer', 0),
        (3, 'foreign-voter', 1), (5, 'hidden-voter', 1), (7, 'confirmed-voter', 1);
    `)
    const db = {
      prepare(query: string) {
        return {
          bind(...args: (string | number | null)[]) {
            return {
              async all() {
                return { results: sqlite.prepare(query).all(...args) }
              },
              async first() {
                return sqlite.prepare(query).get(...args) ?? null
              },
              async run() {
                const result = sqlite.prepare(query).run(...args)
                return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
              },
            }
          },
        }
      },
    } as unknown as D1Database
    await run(db)
  } finally {
    sqlite.close()
    authContext.current = null
  }
}

function fakeDb() {
  const state = {
    vote: { vote_agree: 1, vote_disagree: 0, vote_pass: 0, my_vote: 1, can_view_vote_distribution: 1, can_vote: 1, is_author: 0 },
    exportRows: [{ id: 1, summary: 'comment', created_at: '2026-09-01 00:00:00', author_id: null, agrees: 1, disagrees: 0 }],
  }
  return {
    prepare(sql: string) {
      return {
        bind() {
          return this
        },
        async all() {
          if (sql.includes('ct_opinion_votes') && sql.includes('vote_counts')) return { results: [state.exportRows[0]] }
          return { results: [{ id: 1, issue_id: 2, summary: 'comment', created_at: '2026-09-01 00:00:00', author_name: null, author_email: null, abuse_flagged: 0, ...state.vote }] }
        },
        async first() {
          if (sql.includes('SELECT author_id, abuse_flagged')) return { author_id: null, abuse_flagged: 0 }
          return state.vote
        },
        async run() {
          return { meta: { changes: 1, last_row_id: 1 } }
        },
      }
    },
  } as unknown as D1Database
}

const env = { DB_AUTH: {} as D1Database }

describe('opinion vote routes', () => {
  it('公開回應總數與兩種排序一致，包含作者預設票、略過與零票，但不揭露分布或私人作者欄位', async () => {
    await withVoteDatabase(async db => {
      for (const sort of ['recent', 'responses']) {
        const response = await appWithDb().request(`/api/issues/7/opinions?sort=${sort}`, undefined, { ...env, DB: db })
        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toContain('no-store')
        expect(response.headers.get('Vary')).toContain('Cookie')
        const opinions = (await response.json()) as OpinionWithVote[]
        expect(Object.fromEntries(opinions.map(opinion => [opinion.id, opinion.response_count]))).toEqual({ 1: 4, 2: 1, 4: 0, 5: null, 6: 1 })
        expect(opinions.map(opinion => opinion.id)).toEqual(sort === 'recent' ? [6, 5, 4, 2, 1] : [1, 5, 6, 2, 4])
        for (const opinion of opinions) {
          expect(opinion).toMatchObject({ vote_agree: null, vote_disagree: null, vote_pass: null, my_vote: null, can_view_vote_distribution: false })
          expect(opinion).not.toHaveProperty('author_id')
          expect(opinion).not.toHaveProperty('show_email')
        }
        expect(opinions.find(opinion => opinion.id === 1)?.author_email).toBeNull()
        expect(opinions.find(opinion => opinion.id === 2)?.author_email).toBe('public@example.test')
        expect(opinions.find(opinion => opinion.id === 5)?.summary).toBeNull()
      }
    })
  })

  it('未投票者與作者看到相同總數，分布守門不變，管理端隱藏意見也不公開總數', async () => {
    await withVoteDatabase(async db => {
      const session = (id: string, role: 'user' | 'admin' = 'user') => ({ user: { id, name: '測試', email: 'session@example.test', image: null }, role, banned: false, nameChangeCooldownDays: null })
      authContext.current = session('non-voter')
      const nonVoter = (await (await appWithDb().request('/api/issues/7/opinions', undefined, { ...env, DB: db })).json()) as OpinionWithVote[]
      expect(nonVoter.find(opinion => opinion.id === 1)).toMatchObject({ response_count: 4, vote_agree: null, vote_disagree: null, vote_pass: null, can_view_vote_distribution: false })
      authContext.current = session('author')
      const author = (await (await appWithDb().request('/api/issues/7/opinions', undefined, { ...env, DB: db })).json()) as OpinionWithVote[]
      expect(author.find(opinion => opinion.id === 1)).toMatchObject({ response_count: 4, vote_agree: 2, vote_disagree: 1, vote_pass: 1, can_view_vote_distribution: true, is_author: true, can_vote: false })
      authContext.current = session('admin', 'admin')
      const admin = (await (await appWithDb().request('/api/issues/7/opinions', undefined, { ...env, DB: db })).json()) as OpinionWithVote[]
      expect(admin.find(opinion => opinion.id === 5)?.response_count).toBeNull()
      expect(admin.find(opinion => opinion.id === 7)?.response_count).toBeNull()
    })
  })

  it('投票、改票與撤回回傳即時總數，改票不重複計數，撤回後仍遮蔽分布', async () => {
    await withVoteDatabase(async db => {
      authContext.current = { user: { id: 'voter', name: '投票者', email: 'voter@example.test', image: null }, role: 'user', banned: false, nameChangeCooldownDays: null }
      const send = (method: 'POST' | 'DELETE', value?: number, id = 1) => appWithDb().request(`/api/opinions/${id}/vote`, { method, headers: { 'Content-Type': 'application/json' }, ...(value !== undefined ? { body: JSON.stringify({ value }) } : {}) }, { ...env, DB: db })
      const withdrawn = await send('DELETE')
      expect(withdrawn.status).toBe(200)
      expect(await withdrawn.json()).toMatchObject({ response_count: 3, vote_agree: null, vote_disagree: null, vote_pass: null, my_vote: null, can_view_vote_distribution: false })
      const added = await send('POST', 0)
      expect(added.status).toBe(200)
      expect(await added.json()).toMatchObject({ response_count: 4, vote_agree: 1, vote_disagree: 1, vote_pass: 2, my_vote: 0 })
      const changed = await send('POST', -1)
      expect(changed.status).toBe(200)
      expect(await changed.json()).toMatchObject({ response_count: 4, vote_agree: 1, vote_disagree: 2, vote_pass: 1, my_vote: -1 })
      expect(await (await send('DELETE')).json()).toMatchObject({ response_count: 3, vote_agree: null, vote_disagree: null, vote_pass: null })
      authContext.current.user.id = 'author'
      expect((await send('POST', 1)).status).toBe(400)
      expect((await send('POST', 1, 999)).status).toBe(404)
    })
  })

  it('returns 401 for anonymous vote writes but allows authenticated CSV access for banned sessions', async () => {
    const db = fakeDb()
    authContext.current = null
    const anonymous = await appWithDb().request('/api/opinions/1/vote', { method: 'POST', body: JSON.stringify({ value: 1 }) }, { ...env, DB: db })
    expect(anonymous.status).toBe(401)

    authContext.current = { user: { id: 'banned-user', name: 'Banned', email: 'banned@example.com', image: null }, role: 'user', banned: true, nameChangeCooldownDays: null }
    const bannedWrite = await appWithDb().request('/api/opinions/1/vote', { method: 'POST', body: JSON.stringify({ value: 1 }) }, { ...env, DB: db })
    expect(bannedWrite.status).toBe(403)
    const csv = await appWithDb().request('/api/issues/2/opinions/comments.csv', undefined, { ...env, DB: db })
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(csv.headers.get('content-disposition')).toContain('civic-talk-issue-2-comments.csv')
  })

  it('rejects unknown sort values before querying', async () => {
    authContext.current = null
    const response = await appWithDb().request('/api/issues/2/opinions?sort=popular', undefined, { ...env, DB: fakeDb() })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'sort must be "recent" or "responses"' })
  })
})
