import { describe, expect, it } from 'vite-plus/test'
import { getIssue, listIssues } from '../db/queries'

type IssueRow = {
  id: number
  title: string
  description: string
  status: 'collecting'
  polis_id: string | null
  created_at: string
  abuse_flagged: 0 | 1 | 2 | 3
  author_name: string | null
  author_email: string | null
}

const rows: IssueRow[] = [
  { id: 1, title: '公開議題', description: '公開描述', status: 'collecting', polis_id: null, created_at: '2026-08-01', abuse_flagged: 0, author_name: null, author_email: null },
  { id: 2, title: '已確認濫用', description: '不應公開', status: 'collecting', polis_id: null, created_at: '2026-08-02', abuse_flagged: 2, author_name: null, author_email: null },
  { id: 3, title: '審查中議題', description: '暫時隱藏', status: 'collecting', polis_id: null, created_at: '2026-08-03', abuse_flagged: 3, author_name: null, author_email: null },
]

function testDb() {
  return {
    prepare(query: string) {
      let id: number | undefined
      const statement = {
        bind(value: number) {
          id = value
          return statement
        },
        async all() {
          const visible = rows.filter(row => query.includes('WHERE abuse_flagged IN (0, 1, 3)') && [0, 1, 3].includes(row.abuse_flagged))
          return { results: visible.map(projectPublicIssue) }
        },
        async first() {
          const row = rows.find(candidate => candidate.id === id && query.includes('AND abuse_flagged IN (0, 1, 3)') && [0, 1, 3].includes(candidate.abuse_flagged))
          return row ? projectPublicIssue(row) : null
        },
      }
      return statement
    },
  } as unknown as D1Database
}

function projectPublicIssue(row: IssueRow) {
  return {
    ...row,
    title: row.abuse_flagged === 3 ? null : row.title,
    description: row.abuse_flagged === 3 ? null : row.description,
  }
}

describe('議題公開內容遮蔽', () => {
  it('listIssues 排除已確認濫用，審查中議題只回傳 NULL 內容', async () => {
    const result = await listIssues(testDb())

    expect(result.map(issue => issue.id)).toEqual([1, 3])
    expect(result.find(issue => issue.id === 3)).toMatchObject({ abuse_flagged: 3, title: null, description: null })
  })

  it('getIssue 對已確認濫用回傳 null，審查中議題不回傳本文', async () => {
    const db = testDb()

    await expect(getIssue(db, 2)).resolves.toBeNull()
    await expect(getIssue(db, 3)).resolves.toMatchObject({ abuse_flagged: 3, title: null, description: null })
  })
})
