/** D1 查詢與資料型別 — 所有 SQL 只碰 ct_* 表 */

export type IssueStatus = 'collecting' | 'summarizing' | 'published'
export type Stance = 'pro' | 'con' | 'neutral' | 'unknown'
export type AuthorVisibility = 0 | 1
export type AbuseReportReason = 'spam' | 'hate_speech' | 'defamation' | 'misinformation' | 'other' | 'broken_link'
export type AbuseReportSource = 'user' | 'ai'
export type ModerationPolicyCode = 'spam' | 'sexual_content' | 'hate_speech' | 'defamation' | 'misinformation' | 'illegal'
export type ModerationSubmissionType = 'issue' | 'material' | 'opinion' | 'briefing'
export type AbuseReviewStatus = 'pending' | 'resolved_false' | 'resolved_abuse' | 'resolved_broken'
export type ModerationAppealType = 'rejected_submission' | 'account_ban'
export type ModerationAppealStatus = 'pending' | 'upheld' | 'overturned'

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
  title: string | null
  description: string | null
  status: IssueStatus
  polis_id: string | null
  created_at: string
  abuse_flagged: 0 | 1 | 2 | 3
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
  content: string | null
  verified_count: number
  created_at: string
  /** 投稿者的 OAuth 顯示名稱；#9 之前的舊資料為 null */
  author_name: string | null
  /** 投稿者投稿當下的 email 快照；公開查詢只在 show_email = 1 時回傳 */
  author_email: string | null
  /** 0 正常、1 使用者回報待審、2 確認濫用、3 AI 違規待複核；公開查詢只回傳必要的顯示狀態 */
  abuse_flagged: 0 | 1 | 2 | 3
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
  /** 0 正常、1 使用者回報待審、2 確認濫用、3 AI 違規待複核 */
  abuse_flagged: 0 | 1 | 2 | 3
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
  summary: string | null
  created_at: string
  /** 投稿者的 OAuth 顯示名稱；#9 之前的舊資料為 null */
  author_name: string | null
  /** 投稿者投稿當下的 email 快照；公開查詢只在 show_email = 1 時回傳 */
  author_email: string | null
  /** 0 正常、1 使用者回報待審、2 確認濫用、3 AI 違規待複核 */
  abuse_flagged: 0 | 1 | 2 | 3
}

/** 意見 + 完整作者快照（僅供管理端） */
export interface OpinionWithAuthor extends Opinion {
  author_id: string | null
  show_email: AuthorVisibility
  terms_version: string | null
  terms_accepted_at: string | null
}
/** 濫用回報記錄（管理端查看用） */
export interface AbuseReport {
  id: number
  reporter_id: string
  reporter_name: string | null
  reporter_email: string
  reason: AbuseReportReason
  issue_id: number | null
  description: string | null
  material_id: number | null
  briefing_id: number | null
  opinion_id: number | null
  review_status: AbuseReviewStatus
  created_at: string
  source: AbuseReportSource
  policy_code: ModerationPolicyCode | null
  submission_type: ModerationSubmissionType | null
  content_snapshot: string | null
  target_user_id: string | null
  /** JOIN 取回的所屬議題 ID；若目標已被級聯刪除則為 null */
  target_issue_id: number | null
  /** JOIN 取回的內容作者 ID（停權張貼者用）；舊資料或已刪除則為 null */
  target_author_id: string | null
}

export interface CreateAbuseReportInput {
  reporter_id: string
  reporter_name: string | null
  reporter_email: string
  reason: AbuseReportReason
  description: string | null
  material_id: number | null
  briefing_id: number | null
  opinion_id: number | null
  issue_id?: number | null
  source?: AbuseReportSource
  policy_code?: ModerationPolicyCode | null
  submission_type?: ModerationSubmissionType | null
  content_snapshot?: string | null
  target_user_id?: string | null
}

type AbuseReportTarget = Pick<CreateAbuseReportInput, 'issue_id' | 'material_id' | 'briefing_id' | 'opinion_id'>

export interface CreateAiModerationReportInput {
  user_id: string
  user_name: string | null
  user_email: string
  policy_code: ModerationPolicyCode
  reason: AbuseReportReason
  submission_type: ModerationSubmissionType
  content_snapshot: string
  description: string
  issue_id: number | null
  material_id: number | null
  briefing_id: number | null
  opinion_id: number | null
}

