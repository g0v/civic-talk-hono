/** D1 查詢與資料型別 — 所有 SQL 只碰 ct_* 表 */

export type IssueStatus = 'collecting' | 'summarizing' | 'published'
export type Stance = 'pro' | 'con' | 'neutral' | 'unknown'

export interface Issue {
  id: number
  title: string
  description: string | null
  status: IssueStatus
  polis_id: string | null
  created_at: string
}

export interface IssueListItem extends Issue {
  material_count: number
}

/** 議題 + 建立者（僅供管理端；author_* 對「需登入」之前的舊資料是 null） */
export interface IssueWithAuthor extends Issue {
  author_id: string | null
  author_name: string | null
}

export interface IssueListItemWithAuthor extends IssueListItem {
  author_id: string | null
  author_name: string | null
}

/**
 * 素材的**公開**形狀——刻意不含投稿者欄位。
 *
 * 這個型別會出現在公開 API（GET /api/issues/:id、/api/issues/:id/materials）與
 * SSR 注入的 window.__SSR_STATE__ 裡，也就是「任何人都看得到」。投稿者身分只給
 * 管理端（見 MaterialWithAuthor），所以查詢一律列舉欄位、不用 SELECT *——
 * 用 SELECT * 的話，#9 新增的 author_* 會就這樣漏進 HTML 原始碼。
 */
export interface Material {
  id: number
  issue_id: number
  source_name: string | null
  source_url: string | null
  stance: Stance
  content: string
  verified_count: number
  created_at: string
}

/** 素材 + 投稿者（僅供管理端；author_* 對 #9 之前的舊資料是 null） */
export interface MaterialWithAuthor extends Material {
  author_id: string | null
  author_name: string | null
}

export interface Briefing {
  id: number
  issue_id: number
  consensus: string | null
  disputes: string | null
  positions: string | null
  narrative: string | null
  opinion_prompt: string | null
  version: number
  created_at: string
}

/**
 * 意見的**公開**形狀——與 Material 同理，刻意不含投稿者欄位（意見在前台是公開顯示的）。
 * 查詢一律列舉欄位、不用 SELECT *。
 */
export interface Opinion {
  id: number
  issue_id: number
  summary: string
  created_at: string
}

/** 意見 + 投稿者（僅供管理端） */
export interface OpinionWithAuthor extends Opinion {
  author_id: string | null
  author_name: string | null
}

export interface AdminStats {
  issues: number
  materials: number
  opinions: number
  briefings: number
}

const ISSUE_PUBLIC_COLUMNS = 'id, title, description, status, polis_id, created_at'

async function withMaterialCounts<T extends Issue>(
  db: D1Database,
  issues: T[],
): Promise<(T & { material_count: number })[]> {
  for (const issue of issues) {
    const row = await db
      .prepare('SELECT COUNT(*) as cnt FROM ct_materials WHERE issue_id = ?')
      .bind(issue.id)
      .first<{ cnt: number }>()
    ;(issue as T & { material_count: number }).material_count = row?.cnt ?? 0
  }
  return issues as (T & { material_count: number })[]
}

export async function listIssues(db: D1Database): Promise<IssueListItem[]> {
  const { results } = await db
    .prepare(`SELECT ${ISSUE_PUBLIC_COLUMNS} FROM ct_issues ORDER BY created_at DESC`)
    .all<Issue>()
  return withMaterialCounts(db, results ?? [])
}

