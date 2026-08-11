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
  /** 建立者的 OAuth 顯示名稱；#9 之前的舊資料或系統建立為 null */
  author_name: string | null
  /** 建立者選擇公開的 email（opt-in #27）；未選擇或舊資料為 null */
  author_email: string | null
}

export interface IssueListItem extends Issue {
  material_count: number
  opinion_count: number
}

/** 議題 + 建立者（僅供管理端；author_id 不進公開回應） */
export interface IssueWithAuthor extends Issue {
  author_id: string | null
}

export interface IssueListItemWithAuthor extends IssueListItem {
  author_id: string | null
}

/**
 * 素材的**公開**形狀——含 author_name 供前台顯示（#27），但 author_id 不公開。
 * 查詢一律列舉欄位、不用 SELECT *（防止 SSR state 洩漏 author_id）。
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
  /** 投稿者的 OAuth 顯示名稱；#9 之前的舊資料為 null */
  author_name: string | null
  /** 投稿者選擇公開的 email（opt-in #27）；未選擇或舊資料為 null */
  author_email: string | null
}

/** 素材 + 投稿者 author_id（僅供管理端） */
export interface MaterialWithAuthor extends Material {
  author_id: string | null
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
 * 意見的**公開**形狀——含 author_name 供前台顯示（#27），但 author_id 不公開。
 * 查詢一律列舉欄位、不用 SELECT *。
 */
export interface Opinion {
  id: number
  issue_id: number
  summary: string
  created_at: string
  /** 投稿者的 OAuth 顯示名稱；#9 之前的舊資料為 null */
  author_name: string | null
  /** 投稿者選擇公開的 email（opt-in #27）；未選擇或舊資料為 null */
  author_email: string | null
}

/** 意見 + 投稿者 author_id（僅供管理端） */
export interface OpinionWithAuthor extends Opinion {
  author_id: string | null
}

export interface AdminStats {
  issues: number
  materials: number
  opinions: number
  briefings: number
}

const ISSUE_PUBLIC_COLUMNS = 'id, title, description, status, polis_id, created_at, author_name, author_email'

const ISSUE_COUNT_SUBQUERIES = `
  (SELECT COUNT(*) FROM ct_materials WHERE issue_id = ct_issues.id) AS material_count,
  (SELECT COUNT(*) FROM ct_opinions  WHERE issue_id = ct_issues.id) AS opinion_count`

export async function listIssues(db: D1Database): Promise<IssueListItem[]> {
  const { results } = await db.prepare(`SELECT ${ISSUE_PUBLIC_COLUMNS}, ${ISSUE_COUNT_SUBQUERIES} FROM ct_issues ORDER BY created_at DESC`).all<IssueListItem>()
  return results ?? []
}

/** 管理端專用：多回建立者 author_id。呼叫端必須先確認請求者是管理員。 */
export async function listIssuesWithAuthor(db: D1Database): Promise<IssueListItemWithAuthor[]> {
  const { results } = await db.prepare(`SELECT ${ISSUE_PUBLIC_COLUMNS}, author_id, ${ISSUE_COUNT_SUBQUERIES} FROM ct_issues ORDER BY created_at DESC`).all<IssueListItemWithAuthor>()
  return results ?? []
}

/**
 * 🚫 不要改回 `SELECT *`：這支的結果會經 getIssueDetail() 流進 SSR 注入的
 * window.__SSR_STATE__。author_name 已在公開欄位（#27），但 author_id 仍不得洩漏。
 */
export async function getIssue(db: D1Database, id: number): Promise<Issue | null> {
  return db.prepare(`SELECT ${ISSUE_PUBLIC_COLUMNS} FROM ct_issues WHERE id = ?`).bind(id).first<Issue>()
}

export async function createIssue(
  db: D1Database,
  input: {
    title: string
    description?: string
    polis_id?: string | null
    author_id: string
    author_name: string
    /** 使用者選擇公開的 email；null = 不公開 */
    author_email?: string | null
  }
): Promise<number> {
  const { meta } = await db
    .prepare('INSERT INTO ct_issues (title, description, polis_id, author_id, author_name, author_email) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(input.title, input.description ?? '', input.polis_id ?? null, input.author_id, input.author_name, input.author_email ?? null)
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
  }
): Promise<void> {
  await db
    .prepare('UPDATE ct_issues SET title = ?, description = ?, status = ?, polis_id = ? WHERE id = ?')
    .bind(input.title, input.description ?? '', input.status ?? 'collecting', input.polis_id ?? null, id)
    .run()
}

export async function deleteIssueCascade(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM ct_opinions WHERE issue_id = ?').bind(id).run()
  await db.prepare('DELETE FROM ct_briefings WHERE issue_id = ?').bind(id).run()
  await db.prepare('DELETE FROM ct_materials WHERE issue_id = ?').bind(id).run()
  await db.prepare('DELETE FROM ct_issues WHERE id = ?').bind(id).run()
}

const MATERIAL_PUBLIC_COLUMNS = 'id, issue_id, source_name, source_url, stance, content, verified_count, created_at, author_name, author_email'

export async function listMaterials(db: D1Database, issueId: number): Promise<Material[]> {
  const { results } = await db.prepare(`SELECT ${MATERIAL_PUBLIC_COLUMNS} FROM ct_materials WHERE issue_id = ? ORDER BY created_at DESC`).bind(issueId).all<Material>()
  return results ?? []
}

/** 管理端專用：多回投稿者 author_id。呼叫端必須先過 requireAdmin()。 */
export async function listMaterialsWithAuthor(db: D1Database, issueId: number): Promise<MaterialWithAuthor[]> {
  const { results } = await db
    .prepare(`SELECT ${MATERIAL_PUBLIC_COLUMNS}, author_id FROM ct_materials WHERE issue_id = ? ORDER BY created_at DESC`)
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
    author_id: string
    author_name: string
    /** 使用者選擇公開的 email；null = 不公開 */
    author_email?: string | null
  }
): Promise<number> {
  const { meta } = await db
    .prepare('INSERT INTO ct_materials (issue_id, source_name, source_url, stance, content, author_id, author_name, author_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(issueId, input.source_name ?? '', input.source_url ?? '', input.stance ?? 'unknown', input.content, input.author_id, input.author_name, input.author_email ?? null)
    .run()
  await db.prepare("UPDATE ct_issues SET status = 'summarizing' WHERE id = ? AND status = 'collecting'").bind(issueId).run()
  return meta.last_row_id
}

export async function deleteMaterial(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM ct_materials WHERE id = ?').bind(id).run()
}

export async function getLatestBriefing(db: D1Database, issueId: number): Promise<Briefing | null> {
  return db.prepare('SELECT * FROM ct_briefings WHERE issue_id = ? ORDER BY version DESC LIMIT 1').bind(issueId).first<Briefing>()
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
  }
): Promise<number> {
  const existing = await db.prepare('SELECT MAX(version) as maxv FROM ct_briefings WHERE issue_id = ?').bind(issueId).first<{ maxv: number | null }>()
  const nextVersion = (existing?.maxv ?? 0) + 1
  await db
    .prepare('INSERT INTO ct_briefings (issue_id, consensus, disputes, positions, narrative, opinion_prompt, version) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(issueId, input.consensus ?? '', input.disputes ?? '', input.positions ?? '', input.narrative ?? '', input.opinion_prompt ?? '', nextVersion)
    .run()
  await db.prepare("UPDATE ct_issues SET status = 'published' WHERE id = ? AND status IN ('collecting', 'summarizing')").bind(issueId).run()
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
  }
): Promise<boolean> {
  const existing = await getLatestBriefing(db, issueId)
  if (!existing) return false
  await db
    .prepare('UPDATE ct_briefings SET consensus = ?, disputes = ?, positions = ?, narrative = ? WHERE id = ?')
    .bind(input.consensus ?? '', input.disputes ?? '', input.positions ?? '', input.narrative ?? '', existing.id)
    .run()
  return true
}

