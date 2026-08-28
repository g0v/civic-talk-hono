import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vite-plus/test'
import { createBriefing, createMaterial, createOpinion, listIssues, updateLatestBriefing, type IssueListItem } from '../db/queries'
import { filterAndSortHomeIssues, filterByRole, sortByOrder } from '../lib/homeSorting'

// ── listIssues 的 last_activity_at（#77）───────────────────────────────────
// 用 node:sqlite 跑 listIssues 產生的真實 SQL，驗證欄位版語意：
// ct_issues.last_activity_at 為 NULL（尚無子內容活動）時 fallback 到 created_at。

type Row = Record<string, string | number | null>

/** 以 node:sqlite 建表並塞資料，回傳一個足以跑 listIssues 的 D1Database 形狀 */
function sqliteDb(tables: Record<string, Row[]>) {
  const sqlite = new DatabaseSync(':memory:')
  const schema: Record<string, string> = {
    ct_issues: 'id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, polis_id TEXT, created_at TEXT, last_activity_at TEXT, abuse_flagged INTEGER, author_name TEXT, author_email TEXT, show_email INTEGER',
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
        async first() {
          const stmt = sqlite.prepare(query)
          return (stmt.get() as Row) ?? null
        },
        bind(...args: unknown[]) {
          const stmt = sqlite.prepare(query)
          const info = stmt.run(...(args as (string | number | null)[]))
          return { meta: { changes: Number(info.changes) } }
        },
      }
    },
  } as unknown as D1Database
}

function issueRow(id: number, created_at: string, overrides: Partial<Row> = {}): Row {
  return { id, title: `議題${id}`, description: '描述', status: 'collecting', polis_id: null, created_at, abuse_flagged: 0, author_name: null, author_email: null, show_email: 0, ...overrides }
}


describe('listIssues 的 last_activity_at（#77）', () => {
  it('last_activity_at 欄位有值時直接回傳欄位值（覆蓋 migration 回填後的形狀）', async () => {
    const db = sqliteDb({
      ct_issues: [issueRow(1, '2026-08-01 00:00:00', { last_activity_at: '2026-08-08 00:00:00' })],
      ct_materials: [],
      ct_opinions: [],
      ct_briefings: [],
    })

    const issues = await listIssues(db)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.last_activity_at).toBe('2026-08-08 00:00:00')
  })

  it('last_activity_at 為 NULL（尚無子內容活動）時 fallback 到議題自己的 created_at', async () => {
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

// ── 寫入路徑同步維護 ct_issues.last_activity_at（#77）──────────────────────

describe('寫入路徑更新 last_activity_at（#77）', () => {
  const AUTHOR = { author_id: 'user-1', author_name: 'User', author_email: 'user@example.com', show_email: false } as const
  const CONSENT = { terms_version: '2026-01-01' } as const

  /** 只查 ct_issues.last_activity_at 的小工具 */
  function activityOf(sqlite: DatabaseSync, issueId: number): string | null {
    const row = sqlite.prepare('SELECT last_activity_at FROM ct_issues WHERE id = ?').get(issueId) as { last_activity_at: string | null } | undefined
    return row?.last_activity_at ?? null
  }

  /** 回傳 { db, sqlite }：db 餵給寫入函式，sqlite 用來驗證欄位真的被更新 */
  function writableDb() {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(`
      CREATE TABLE ct_issues (id INTEGER PRIMARY KEY, created_at TEXT, last_activity_at TEXT, status TEXT);
      CREATE TABLE ct_materials (id INTEGER PRIMARY KEY, issue_id INTEGER, source_name TEXT, source_url TEXT, stance TEXT, content TEXT, author_id TEXT, author_name TEXT, author_email TEXT, show_email INTEGER, terms_version TEXT, terms_accepted_at TEXT, abuse_flagged INTEGER, created_at TEXT);
      CREATE TABLE ct_opinions (id INTEGER PRIMARY KEY, issue_id INTEGER, summary TEXT, author_id TEXT, author_name TEXT, author_email TEXT, show_email INTEGER, terms_version TEXT, terms_accepted_at TEXT, abuse_flagged INTEGER, created_at TEXT);
      CREATE TABLE ct_briefings (id INTEGER PRIMARY KEY, issue_id INTEGER, consensus TEXT, disputes TEXT, positions TEXT, narrative TEXT, opinion_prompt TEXT, version INTEGER, author_id TEXT, author_name TEXT, author_email TEXT, show_email INTEGER, abuse_flagged INTEGER, created_at TEXT);
      INSERT INTO ct_issues (id, created_at, status) VALUES (1, '2026-08-01 00:00:00', 'collecting');
    `)
    const db = {
      prepare(query: string) {
        return {
          bind(...args: unknown[]) {
            const bindArgs = args as (string | number | null)[]
            return {
              async run() {
                const info = sqlite.prepare(query).run(...bindArgs)
                return { meta: { changes: Number(info.changes), last_row_id: 0 } }
              },
              async first<T>() {
                return (sqlite.prepare(query).get(...bindArgs) ?? null) as T | null
              },
              async all() {
                return { results: sqlite.prepare(query).all(...bindArgs) as Row[] }
              },
            }
          },
        }
      },
    } as unknown as D1Database
    return { db, sqlite }
  }

  it('createMaterial（含 moderationHidden）更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    await createMaterial(db, 1, { content: '素材', ...AUTHOR, ...CONSENT }, { moderationHidden: true, skipStatusTransition: true })
    expect(activityOf(sqlite, 1)).not.toBeNull()
  })

  it('createOpinion 更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    await createOpinion(db, 1, { summary: '意見', ...AUTHOR, ...CONSENT })
    expect(activityOf(sqlite, 1)).not.toBeNull()
  })

  it('createBriefing 更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    await createBriefing(db, 1, AUTHOR, { consensus: '共識' })
    expect(activityOf(sqlite, 1)).not.toBeNull()
  })

  it('updateLatestBriefing（原地 UPDATE）也更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    sqlite.prepare("INSERT INTO ct_briefings (id, issue_id, version, created_at, consensus, abuse_flagged) VALUES (1, 1, 1, '2026-08-02 00:00:00', '舊內容', 0)").run()
    const ok = await updateLatestBriefing(db, 1, { consensus: '新內容' })
    expect(ok).toBe(true)
    expect(activityOf(sqlite, 1)).not.toBeNull()
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
