import type { IssueSource, MaterialSource, SourceRecord } from './source'

// 此 repository 只接受隔離本機 DB；遠端來源的可讀性由呼叫端先查核。
export type IssuePayload = IssueSource
export type MaterialPayload = MaterialSource
export type SourceInput = SourceRecord
export type SourceKind = 'issue' | 'material'
export type SourceGeneration = { kind: SourceKind; id: number; generation: number }
export type ExecutionStatus = 'queued' | 'extracting' | 'comparing' | 'generating' | 'ai_draft' | 'partial_draft' | 'failed' | 'withdrawn' | 'erased'
export type ArtifactKind = 'raw' | 'extraction' | 'comparison' | 'generation' | 'diagnostics'
export type ErrorCode =
  | 'source_unavailable' | 'source_withdrawn' | 'source_stale' | 'source_erased' | 'account_suspended'
  | 'budget_exhausted' | 'provider_error' | 'provider_uncertain' | 'invalid_extraction'
  | 'too_many_evidence' | 'comparison_incomplete' | 'invalid_generation' | 'workflow_limit' | 'configuration_changed' | 'internal_error'

export interface InputManifest {
  namespace: string
  issue: { id: number; hash: string }
  materials: Array<{ id: number; hash: string; content_hash: string }>
  language: string
  settings: unknown
}
export interface ClaimInput {
  ownerId: string
  issueId: number
  inputKey: string
  manifest: InputManifest
  sources: SourceInput[]
  initialEstimateMicroUsd: number
  consentVersion: string
  consentAt: string
  now?: string
}
export type ClaimResult =
  | { outcome: 'created' | 'joined' | 'cached'; jobId: string; executionId: string; status: ExecutionStatus }
  | { outcome: 'quota' | 'budget'; resetAt: string }
  | { outcome: 'cooldown'; retryAt: string }
  | { outcome: 'erased' | 'withdrawn' | 'conflict' }
export interface Snapshot {
  executionId: string
  manifest: InputManifest
  sources: Array<SourceInput & { generation: number }>
  generations: SourceGeneration[]
}
export interface JobInfo {
  id: string
  executionId: string
  inputKey: string
  issueId: number
  language: string
  status: ExecutionStatus
  errorCode: ErrorCode | null
  artifactId: string | null
  createdAt: string
  updatedAt: string
  sourceCheckedAt: string | null
  usage: { attempts: number; reservedMicroUsd: number; actualMicroUsd: number; uncertain: number }
}
export interface Artifact {
  id: string
  executionId: string
  attemptId: string | null
  kind: ArtifactKind
  payload: unknown
  payloadHash: string
  createdAt: string
}
export interface ArtifactSummary {
  id: string
  kind: ArtifactKind
  sha256: string
  created_at: string
  model: {
    selector: string | null
    provider_model: string | null
    provider_revision: string | null
    request_id: string | null
    system_fingerprint: string | null
    request_sha256: string | null
    pricing_version: string | null
    usage_status: string
  } | null
  attempt: { id: string; state: string; estimated_micro_usd: number; actual_micro_usd: number | null } | null
}
export interface Revision {
  id: string
  parentId: string
  editorId: string
  payload: unknown
  payloadHash: string
  diff: FieldChange[]
  createdAt: string
  verification: 'human_unverified'
}
export interface FieldChange { path: string; before?: unknown; after?: unknown }
export type AttemptResult =
  | { outcome: 'started'; attemptId: string }
  | { outcome: 'existing'; attemptId: string; state: 'started' | 'unknown' | 'settled'; artifactId: string | null }
  | { outcome: 'budget'; resetAt: string }
  | { outcome: 'fenced' }
export type SaveResult = { outcome: 'saved'; artifactId: string } | { outcome: 'fenced' | 'conflict' }
export type RevisionResult = { outcome: 'created'; revisionId: string } | { outcome: 'conflict' | 'unavailable' }

const DAILY_BUDGET = 5_000_000
const DAILY_JOBS = 20
const COOLDOWN_MS = 5 * 60 * 1000
const ACTIVE = "'queued','extracting','comparing','generating'"
const READABLE = "'queued','extracting','comparing','generating','ai_draft','partial_draft','failed'"
const FINAL = "'ai_draft','partial_draft'"
const HASH = /^[a-f0-9]{64}$/
const STEP_KEY = /^[a-z0-9][a-z0-9:._-]{0,119}$/
const ERROR_CODES: readonly ErrorCode[] = ['source_unavailable', 'source_withdrawn', 'source_stale', 'source_erased', 'account_suspended', 'budget_exhausted', 'provider_error', 'provider_uncertain', 'invalid_extraction', 'too_many_evidence', 'comparison_incomplete', 'invalid_generation', 'workflow_limit', 'configuration_changed', 'internal_error']

// 全來源與呼叫時擷取的 generation 必須完整一致；判斷與寫入在同一 SQL 內。
const fence = (alias: string) => `
  EXISTS (SELECT 1 FROM ct_ai_sources s WHERE s.execution_id = ${alias}.id)
  AND NOT EXISTS (
    SELECT 1 FROM ct_ai_sources s LEFT JOIN ct_ai_source_fences f
      ON f.namespace = s.namespace AND f.kind = s.kind AND f.source_id = s.source_id
    WHERE s.execution_id = ${alias}.id
      AND (f.generation IS NULL OR f.erased_at IS NOT NULL OR f.generation <> s.generation OR s.payload IS NULL)
  )`
const capturedFence = (alias: string) => `${fence(alias)}
  AND (SELECT COUNT(*) FROM ct_ai_sources s WHERE s.execution_id = ${alias}.id) = (SELECT COUNT(*) FROM json_each(?))
  AND NOT EXISTS (
    SELECT 1 FROM ct_ai_sources s WHERE s.execution_id = ${alias}.id AND NOT EXISTS (
      SELECT 1 FROM json_each(?) g WHERE json_extract(g.value, '$.kind') = s.kind
        AND json_extract(g.value, '$.id') = s.source_id AND json_extract(g.value, '$.generation') = s.generation
    )
  )`
