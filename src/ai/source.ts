// 遠端來源 binding 僅經本檔的固定、參數化 SELECT 使用，從不交給寫入 repository。
export const SOURCE_NAMESPACE = 'vtaiwan-civic-talks' as const
export const MAX_MATERIALS = 64
export const MAX_MATERIAL_BYTES = 48 * 1024
export const MAX_CONTENT_BYTES = 512 * 1024

export interface IssueSource {
  id: number
  title: string
  description: string | null
}

export interface MaterialSource {
  id: number
  issue_id: number
  source_name: string | null
  source_url: string | null
  content: string
  content_hash: string
}

export type SourceRecord =
  | { kind: 'issue'; id: number; hash: string; payload: IssueSource }
  | { kind: 'material'; id: number; hash: string; payload: MaterialSource }

export interface SourceInput {
  issue: IssueSource
  materials: MaterialSource[]
  sources: SourceRecord[]
  exclusions: Array<{ id: number; reason: 'hidden' }>
  content_bytes: number
}

export class SourceInputError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 413 | 422,
    readonly details: Record<string, unknown> = {}
  ) {
    super(code)
  }
}

const encoder = new TextEncoder()

/** 所有 hash 均以未正規化的 UTF-8 計算。 */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function issueRecord(issue: IssueSource): Promise<SourceRecord> {
  const payload: IssueSource = { id: issue.id, title: issue.title, description: issue.description }
  return { kind: 'issue', id: issue.id, hash: await sha256(JSON.stringify(payload)), payload }
}

async function materialRecord(material: Omit<MaterialSource, 'content_hash'>): Promise<SourceRecord> {
  const payload: MaterialSource = {
    id: material.id,
    issue_id: material.issue_id,
    source_name: material.source_name,
    source_url: material.source_url,
    content: material.content,
    content_hash: await sha256(material.content),
  }
  return { kind: 'material', id: material.id, hash: await sha256(JSON.stringify(payload)), payload }
}

type IssueRow = IssueSource & { abuse_flagged: number }
type MaterialRow = Omit<MaterialSource, 'content_hash'> & { abuse_flagged: number }
type MaterialStatus = { id: number; abuse_flagged: number }

/** 僅來源識別及可讀狀態，不投影作者或正文。 */
export async function readMaterialStatuses(sourceDb: D1Database, issueId: number): Promise<MaterialStatus[]> {
  const result = await sourceDb.prepare('SELECT id, abuse_flagged FROM ct_materials WHERE issue_id = ? ORDER BY id').bind(issueId).all<MaterialStatus>()
  return result.results ?? []
}

