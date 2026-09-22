import { describe, expect, it } from 'vite-plus/test'
import { deleteIssueCascade, deleteOpinion, listOpinionsForViewer, upsertOpinionVote } from '../db/queries'

function fakeDb(firstRows: unknown[] = [], allRows: unknown[] = []) {
  const sql: string[] = []
  let firstIndex = 0
  const statement = {
    bind() {
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
  return {
    sql,
    db: { prepare(query: string) { sql.push(query); return statement } } as unknown as D1Database,
  }
}

describe('opinion vote queries', () => {
  it('projects numeric vote state only through the viewer-aware aggregate query', async () => {
    const { db, sql } = fakeDb([], [
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
    ])
    const [opinion] = await listOpinionsForViewer(db, 2, null, 'responses')
    expect(opinion).toMatchObject({ vote_agree: null, vote_disagree: null, vote_pass: null, my_vote: null, can_view_vote_distribution: false, can_vote: true, is_author: false })
    expect(sql[0]).toContain('vote_counts')
    expect(sql[0]).toContain('ORDER BY COALESCE(vc.agree_count, 0)')
  })

  it('uses atomic upsert and preserves the returned viewer state', async () => {
    const { db, sql } = fakeDb(
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
      [],
    )
    const result = await upsertOpinionVote(db, 4, 'voter', 1)
    expect(result).toEqual({ state: { vote_agree: 2, vote_disagree: 1, vote_pass: 0, my_vote: 1, can_view_vote_distribution: true, can_vote: true, is_author: false } })
    expect(sql.some(query => query.includes('ON CONFLICT(opinion_id, voter_id) DO UPDATE'))).toBe(true)
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