// 尚未開始、未結及未知的預留跨日保留；已結算金額只計入呼叫所屬 UTC 日。
const budgetSql = `COALESCE((SELECT SUM(CASE WHEN state = 'settled' THEN actual_micro_usd ELSE estimate_micro_usd END)
  FROM ct_ai_usage WHERE started_day = ? OR state IN ('reserved','started','unknown')), 0)`
// 排隊／執行中的 admission 暫佔名額；終止前從未開始付費嘗試則釋放，已開始者仍計入。
const quotaSql = `(SELECT COUNT(*) FROM ct_ai_executions q
  WHERE q.charged_owner_id = ? AND q.created_day = ?
    AND (q.status IN (${ACTIVE}) OR EXISTS (
      SELECT 1 FROM ct_ai_usage u WHERE u.execution_id = q.id AND u.state IN ('started','unknown','settled')
    )))`
// 同毫秒可能有一個失敗與一個新 admission；只在沒有仍有效或已付費的同時刻工作時釋放。
const releaseUnstartedCooldown = `DELETE FROM ct_ai_issue_cooldowns
  WHERE EXISTS (SELECT 1 FROM ct_ai_executions e
    WHERE e.status IN ('failed','withdrawn','erased') AND e.namespace = ct_ai_issue_cooldowns.namespace
      AND e.issue_id = ct_ai_issue_cooldowns.issue_id AND e.created_at = ct_ai_issue_cooldowns.claimed_at)
  AND NOT EXISTS (SELECT 1 FROM ct_ai_executions e
    WHERE e.namespace = ct_ai_issue_cooldowns.namespace AND e.issue_id = ct_ai_issue_cooldowns.issue_id
      AND e.created_at = ct_ai_issue_cooldowns.claimed_at
      AND (e.status IN (${ACTIVE}) OR EXISTS (
        SELECT 1 FROM ct_ai_usage u WHERE u.execution_id = e.id AND u.state IN ('started','unknown','settled')
      )))`

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export class EvidenceStoreError extends Error {
  readonly code: 'invalid_input' | 'storage_error'
  constructor(code: 'invalid_input' | 'storage_error') {
    super(code)
    this.code = code
  }
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) {
    if (error instanceof EvidenceStoreError) throw error
    throw new EvidenceStoreError('storage_error')
  }
}
function invalid(): never { throw new EvidenceStoreError('invalid_input') }
function time(value?: string): string {
  const date = value === undefined ? new Date() : new Date(value)
  if (!Number.isFinite(date.getTime())) return invalid()
  return date.toISOString()
}
function resetAt(now: string): string {
  const next = new Date(now)
  next.setUTCHours(24, 0, 0, 0)
  return next.toISOString()
}
function id(): string { return crypto.randomUUID() }
function json(value: unknown): string {
  try {
    const result = JSON.stringify(value)
    if (result === undefined) return invalid()
    return result
  } catch { return invalid() }
}
function validGenerations(generations: SourceGeneration[]): string {
  if (!Array.isArray(generations) || !generations.length || generations.length > 65) return invalid()
  const seen = new Set<string>()
  for (const item of generations) {
    if (!item || !['issue', 'material'].includes(item.kind) || !Number.isSafeInteger(item.id) || item.id <= 0 || !Number.isSafeInteger(item.generation) || item.generation < 0) return invalid()
    const key = `${item.kind}:${item.id}`
    if (seen.has(key)) return invalid()
    seen.add(key)
  }
  return json(generations)
}
function positiveMicro(value: number): boolean { return Number.isSafeInteger(value) && value > 0 }

async function validateClaim(input: ClaimInput): Promise<{ manifest: string; sources: string }> {
  if (!input.ownerId || !input.consentVersion || !Number.isSafeInteger(input.issueId) || input.issueId <= 0 || !HASH.test(input.inputKey) || !positiveMicro(input.initialEstimateMicroUsd)) return invalid()
  const manifest = input.manifest
  if (!manifest || typeof manifest.namespace !== 'string' || !manifest.namespace || typeof manifest.language !== 'string' || !manifest.language || !manifest.issue || manifest.issue.id !== input.issueId || !Array.isArray(manifest.materials)) return invalid()
  const manifestJson = json(manifest)
  if (await sha256(manifestJson) !== input.inputKey) return invalid()
  if (!Array.isArray(input.sources) || input.sources.length < 2 || input.sources.length > 65 || manifest.materials.length !== input.sources.length - 1) return invalid()
  const normalized: SourceInput[] = []
  const seen = new Set<string>()
  for (const source of input.sources) {
    if (!source || !Number.isSafeInteger(source.id) || source.id <= 0 || !HASH.test(source.hash)) return invalid()
    const key = `${source.kind}:${source.id}`
    if (seen.has(key)) return invalid()
    seen.add(key)
    if (source.kind === 'issue') {
      const p = source.payload
      if (source.id !== input.issueId || p.id !== source.id || typeof p.title !== 'string' || (p.description !== null && typeof p.description !== 'string')) return invalid()
      const payload: IssuePayload = { id: p.id, title: p.title, description: p.description }
      if (manifest.issue.hash !== source.hash || await sha256(json(payload)) !== source.hash) return invalid()
      normalized.push({ kind: 'issue', id: source.id, hash: source.hash, payload })
    } else if (source.kind === 'material') {
      const p = source.payload
      if (p.id !== source.id || p.issue_id !== input.issueId || typeof p.content !== 'string' || (p.source_name !== null && typeof p.source_name !== 'string') || (p.source_url !== null && typeof p.source_url !== 'string') || !HASH.test(p.content_hash)) return invalid()
      const payload: MaterialPayload = { id: p.id, issue_id: p.issue_id, source_name: p.source_name, source_url: p.source_url, content: p.content, content_hash: p.content_hash }
      const entry = manifest.materials.find(item => item.id === source.id)
      if (!entry || entry.hash !== source.hash || entry.content_hash !== p.content_hash || await sha256(p.content) !== p.content_hash || await sha256(json(payload)) !== source.hash) return invalid()
      normalized.push({ kind: 'material', id: source.id, hash: source.hash, payload })
    } else return invalid()
  }
  if (!seen.has(`issue:${input.issueId}`) || new Set(manifest.materials.map(item => item.id)).size !== manifest.materials.length) return invalid()
  time(input.consentAt)
  return { manifest: manifestJson, sources: json(normalized) }
}

