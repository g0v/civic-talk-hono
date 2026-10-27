import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vite-plus/test'
import { createBriefing, createMaterial, createOpinion, listIssues, updateLatestBriefing, type IssueListItem, type IssueStatus } from '../db/queries'
import { filterHomeIssuesByLifecycle } from '../lib/homeLifecycle'
import { filterAndSortHomeIssues, filterByRole, sortByOrder } from '../lib/homeSorting'

// ── listIssues 的 last_activity_at（#77）───────────────────────────────────
// 用 node:sqlite 跑 listIssues 產生的真實 SQL，驗證欄位版語意：
// ct_issues.last_activity_at 為 NULL（尚無子內容活動）時 fallback 到 created_at。

type Row = Record<string, string | number | null>

/** 以 node:sqlite 建表並塞資料，回傳一個足以跑 listIssues 的 D1Database 形狀 */
function sqliteDb(tables: Record<string, Row[]>) {
  const sqlite = new DatabaseSync(':memory:')
  const schema: Record<string, string> = {
    ct_issues:
      'id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, polis_id TEXT, created_at TEXT, last_activity_at TEXT, is_closed INTEGER NOT NULL DEFAULT 0, closure_reason TEXT, closure_changed_at TEXT, tags TEXT, abuse_flagged INTEGER, author_name TEXT, author_email TEXT, show_email INTEGER',
    ct_materials: 'id INTEGER PRIMARY KEY, issue_id INTEGER, created_at TEXT, abuse_flagged INTEGER',
    ct_opinions: 'id INTEGER PRIMARY KEY, issue_id INTEGER, created_at TEXT, abuse_flagged INTEGER, author_id TEXT',
    ct_opinion_votes: 'id INTEGER PRIMARY KEY, opinion_id INTEGER, voter_id TEXT, value INTEGER',
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
  return {
    id,
    title: `議題${id}`,
    description: '描述',
    status: 'collecting',
    polis_id: null,
    created_at,
    is_closed: 0,
    closure_reason: null,
    closure_changed_at: null,
    tags: '[]',
    abuse_flagged: 0,
    author_name: null,
    author_email: null,
    show_email: 0,
    ...overrides,
  }
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

  it('createMaterial 更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    await createMaterial(db, 1, { content: '素材', ...AUTHOR, ...CONSENT })
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM ct_materials WHERE issue_id = 1 AND content = ?').get('素材') as { n: number }
    expect(row.n).toBe(1)
    expect(activityOf(sqlite, 1)).not.toBeNull()
  })

  it('createMaterial 的 moderationHidden 投稿不算活動，不更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    await createMaterial(db, 1, { content: '素材', ...AUTHOR, ...CONSENT }, { moderationHidden: true, skipStatusTransition: true })
    expect(activityOf(sqlite, 1)).toBeNull()
  })

  it('createOpinion 更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    await createOpinion(db, 1, { summary: '意見', ...AUTHOR, ...CONSENT })
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM ct_opinions WHERE issue_id = 1 AND summary = ?').get('意見') as { n: number }
    expect(row.n).toBe(1)
    expect(activityOf(sqlite, 1)).not.toBeNull()
  })

  it('createOpinion 的 moderationHidden 投稿不算活動，不更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    await createOpinion(db, 1, { summary: '意見', ...AUTHOR, ...CONSENT }, { moderationHidden: true })
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM ct_opinions WHERE issue_id = 1').get() as { n: number }
    expect(row.n).toBe(1)
    expect(activityOf(sqlite, 1)).toBeNull()
  })

  it('createBriefing 更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    const version = await createBriefing(db, 1, AUTHOR, { consensus: '共識' })
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM ct_briefings WHERE issue_id = 1 AND version = ? AND consensus = ?').get(version, '共識') as { n: number }
    expect(row.n).toBe(1)
    expect(activityOf(sqlite, 1)).not.toBeNull()
  })

  it('createBriefing 的 moderationHidden 投稿不算活動，不更新 last_activity_at', async () => {
    const { db, sqlite } = writableDb()
    await createBriefing(db, 1, AUTHOR, { consensus: '共識' }, { moderationHidden: true })
    expect(activityOf(sqlite, 1)).toBeNull()
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
    vote_count: 0,
    last_activity_at: '2026-08-01 00:00:00',
    is_closed: 0,
    closure_reason: null,
    closure_changed_at: null,
    tags: [],
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
  it('發布與活動日期相反時，兩種排序各自依對應時間降冪且不改動輸入', () => {
    const list = [
      item(1, { created_at: '2026-09-01 00:00:00', last_activity_at: '2026-09-02 00:00:00' }),
      item(2, { created_at: '2026-08-01 00:00:00', last_activity_at: '2026-10-01 00:00:00' }),
    ]
    expect(sortByOrder(list, 'published').map(i => i.id)).toEqual([1, 2])
    expect(sortByOrder(list, 'activity').map(i => i.id)).toEqual([2, 1])
    expect(list.map(i => i.id)).toEqual([1, 2])
  })

  it('尚無活動時以發布時間排序，相同日期保留原清單順序', () => {
    const list = [
      item(1, { created_at: '2026-09-01 00:00:00', last_activity_at: null }),
      item(2, { created_at: '2026-08-01 00:00:00', last_activity_at: '2026-09-01 00:00:00' }),
      item(3, { created_at: '2026-08-01 00:00:00', last_activity_at: null }),
    ]
    expect(sortByOrder(list, 'published').map(i => i.id)).toEqual([1, 2, 3])
    expect(sortByOrder(list, 'activity').map(i => i.id)).toEqual([1, 2, 3])
  })

  it('most／least 加總意見與票數、忽略素材數，同分保留原順序', () => {
    const list = [
      item(1, { material_count: 100, opinion_count: 1, vote_count: 1 }),
      item(2, { material_count: 0, opinion_count: 0, vote_count: 5 }),
      item(3, { material_count: 0, opinion_count: 4, vote_count: 0 }),
      item(4, { material_count: 999, opinion_count: 0, vote_count: 0 }),
      item(5, { material_count: 1, opinion_count: 2, vote_count: 0 }),
    ]
    expect(sortByOrder(list, 'most').map(i => i.id)).toEqual([2, 3, 1, 5, 4])
    expect(sortByOrder(list, 'least').map(i => i.id)).toEqual([4, 1, 5, 3, 2])
    expect(list.map(i => i.id)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('filterAndSortHomeIssues（#77、#90）', () => {
  it.each(['published', 'activity'] as const)('%s 保留公民／志願者的狀態階序與角色過濾', order => {
    const list = [
      item(1, { status: 'published', created_at: '2026-09-01', last_activity_at: '2026-10-01' }),
      item(2, { status: 'published', created_at: '2026-10-01', last_activity_at: '2026-09-01' }),
      item(3, { status: 'summarizing', created_at: '2026-10-10', last_activity_at: '2026-10-10' }),
      item(4, { status: 'collecting', created_at: '2026-10-20', last_activity_at: '2026-10-20' }),
    ]
    const publishedIds = order === 'published' ? [2, 1] : [1, 2]
    expect(filterAndSortHomeIssues(list, 'citizen', order).map(i => i.id)).toEqual([...publishedIds, 3])
    expect(filterAndSortHomeIssues(list, 'volunteer', order).map(i => i.id)).toEqual([3, 4, ...publishedIds])
  })

  it('citizen：過濾 collecting，最新活動依 last_activity_at', () => {
    const list = [
      item(1, { last_activity_at: '2026-08-01 00:00:00' }),
      item(2, { status: 'collecting', last_activity_at: '2026-09-01 00:00:00' }),
      item(3, { last_activity_at: '2026-08-15 00:00:00' }),
    ]
    expect(filterAndSortHomeIssues(list, 'citizen', 'activity').map(i => i.id)).toEqual([3, 1])
  })

  it('citizen：已發佈排在彙整中之前，即使彙整中比較新（#90）', () => {
    const list = [item(1, { status: 'summarizing', last_activity_at: '2026-09-01 00:00:00' }), item(2, { status: 'published', last_activity_at: '2026-08-01 00:00:00' })]
    expect(filterAndSortHomeIssues(list, 'citizen', 'activity').map(i => i.id)).toEqual([2, 1])
  })

  it('citizen：階內仍套使用者選的排序（#90）', () => {
    const list = [
      item(1, { status: 'summarizing', last_activity_at: '2026-08-01 00:00:00' }),
      item(2, { status: 'published', last_activity_at: '2026-08-01 00:00:00' }),
      item(3, { status: 'published', last_activity_at: '2026-09-01 00:00:00' }),
      item(4, { status: 'summarizing', last_activity_at: '2026-09-05 00:00:00' }),
    ]
    expect(filterAndSortHomeIssues(list, 'citizen', 'activity').map(i => i.id)).toEqual([3, 2, 4, 1])
  })

  it('volunteer：彙整中 → 素材收集中 → 已發佈（#90）', () => {
    const list = [
      item(1, { status: 'published', last_activity_at: '2026-09-10 00:00:00' }),
      item(2, { status: 'collecting', last_activity_at: '2026-08-05 00:00:00' }),
      item(3, { status: 'summarizing', last_activity_at: '2026-08-01 00:00:00' }),
    ]
    expect(filterAndSortHomeIssues(list, 'volunteer', 'activity').map(i => i.id)).toEqual([3, 2, 1])
  })

  it('volunteer：階內套使用者排序，階與階之間不混（#90）', () => {
    const list = [
      item(1, { status: 'published', last_activity_at: '2026-08-20 00:00:00' }),
      item(2, { status: 'collecting', last_activity_at: '2026-08-05 00:00:00' }),
      item(3, { status: 'collecting', last_activity_at: '2026-08-10 00:00:00' }),
      item(4, { status: 'published', last_activity_at: '2026-08-01 00:00:00' }),
      item(5, { status: 'summarizing', last_activity_at: '2026-07-01 00:00:00' }),
      item(6, { status: 'summarizing', last_activity_at: '2026-07-10 00:00:00' }),
    ]
    expect(filterAndSortHomeIssues(list, 'volunteer', 'activity').map(i => i.id)).toEqual([6, 5, 3, 2, 1, 4])
  })

  it('most／least 只在狀態階內依意見數＋票數排序，保留角色過濾與階序', () => {
    const list = [
      item(1, { status: 'published', opinion_count: 10, vote_count: 90 }),
      item(2, { status: 'collecting', material_count: 100, opinion_count: 3 }),
      item(3, { status: 'summarizing', material_count: 100, vote_count: 1 }),
      item(4, { status: 'collecting', vote_count: 5 }),
      item(5, { status: 'summarizing' }),
    ]
    expect(filterAndSortHomeIssues(list, 'volunteer', 'most').map(i => i.id)).toEqual([3, 5, 4, 2, 1])
    expect(filterAndSortHomeIssues(list, 'volunteer', 'least').map(i => i.id)).toEqual([5, 3, 2, 4, 1])
    expect(filterAndSortHomeIssues(list, 'citizen', 'most').map(i => i.id)).toEqual([1, 3, 5])
    expect(filterAndSortHomeIssues(list, 'citizen', 'least').map(i => i.id)).toEqual([1, 5, 3])
  })

  it('未列在優先序中的狀態排在最後，不會從列表中消失（防呆）', () => {
    const list = [item(1, { status: 'future_status' as IssueStatus }), item(2, { status: 'published' })]
    expect(filterAndSortHomeIssues(list, 'citizen', 'activity').map(i => i.id)).toEqual([2, 1])
  })

  it('citizen + 搜尋：保留標題／簡介比對並排除 collecting', () => {
    const list = [item(1, { title: '居住正義' }), item(2, { status: 'collecting', title: '居住正義' }), item(3, { title: '交通建設', description: '居住描述' }), item(4, { title: '交通建設' })]
    expect(filterAndSortHomeIssues(list, 'citizen', 'activity', '居住').map(i => i.id)).toEqual([1, 3])
  })

  it('tag search accepts # prefixes while preserving role filtering and status ordering', () => {
    const list = [
      item(1, { status: 'published', tags: ['Civic Life'], last_activity_at: '2026-08-01' }),
      item(2, { status: 'collecting', tags: ['civic life'], last_activity_at: '2026-08-05' }),
      item(3, { status: 'summarizing', tags: ['CIVIC LIFE'], last_activity_at: '2026-08-03' }),
      item(4, { status: 'published', tags: ['other'] }),
      item(5, { status: 'published', abuse_flagged: 3, tags: ['civic life'] }),
    ]

    expect(filterAndSortHomeIssues(list, 'citizen', 'activity', '#cIvIc').map(i => i.id)).toEqual([1, 3])
    expect(filterAndSortHomeIssues(list, 'volunteer', 'activity', '#CIVIC').map(i => i.id)).toEqual([3, 2, 1])
  })
})

describe('homepage lifecycle filtering', () => {
  const list = [
    item(1, { title: 'Housing open', status: 'published' }),
    item(2, { title: 'Housing closed', status: 'published', is_closed: 1 }),
    item(3, { title: 'Housing closed collecting', status: 'collecting', is_closed: 1 }),
    item(4, { title: 'Housing open collecting', status: 'collecting' }),
  ]

  it('defaults to open issues and filters closed issues before role, search, and sort', () => {
    expect(filterHomeIssuesByLifecycle(list, 'open').map(issue => issue.id)).toEqual([1, 4])
    expect(filterAndSortHomeIssues(filterHomeIssuesByLifecycle(list, 'open'), 'citizen', 'activity', 'housing').map(issue => issue.id)).toEqual([1])
    expect(filterAndSortHomeIssues(filterHomeIssuesByLifecycle(list, 'open'), 'volunteer', 'activity', 'housing').map(issue => issue.id)).toEqual([4, 1])
    expect(filterHomeIssuesByLifecycle(list, 'closed').map(issue => issue.id)).toEqual([2, 3])
    expect(filterAndSortHomeIssues(filterHomeIssuesByLifecycle(list, 'closed'), 'citizen', 'activity', 'housing').map(issue => issue.id)).toEqual([2])
    expect(filterAndSortHomeIssues(filterHomeIssuesByLifecycle(list, 'closed'), 'volunteer', 'activity', 'housing').map(issue => issue.id)).toEqual([3, 2])
  })
})
