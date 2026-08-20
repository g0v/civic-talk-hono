import { describe, expect, it } from 'vite-plus/test'
import { createAbuseReport, createBriefing } from '../db/queries'

function briefingDb() {
  const sql: string[] = []
  const statement = {
    bind() {
      return statement
    },
    async first<T>() {
      return { version: 3 } as T
    },
    async run() {
      return { meta: { changes: 1, last_row_id: 3 } }
    },
  }
  return {
    sql,
    db: {
      prepare(query: string) {
        sql.push(query)
        return statement
      },
    } as unknown as D1Database,
  }
}

function abuseReportDb(insertChanges: number) {
  const sql: string[] = []
  const statement = {
    bind() {
      return statement
    },
    async run() {
      return { meta: { changes: insertChanges, last_row_id: 17 } }
    },
  }
  return {
    sql,
    db: {
      prepare(query: string) {
        sql.push(query)
        return statement
      },
      async batch() {
        return [{ meta: { changes: insertChanges, last_row_id: 17 } }, { meta: { changes: 1, last_row_id: 0 } }]
      },
    } as unknown as D1Database,
  }
}

describe('投稿寫入併發保護', () => {
  it('以單一 INSERT statement 原子計算並回傳 briefing 版號', async () => {
    const { db, sql } = briefingDb()

    await expect(createBriefing(db, 1, { author_id: 'user-1', author_name: 'User', author_email: 'user@example.com', show_email: false }, { consensus: '共識' })).resolves.toBe(3)

    expect(sql[0]).toContain('COALESCE(MAX(version), 0) + 1')
    expect(sql[0]).toContain('RETURNING version')
    expect(sql[0]).not.toContain('SELECT MAX(version) as maxv')
  })

  it('在同一個 batch 中建立使用者回報與標示目標內容', async () => {
    const { db, sql } = abuseReportDb(1)

    await expect(
      createAbuseReport(db, {
        reporter_id: 'user-1',
        reporter_name: 'User',
        reporter_email: 'user@example.com',
        reason: 'spam',
        description: null,
        material_id: 4,
        briefing_id: null,
        opinion_id: null,
      })
    ).resolves.toBe(17)

    expect(sql[0]).toContain('WHERE NOT EXISTS')
    expect(sql[0]).toContain("source = 'user' AND review_status = 'pending'")
    expect(sql[1]).toContain('UPDATE ct_materials SET abuse_flagged = 1')
  })

  it('在原子 INSERT 沒有寫入時回報既有 pending 回報', async () => {
    const { db } = abuseReportDb(0)

    await expect(
      createAbuseReport(db, {
        reporter_id: 'user-1',
        reporter_name: 'User',
        reporter_email: 'user@example.com',
        reason: 'spam',
        description: null,
        material_id: 4,
        briefing_id: null,
        opinion_id: null,
      })
    ).resolves.toBeNull()
  })
})