const OPINION_PUBLIC_COLUMNS = 'id, issue_id, summary, created_at, author_name, author_email'

export async function listOpinions(db: D1Database, issueId: number): Promise<Opinion[]> {
  const { results } = await db.prepare(`SELECT ${OPINION_PUBLIC_COLUMNS} FROM ct_opinions WHERE issue_id = ? ORDER BY created_at DESC`).bind(issueId).all<Opinion>()
  return results ?? []
}

/** 管理端專用：多回投稿者 author_id。呼叫端必須先過 requireAdmin()。 */
export async function listOpinionsWithAuthor(db: D1Database, issueId: number): Promise<OpinionWithAuthor[]> {
  const { results } = await db.prepare(`SELECT ${OPINION_PUBLIC_COLUMNS}, author_id FROM ct_opinions WHERE issue_id = ? ORDER BY created_at DESC`).bind(issueId).all<OpinionWithAuthor>()
  return results ?? []
}

export async function createOpinion(
  db: D1Database,
  issueId: number,
  input: {
    summary: string
    author_id: string
    author_name: string
    /** 使用者選擇公開的 email；null = 不公開 */
    author_email?: string | null
  }
): Promise<number> {
  const { meta } = await db
    .prepare('INSERT INTO ct_opinions (issue_id, summary, author_id, author_name, author_email) VALUES (?, ?, ?, ?, ?)')
    .bind(issueId, input.summary, input.author_id, input.author_name, input.author_email ?? null)
    .run()
  return meta.last_row_id
}

