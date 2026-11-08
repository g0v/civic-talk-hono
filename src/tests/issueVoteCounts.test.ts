import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { listIssues, listIssuesWithAuthor, type IssueListItem } from '../db/queries'

const databases: DatabaseSync[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const database of databases.splice(0)) database.close()
})

function dataset() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  sqlite.exec(`
    CREATE TABLE ct_issues (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, polis_id TEXT,
      created_at TEXT, tags TEXT, is_closed INTEGER DEFAULT 0, closure_reason TEXT,
      closure_changed_at TEXT, abuse_flagged INTEGER DEFAULT 0, author_id TEXT,
      author_name TEXT, author_email TEXT, show_email INTEGER DEFAULT 0,
      terms_version TEXT, terms_accepted_at TEXT, last_activity_at TEXT
    );
    CREATE TABLE ct_materials (id INTEGER PRIMARY KEY, issue_id INTEGER, abuse_flagged INTEGER);
    CREATE TABLE ct_opinions (id INTEGER PRIMARY KEY, issue_id INTEGER, author_id TEXT, abuse_flagged INTEGER);
    CREATE INDEX idx_ct_opinions_issue_id ON ct_opinions(issue_id);
    CREATE TABLE ct_opinion_votes (
      id INTEGER PRIMARY KEY, opinion_id INTEGER, voter_id TEXT, value INTEGER,
      UNIQUE(opinion_id, voter_id)
    );
    CREATE INDEX idx_ct_opinion_votes_opinion ON ct_opinion_votes(opinion_id);
    INSERT INTO ct_issues (id, title, status, tags, author_id, author_name, author_email, show_email) VALUES
      (1, 'first', 'published', '[]', 'private-author', 'Author', 'private@example.com', 0),
      (2, 'empty', 'published', '[]', 'public-author', 'Public Author', 'public@example.com', 1),
      (3, 'legacy', 'published', '[]', NULL, NULL, NULL, 0);
    INSERT INTO ct_opinions VALUES
      (1, 1, 'same-author', 0), (2, 1, 'same-author', 1), (3, 1, NULL, 0),
      (4, 1, 'hidden-author', 2), (5, 1, 'hidden-author', 3), (6, 3, NULL, 0);
    INSERT INTO ct_opinion_votes (opinion_id, voter_id, value) VALUES
      (1, 'viewer', 1), (1, 'other', -1), (1, 'passer', 0), (2, 'viewer', 0),
      (4, 'viewer', 1), (5, 'viewer', 1);
  `)
  let reads = 0
  const db = {
    prepare(sql: string) {
      return {
        async all() {
          reads++
          return { results: sqlite.prepare(sql).all() }
        },
      }
    },
  } as unknown as D1Database
  return { db, sqlite, reads: () => reads }
}

function installCache() {
  const entries = new Map<string, Response>()
  vi.stubGlobal('caches', {
    default: {
      async match(key: Request) {
        return entries.get(key.url)?.clone()
      },
      async put(key: Request, response: Response) {
        entries.set(key.url, response.clone())
      },
      async delete(key: Request) {
        return entries.delete(key.url)
      },
    },
  })
  return entries
}

function totals(issues: IssueListItem[]) {
  return Object.fromEntries(issues.map(issue => [issue.id, issue.vote_count]))
}

describe('首頁公開累計票數（#178）', () => {
  it('counts all three vote values and each named opinion author once, excluding hidden opinions', async () => {
    const { db } = dataset()
    expect(totals(await listIssues(db))).toEqual({ 1: 6, 2: 0, 3: 0 })
  })

  it('reflects changed votes, withdrawals, moderation and opinion removal without a cache', async () => {
    const { db, sqlite } = dataset()
    sqlite.exec("UPDATE ct_opinion_votes SET value = -1 WHERE opinion_id = 1 AND voter_id = 'viewer'")
    expect(totals(await listIssues(db))[1]).toBe(6)
    sqlite.exec("DELETE FROM ct_opinion_votes WHERE opinion_id = 1 AND voter_id = 'viewer'")
    expect(totals(await listIssues(db))[1]).toBe(5)
    sqlite.exec('UPDATE ct_opinions SET abuse_flagged = 3 WHERE id = 1')
    expect(totals(await listIssues(db))[1]).toBe(2)
    sqlite.exec('DELETE FROM ct_opinions WHERE id = 2')
    expect(totals(await listIssues(db))[1]).toBe(0)
  })

  it('shares only aggregate counts between SSR and admin API while keeping issue projections fresh and private', async () => {
    const { db, sqlite, reads } = dataset()
    const entries = installCache()
    const publicIssues = await listIssues(db, 'https://civic.example/?search=first')
    expect(publicIssues.find(issue => issue.id === 1)).toMatchObject({ vote_count: 6, author_email: null })
    expect(publicIssues.find(issue => issue.id === 2)?.author_email).toBe('public@example.com')
    for (const issue of publicIssues) {
      expect(issue).not.toHaveProperty('author_id')
      expect(issue).not.toHaveProperty('show_email')
    }
    const coldReads = reads()
    sqlite.exec("UPDATE ct_issues SET title = 'changed' WHERE id = 1; DELETE FROM ct_opinion_votes WHERE opinion_id = 1;")
    const adminIssues = await listIssuesWithAuthor(db, 'https://civic.example/api/issues')
    expect(reads() - coldReads).toBe(1)
    expect(adminIssues.find(issue => issue.id === 1)).toMatchObject({ title: 'changed', vote_count: 6, author_id: 'private-author', author_email: 'private@example.com' })
    expect(entries.size).toBe(1)
    const cached = [...entries.values()][0]!
    const payload = (await cached.clone().json()) as { counts: [number, number][] }
    expect(payload.counts).toEqual([
      [1, 6],
      [3, 0],
    ])
    expect(Object.keys(payload).sort()).toEqual(['counts', 'expires_at'])
    const returnedPublicIssues = await listIssues(db, 'https://civic.example/')
    expect(returnedPublicIssues.find(issue => issue.id === 1)?.author_email).toBeNull()
    expect(returnedPublicIssues.find(issue => issue.id === 1)).not.toHaveProperty('author_id')
  })

  it('refreshes expired totals after five minutes and isolates different origins', async () => {
    vi.useFakeTimers()
    const { db, sqlite, reads } = dataset()
    installCache()
    expect(totals(await listIssues(db, 'https://production.example/'))[1]).toBe(6)
    sqlite.exec('DELETE FROM ct_opinion_votes WHERE opinion_id = 1')
    expect(totals(await listIssues(db, 'https://staging.example/'))[1]).toBe(3)
    vi.advanceTimersByTime(299_999)
    const beforeWarm = reads()
    expect(totals(await listIssues(db, 'https://production.example/api/issues'))[1]).toBe(6)
    expect(reads() - beforeWarm).toBe(1)
    vi.advanceTimersByTime(1)
    const beforeExpired = reads()
    expect(totals(await listIssues(db, 'https://production.example/'))[1]).toBe(3)
    expect(reads() - beforeExpired).toBe(2)
  })

  it('returns real totals when Cache API reads or writes fail', async () => {
    const { db } = dataset()
    vi.stubGlobal('caches', {
      default: {
        async match() {
          throw new Error('cache unavailable')
        },
        async put() {
          throw new Error('cache unavailable')
        },
      },
    })
    expect(totals(await listIssues(db, 'https://civic.example/'))).toEqual({ 1: 6, 2: 0, 3: 0 })
  })
})
