import { describe, expect, it } from 'vite-plus/test'
import { createAbuseReport, createBriefing } from '../db/queries'

function briefingDb() {
  const sql: string[] = []
  // 每次 prepare() 產生獨立的 statement，各自記錄傳入 bind() 的參數
  const binds: unknown[][] = []

  function makeStatement(stmtIndex: number) {
    const stmt = {
      bind(...args: unknown[]) {
        binds[stmtIndex] = args
        return stmt
      },
      async first<T>() {
        return { version: 3 } as T
      },
      async run() {
        return { meta: { changes: 1, last_row_id: 3 } }
      },
    }
    return stmt
  }

  return {
    sql,
    binds,
    db: {
      prepare(query: string) {
        const idx = sql.length
        sql.push(query)
        return makeStatement(idx)
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
  const AUTHOR = { author_id: 'user-1', author_name: 'User', author_email: 'user@example.com', show_email: false } as const

  it('bind 參數順序與欄位語意正確：未填欄位傳 null、issueId 出現在三個正確位置', async () => {
    const { db, sql, binds } = briefingDb()

    // 只給 consensus，其餘四個內容欄位留空
    const version = await createBriefing(db, 1, AUTHOR, { consensus: '共識' })

    // 版號在同一個 statement 內原子取得（不先 SELECT MAX 再 INSERT）
    expect(sql[0]).toContain('RETURNING version')
    // mock 的 first() 固定回 { version: 3 }
    expect(version).toBe(3)

    // 13 個 bind 參數（1 issueId + 5 內容欄 + 1 issueId + 4 作者欄 + 1 abuse_flagged + 1 issueId）
    expect(binds[0]).toHaveLength(13)

    // 五個內容欄位（index 1-5）：只有 consensus 有值，其餘四欄傳 null，
    // 讓 SQL 的 COALESCE(?, prev.xxx, '') 繼承上一版，不寫入空字串
    expect(binds[0].slice(1, 6)).toEqual(['共識', null, null, null, null])

    // issueId 必須出現在第 1、第 7、第 13 個位置（1-based），
    // 分別對應 SELECT 的第一欄、MAX(version) 子查詢、LEFT JOIN WHERE 子查詢
    expect(binds[0][0]).toBe(1)   // index 0 → SQL pos 1
    expect(binds[0][6]).toBe(1)   // index 6 → SQL pos 7
    expect(binds[0][12]).toBe(1)  // index 12 → SQL pos 13
  })

  it('blankToNull 把純空白字元轉成 null，不把空白當有效值寫入', async () => {
    const { db, binds } = briefingDb()

    await createBriefing(db, 1, AUTHOR, { consensus: '   ' })

    // '   '.trim() === '' → blankToNull 回 null，SQL 才能 COALESCE 繼承上一版
    expect(binds[0][1]).toBeNull()
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