export interface ModerationAppeal {
  id: number
  user_id: string
  user_name: string | null
  user_email: string
  abuse_report_id: number | null
  appeal_type: ModerationAppealType
  content_snapshot: string | null
  message: string
  status: ModerationAppealStatus
  admin_id: string | null
  admin_name: string | null
  review_note: string | null
  created_at: string
  reviewed_at: string | null
}

export interface MyModerationReport {
  id: number
  policy_code: ModerationPolicyCode
  submission_type: ModerationSubmissionType
  content_snapshot: string
  description: string | null
  review_status: 'pending'
  created_at: string
}
export interface CreateModerationAppealInput {
  user_id: string
  user_name: string | null
  user_email: string
  abuse_report_id: number | null
  appeal_type: ModerationAppealType
  content_snapshot: string | null
  message: string
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
const ISSUE_PUBLIC_COLUMNS = `${ISSUE_BASE_COLUMNS.replace('title', 'CASE WHEN abuse_flagged = 3 THEN NULL ELSE title END AS title').replace('description', 'CASE WHEN abuse_flagged = 3 THEN NULL ELSE description END AS description')}, abuse_flagged, ${PUBLIC_AUTHOR_COLUMNS}`
const ISSUE_ADMIN_COLUMNS = `${ISSUE_BASE_COLUMNS}, ${PRIVATE_AUTHOR_COLUMNS}, ${SUBMISSION_CONSENT_COLUMNS}, abuse_flagged`

const ISSUE_COUNT_SUBQUERIES = `
  (SELECT COUNT(*) FROM ct_materials WHERE issue_id = ct_issues.id AND abuse_flagged IN (0, 1)) AS material_count,
  (SELECT COUNT(*) FROM ct_opinions  WHERE issue_id = ct_issues.id AND abuse_flagged IN (0, 1)) AS opinion_count`

export async function listIssues(db: D1Database): Promise<IssueListItem[]> {
  const { results } = await db.prepare(`SELECT ${ISSUE_PUBLIC_COLUMNS}, ${ISSUE_COUNT_SUBQUERIES} FROM ct_issues WHERE abuse_flagged IN (0, 1, 3) ORDER BY created_at DESC`).all<IssueListItem>()
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
  return db.prepare(`SELECT ${ISSUE_PUBLIC_COLUMNS} FROM ct_issues WHERE id = ? AND abuse_flagged IN (0, 1, 3)`).bind(id).first<Issue>()
}

export async function createIssue(
  db: D1Database,
  input: {
    title: string
    description?: string
    polis_id?: string | null
  } & AuthorSnapshotInput &
    SubmissionConsentInput,
  options: { moderationHidden?: boolean } = {}
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_issues (title, description, polis_id, author_id, author_name, author_email, show_email, terms_version, terms_accepted_at, abuse_flagged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)'
    )
    .bind(
      input.title,
      input.description ?? '',
      input.polis_id ?? null,
      input.author_id,
      input.author_name,
      input.author_email,
      input.show_email ? 1 : 0,
      input.terms_version,
      options.moderationHidden ? 3 : 0
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

const MATERIAL_BASE_COLUMNS = 'id, issue_id, source_name, source_url, stance, content, verified_count, created_at, abuse_flagged'
const MATERIAL_PUBLIC_COLUMNS =
  'id, issue_id, source_name, source_url, stance, CASE WHEN abuse_flagged = 3 THEN NULL ELSE content END AS content, verified_count, created_at, abuse_flagged, ' + PUBLIC_AUTHOR_COLUMNS
const MATERIAL_ADMIN_COLUMNS = `${MATERIAL_BASE_COLUMNS}, ${PRIVATE_AUTHOR_COLUMNS}, ${SUBMISSION_CONSENT_COLUMNS}`

export async function listMaterials(db: D1Database, issueId: number): Promise<Material[]> {
  const { results } = await db.prepare(`SELECT ${MATERIAL_PUBLIC_COLUMNS} FROM ct_materials WHERE issue_id = ? AND abuse_flagged IN (0, 1, 3) ORDER BY created_at DESC`).bind(issueId).all<Material>()
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
    SubmissionConsentInput,
  options: { moderationHidden?: boolean; skipStatusTransition?: boolean } = {}
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_materials (issue_id, source_name, source_url, stance, content, author_id, author_name, author_email, show_email, terms_version, terms_accepted_at, abuse_flagged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)'
    )
    .bind(
      issueId,
      input.source_name ?? '',
      input.source_url ?? '',
      input.stance ?? 'unknown',
      input.content,
      input.author_id,
      input.author_name,
      input.author_email,
      input.show_email ? 1 : 0,
      input.terms_version,
      options.moderationHidden ? 3 : 0
    )
    .run()
  if (!options.skipStatusTransition) {
    await db.prepare("UPDATE ct_issues SET status = 'summarizing' WHERE id = ? AND status = 'collecting'").bind(issueId).run()
  }
  return meta.last_row_id
}

export async function deleteMaterial(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM ct_materials WHERE id = ?').bind(id).run()
}

const BRIEFING_BASE_COLUMNS = 'id, issue_id, consensus, disputes, positions, narrative, opinion_prompt, version, created_at, abuse_flagged'
const BRIEFING_PUBLIC_COLUMNS = `${BRIEFING_BASE_COLUMNS}, ${PUBLIC_AUTHOR_COLUMNS}`
const BRIEFING_ADMIN_COLUMNS = `${BRIEFING_BASE_COLUMNS}, ${PRIVATE_AUTHOR_COLUMNS}`

export async function getLatestBriefing(db: D1Database, issueId: number): Promise<Briefing | null> {
  return db.prepare(`SELECT ${BRIEFING_PUBLIC_COLUMNS} FROM ct_briefings WHERE issue_id = ? AND abuse_flagged IN (0, 1) ORDER BY version DESC LIMIT 1`).bind(issueId).first<Briefing>()
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
  },
  options: { moderationHidden?: boolean; skipStatusTransition?: boolean } = {}
): Promise<number> {
  // 版本計算與 INSERT 必須是同一個 SQL statement；拆成 MAX(version) + INSERT 時，
  // 兩個同時投稿可能選到同一版號。
  const inserted = await db
    .prepare(
      `INSERT INTO ct_briefings (
         issue_id, consensus, disputes, positions, narrative, opinion_prompt, version,
         author_id, author_name, author_email, show_email, abuse_flagged
       )
       SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ?
       FROM ct_briefings
       WHERE issue_id = ?
       RETURNING version`
    )
    .bind(
      issueId,
      input.consensus ?? '',
      input.disputes ?? '',
      input.positions ?? '',
      input.narrative ?? '',
      input.opinion_prompt ?? '',
      author.author_id,
      author.author_name,
      author.author_email,
      author.show_email ? 1 : 0,
      options.moderationHidden ? 3 : 0,
      issueId
    )
    .first<{ version: number }>()
  if (!inserted) throw new Error('Briefing insert did not return a version')
  if (!options.skipStatusTransition) {
    await db.prepare("UPDATE ct_issues SET status = 'published' WHERE id = ? AND status IN ('collecting', 'summarizing')").bind(issueId).run()
  }
  return inserted.version
}

