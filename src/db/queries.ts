/** D1 查詢與資料型別 — 所有 SQL 只碰 ct_* 表 */

export type IssueStatus = 'collecting' | 'summarizing' | 'published'
export type Stance = 'pro' | 'con' | 'neutral' | 'unknown'
export type AuthorVisibility = 0 | 1

export interface AuthorSnapshotInput {
  author_id: string
  author_name: string | null
  author_email: string
  show_email: boolean
}

export interface SubmissionConsentInput {
  terms_version: string
}

export interface Issue {
  id: number
  title: string
  description: string | null
  status: IssueStatus
  polis_id: string | null
  created_at: string
  /** 建立者的 OAuth 顯示名稱；#9 之前的舊資料或系統建立為 null */
  author_name: string | null
  /** 建立者投稿當下的 email 快照；公開查詢只在 show_email = 1 時回傳 */
  author_email: string | null
}

export interface IssueListItem extends Issue {
  material_count: number
  opinion_count: number
}

/** 議題 + 完整作者快照（僅供管理端；author_id／show_email 不進公開回應） */
export interface IssueWithAuthor extends Issue {
  author_id: string | null
  show_email: AuthorVisibility
  terms_version: string | null
  terms_accepted_at: string | null
}

export interface IssueListItemWithAuthor extends IssueListItem {
  author_id: string | null
  show_email: AuthorVisibility
  terms_version: string | null
  terms_accepted_at: string | null
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
  /** 投稿者投稿當下的 email 快照；公開查詢只在 show_email = 1 時回傳 */
  author_email: string | null
}

/** 素材 + 完整作者快照（僅供管理端） */
export interface MaterialWithAuthor extends Material {
  author_id: string | null
  show_email: AuthorVisibility
  terms_version: string | null
  terms_accepted_at: string | null
}

/**
 * 說明頁的**公開**形狀——含 author_name（#27），email 僅在 show_email = 1 時投影。
 * author_id／show_email 不進公開回應或 SSR state。
 */
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
  author_name: string | null
  author_email: string | null
}

/** briefing + 完整作者快照（僅供管理端） */
export interface BriefingWithAuthor extends Briefing {
  author_id: string | null
  show_email: AuthorVisibility
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
  /** 投稿者投稿當下的 email 快照；公開查詢只在 show_email = 1 時回傳 */
  author_email: string | null
}

/** 意見 + 完整作者快照（僅供管理端） */
export interface OpinionWithAuthor extends Opinion {
  author_id: string | null
  show_email: AuthorVisibility
  terms_version: string | null
  terms_accepted_at: string | null
}

export interface AdminStats {
  issues: number
  materials: number
  opinions: number
  briefings: number
}

const PUBLIC_AUTHOR_COLUMNS = 'author_name, CASE WHEN show_email = 1 THEN author_email ELSE NULL END AS author_email'
const PRIVATE_AUTHOR_COLUMNS = 'author_id, author_name, author_email, show_email'
const SUBMISSION_CONSENT_COLUMNS = 'terms_version, terms_accepted_at'
const ISSUE_BASE_COLUMNS = 'id, title, description, status, polis_id, created_at'
const ISSUE_PUBLIC_COLUMNS = `${ISSUE_BASE_COLUMNS}, ${PUBLIC_AUTHOR_COLUMNS}`
const ISSUE_ADMIN_COLUMNS = `${ISSUE_BASE_COLUMNS}, ${PRIVATE_AUTHOR_COLUMNS}, ${SUBMISSION_CONSENT_COLUMNS}`

const ISSUE_COUNT_SUBQUERIES = `
  (SELECT COUNT(*) FROM ct_materials WHERE issue_id = ct_issues.id) AS material_count,
  (SELECT COUNT(*) FROM ct_opinions  WHERE issue_id = ct_issues.id) AS opinion_count`

export async function listIssues(db: D1Database): Promise<IssueListItem[]> {
  const { results } = await db.prepare(`SELECT ${ISSUE_PUBLIC_COLUMNS}, ${ISSUE_COUNT_SUBQUERIES} FROM ct_issues ORDER BY created_at DESC`).all<IssueListItem>()
  return results ?? []
}

/** 管理端專用：回傳完整作者快照。呼叫端必須先確認請求者是管理員。 */
export async function listIssuesWithAuthor(db: D1Database): Promise<IssueListItemWithAuthor[]> {
  const { results } = await db.prepare(`SELECT ${ISSUE_ADMIN_COLUMNS}, ${ISSUE_COUNT_SUBQUERIES} FROM ct_issues ORDER BY created_at DESC`).all<IssueListItemWithAuthor>()
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
  } & AuthorSnapshotInput &
    SubmissionConsentInput
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_issues (title, description, polis_id, author_id, author_name, author_email, show_email, terms_version, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
    )
    .bind(input.title, input.description ?? '', input.polis_id ?? null, input.author_id, input.author_name, input.author_email, input.show_email ? 1 : 0, input.terms_version)
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

const MATERIAL_BASE_COLUMNS = 'id, issue_id, source_name, source_url, stance, content, verified_count, created_at'
const MATERIAL_PUBLIC_COLUMNS = `${MATERIAL_BASE_COLUMNS}, ${PUBLIC_AUTHOR_COLUMNS}`
const MATERIAL_ADMIN_COLUMNS = `${MATERIAL_BASE_COLUMNS}, ${PRIVATE_AUTHOR_COLUMNS}, ${SUBMISSION_CONSENT_COLUMNS}`

export async function listMaterials(db: D1Database, issueId: number): Promise<Material[]> {
  const { results } = await db.prepare(`SELECT ${MATERIAL_PUBLIC_COLUMNS} FROM ct_materials WHERE issue_id = ? ORDER BY created_at DESC`).bind(issueId).all<Material>()
  return results ?? []
}