export async function deleteOpinion(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM ct_opinions WHERE id = ?').bind(id).run()
}

export async function getIssueDetail(
  db: D1Database,
  id: number
): Promise<{
  issue: Issue
  materials: Material[]
  briefing: Briefing | null
  opinions: Opinion[]
} | null> {
  const issue = await getIssue(db, id)
  if (!issue) return null
  const [materials, briefing, opinions] = await Promise.all([listMaterials(db, id), getLatestBriefing(db, id), listOpinions(db, id)])
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

export async function listMaterialsForPrompt(db: D1Database, issueId: number): Promise<Pick<Material, 'source_name' | 'source_url' | 'stance' | 'content'>[]> {
  const { results } = await db
    .prepare('SELECT source_name, source_url, stance, content FROM ct_materials WHERE issue_id = ? ORDER BY created_at')
    .bind(issueId)
    .all<Pick<Material, 'source_name' | 'source_url' | 'stance' | 'content'>>()
  return results ?? []
}

export async function listOpinionSummaries(db: D1Database, issueId: number, limit = 50): Promise<Pick<Opinion, 'summary'>[]> {
  const { results } = await db.prepare('SELECT summary FROM ct_opinions WHERE issue_id = ? ORDER BY created_at DESC LIMIT ?').bind(issueId, limit).all<Pick<Opinion, 'summary'>>()
  return results ?? []
}

/** 素材詳情頁用：取單筆素材（公開欄位）及其所屬議題，用於 /issues/:id/source/:materialId */
export async function getMaterialWithIssue(db: D1Database, materialId: number): Promise<{ material: Material; issue: Issue } | null> {
  const material = await db.prepare(`SELECT ${MATERIAL_PUBLIC_COLUMNS} FROM ct_materials WHERE id = ?`).bind(materialId).first<Material>()
  if (!material) return null
  const issue = await getIssue(db, material.issue_id)
  if (!issue) return null
  return { material, issue }
}

/** 意見詳情頁用：取單筆意見（公開欄位）及其所屬議題，用於 /issues/:id/comment/:opinionId */
export async function getOpinionWithIssue(db: D1Database, opinionId: number): Promise<{ opinion: Opinion; issue: Issue } | null> {
  const opinion = await db.prepare(`SELECT ${OPINION_PUBLIC_COLUMNS} FROM ct_opinions WHERE id = ?`).bind(opinionId).first<Opinion>()
  if (!opinion) return null
  const issue = await getIssue(db, opinion.issue_id)
  if (!issue) return null
  return { opinion, issue }
}
