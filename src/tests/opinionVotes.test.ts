import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vite-plus/test'
import { deleteIssueCascade, deleteOpinion, listOpinionsForViewer, upsertOpinionVote } from '../db/queries'

function fakeDb(firstRows: unknown[] = [], allRows: unknown[] = []) {
  const sql: string[] = []
  const binds: unknown[][] = []
  let firstIndex = 0
  function makeStatement(statementIndex: number) {
    const statement = {
      bind(...args: unknown[]) {
        binds[statementIndex] = args
        return statement
      },
      async first() {
        return firstRows[firstIndex++] ?? null
      },
      async all() {
        return { results: allRows }
      },
      async run() {
        return { meta: { changes: 1, last_row_id: 1 } }
      },
    }
    return statement
  }
  return {
    sql,
    binds,
    db: {
      prepare(query: string) {
        const statementIndex = sql.length
        sql.push(query)
        return makeStatement(statementIndex)
      },
    } as unknown as D1Database,
  }
}

describe('opinion vote queries', () => {
  it('runs the issue-scoped aggregate against SQLite and preserves vote visibility', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(`
      CREATE TABLE ct_opinions (
        id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL, summary TEXT, created_at TEXT,
        abuse_flagged INTEGER NOT NULL, author_id TEXT, author_name TEXT, author_email TEXT,
        show_email INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE ct_opinion_votes (
        id INTEGER PRIMARY KEY, opinion_id INTEGER NOT NULL, voter_id TEXT NOT NULL,
        value INTEGER NOT NULL, UNIQUE(opinion_id, voter_id)
      );
      CREATE INDEX idx_ct_opinions_issue_id ON ct_opinions(issue_id);
      CREATE INDEX idx_ct_opinion_votes_opinion ON ct_opinion_votes(opinion_id);
      CREATE INDEX idx_ct_opinion_votes_voter ON ct_opinion_votes(voter_id);
      INSERT INTO ct_opinions VALUES
        (1, 7, 'first',  '2026-09-01 00:00:00', 0, 'author-1', 'Author 1', NULL, 0),
        (2, 7, 'second', '2026-09-02 00:00:00', 0, 'author-2', 'Author 2', NULL, 0),
        (3, 8, 'other issue', '2026-09-03 00:00:00', 0, 'author-3', 'Author 3', NULL, 0);
      INSERT INTO ct_opinion_votes (opinion_id, voter_id, value) VALUES
        (1, 'viewer', 1), (1, 'other', -1), (3, 'viewer', -1), (3, 'other', -1);
    `)

    const db = {
      prepare(query: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async all() {
                return { results: sqlite.prepare(query).all(...(args as (string | number | null)[])) }
              },
            }
          },
        }
      },
    } as unknown as D1Database

    const opinions = await listOpinionsForViewer(db, 7, 'viewer')

    expect(opinions.map(opinion => opinion.id)).toEqual([2, 1])
    expect(opinions[0]).toMatchObject({ vote_agree: null, vote_disagree: null, my_vote: null, can_view_vote_distribution: false })
    expect(opinions[1]).toMatchObject({ vote_agree: 2, vote_disagree: 1, vote_pass: 0, my_vote: 1, can_view_vote_distribution: true })
  })

  it('projects numeric vote state only through the viewer-aware aggregate query', async () => {
    const { db, sql, binds } = fakeDb(
      [],
      [
        {
          id: 4,
          issue_id: 2,
          summary: 'opinion',
          created_at: '2026-09-01 00:00:00',
          author_name: 'Author',
          author_email: null,
          abuse_flagged: 0,
          vote_agree: null,
          vote_disagree: null,
          vote_pass: null,
          my_vote: null,
          can_view_vote_distribution: 0,
          can_vote: 1,
          is_author: 0,
        },
      ]
    )
    const [opinion] = await listOpinionsForViewer(db, 2, null, 'responses')
    expect(opinion).toMatchObject({ vote_agree: null, vote_disagree: null, vote_pass: null, my_vote: null, can_view_vote_distribution: false, can_vote: true, is_author: false })
    expect(sql[0]).toContain('vote_counts')
    expect(sql[0]).toContain('WHERE opinion_id IN (SELECT id FROM ct_opinions WHERE issue_id = ?)')
    expect(sql[0]).toContain('ORDER BY COALESCE(vc.agree_count, 0)')
    expect(binds[0]).toEqual([null, 2, 2])
  })

  it('uses atomic upsert and preserves the returned viewer state', async () => {
    const { db, sql, binds } = fakeDb(
      [
        { author_id: 'author', abuse_flagged: 0 },
        {
          vote_agree: 2,
          vote_disagree: 1,
          vote_pass: 0,
          my_vote: 1,
          can_view_vote_distribution: 1,
          can_vote: 1,
          is_author: 0,
        },
      ],
      []
    )
    const result = await upsertOpinionVote(db, 4, 'voter', 1)
    expect(result).toEqual({ state: { vote_agree: 2, vote_disagree: 1, vote_pass: 0, my_vote: 1, can_view_vote_distribution: true, can_vote: true, is_author: false } })
    expect(sql.some(query => query.includes('ON CONFLICT(opinion_id, voter_id) DO UPDATE'))).toBe(true)
    expect(sql[2]).toContain('WHERE opinion_id = ?')
    expect(binds[2]).toEqual(['voter', 4, 4])
  })

  it('deletes vote rows before opinions and before issue cascade removes opinions', async () => {
    const opinionDb = fakeDb()
    await deleteOpinion(opinionDb.db, 8)
    expect(opinionDb.sql[0]).toContain('DELETE FROM ct_opinion_votes')

    const issueDb = fakeDb()
    await deleteIssueCascade(issueDb.db, 2)
    expect(issueDb.sql[0]).toContain('ct_opinion_votes')
    expect(issueDb.sql[1]).toContain('ct_opinions')
  })
})
