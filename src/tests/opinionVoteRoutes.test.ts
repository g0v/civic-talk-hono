import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vite-plus/test'
import { registerApiRoutes } from '../api/routes'

const authContext = vi.hoisted(() => ({ current: null as null | { user: { id: string; name: string; email: string; image: null }; role: 'user' | 'admin'; banned: boolean; nameChangeCooldownDays: null } }))

vi.mock('../auth/authorization', () => ({
  isAdminRole: (role: string) => role === 'admin',
  tryGetAuthContext: vi.fn(async () => authContext.current),
}))

function appWithDb(db: D1Database) {
  const app = new Hono<{ Bindings: { DB: D1Database; DB_AUTH: D1Database } }>()
  registerApiRoutes(app as never)
  return app
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
  it('returns 401 for anonymous vote writes but allows authenticated CSV access for banned sessions', async () => {
    const db = fakeDb()
    authContext.current = null
    const anonymous = await appWithDb(db).request('/api/opinions/1/vote', { method: 'POST', body: JSON.stringify({ value: 1 }) }, { ...env, DB: db })
    expect(anonymous.status).toBe(401)

    authContext.current = { user: { id: 'banned-user', name: 'Banned', email: 'banned@example.com', image: null }, role: 'user', banned: true, nameChangeCooldownDays: null }
    const bannedWrite = await appWithDb(db).request('/api/opinions/1/vote', { method: 'POST', body: JSON.stringify({ value: 1 }) }, { ...env, DB: db })
    expect(bannedWrite.status).toBe(403)
    const csv = await appWithDb(db).request('/api/issues/2/opinions/comments.csv', undefined, { ...env, DB: db })
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(csv.headers.get('content-disposition')).toContain('civic-talk-issue-2-comments.csv')
  })

  it('rejects unknown sort values before querying', async () => {
    authContext.current = null
    const response = await appWithDb(fakeDb()).request('/api/issues/2/opinions?sort=popular', undefined, { ...env, DB: fakeDb() })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'sort must be "recent" or "responses"' })
  })
})
