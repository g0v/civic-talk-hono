import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vite-plus/test'
import { listIssues, type IssueListItem } from '../db/queries'
import { filterAndSortHomeIssues, filterByRole, sortByOrder } from '../lib/homeSorting'

// ── listIssues 的 last_activity_at（#77）───────────────────────────────────
// 用 node:sqlite 跑 listIssues 產出的真實 SQL，驗證子查詢語意：
// 三類子內容（abuse_flagged IN (0,1)）的最新 created_at，皆無則 fallback 到議題 created_at。

type Row = Record<string, string | number | null>

/** 以 node:sqlite 建表並塞資料，回傳一個足以跑 listIssues 的 D1Database 形狀 */
function sqliteDb(tables: Record<string, Row[]>) {
  const sqlite = new DatabaseSync(':memory:')
  const schema: Record<string, string> = {
    ct_issues: 'id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, polis_id TEXT, created_at TEXT, abuse_flagged INTEGER, author_name TEXT, author_email TEXT, show_email INTEGER',
    ct_materials: 'id INTEGER PRIMARY KEY, issue_id INTEGER, created_at TEXT, abuse_flagged INTEGER',
    ct_opinions: 'id INTEGER PRIMARY KEY, issue_id INTEGER, created_at TEXT, abuse_flagged INTEGER',
    ct_briefings: 'id INTEGER PRIMARY KEY, issue_id INTEGER, created_at TEXT, abuse_flagged INTEGER',
  }
  for (const [name, ddl] of Object.entries(schema)) sqlite.exec(`CREATE TABLE ${name} (${ddl})`)
  for (const [name, rows] of Object.entries(tables)) {
    for (const row of rows) {
      const cols = Object.keys(row)
      sqlite.prepare(`INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => row[c] ?? null))
    }
  }
  return {
    prepare(query: string) {
      return {
        async all() {
          const stmt = sqlite.prepare(query)
          return { results: stmt.all() as Row[] }
        },
      }
    },
  } as unknown as D1Database
}

function issueRow(id: number, created_at: string, overrides: Partial<Row> = {}): Row {
  return { id, title: `議題${id}`, description: '描述', status: 'collecting', polis_id: null, created_at, abuse_flagged: 0, author_name: null, author_email: null, show_email: 0, ...overrides }
}


describe('listIssues 的 last_activity_at（#77）', () => {
  it('回傳 last_activity_at 且等於三類子內容中最新的 created_at（abuse_flagged IN (0,1)）', async () => {
    const db = sqliteDb({
      ct_issues: [issueRow(1, '2026-08-01 00:00:00')],
      ct_materials: [{ id: 1, issue_id: 1, created_at: '2026-08-05 00:00:00', abuse_flagged: 0 }, { id: 2, issue_id: 1, created_at: '2026-08-12 00:00:00', abuse_flagged: 3 }],
      ct_opinions: [{ id: 1, issue_id: 1, created_at: '2026-08-08 00:00:00', abuse_flagged: 1 }],
      ct_briefings: [],
    })

    const issues = await listIssues(db)
    expect(issues).toHaveLength(1)
    // abuse_flagged = 3 的素材不計入；取正常素材 08-05 與意見 08-08 的最新
    expect(issues[0]!.last_activity_at).toBe('2026-08-08 00:00:00')
  })

  it('無任何子內容時 fallback 到議題自己的 created_at', async () => {
    const db = sqliteDb({
      ct_issues: [issueRow(1, '2026-08-01 00:00:00')],
      ct_materials: [],
      ct_opinions: [],
      ct_briefings: [],
    })

    const issues = await listIssues(db)
    expect(issues[0]!.last_activity_at).toBe('2026-08-01 00:00:00')
  })

  it('SQL 不含 author_id／show_email，也沒有 SELECT *（公開欄位契約）', async () => {
    let sql = ''
    const db = {
      prepare(query: string) {
        sql = query
        return {
          async all() {
            return { results: [] }
          },
        }
      },
    } as unknown as D1Database

    await listIssues(db)
    expect(sql).not.toContain('author_id')
    expect(sql).not.toMatch(/SELECT\s+\*/i)
  })
})

// ── Home 過濾／排序純函式（src/lib/homeSorting.ts，#77）──────────────────

function item(id: number, overrides: Partial<IssueListItem> = {}): IssueListItem {
  return {
    id,
    title: `議題${id}`,
    description: '描述',
    status: 'published',
    polis_id: null,
    created_at: '2026-08-01 00:00:00',
    abuse_flagged: 0,
    author_name: null,
    author_email: null,
    material_count: 0,
    opinion_count: 0,
    last_activity_at: '2026-08-01 00:00:00',
    ...overrides,
  }
}

describe('filterByRole（#77）', () => {
  const list = [item(1), item(2, { status: 'collecting' }), item(3, { status: 'summarizing' })]

  it('citizen 過濾掉素材收集中（collecting）的議題', () => {
    expect(filterByRole(list, 'citizen').map(i => i.id)).toEqual([1, 3])
  })

  it('volunteer 顯示全部議題', () => {
    expect(filterByRole(list, 'volunteer').map(i => i.id)).toEqual([1, 2, 3])
  })
})

describe('sortByOrder（#77）', () => {
  it('newest 以 last_activity_at 降冪（不是 created_at）', () => {
    const list = [item(1, { created_at: '2026-09-01 00:00:00', last_activity_at: '2026-08-01 00:00:00' }), item(2, { created_at: '2026-08-01 00:00:00', last_activity_at: '2026-09-01 00:00:00' })]
    expect(sortByOrder(list, 'newest').map(i => i.id)).toEqual([2, 1])
  })

  it('most／least 依關注數排序', () => {
    const list = [item(1, { material_count: 1, opinion_count: 1 }), item(2, { material_count: 5, opinion_count: 0 })]
    expect(sortByOrder(list, 'most').map(i => i.id)).toEqual([2, 1])
    expect(sortByOrder(list, 'least').map(i => i.id)).toEqual([1, 2])
  })
})

describe('filterAndSortHomeIssues（#77）', () => {
  it('citizen：過濾 collecting，newest 依 last_activity_at', () => {
    const list = [item(1, { last_activity_at: '2026-08-01 00:00:00' }), item(2, { status: 'collecting', last_activity_at: '2026-09-01 00:00:00' }), item(3, { last_activity_at: '2026-08-15 00:00:00' })]
    expect(filterAndSortHomeIssues(list, 'citizen', 'newest').map(i => i.id)).toEqual([3, 1])
  })

  it('volunteer：collecting 固定排最前（第一階），階內套使用者排序', () => {
    const list = [
      item(1, { last_activity_at: '2026-08-20 00:00:00' }),
      item(2, { status: 'collecting', last_activity_at: '2026-08-05 00:00:00' }),
      item(3, { status: 'collecting', last_activity_at: '2026-08-10 00:00:00' }),
      item(4, { last_activity_at: '2026-08-01 00:00:00' }),
    ]
    expect(filterAndSortHomeIssues(list, 'volunteer', 'newest').map(i => i.id)).toEqual([3, 2, 1, 4])
  })

  it('volunteer + most：collecting 仍固定在最前，階內依關注數', () => {
    const list = [item(1, { material_count: 10, opinion_count: 0 }), item(2, { status: 'collecting', material_count: 0, opinion_count: 0 })]
    expect(filterAndSortHomeIssues(list, 'volunteer', 'most').map(i => i.id)).toEqual([2, 1])
  })

  it('citizen + 搜尋：先過濾 collecting 再比對標題／簡介', () => {
    const list = [item(1, { title: '居住正義' }), item(2, { status: 'collecting', title: '居住正義' }), item(3, { title: '交通建設' })]
    expect(filterAndSortHomeIssues(list, 'citizen', 'newest', '居住').map(i => i.id)).toEqual([1])
  })
})