/** 管理端專用：多回建立者。呼叫端必須先確認請求者是管理員。 */
export async function listIssuesWithAuthor(db: D1Database): Promise<IssueListItemWithAuthor[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ISSUE_PUBLIC_COLUMNS}, author_id, author_name FROM ct_issues ORDER BY created_at DESC`,
    )
    .all<IssueWithAuthor>()
  return withMaterialCounts(db, results ?? [])
}

/**
 * 🚫 不要改回 `SELECT *`：這支的結果會經 getIssueDetail() 流進 SSR 注入的
 * window.__SSR_STATE__，把 author_* 撈出來等於寫進 HTML 原始碼。
 */
export async function getIssue(db: D1Database, id: number): Promise<Issue | null> {
  return db
    .prepare(`SELECT ${ISSUE_PUBLIC_COLUMNS} FROM ct_issues WHERE id = ?`)
    .bind(id)
    .first<Issue>()
}

export async function createIssue(
  db: D1Database,
  input: {
    title: string
    description?: string
    polis_id?: string | null
    // 建立議題一律要登入，所以這兩欄是必填（舊資料才會是 null）
    author_id: string
    author_name: string
  },
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_issues (title, description, polis_id, author_id, author_name) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(
      input.title,
      input.description ?? '',
      input.polis_id ?? null,
      input.author_id,
      input.author_name,
    )
    .run()
  return meta.last_row_id
}

export async function updateIssue(
  db: D1Database,
  id: number,
  input: {
    title: string
    description?: string
    status?: IssueStatus
    polis_id?: string | null
  },
): Promise<void> {
  await db
    .prepare(
      'UPDATE ct_issues SET title = ?, description = ?, status = ?, polis_id = ? WHERE id = ?',
    )
    .bind(
      input.title,
      input.description ?? '',
      input.status ?? 'collecting',
      input.polis_id ?? null,
      id,
    )
    .run()
}

export async function deleteIssueCascade(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM ct_opinions WHERE issue_id = ?').bind(id).run()
  await db.prepare('DELETE FROM ct_briefings WHERE issue_id = ?').bind(id).run()
  await db.prepare('DELETE FROM ct_materials WHERE issue_id = ?').bind(id).run()
  await db.prepare('DELETE FROM ct_issues WHERE id = ?').bind(id).run()
}

const MATERIAL_PUBLIC_COLUMNS =
  'id, issue_id, source_name, source_url, stance, content, verified_count, created_at'

export async function listMaterials(db: D1Database, issueId: number): Promise<Material[]> {
  const { results } = await db
    .prepare(
      `SELECT ${MATERIAL_PUBLIC_COLUMNS} FROM ct_materials WHERE issue_id = ? ORDER BY created_at DESC`,
    )
    .bind(issueId)
    .all<Material>()
  return results ?? []
}

/** 管理端專用：多回投稿者。呼叫端必須先過 requireAdmin()。 */
export async function listMaterialsWithAuthor(
  db: D1Database,
  issueId: number,
): Promise<MaterialWithAuthor[]> {
  const { results } = await db
    .prepare(
      `SELECT ${MATERIAL_PUBLIC_COLUMNS}, author_id, author_name FROM ct_materials WHERE issue_id = ? ORDER BY created_at DESC`,
    )
    .bind(issueId)
    .all<MaterialWithAuthor>()
  return results ?? []
}

export async function createMaterial(
  db: D1Database,
  issueId: number,
  input: {
    source_name?: string
    source_url?: string
    stance?: Stance
    content: string
    // #9 起投稿一律要登入，所以這兩欄是必填（舊資料才會是 null）
    author_id: string
    author_name: string
  },
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_materials (issue_id, source_name, source_url, stance, content, author_id, author_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      issueId,
      input.source_name ?? '',
      input.source_url ?? '',
      input.stance ?? 'unknown',
      input.content,
      input.author_id,
      input.author_name,
    )
    .run()
  await db
    .prepare(
      "UPDATE ct_issues SET status = 'summarizing' WHERE id = ? AND status = 'collecting'",
    )
    .bind(issueId)
    .run()
  return meta.last_row_id
}

export async function deleteMaterial(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM ct_materials WHERE id = ?').bind(id).run()
}

export async function getLatestBriefing(
  db: D1Database,
  issueId: number,
): Promise<Briefing | null> {
  return db
    .prepare('SELECT * FROM ct_briefings WHERE issue_id = ? ORDER BY version DESC LIMIT 1')
    .bind(issueId)
    .first<Briefing>()
}

export async function createBriefing(
  db: D1Database,
  issueId: number,
  input: {
    consensus?: string
    disputes?: string
    positions?: string
    narrative?: string
    opinion_prompt?: string
  },
): Promise<number> {
  const existing = await db
    .prepare('SELECT MAX(version) as maxv FROM ct_briefings WHERE issue_id = ?')
    .bind(issueId)
    .first<{ maxv: number | null }>()
  const nextVersion = (existing?.maxv ?? 0) + 1
  await db
    .prepare(
      'INSERT INTO ct_briefings (issue_id, consensus, disputes, positions, narrative, opinion_prompt, version) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      issueId,
      input.consensus ?? '',
      input.disputes ?? '',
      input.positions ?? '',
      input.narrative ?? '',
      input.opinion_prompt ?? '',
      nextVersion,
    )
    .run()
  await db
    .prepare(
      "UPDATE ct_issues SET status = 'published' WHERE id = ? AND status IN ('collecting', 'summarizing')",
    )
    .bind(issueId)
    .run()
  return nextVersion
}

export async function updateLatestBriefing(
  db: D1Database,
  issueId: number,
  input: {
    consensus?: string
    disputes?: string
    positions?: string
    narrative?: string
  },
): Promise<boolean> {
  const existing = await getLatestBriefing(db, issueId)
  if (!existing) return false
  await db
    .prepare(
      'UPDATE ct_briefings SET consensus = ?, disputes = ?, positions = ?, narrative = ? WHERE id = ?',
    )
    .bind(
      input.consensus ?? '',
      input.disputes ?? '',
      input.positions ?? '',
      input.narrative ?? '',
      existing.id,
    )
    .run()
  return true
}

const OPINION_PUBLIC_COLUMNS = 'id, issue_id, summary, created_at'

export async function listOpinions(db: D1Database, issueId: number): Promise<Opinion[]> {
  const { results } = await db
    .prepare(
      `SELECT ${OPINION_PUBLIC_COLUMNS} FROM ct_opinions WHERE issue_id = ? ORDER BY created_at DESC`,
    )
    .bind(issueId)
    .all<Opinion>()
  return results ?? []
}

/** 管理端專用：多回投稿者。呼叫端必須先過 requireAdmin()。 */
export async function listOpinionsWithAuthor(
  db: D1Database,
  issueId: number,
): Promise<OpinionWithAuthor[]> {
  const { results } = await db
    .prepare(
      `SELECT ${OPINION_PUBLIC_COLUMNS}, author_id, author_name FROM ct_opinions WHERE issue_id = ? ORDER BY created_at DESC`,
    )
    .bind(issueId)
    .all<OpinionWithAuthor>()
  return results ?? []
}

export async function createOpinion(
  db: D1Database,
  issueId: number,
  input: {
    summary: string
    // 意見投稿一律要登入，所以這兩欄是必填（舊資料才會是 null）
    author_id: string
    author_name: string
  },
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_opinions (issue_id, summary, author_id, author_name) VALUES (?, ?, ?, ?)',
    )
    .bind(issueId, input.summary, input.author_id, input.author_name)
    .run()
  return meta.last_row_id
}

export async function deleteOpinion(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM ct_opinions WHERE id = ?').bind(id).run()
}

export async function getIssueDetail(
  db: D1Database,
  id: number,
): Promise<{
  issue: Issue
  materials: Material[]
  briefing: Briefing | null
  opinions: Opinion[]
} | null> {
  const issue = await getIssue(db, id)
  if (!issue) return null
  const [materials, briefing, opinions] = await Promise.all([
    listMaterials(db, id),
    getLatestBriefing(db, id),
    listOpinions(db, id),
  ])
  return { issue, materials, briefing, opinions }
}

export async function getAdminStats(db: D1Database): Promise<AdminStats> {
  const [issues, materials, opinions, briefings] = await Promise.all([
    db.prepare('SELECT COUNT(*) as cnt FROM ct_issues').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM ct_materials').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM ct_opinions').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM ct_briefings').first<{ cnt: number }>(),
  ])
  return {
    issues: issues?.cnt ?? 0,
    materials: materials?.cnt ?? 0,
    opinions: opinions?.cnt ?? 0,
    briefings: briefings?.cnt ?? 0,
  }
}

export async function listMaterialsForPrompt(
  db: D1Database,
  issueId: number,
): Promise<Pick<Material, 'source_name' | 'source_url' | 'stance' | 'content'>[]> {
  const { results } = await db
    .prepare(
      'SELECT source_name, source_url, stance, content FROM ct_materials WHERE issue_id = ? ORDER BY created_at',
    )
    .bind(issueId)
    .all<Pick<Material, 'source_name' | 'source_url' | 'stance' | 'content'>>()
  return results ?? []
}

export async function listOpinionSummaries(
  db: D1Database,
  issueId: number,
  limit = 50,
): Promise<Pick<Opinion, 'summary'>[]> {
  const { results } = await db
    .prepare(
      'SELECT summary FROM ct_opinions WHERE issue_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(issueId, limit)
    .all<Pick<Opinion, 'summary'>>()
  return results ?? []
}