// JSON Pointer 欄位差異由程式產生；陣列逐項比較，不沿用 AI 的引用驗證標籤。
function fieldDiff(before: unknown, after: unknown, path = ''): FieldChange[] {
  if (json(before) === json(after)) return []
  const a = before !== null && typeof before === 'object'
  const b = after !== null && typeof after === 'object'
  if (a && b && Array.isArray(before) === Array.isArray(after)) {
    const left = before as Record<string, unknown>
    const right = after as Record<string, unknown>
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    return keys.flatMap(key => {
      const pointer = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
      if (!Object.hasOwn(left, key)) return [{ path: pointer, after: right[key] }]
      if (!Object.hasOwn(right, key)) return [{ path: pointer, before: left[key] }]
      return fieldDiff(left[key], right[key], pointer)
    })
  }
  return [{ path, before, after }]
}

export class EvidenceStore {
  private readonly db: D1Database
  constructor(db: D1Database) {
    this.db = db
  }

  async claimJob(input: ClaimInput): Promise<ClaimResult> { return safe(async () => {
    const checked = await validateClaim(input)
    const now = time(input.now)
    const day = now.slice(0, 10)
    const cutoff = new Date(Date.parse(now) - COOLDOWN_MS).toISOString()
    const executionId = id()
    const jobId = id()
    const reservationId = id()
    const namespace = input.manifest.namespace
    const results = await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO ct_ai_source_fences (namespace, kind, source_id, generation)
        SELECT ?, json_extract(value, '$.kind'), json_extract(value, '$.id'), 0 FROM json_each(?)`).bind(namespace, checked.sources),
      this.db.prepare(`INSERT OR IGNORE INTO ct_ai_executions
        (id, input_key, namespace, issue_id, charged_owner_id, language, manifest, status, created_at, updated_at, created_day)
        SELECT ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM json_each(?) j JOIN ct_ai_source_fences f
          ON f.namespace = ? AND f.kind = json_extract(j.value, '$.kind') AND f.source_id = json_extract(j.value, '$.id') WHERE f.erased_at IS NOT NULL)
        AND ${quotaSql} < ?
        AND NOT EXISTS (SELECT 1 FROM ct_ai_issue_cooldowns WHERE namespace = ? AND issue_id = ? AND claimed_at > ?)
        AND ${budgetSql} + ? <= ?`).bind(executionId, input.inputKey, namespace, input.issueId, input.ownerId, input.manifest.language, checked.manifest, now, now, day, checked.sources, namespace, input.ownerId, day, DAILY_JOBS, namespace, input.issueId, cutoff, day, input.initialEstimateMicroUsd, DAILY_BUDGET),
      this.db.prepare(`INSERT INTO ct_ai_sources (execution_id, namespace, kind, source_id, source_hash, generation, payload, checked_at)
        SELECT ?, ?, json_extract(j.value, '$.kind'), json_extract(j.value, '$.id'), json_extract(j.value, '$.hash'), f.generation,
          json_extract(j.value, '$.payload'), ? FROM json_each(?) j JOIN ct_ai_source_fences f
          ON f.namespace = ? AND f.kind = json_extract(j.value, '$.kind') AND f.source_id = json_extract(j.value, '$.id')
        WHERE EXISTS (SELECT 1 FROM ct_ai_executions WHERE id = ?)`).bind(executionId, namespace, now, checked.sources, namespace, executionId),
      this.db.prepare(`INSERT INTO ct_ai_usage (id, execution_id, step_key, started_at, started_day, estimate_micro_usd, state)
        SELECT ?, id, '_admission', ?, ?, ?, 'reserved' FROM ct_ai_executions WHERE id = ?`)
        .bind(reservationId, now, day, input.initialEstimateMicroUsd, executionId),
      this.db.prepare(`INSERT OR IGNORE INTO ct_ai_jobs (id, execution_id, owner_id, consent_version, consent_at, created_at)
        SELECT ?, e.id, ?, ?, ?, ? FROM ct_ai_executions e WHERE e.input_key = ? AND e.manifest = ?
        AND e.status IN (${READABLE}) AND ${fence('e')}`).bind(jobId, input.ownerId, input.consentVersion, time(input.consentAt), now, input.inputKey, checked.manifest),
      this.db.prepare(`INSERT INTO ct_ai_issue_cooldowns (namespace, issue_id, claimed_at)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM ct_ai_executions WHERE id = ?)
        ON CONFLICT(namespace, issue_id) DO UPDATE SET claimed_at = excluded.claimed_at`).bind(namespace, input.issueId, now, executionId),
    ])
    const row = await this.db.prepare(`SELECT e.id AS execution_id, e.status, e.manifest, j.id AS job_id
      FROM ct_ai_executions e LEFT JOIN ct_ai_jobs j ON j.execution_id = e.id AND j.owner_id = ? WHERE e.input_key = ?`)
      .bind(input.ownerId, input.inputKey).first<{ execution_id: string; status: ExecutionStatus; manifest: string | null; job_id: string | null }>()
    if (row) {
      if (row.status === 'erased') return { outcome: 'erased' }
      if (row.status === 'withdrawn') return { outcome: 'withdrawn' }
      if (row.manifest !== checked.manifest || !row.job_id) return { outcome: 'conflict' }
      return { outcome: (results[1].meta.changes ?? 0) > 0 ? 'created' : row.status === 'ai_draft' || row.status === 'partial_draft' ? 'cached' : 'joined', jobId: row.job_id, executionId: row.execution_id, status: row.status }
    }
    const state = await this.db.prepare(`SELECT
      EXISTS (SELECT 1 FROM json_each(?) j JOIN ct_ai_source_fences f ON f.namespace = ? AND f.kind = json_extract(j.value, '$.kind') AND f.source_id = json_extract(j.value, '$.id') WHERE f.erased_at IS NOT NULL) AS erased,
      ${quotaSql} AS quota,
      (SELECT claimed_at FROM ct_ai_issue_cooldowns WHERE namespace = ? AND issue_id = ?) AS cooldown,
      ${budgetSql} AS budget`).bind(checked.sources, namespace, input.ownerId, day, namespace, input.issueId, day)
      .first<{ erased: number; quota: number; cooldown: string | null; budget: number }>()
    if (state?.erased) return { outcome: 'erased' }
    if ((state?.quota ?? 0) >= DAILY_JOBS) return { outcome: 'quota', resetAt: resetAt(now) }
    if (state?.cooldown && state.cooldown > cutoff) return { outcome: 'cooldown', retryAt: new Date(Date.parse(state.cooldown) + COOLDOWN_MS).toISOString() }
    if ((state?.budget ?? 0) + input.initialEstimateMicroUsd > DAILY_BUDGET) return { outcome: 'budget', resetAt: resetAt(now) }
    return { outcome: 'conflict' }
  }) }

  async getSnapshot(executionId: string): Promise<Snapshot | null> { return safe(async () => {
    const rows = await this.db.prepare(`SELECT e.manifest, s.kind, s.source_id, s.source_hash, s.generation, s.payload
      FROM ct_ai_executions e JOIN ct_ai_sources s ON s.execution_id = e.id
      WHERE e.id = ? AND e.status IN (${READABLE}) AND ${fence('e')}
      ORDER BY CASE s.kind WHEN 'issue' THEN 0 ELSE 1 END, s.source_id`).bind(executionId)
      .all<{ manifest: string; kind: SourceKind; source_id: number; source_hash: string; generation: number; payload: string }>()
    if (!rows.results?.length || !rows.results[0].manifest) return null
    const sources = rows.results.map(row => ({ kind: row.kind, id: row.source_id, hash: row.source_hash, generation: row.generation, payload: JSON.parse(row.payload) }) as SourceInput & { generation: number })
    return { executionId, manifest: JSON.parse(rows.results[0].manifest) as InputManifest, sources, generations: sources.map(source => ({ kind: source.kind, id: source.id, generation: source.generation })) }
  }) }

  async listSources(executionId?: string): Promise<Array<{ executionId: string; namespace: string; kind: SourceKind; id: number; hash: string; generation: number; checkedAt: string }>> { return safe(async () => {
    const statement = this.db.prepare(`SELECT s.execution_id, s.namespace, s.kind, s.source_id, s.source_hash, s.generation, s.checked_at
      FROM ct_ai_sources s JOIN ct_ai_executions e ON e.id = s.execution_id WHERE e.status <> 'erased' ${executionId ? 'AND e.id = ?' : ''} ORDER BY s.namespace, s.kind, s.source_id, s.execution_id`)
    const rows = await (executionId ? statement.bind(executionId) : statement).all<{
        execution_id: string; namespace: string; kind: SourceKind; source_id: number; source_hash: string; generation: number; checked_at: string
      }>()
    return (rows.results ?? []).map(row => ({ executionId: row.execution_id, namespace: row.namespace, kind: row.kind, id: row.source_id, hash: row.source_hash, generation: row.generation, checkedAt: row.checked_at }))
  }) }

  /** 呼叫端確認全來源有效後，一次更新檢查時間；不可用來代替遠端查核。 */
  async touchSources(executionId: string, generations: SourceGeneration[], now?: string): Promise<boolean> { return safe(async () => {
    const captured = validGenerations(generations)
    const result = await this.db.prepare(`UPDATE ct_ai_sources AS s SET checked_at = ? WHERE s.execution_id = ?
      AND EXISTS (SELECT 1 FROM ct_ai_executions e WHERE e.id = s.execution_id AND e.status IN (${READABLE}) AND ${capturedFence('e')})`)
      .bind(time(now), executionId, captured, captured).run()
    return (result.meta.changes ?? 0) === generations.length
  }) }

  async getJob(jobId: string, viewerId: string, isAdmin = false): Promise<JobInfo | null> { return safe(async () => {
    const row = await this.db.prepare(`SELECT j.id, e.id AS execution_id, e.input_key, e.issue_id, e.language, e.status, e.error_code, e.artifact_id, j.created_at, e.updated_at,
      (SELECT MIN(checked_at) FROM ct_ai_sources WHERE execution_id = e.id) AS source_checked_at,
      (SELECT COUNT(*) FROM ct_ai_usage WHERE execution_id = e.id AND state <> 'reserved') AS attempts,
      (SELECT COALESCE(SUM(estimate_micro_usd), 0) FROM ct_ai_usage WHERE execution_id = e.id AND state <> 'settled') AS reserved,
      (SELECT COALESCE(SUM(actual_micro_usd), 0) FROM ct_ai_usage WHERE execution_id = e.id AND state = 'settled') AS actual,
      (SELECT COUNT(*) FROM ct_ai_usage WHERE execution_id = e.id AND state = 'unknown') AS uncertain
      FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id WHERE j.id = ? AND (j.owner_id = ? OR ? = 1)`)
      .bind(jobId, viewerId, isAdmin ? 1 : 0).first<{ id: string; execution_id: string; input_key: string; issue_id: number; language: string; status: ExecutionStatus; error_code: ErrorCode | null; artifact_id: string | null; created_at: string; updated_at: string; source_checked_at: string | null; attempts: number; reserved: number; actual: number; uncertain: number }>()
    if (!row) return null
    return { id: row.id, executionId: row.execution_id, inputKey: row.input_key, issueId: row.issue_id, language: row.language, status: row.status, errorCode: row.error_code, artifactId: row.status === 'withdrawn' || row.status === 'erased' ? null : row.artifact_id, createdAt: row.created_at, updatedAt: row.updated_at, sourceCheckedAt: row.source_checked_at, usage: { attempts: row.attempts, reservedMicroUsd: row.reserved, actualMicroUsd: row.actual, uncertain: row.uncertain } }
  }) }

  /** 僅供 workflow 讀取啟動者 ID，以便每個付費階段重查停權。 */
  async getWorkflowJob(jobId: string): Promise<{ id: string; executionId: string; ownerId: string; status: ExecutionStatus; artifactId: string | null } | null> { return safe(async () => {
    const row = await this.db.prepare(`SELECT j.id, e.id AS execution_id, e.charged_owner_id, e.status, e.artifact_id
      FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id WHERE j.id = ? AND j.owner_id = e.charged_owner_id`)
      .bind(jobId).first<{ id: string; execution_id: string; charged_owner_id: string; status: ExecutionStatus; artifact_id: string | null }>()
    return row ? { id: row.id, executionId: row.execution_id, ownerId: row.charged_owner_id, status: row.status, artifactId: row.status === 'withdrawn' || row.status === 'erased' ? null : row.artifact_id } : null
  }) }

  /** 修復本機 workflow 時只列啟動者的有效進行中工作，不輸出內容。 */
  async listActiveWorkflowJobs(): Promise<Array<{ id: string; executionId: string; status: 'queued' | 'extracting' | 'comparing' | 'generating' }>> { return safe(async () => {
    const rows = await this.db.prepare(`SELECT j.id, e.id AS execution_id, e.status
      FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id
      WHERE j.owner_id = e.charged_owner_id AND e.status IN (${ACTIVE}) AND ${fence('e')}
      ORDER BY e.created_at, e.id`).all<{ id: string; execution_id: string; status: 'queued' | 'extracting' | 'comparing' | 'generating' }>()
    return (rows.results ?? []).map(row => ({ id: row.id, executionId: row.execution_id, status: row.status }))
  }) }

  async beginAttempt(input: { executionId: string; stepKey: string; estimateMicroUsd: number; generations: SourceGeneration[]; now?: string }): Promise<AttemptResult> { return safe(async () => {
    if (!STEP_KEY.test(input.stepKey) || !positiveMicro(input.estimateMicroUsd)) return invalid()
    const generations = validGenerations(input.generations)
    const now = time(input.now)
    const attemptId = id()
    const results = await this.db.batch([
      this.db.prepare(`UPDATE ct_ai_usage AS u SET step_key = ?, started_at = ?, started_day = ?,
        estimate_micro_usd = MAX(estimate_micro_usd, ?), state = 'started'
        WHERE u.execution_id = ? AND u.state = 'reserved'
        AND NOT EXISTS (SELECT 1 FROM ct_ai_usage other WHERE other.execution_id = u.execution_id AND other.step_key = ?)
        AND EXISTS (SELECT 1 FROM ct_ai_executions e WHERE e.id = u.execution_id AND e.status IN (${ACTIVE}) AND ${capturedFence('e')})
        AND ${budgetSql} + MAX(0, ? - u.estimate_micro_usd) <= ?`)
        .bind(input.stepKey, now, now.slice(0, 10), input.estimateMicroUsd, input.executionId, input.stepKey, generations, generations, now.slice(0, 10), input.estimateMicroUsd, DAILY_BUDGET),
      this.db.prepare(`INSERT OR IGNORE INTO ct_ai_usage (id, execution_id, step_key, started_at, started_day, estimate_micro_usd, state)
        SELECT ?, e.id, ?, ?, ?, ?, 'started' FROM ct_ai_executions e WHERE e.id = ? AND e.status IN (${ACTIVE})
        AND NOT EXISTS (SELECT 1 FROM ct_ai_usage u WHERE u.execution_id = e.id AND u.state = 'reserved')
        AND ${capturedFence('e')} AND ${budgetSql} + ? <= ?`)
        .bind(attemptId, input.stepKey, now, now.slice(0, 10), input.estimateMicroUsd, input.executionId, generations, generations, now.slice(0, 10), input.estimateMicroUsd, DAILY_BUDGET),
    ])
    const existing = await this.db.prepare(`SELECT u.id, u.state, CASE WHEN e.status IN (${READABLE}) AND ${fence('e')}
      THEN (SELECT a.id FROM ct_ai_artifacts a WHERE a.attempt_id = u.id AND a.kind = 'raw' AND a.payload IS NOT NULL) END AS artifact_id
      FROM ct_ai_usage u JOIN ct_ai_executions e ON e.id = u.execution_id WHERE u.execution_id = ? AND u.step_key = ?`)
      .bind(input.executionId, input.stepKey).first<{ id: string; state: 'started' | 'unknown' | 'settled'; artifact_id: string | null }>()
    if (existing && ((results[0].meta.changes ?? 0) > 0 || (results[1].meta.changes ?? 0) > 0)) return { outcome: 'started', attemptId: existing.id }
    if (existing) return { outcome: 'existing', attemptId: existing.id, state: existing.state, artifactId: existing.artifact_id }
    const eligible = await this.db.prepare(`SELECT e.id FROM ct_ai_executions e WHERE e.id = ? AND e.status IN (${ACTIVE}) AND ${capturedFence('e')}`)
      .bind(input.executionId, generations, generations).first<{ id: string }>()
    return eligible ? { outcome: 'budget', resetAt: resetAt(now) } : { outcome: 'fenced' }
  }) }

  async settleAttempt(attemptId: string, actualMicroUsd: number | null, now?: string): Promise<'settled' | 'unknown' | 'existing' | 'missing'> { return safe(async () => {
    if (actualMicroUsd !== null && (!Number.isSafeInteger(actualMicroUsd) || actualMicroUsd < 0)) return invalid()
    const at = time(now)
    const state = actualMicroUsd === null ? 'unknown' : 'settled'
    const result = await this.db.prepare(`UPDATE ct_ai_usage SET state = ?, actual_micro_usd = ?, settled_at = ?
      WHERE id = ? AND (state = 'started' OR (state = 'unknown' AND ? IS NOT NULL))`)
      .bind(state, actualMicroUsd, at, attemptId, actualMicroUsd).run()
    if ((result.meta.changes ?? 0) > 0) return state
    return await this.db.prepare('SELECT id FROM ct_ai_usage WHERE id = ?').bind(attemptId).first() ? 'existing' : 'missing'
  }) }

  /** 復原時僅將指定已中斷執行的未結呼叫標記不確定，保留預留並禁止重打。 */
  async markAttemptsUnknown(executionId: string, now?: string): Promise<number> { return safe(async () => {
    const result = await this.db.prepare("UPDATE ct_ai_usage SET state = 'unknown', settled_at = ? WHERE execution_id = ? AND state = 'started'").bind(time(now), executionId).run()
    return result.meta.changes ?? 0
  }) }

  async budget(now?: string): Promise<{ day: string; committedMicroUsd: number; remainingMicroUsd: number; resetAt: string }> { return safe(async () => {
    const at = time(now)
    const row = await this.db.prepare(`SELECT ${budgetSql} AS committed`).bind(at.slice(0, 10)).first<{ committed: number }>()
    const committed = row?.committed ?? 0
    return { day: at.slice(0, 10), committedMicroUsd: committed, remainingMicroUsd: Math.max(0, DAILY_BUDGET - committed), resetAt: resetAt(at) }
  }) }

  async setStatus(input: { executionId: string; expected: 'queued' | 'extracting' | 'comparing' | 'generating'; next: 'extracting' | 'comparing' | 'generating' | 'failed'; errorCode?: ErrorCode; generations: SourceGeneration[]; now?: string }): Promise<boolean> { return safe(async () => {
    const transitions: Record<string, string[]> = { queued: ['extracting', 'failed'], extracting: ['comparing', 'failed'], comparing: ['generating', 'failed'], generating: ['failed'] }
    if (!transitions[input.expected]?.includes(input.next) || (input.errorCode !== undefined && !ERROR_CODES.includes(input.errorCode)) || (input.next === 'failed') !== (input.errorCode !== undefined)) return invalid()
    const generations = validGenerations(input.generations)
    const results = await this.db.batch([
      this.db.prepare(`UPDATE ct_ai_executions AS e SET status = ?, error_code = ?, updated_at = ?
        WHERE e.id = ? AND e.status = ? AND ${capturedFence('e')}`)
        .bind(input.next, input.errorCode ?? null, time(input.now), input.executionId, input.expected, generations, generations),
      this.db.prepare(`DELETE FROM ct_ai_usage WHERE execution_id = ? AND state = 'reserved'
        AND EXISTS (SELECT 1 FROM ct_ai_executions WHERE id = ? AND status = 'failed')`).bind(input.executionId, input.executionId),
      this.db.prepare(releaseUnstartedCooldown),
    ])
    return (results[0].meta.changes ?? 0) > 0
  }) }

  async saveArtifact(input: { executionId: string; attemptId?: string; kind: ArtifactKind; payload: unknown; generations: SourceGeneration[]; now?: string }): Promise<SaveResult> { return safe(async () => {
    if (!['raw', 'extraction', 'comparison', 'generation', 'diagnostics'].includes(input.kind) || (input.kind === 'raw' && !input.attemptId)) return invalid()
    const generations = validGenerations(input.generations)
    const payload = json(input.payload)
    const payloadHash = await sha256(payload)
    const artifactId = id()
    const result = await this.db.prepare(`INSERT OR IGNORE INTO ct_ai_artifacts (id, execution_id, attempt_id, kind, payload, payload_hash, created_at)
      SELECT ?, e.id, ?, ?, ?, ?, ? FROM ct_ai_executions e WHERE e.id = ? AND e.status IN (${ACTIVE})
      AND (? IS NULL OR EXISTS (SELECT 1 FROM ct_ai_usage u WHERE u.id = ? AND u.execution_id = e.id AND u.state <> 'reserved'))
      AND ${capturedFence('e')}`).bind(artifactId, input.attemptId ?? null, input.kind, payload, payloadHash, time(input.now), input.executionId, input.attemptId ?? null, input.attemptId ?? null, generations, generations).run()
    if ((result.meta.changes ?? 0) > 0) return { outcome: 'saved', artifactId }
    const eligible = await this.db.prepare(`SELECT e.id FROM ct_ai_executions e WHERE e.id = ? AND e.status IN (${ACTIVE}) AND ${capturedFence('e')}`)
      .bind(input.executionId, generations, generations).first()
    return { outcome: eligible ? 'conflict' : 'fenced' }
  }) }

  async completeExecution(input: { executionId: string; artifactId: string; generations: SourceGeneration[]; partial?: boolean; now?: string }): Promise<boolean> { return safe(async () => {
    const generations = validGenerations(input.generations)
    const result = await this.db.prepare(`UPDATE ct_ai_executions AS e SET status = ?, artifact_id = ?, updated_at = ?
      WHERE e.id = ? AND e.status = 'generating' AND EXISTS (SELECT 1 FROM ct_ai_artifacts a WHERE a.id = ? AND a.execution_id = e.id AND a.kind = 'generation' AND a.payload IS NOT NULL)
      AND ${capturedFence('e')}`).bind(input.partial ? 'partial_draft' : 'ai_draft', input.artifactId, time(input.now), input.executionId, input.artifactId, generations, generations).run()
    return (result.meta.changes ?? 0) > 0
  }) }

  /** 僅供受信任的 workflow 使用；API 必須先授權 job 並重新查核來源。 */
  async getArtifact(executionId: string, artifactId: string): Promise<Artifact | null> { return safe(async () => {
    const row = await this.db.prepare(`SELECT a.id, a.execution_id, a.attempt_id, a.kind, a.payload, a.payload_hash, a.created_at
      FROM ct_ai_artifacts a JOIN ct_ai_executions e ON e.id = a.execution_id
      WHERE e.id = ? AND a.id = ? AND e.status IN (${READABLE}) AND a.payload IS NOT NULL AND ${fence('e')}`)
      .bind(executionId, artifactId).first<{ id: string; execution_id: string; attempt_id: string | null; kind: ArtifactKind; payload: string; payload_hash: string; created_at: string }>()
    return row ? { id: row.id, executionId: row.execution_id, attemptId: row.attempt_id, kind: row.kind, payload: JSON.parse(row.payload), payloadHash: row.payload_hash, createdAt: row.created_at } : null
  }) }

  /** 與 getArtifact 一樣，API 呼叫前須授權並重新查核所有來源。 */
  async listArtifacts(executionId: string, kind: ArtifactKind): Promise<Artifact[]> { return safe(async () => {
    if (!['raw', 'extraction', 'comparison', 'generation', 'diagnostics'].includes(kind)) return invalid()
    const rows = await this.db.prepare(`SELECT a.id, a.execution_id, a.attempt_id, a.kind, a.payload, a.payload_hash, a.created_at
      FROM ct_ai_artifacts a JOIN ct_ai_executions e ON e.id = a.execution_id
      WHERE e.id = ? AND a.kind = ? AND e.status IN (${READABLE}) AND a.payload IS NOT NULL AND ${fence('e')}
      ORDER BY a.rowid`).bind(executionId, kind)
      .all<{ id: string; execution_id: string; attempt_id: string | null; kind: ArtifactKind; payload: string; payload_hash: string; created_at: string }>()
    return (rows.results ?? []).map(row => ({ id: row.id, executionId: row.execution_id, attemptId: row.attempt_id, kind: row.kind, payload: JSON.parse(row.payload), payloadHash: row.payload_hash, createdAt: row.created_at }))
  }) }

  /** 只投影可公開給工作授權者的稽核欄位，不載入完整 prompt／模型回應。 */
  async listArtifactSummaries(executionId: string): Promise<ArtifactSummary[]> { return safe(async () => {
    const rows = await this.db.prepare(`SELECT a.id, a.kind, a.payload_hash, a.created_at,
        u.id AS attempt_id, u.state AS attempt_state, u.estimate_micro_usd, u.actual_micro_usd,
        json_extract(a.payload, '$.provenance.model_selector') AS model_selector,
        json_extract(a.payload, '$.provenance.provider_model') AS provider_model,
        json_extract(a.payload, '$.provenance.provider_revision') AS provider_revision,
        json_extract(a.payload, '$.provenance.provider_request_id') AS request_id,
        json_extract(a.payload, '$.provenance.provider_system_fingerprint') AS system_fingerprint,
        json_extract(a.payload, '$.provenance.request_sha256') AS request_sha256,
        json_extract(a.payload, '$.provenance.pricing_version') AS pricing_version,
        json_extract(a.payload, '$.provenance.usage_status') AS usage_status
      FROM ct_ai_artifacts a JOIN ct_ai_executions e ON e.id = a.execution_id
      LEFT JOIN ct_ai_usage u ON u.id = a.attempt_id
      WHERE e.id = ? AND e.status IN (${READABLE}) AND a.payload IS NOT NULL AND ${fence('e')}
      ORDER BY a.rowid`).bind(executionId).all<{
        id: string; kind: ArtifactKind; payload_hash: string; created_at: string
        attempt_id: string | null; attempt_state: string | null; estimate_micro_usd: number | null; actual_micro_usd: number | null
        model_selector: string | null; provider_model: string | null; provider_revision: string | null
        request_id: string | null; system_fingerprint: string | null; request_sha256: string | null; pricing_version: string | null; usage_status: string | null
      }>()
    return (rows.results ?? []).map(row => ({
      id: row.id,
      kind: row.kind,
      sha256: row.payload_hash,
      created_at: row.created_at,
      model: row.kind === 'raw' ? {
        selector: row.model_selector,
        provider_model: row.provider_model,
        provider_revision: row.provider_revision,
        request_id: row.request_id,
        system_fingerprint: row.system_fingerprint,
        request_sha256: row.request_sha256,
        pricing_version: row.pricing_version,
        usage_status: row.usage_status ?? 'unknown',
      } : null,
      attempt: row.attempt_id && row.attempt_state && row.estimate_micro_usd !== null ? {
        id: row.attempt_id,
        state: row.attempt_state,
        estimated_micro_usd: row.estimate_micro_usd,
        actual_micro_usd: row.actual_micro_usd,
      } : null,
    }))
  }) }

  async listRevisions(jobId: string, viewerId: string, isAdmin = false): Promise<Revision[] | null> { return safe(async () => {
    const allowed = await this.db.prepare(`SELECT j.id FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id
      WHERE j.id = ? AND (j.owner_id = ? OR ? = 1) AND e.status IN (${FINAL}) AND ${fence('e')}`)
      .bind(jobId, viewerId, isAdmin ? 1 : 0).first()
    if (!allowed) return null
    const rows = await this.db.prepare(`SELECT r.id, r.parent_id, r.editor_id, r.payload, r.payload_hash, r.diff, r.created_at
      FROM ct_ai_revisions r JOIN ct_ai_jobs j ON j.id = r.job_id JOIN ct_ai_executions e ON e.id = j.execution_id
      WHERE j.id = ? AND (j.owner_id = ? OR ? = 1) AND e.status IN (${FINAL}) AND r.payload IS NOT NULL AND r.diff IS NOT NULL AND ${fence('e')}
      ORDER BY r.rowid`).bind(jobId, viewerId, isAdmin ? 1 : 0).all<{ id: string; parent_id: string; editor_id: string; payload: string; payload_hash: string; diff: string; created_at: string }>()
    return (rows.results ?? []).map(row => ({ id: row.id, parentId: row.parent_id, editorId: row.editor_id, payload: JSON.parse(row.payload), payloadHash: row.payload_hash, diff: JSON.parse(row.diff), createdAt: row.created_at, verification: 'human_unverified' }))
  }) }

  async createRevision(input: { jobId: string; ownerId: string; parentId: string; payload: unknown; generations: SourceGeneration[]; now?: string }): Promise<RevisionResult> { return safe(async () => {
    const generations = validGenerations(input.generations)
    const payload = json(input.payload)
    const parsed = JSON.parse(payload) as unknown
    const base = await this.db.prepare(`SELECT CASE WHEN ? = 'ai' THEN a.payload ELSE r.payload END AS payload
      FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id
      JOIN ct_ai_artifacts a ON a.id = e.artifact_id AND a.execution_id = e.id
      LEFT JOIN ct_ai_revisions r ON r.id = ? AND r.job_id = j.id
      WHERE j.id = ? AND j.owner_id = ? AND e.status IN (${FINAL}) AND ${capturedFence('e')}`)
      .bind(input.parentId, input.parentId, input.jobId, input.ownerId, generations, generations).first<{ payload: string | null }>()
    if (!base) return { outcome: 'unavailable' }
    if (!base.payload) return { outcome: 'conflict' }
    const original = JSON.parse(base.payload) as unknown
    const before = input.parentId === 'ai' && original !== null && typeof original === 'object' && 'data' in original ? original.data : original
    const diff = json(fieldDiff(before, parsed))
    const revisionId = id()
    const payloadHash = await sha256(payload)
    const result = await this.db.prepare(`INSERT OR IGNORE INTO ct_ai_revisions (id, job_id, parent_id, editor_id, payload, payload_hash, diff, created_at)
      SELECT ?, j.id, ?, j.owner_id, ?, ?, ?, ? FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id
      WHERE j.id = ? AND j.owner_id = ? AND e.status IN (${FINAL}) AND ${capturedFence('e')}
      AND EXISTS (SELECT 1 FROM ct_ai_artifacts a WHERE a.id = e.artifact_id AND a.kind = 'generation' AND a.payload IS NOT NULL)
      AND (? = 'ai' OR EXISTS (SELECT 1 FROM ct_ai_revisions p WHERE p.id = ? AND p.job_id = j.id AND p.payload IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM ct_ai_revisions child WHERE child.job_id = j.id AND child.parent_id = ?)`)
      .bind(revisionId, input.parentId, payload, payloadHash, diff, time(input.now), input.jobId, input.ownerId, generations, generations, input.parentId, input.parentId, input.parentId).run()
    if ((result.meta.changes ?? 0) > 0) return { outcome: 'created', revisionId }
    const accessible = await this.db.prepare(`SELECT j.id FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id
      WHERE j.id = ? AND j.owner_id = ? AND e.status IN (${FINAL}) AND ${capturedFence('e')}`)
      .bind(input.jobId, input.ownerId, generations, generations).first()
    return { outcome: accessible ? 'conflict' : 'unavailable' }
  }) }

  async reconcileSource(input: { namespace: string; kind: SourceKind; id: number; status: 'valid' | 'withdrawn' | 'deleted'; currentHash?: string | null; now?: string }): Promise<void> { return safe(async () => {
    if (!input.namespace || !['issue', 'material'].includes(input.kind) || !Number.isSafeInteger(input.id) || input.id <= 0 || !['valid', 'withdrawn', 'deleted'].includes(input.status)) return invalid()
    if (input.status === 'deleted') { await this.eraseSource({ namespace: input.namespace, kind: input.kind, id: input.id, reason: 'deleted', now: input.now }); return }
    if ((input.status === 'valid' && !input.currentHash) || (input.currentHash != null && !HASH.test(input.currentHash))) return invalid()
    const now = time(input.now)
    await this.db.batch([
      this.db.prepare(`UPDATE ct_ai_executions SET status = 'withdrawn', error_code = CASE WHEN ? IS NULL THEN 'source_withdrawn' ELSE 'source_stale' END, artifact_id = NULL, updated_at = ?
        WHERE status <> 'erased' AND id IN (SELECT execution_id FROM ct_ai_sources WHERE namespace = ? AND kind = ? AND source_id = ? AND (? IS NULL OR source_hash <> ?))`)
        .bind(input.currentHash ?? null, now, input.namespace, input.kind, input.id, input.currentHash ?? null, input.currentHash ?? null),
      this.db.prepare('UPDATE ct_ai_sources SET checked_at = ? WHERE namespace = ? AND kind = ? AND source_id = ?')
        .bind(now, input.namespace, input.kind, input.id),
      this.db.prepare(`DELETE FROM ct_ai_usage WHERE state = 'reserved' AND execution_id IN
        (SELECT id FROM ct_ai_executions WHERE status = 'withdrawn')`),
      this.db.prepare(releaseUnstartedCooldown),
    ])
  }) }

  /** 同一 batch 永久遞增 tombstone 並抹除所有依賴執行的私有內容。 */
  async eraseSource(input: { namespace: string; kind: SourceKind; id: number; reason: 'deleted' | 'request'; now?: string }): Promise<void> { return safe(async () => {
    if (!input.namespace || !['issue', 'material'].includes(input.kind) || !Number.isSafeInteger(input.id) || input.id <= 0 || !['deleted', 'request'].includes(input.reason)) return invalid()
    const now = time(input.now)
    const affected = 'SELECT execution_id FROM ct_ai_sources WHERE namespace = ? AND kind = ? AND source_id = ?'
    const keys = [input.namespace, input.kind, input.id] as const
    await this.db.batch([
      this.db.prepare(`INSERT INTO ct_ai_source_fences (namespace, kind, source_id, generation, erased_at, reason_code) VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(namespace, kind, source_id) DO UPDATE SET generation = generation + 1, erased_at = COALESCE(erased_at, excluded.erased_at), reason_code = COALESCE(reason_code, excluded.reason_code)`).bind(...keys, now, input.reason),
      this.db.prepare(`UPDATE ct_ai_executions SET status = 'erased', error_code = 'source_erased', manifest = NULL, artifact_id = NULL, updated_at = ? WHERE id IN (${affected})`).bind(now, ...keys),
      this.db.prepare(`DELETE FROM ct_ai_usage WHERE state = 'reserved' AND execution_id IN (${affected})`).bind(...keys),
      this.db.prepare(`UPDATE ct_ai_sources SET payload = NULL WHERE execution_id IN (${affected})`).bind(...keys),
      this.db.prepare(`UPDATE ct_ai_artifacts SET payload = NULL WHERE execution_id IN (${affected})`).bind(...keys),
      this.db.prepare(`UPDATE ct_ai_revisions SET payload = NULL, diff = NULL WHERE job_id IN (SELECT id FROM ct_ai_jobs WHERE execution_id IN (${affected}))`).bind(...keys),
      this.db.prepare(releaseUnstartedCooldown),
    ])
  }) }
}