export async function getBriefingIdByVersion(db: D1Database, issueId: number, version: number): Promise<number | null> {
  const row = await db.prepare('SELECT id FROM ct_briefings WHERE issue_id = ? AND version = ?').bind(issueId, version).first<{ id: number }>()
  return row?.id ?? null
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

const OPINION_BASE_COLUMNS = 'id, issue_id, summary, created_at, abuse_flagged'
const OPINION_PUBLIC_COLUMNS = 'id, issue_id, CASE WHEN abuse_flagged = 3 THEN NULL ELSE summary END AS summary, created_at, abuse_flagged, ' + PUBLIC_AUTHOR_COLUMNS
const OPINION_ADMIN_COLUMNS = `${OPINION_BASE_COLUMNS}, ${PRIVATE_AUTHOR_COLUMNS}, ${SUBMISSION_CONSENT_COLUMNS}`

export async function listOpinions(db: D1Database, issueId: number): Promise<Opinion[]> {
  const { results } = await db.prepare(`SELECT ${OPINION_PUBLIC_COLUMNS} FROM ct_opinions WHERE issue_id = ? AND abuse_flagged IN (0, 1, 3) ORDER BY created_at DESC`).bind(issueId).all<Opinion>()
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
    SubmissionConsentInput,
  options: { moderationHidden?: boolean } = {}
): Promise<number> {
  const { meta } = await db
    .prepare(
      'INSERT INTO ct_opinions (issue_id, summary, author_id, author_name, author_email, show_email, terms_version, terms_accepted_at, abuse_flagged) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)'
    )
    .bind(issueId, input.summary, input.author_id, input.author_name, input.author_email, input.show_email ? 1 : 0, input.terms_version, options.moderationHidden ? 3 : 0)
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
  const moderation = await db.prepare('SELECT abuse_flagged FROM ct_issues WHERE id = ?').bind(id).first<{ abuse_flagged: number }>()
  if ((moderation?.abuse_flagged ?? 0) >= 2) return { issue, materials: [], briefing: null, opinions: [] }
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

export async function listMaterialsForPrompt(db: D1Database, issueId: number): Promise<{ source_name: string | null; source_url: string | null; stance: Stance | null; content: string | null }[]> {
  const { results } = await db
    .prepare('SELECT source_name, source_url, stance, content FROM ct_materials WHERE issue_id = ? AND abuse_flagged = 0 ORDER BY created_at')
    .bind(issueId)
    .all<{ source_name: string | null; source_url: string | null; stance: Stance | null; content: string | null }>()
  return results ?? []
}

export async function listOpinionSummaries(db: D1Database, issueId: number, limit = 50): Promise<Pick<Opinion, 'summary'>[]> {
  const { results } = await db
    .prepare('SELECT summary FROM ct_opinions WHERE issue_id = ? AND abuse_flagged = 0 ORDER BY created_at DESC LIMIT ?')
    .bind(issueId, limit)
    .all<Pick<Opinion, 'summary'>>()
  return results ?? []
}

/** 素材詳情頁用：取單筆素材（公開欄位）及其所屬議題，用於 /issues/:id/source/:materialId */
export async function getMaterialWithIssue(db: D1Database, materialId: number): Promise<{ material: Material; issue: Issue } | null> {
  const material = await db.prepare(`SELECT ${MATERIAL_PUBLIC_COLUMNS} FROM ct_materials WHERE id = ? AND abuse_flagged IN (0, 1, 3)`).bind(materialId).first<Material>()
  if (!material) return null
  const issue = await getIssue(db, material.issue_id)
  if (!issue) return null
  return { material, issue }
}

/** 意見詳情頁用：取單筆意見（公開欄位）及其所屬議題，用於 /issues/:id/comment/:opinionId */
export async function getOpinionWithIssue(db: D1Database, opinionId: number): Promise<{ opinion: Opinion; issue: Issue } | null> {
  const opinion = await db.prepare(`SELECT ${OPINION_PUBLIC_COLUMNS} FROM ct_opinions WHERE id = ? AND abuse_flagged IN (0, 1, 3)`).bind(opinionId).first<Opinion>()
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
         WHERE abuse_flagged IN (0, 1)
         UNION ALL
         SELECT 'material' AS type, id, source_name AS title, content AS description, issue_id, created_at
         FROM ct_materials
         WHERE abuse_flagged IN (0, 1)
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<RssFeedItem>()
  ).results
}

/**
 * 建立一筆濫用回報，並立即將目標內容的 abuse_flagged 設為 1（第 1 次回報即打標）。
 * 使用者回報在單一 D1 batch 內進行去重、INSERT 與打標，避免平行請求留下不一致資料。
 * 呼叫端必須先過 requireUser()。AI 審查回報沒有公開內容列，會以 source='ai'
 * 搭配 target_user_id 與 content_snapshot 保存供管理員複核。
 */
export async function createAbuseReport(db: D1Database, input: CreateAbuseReportInput): Promise<number | null> {
  const source = input.source ?? 'user'
  const target: AbuseReportTarget = {
    issue_id: input.issue_id ?? null,
    material_id: input.material_id ?? null,
    briefing_id: input.briefing_id ?? null,
    opinion_id: input.opinion_id ?? null,
  }
  const targetKey = source === 'user' ? abuseReportTargetKey(target) : null
  const values = [
    input.reporter_id,
    input.reporter_name,
    input.reporter_email,
    input.reason,
    input.description ?? null,
    target.issue_id,
    target.material_id,
    target.briefing_id,
    target.opinion_id,
    source,
    input.policy_code ?? null,
    input.submission_type ?? null,
    input.content_snapshot ?? null,
    input.target_user_id ?? null,
    targetKey,
  ]
  const insert = db
    .prepare(
      source === 'user'
        ? `INSERT INTO ct_abuse_reports (
             reporter_id, reporter_name, reporter_email, reason, description, issue_id, material_id,
             briefing_id, opinion_id, source, policy_code, submission_type, content_snapshot,
             target_user_id, pending_target_key
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM ct_abuse_reports
             WHERE source = 'user' AND review_status = 'pending'
               AND issue_id IS ? AND material_id IS ? AND briefing_id IS ? AND opinion_id IS ?
           )`
        : 'INSERT INTO ct_abuse_reports (reporter_id, reporter_name, reporter_email, reason, description, issue_id, material_id, briefing_id, opinion_id, source, policy_code, submission_type, content_snapshot, target_user_id, pending_target_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(...values, ...(source === 'user' ? [target.issue_id, target.material_id, target.briefing_id, target.opinion_id] : []))

  // AI 投稿在 INSERT 時已帶 abuse_flagged = 3；使用者回報才需要打上待審旗標。
  if (source !== 'user') {
    const { meta } = await insert.run()
    return meta.last_row_id
  }

  const flag = flagContentForPendingReport(db, target)
  const [created] = await db.batch([insert, flag])
  return created?.meta.changes === 1 ? created.meta.last_row_id : null
}

function abuseReportTargetKey(target: AbuseReportTarget): string {
  if (target.issue_id != null) return `issue:${target.issue_id}`
  if (target.material_id != null) return `material:${target.material_id}`
  if (target.briefing_id != null) return `briefing:${target.briefing_id}`
  if (target.opinion_id != null) return `opinion:${target.opinion_id}`
  throw new Error('Abuse report requires exactly one target')
}

function flagContentForPendingReport(db: D1Database, target: AbuseReportTarget): D1PreparedStatement {
  // AND abuse_flagged = 0 防止使用者回報把 AI 遮蔽（3）或管理員確認（2）降級為待審（1）
  if (target.issue_id    != null) return db.prepare('UPDATE ct_issues    SET abuse_flagged = 1 WHERE id = ? AND abuse_flagged = 0').bind(target.issue_id)
  if (target.material_id != null) return db.prepare('UPDATE ct_materials SET abuse_flagged = 1 WHERE id = ? AND abuse_flagged = 0').bind(target.material_id)
  if (target.briefing_id != null) return db.prepare('UPDATE ct_briefings SET abuse_flagged = 1 WHERE id = ? AND abuse_flagged = 0').bind(target.briefing_id)
  if (target.opinion_id  != null) return db.prepare('UPDATE ct_opinions  SET abuse_flagged = 1 WHERE id = ? AND abuse_flagged = 0').bind(target.opinion_id)
  throw new Error('Abuse report requires exactly one target')
}
/** 建立 AI 審查判定違規的回報，直接指向已寫入且暫時隱藏的投稿列。 */
export async function createAiModerationReport(db: D1Database, input: CreateAiModerationReportInput): Promise<number> {
  const id = await createAbuseReport(db, {
    reporter_id: input.user_id,
    reporter_name: input.user_name,
    reporter_email: input.user_email,
    reason: input.reason,
    description: input.description,
    issue_id: input.issue_id,
    material_id: input.material_id,
    briefing_id: input.briefing_id,
    opinion_id: input.opinion_id,
    source: 'ai',
    policy_code: input.policy_code,
    submission_type: input.submission_type,
    content_snapshot: input.content_snapshot,
    target_user_id: input.user_id,
  })
  if (id === null) throw new Error('AI moderation report unexpectedly deduplicated')
  return id
}

/** 管理端：列出所有濫用回報（按建立時間降冪），LEFT JOIN 取回目標所屬議題與作者 ID。
 *  呼叫端必須先過 requireAdmin()。AI 回報也包含私有投稿快照，供申訴複核。 */
export async function listAbuseReports(db: D1Database): Promise<AbuseReport[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.reporter_id, r.reporter_name, r.reporter_email,
              r.reason, r.description,
              r.issue_id, r.material_id, r.briefing_id, r.opinion_id,
              r.review_status, r.created_at, r.source, r.policy_code,
              r.submission_type, r.content_snapshot, r.target_user_id,
              COALESCE(r.issue_id, m.issue_id, b.issue_id, o.issue_id) AS target_issue_id,
              COALESCE(r.target_user_id, m.author_id, b.author_id, o.author_id) AS target_author_id
       FROM ct_abuse_reports r
       LEFT JOIN ct_materials m ON r.material_id = m.id
       LEFT JOIN ct_briefings b ON r.briefing_id = b.id
       LEFT JOIN ct_opinions  o ON r.opinion_id  = o.id
       ORDER BY r.created_at DESC`
    )
    .all<AbuseReport>()
  return results ?? []
}

/** 取單筆濫用回報（含 JOIN 欄位）；管理端審核前先確認 report 存在且 pending。 */
export async function getAbuseReport(db: D1Database, id: number): Promise<AbuseReport | null> {
  return db
    .prepare(
      `SELECT r.id, r.reporter_id, r.reporter_name, r.reporter_email,
              r.reason, r.description,
              r.issue_id, r.material_id, r.briefing_id, r.opinion_id,
              r.review_status, r.created_at, r.source, r.policy_code,
              r.submission_type, r.content_snapshot, r.target_user_id,
              COALESCE(r.issue_id, m.issue_id, b.issue_id, o.issue_id) AS target_issue_id,
              COALESCE(r.target_user_id, m.author_id, b.author_id, o.author_id) AS target_author_id
       FROM ct_abuse_reports r
       LEFT JOIN ct_materials m ON r.material_id = m.id
       LEFT JOIN ct_briefings b ON r.briefing_id = b.id
       LEFT JOIN ct_opinions  o ON r.opinion_id  = o.id
       WHERE r.id = ?`
    )
    .bind(id)
    .first<AbuseReport>()
}

/** 取指定使用者自己的 AI 回報，避免把別人的申訴目標暴露給前端。 */
export async function getAiAbuseReportForUser(db: D1Database, reportId: number, userId: string): Promise<AbuseReport | null> {
  const report = await getAbuseReport(db, reportId)
  return report?.source === 'ai' && report.target_user_id === userId ? report : null
}
/** 只列出登入者自己的待複核 AI 回報；不回傳 reporter 或 target_user 欄位。 */
export async function listPendingAiModerationReportsForUser(db: D1Database, userId: string): Promise<MyModerationReport[]> {
  const { results } = await db
    .prepare(
      `SELECT id, policy_code, submission_type, content_snapshot, description, review_status, created_at
       FROM ct_abuse_reports
       WHERE source = 'ai' AND target_user_id = ? AND review_status = 'pending'
       ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<MyModerationReport>()
  return results ?? []
}

/**
 * 列出登入者目前仍可提出申訴的 AI 回報。
 * 已經有 pending 申訴的回報不再顯示表單，避免使用者重複送件後才看到 409。
 */
export async function listAppealableAiModerationReportsForUser(db: D1Database, userId: string): Promise<MyModerationReport[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.policy_code, r.submission_type, r.content_snapshot,
              r.description, r.review_status, r.created_at
       FROM ct_abuse_reports r
       WHERE r.source = 'ai'
         AND r.target_user_id = ?
         AND r.review_status = 'pending'
         AND NOT EXISTS (
           SELECT 1
           FROM ct_moderation_appeals a
           WHERE a.user_id = ?
             AND a.abuse_report_id = r.id
             AND a.status = 'pending'
         )
       ORDER BY r.created_at DESC`
    )
    .bind(userId, userId)
    .all<MyModerationReport>()
  return results ?? []
}

/** 建立一筆自動審查申訴；呼叫端必須先驗證 report 所屬使用者。 */
export async function createModerationAppeal(db: D1Database, input: CreateModerationAppealInput): Promise<number> {
  const { meta } = await db
    .prepare('INSERT INTO ct_moderation_appeals (user_id, user_name, user_email, abuse_report_id, appeal_type, content_snapshot, message) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(input.user_id, input.user_name, input.user_email, input.abuse_report_id, input.appeal_type, input.content_snapshot ?? null, input.message)
    .run()
  return meta.last_row_id
}

/** 同一回報／帳號不可重複建立待處理申訴。 */
export async function findPendingModerationAppeal(db: D1Database, userId: string, reportId: number | null, appealType: ModerationAppealType): Promise<boolean> {
  const row =
    reportId !== null
      ? await db.prepare("SELECT COUNT(*) AS cnt FROM ct_moderation_appeals WHERE user_id = ? AND abuse_report_id = ? AND status = 'pending'").bind(userId, reportId).first<{ cnt: number }>()
      : await db.prepare("SELECT COUNT(*) AS cnt FROM ct_moderation_appeals WHERE user_id = ? AND appeal_type = ? AND status = 'pending'").bind(userId, appealType).first<{ cnt: number }>()
  return (row?.cnt ?? 0) > 0
}

/** 管理端列出申訴（包含被拒內容快照；僅供管理員 API 使用）。 */
export async function listModerationAppeals(db: D1Database): Promise<ModerationAppeal[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, user_name, user_email, abuse_report_id, appeal_type,
              content_snapshot, message, status, admin_id, admin_name,
              review_note, created_at, reviewed_at
       FROM ct_moderation_appeals
       ORDER BY created_at DESC`
    )
    .all<ModerationAppeal>()
  return results ?? []
}

/** 管理端取單筆申訴，供處理前確認狀態與停權目標。 */
export async function getModerationAppeal(db: D1Database, id: number): Promise<ModerationAppeal | null> {
  return db
    .prepare(
      `SELECT id, user_id, user_name, user_email, abuse_report_id, appeal_type,
              content_snapshot, message, status, admin_id, admin_name,
              review_note, created_at, reviewed_at
       FROM ct_moderation_appeals
       WHERE id = ?`
    )
    .bind(id)
    .first<ModerationAppeal>()
}

/** 更新申訴結果；呼叫端需先完成必要的 Better Auth ban/unban。 */
export async function resolveModerationAppeal(
  db: D1Database,
  id: number,
  status: Exclude<ModerationAppealStatus, 'pending'>,
  admin: { id: string; name: string | null },
  reviewNote: string | null
): Promise<void> {
  await db
    .prepare('UPDATE ct_moderation_appeals SET status = ?, admin_id = ?, admin_name = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(status, admin.id, admin.name, reviewNote, id)
    .run()
}

/** 更新濫用回報審核狀態。 */
export async function resolveAbuseReport(db: D1Database, id: number, status: Exclude<AbuseReviewStatus, 'pending'>): Promise<void> {
  await db.prepare('UPDATE ct_abuse_reports SET review_status = ?, pending_target_key = NULL WHERE id = ?').bind(status, id).run()
}

/** 誤報時將目標內容的 abuse_flagged 清回 0。
 * source='user' 誤報只清 1（使用者待審），不降低 AI 遮蔽（3）或管理員確認（2）。
 * source='ai'  誤報只清 3（AI 遮蔽），不干擾使用者待審（1）或確認（2）。*/
export async function unflagContent(db: D1Database, report: Pick<AbuseReport, 'issue_id' | 'material_id' | 'briefing_id' | 'opinion_id' | 'source'>): Promise<void> {
  const flag = report.source === 'ai' ? 3 : 1
  if (report.issue_id    != null) await db.prepare('UPDATE ct_issues    SET abuse_flagged = 0 WHERE id = ? AND abuse_flagged = ?').bind(report.issue_id,    flag).run()
  if (report.material_id != null) await db.prepare('UPDATE ct_materials SET abuse_flagged = 0 WHERE id = ? AND abuse_flagged = ?').bind(report.material_id, flag).run()
  if (report.briefing_id != null) await db.prepare('UPDATE ct_briefings SET abuse_flagged = 0 WHERE id = ? AND abuse_flagged = ?').bind(report.briefing_id, flag).run()
  if (report.opinion_id  != null) await db.prepare('UPDATE ct_opinions  SET abuse_flagged = 0 WHERE id = ? AND abuse_flagged = ?').bind(report.opinion_id,  flag).run()
}

/** 確認濫用時將目標內容的 abuse_flagged 設為 2（完全隱藏，不可展開）。 */
export async function confirmFlagContent(db: D1Database, report: Pick<AbuseReport, 'issue_id' | 'material_id' | 'briefing_id' | 'opinion_id'>): Promise<void> {
  if (report.issue_id != null) {
    await db.prepare('UPDATE ct_issues SET abuse_flagged = 2 WHERE id = ?').bind(report.issue_id).run()
  } else if (report.material_id != null) {
    await db.prepare('UPDATE ct_materials SET abuse_flagged = 2 WHERE id = ?').bind(report.material_id).run()
  } else if (report.briefing_id != null) {
    await db.prepare('UPDATE ct_briefings SET abuse_flagged = 2 WHERE id = ?').bind(report.briefing_id).run()
  } else if (report.opinion_id != null) {
    await db.prepare('UPDATE ct_opinions SET abuse_flagged = 2 WHERE id = ?').bind(report.opinion_id).run()
  }
}