/** 取得當前、可送交模型的來源；不接受呼叫者提供正文、hash 或作者欄位。 */
export async function readSourceInput(sourceDb: D1Database, issueId: number, requestedIds?: number[]): Promise<SourceInput> {
  const issue = await sourceDb
    .prepare('SELECT id, title, description, abuse_flagged FROM ct_issues WHERE id = ? AND abuse_flagged = 0')
    .bind(issueId)
    .first<IssueRow>()
  if (!issue) throw new SourceInputError('issue_unavailable', 422)

  const rows = await readMaterialStatuses(sourceDb, issueId)
  const available = rows.filter(row => row.abuse_flagged === 0)
  const exclusions = rows.filter(row => row.abuse_flagged !== 0).map(row => ({ id: row.id, reason: 'hidden' as const }))
  let ids: number[]
  if (requestedIds !== undefined) {
    if (!Array.isArray(requestedIds) || requestedIds.length === 0 || requestedIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(requestedIds).size !== requestedIds.length) {
      throw new SourceInputError('invalid_material_ids', 400)
    }
    if (requestedIds.length > MAX_MATERIALS) throw new SourceInputError('too_many_materials', 422, { maximum: MAX_MATERIALS, count: requestedIds.length })
    const availableIds = new Set(available.map(row => row.id))
    const unavailable = requestedIds.filter(id => !availableIds.has(id))
    if (unavailable.length) throw new SourceInputError('material_unavailable', 422, { material_ids: unavailable })
    ids = [...requestedIds].sort((a, b) => a - b)
  } else {
    ids = available.map(row => row.id)
  }
  if (!ids.length) throw new SourceInputError('no_available_materials', 422, { exclusions })
  if (ids.length > MAX_MATERIALS) throw new SourceInputError('too_many_materials', 422, { maximum: MAX_MATERIALS, count: ids.length, material_ids: ids })

  const sources: SourceRecord[] = [await issueRecord(issue)]
  let contentBytes = 0
  for (const id of ids) {
    const material = await sourceDb
      .prepare('SELECT id, issue_id, source_name, source_url, content, abuse_flagged FROM ct_materials WHERE issue_id = ? AND id = ? AND abuse_flagged = 0')
      .bind(issueId, id)
      .first<MaterialRow>()
    // 來源在兩次 SELECT 間隱藏或刪除時，不沿用先前狀態。
    if (!material || typeof material.content !== 'string') throw new SourceInputError('material_unavailable', 422, { material_ids: [id] })
    if (!material.content.trim()) throw new SourceInputError('empty_material', 422, { material_ids: [id] })
    const bytes = encoder.encode(material.content).byteLength
    if (bytes > MAX_MATERIAL_BYTES) throw new SourceInputError('material_too_large', 422, { material_id: id, bytes, maximum: MAX_MATERIAL_BYTES })
    contentBytes += bytes
    if (contentBytes > MAX_CONTENT_BYTES) throw new SourceInputError('input_too_large', 422, { bytes: contentBytes, maximum: MAX_CONTENT_BYTES, material_ids: ids })
    sources.push(await materialRecord(material))
  }
  return {
    issue: (sources[0] as Extract<SourceRecord, { kind: 'issue' }>).payload,
    materials: sources.slice(1).map(record => (record as Extract<SourceRecord, { kind: 'material' }>).payload),
    sources,
    exclusions,
    content_bytes: contentBytes,
  }
}

export type SourceCheck = { status: 'valid'; hash: string } | { status: 'withdrawn'; hash: string | null } | { status: 'deleted'; hash: null }

/** 隱藏內容以 CASE 在 SQL 中遮蔽；遠端查詢失敗一律向上拋出、不得回傳舊快照。 */
export async function inspectSource(sourceDb: D1Database, kind: 'issue' | 'material', id: number, expectedHash: string): Promise<SourceCheck> {
  if (kind === 'issue') {
    const row = await sourceDb
      .prepare('SELECT id, abuse_flagged, CASE WHEN abuse_flagged = 0 THEN title END AS title, CASE WHEN abuse_flagged = 0 THEN description END AS description FROM ct_issues WHERE id = ?')
      .bind(id)
      .first<IssueRow>()
    if (!row) return { status: 'deleted', hash: null }
    if (row.abuse_flagged !== 0 || typeof row.title !== 'string') return { status: 'withdrawn', hash: null }
    const hash = (await issueRecord(row)).hash
    return { status: hash === expectedHash ? 'valid' : 'withdrawn', hash }
  }
  const row = await sourceDb
    .prepare('SELECT id, issue_id, abuse_flagged, CASE WHEN abuse_flagged = 0 THEN source_name END AS source_name, CASE WHEN abuse_flagged = 0 THEN source_url END AS source_url, CASE WHEN abuse_flagged = 0 THEN content END AS content FROM ct_materials WHERE id = ?')
    .bind(id)
    .first<MaterialRow>()
  if (!row) return { status: 'deleted', hash: null }
  if (row.abuse_flagged !== 0 || typeof row.content !== 'string') return { status: 'withdrawn', hash: null }
  const hash = (await materialRecord(row)).hash
  return { status: hash === expectedHash ? 'valid' : 'withdrawn', hash }
}