/** 管理端專用：回傳完整作者快照。呼叫端必須先過 requireAdmin()。 */
export async function listMaterialsWithAuthor(db: D1Database, issueId: number): Promise<MaterialWithAuthor[]> {
  const { results } = await db.prepare(`SELECT ${MATERIAL_ADMIN_COLUMNS} FROM ct_materials WHERE issue_id = ? ORDER BY created_at DESC`).bind(issueId).all<MaterialWithAuthor>()
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
  } & AuthorSnapshotInput &
    SubmissionConsentInput
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_materials (issue_id, source_name, source_url, stance, content, author_id, author_name, author_email, show_email, terms_version, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
    )
    .bind(issueId, input.source_name ?? '', input.source_url ?? '', input.stance ?? 'unknown', input.content, input.author_id, input.author_name, input.author_email, input.show_email ? 1 : 0, input.terms_version)
    .run()
  await db.prepare("UPDATE ct_issues SET status = 'summarizing' WHERE id = ? AND status = 'collecting'").bind(issueId).run()
  return meta.last_row_id
}

export async function deleteMaterial(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM ct_materials WHERE id = ?').bind(id).run()
}

const BRIEFING_BASE_COLUMNS = 'id, issue_id, consensus, disputes, positions, narrative, opinion_prompt, version, created_at'
const BRIEFING_PUBLIC_COLUMNS = `${BRIEFING_BASE_COLUMNS}, ${PUBLIC_AUTHOR_COLUMNS}`
const BRIEFING_ADMIN_COLUMNS = `${BRIEFING_BASE_COLUMNS}, ${PRIVATE_AUTHOR_COLUMNS}`

export async function getLatestBriefing(db: D1Database, issueId: number): Promise<Briefing | null> {
  return db.prepare(`SELECT ${BRIEFING_PUBLIC_COLUMNS} FROM ct_briefings WHERE issue_id = ? ORDER BY version DESC LIMIT 1`).bind(issueId).first<Briefing>()
}

export async function getLatestBriefingWithAuthor(db: D1Database, issueId: number): Promise<BriefingWithAuthor | null> {
  return db.prepare(`SELECT ${BRIEFING_ADMIN_COLUMNS} FROM ct_briefings WHERE issue_id = ? ORDER BY version DESC LIMIT 1`).bind(issueId).first<BriefingWithAuthor>()
}

export async function createBriefing(
  db: D1Database,
  issueId: number,
  author: AuthorSnapshotInput,
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
    .prepare(
      'INSERT INTO ct_briefings (issue_id, consensus, disputes, positions, narrative, opinion_prompt, version, author_id, author_name, author_email, show_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      issueId,
      input.consensus ?? '',
      input.disputes ?? '',
      input.positions ?? '',
      input.narrative ?? '',
      input.opinion_prompt ?? '',
      nextVersion,
      author.author_id,
      author.author_name,
      author.author_email,
      author.show_email ? 1 : 0
    )
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

const OPINION_BASE_COLUMNS = 'id, issue_id, summary, created_at'
const OPINION_PUBLIC_COLUMNS = `${OPINION_BASE_COLUMNS}, ${PUBLIC_AUTHOR_COLUMNS}`
const OPINION_ADMIN_COLUMNS = `${OPINION_BASE_COLUMNS}, ${PRIVATE_AUTHOR_COLUMNS}, ${SUBMISSION_CONSENT_COLUMNS}`

export async function listOpinions(db: D1Database, issueId: number): Promise<Opinion[]> {
  const { results } = await db.prepare(`SELECT ${OPINION_PUBLIC_COLUMNS} FROM ct_opinions WHERE issue_id = ? ORDER BY created_at DESC`).bind(issueId).all<Opinion>()
  return results ?? []
}

/** 管理端專用：回傳完整作者快照。呼叫端必須先過 requireAdmin()。 */
export async function listOpinionsWithAuthor(db: D1Database, issueId: number): Promise<OpinionWithAuthor[]> {
  const { results } = await db.prepare(`SELECT ${OPINION_ADMIN_COLUMNS} FROM ct_opinions WHERE issue_id = ? ORDER BY created_at DESC`).bind(issueId).all<OpinionWithAuthor>()
  return results ?? []
}

export async function createOpinion(
  db: D1Database,
  issueId: number,
  input: {
    summary: string
  } & AuthorSnapshotInput &
    SubmissionConsentInput
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_opinions (issue_id, summary, author_id, author_name, author_email, show_email, terms_version, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
    )
    .bind(issueId, input.summary, input.author_id, input.author_name, input.author_email, input.show_email ? 1 : 0, input.terms_version)
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

/** RSS feed 用：議題與素材的最新 N 筆（混合，按 created_at DESC） */
export interface RssFeedItem {
  type: 'issue' | 'material'
  id: number
  title: string | null
  /** 議題的 description 或素材的 content（前 300 字） */
  description: string | null
  /** 素材所屬議題 ID；type === 'issue' 時為 NULL */
  issue_id: number | null
  created_at: string
}

/** RSS 用：取最新 `limit` 筆（議題＋素材混合，按 created_at DESC） */
export async function listForRss(db: D1Database, limit = 20): Promise<RssFeedItem[]> {
  return (
    await db
      .prepare(
        `SELECT 'issue' AS type, id, title, description, NULL AS issue_id, created_at
         FROM ct_issues
         UNION ALL
         SELECT 'material' AS type, id, source_name AS title, content AS description, issue_id, created_at
         FROM ct_materials
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<RssFeedItem>()
  ).results
}
