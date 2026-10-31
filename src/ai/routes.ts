import type { Hono } from 'hono'
import { isAdminRole } from '../auth/authorization'
import { requireUser } from '../api/requireUser'
import type { EvidenceBindings } from './env'
import { buildClairicRequest, MODEL_SELECTORS } from './models'
import { GENERATION_SECTIONS, pipelineSettings, type GenerationLanguage, type GenerationSection } from './generation'
import { validateHumanData } from './human'
import { checkedSnapshot, reconcileSources, SourceUnavailable } from './lifecycle'
import { estimateCall } from './pricing'
import { readMaterialStatuses, readSourceInput, sha256, SOURCE_NAMESPACE, SourceInputError } from './source'
import { EvidenceStore, type ExecutionStatus, type InputManifest } from './store'

export type EvidenceApp = Hono<{ Bindings: EvidenceBindings }>
const CONSENT_VERSION = 'evidence-processing-2026-10-29-v1'
const BODY_LIMIT = 256 * 1024

class RequestProblem extends Error {
  constructor(readonly code: string, readonly status: 400 | 413) { super(code) }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RequestProblem('invalid_content_type', 400)
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new RequestProblem('request_too_large', 413)
  if (!request.body) throw new RequestProblem('invalid_json', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > BODY_LIMIT) {
      await reader.cancel()
      throw new RequestProblem('request_too_large', 413)
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new RequestProblem('invalid_json', 400)
  }
}

function issueId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function validJobId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/** 同一 execution 使用固定 Workflow ID；冷啟安全重放只會重用已記錄的 paid attempt。 */
async function ensureWorkflow(env: EvidenceBindings, job: { id: string; executionId: string; status: ExecutionStatus }, coldStart = false): Promise<void> {
  let instance: WorkflowInstance | null = null
  try {
    instance = await env.EVIDENCE_WORKFLOW.get(job.executionId)
    const state = await instance.status()
    if (state.status === 'errored' || state.status === 'terminated' || state.status === 'complete' || state.status === 'unknown') {
      const store = new EvidenceStore(env.DB)
      const snapshot = await store.getSnapshot(job.executionId)
      if (snapshot && ['queued', 'extracting', 'comparing', 'generating'].includes(job.status)) {
        await store.markAttemptsUnknown(job.executionId)
        await store.setStatus({ executionId: job.executionId, expected: job.status as 'queued' | 'extracting' | 'comparing' | 'generating', next: 'failed', errorCode: 'provider_uncertain', generations: snapshot.generations })
      }
    }
    else if (coldStart && (state.status === 'running' || state.status === 'waiting')) {
      // 本機 runtime 重啟後可能仍顯示 running；D1 attempt fence 禁止重打已送出的推論。
      await instance.restart()
    }
    return
  } catch {
    // get/status 不存在或失聯：只有從未開始的 queued 可嘗試固定 ID create。
  }
  if (job.status !== 'queued') {
    const store = new EvidenceStore(env.DB)
    const snapshot = await store.getSnapshot(job.executionId)
    if (snapshot && ['extracting', 'comparing', 'generating'].includes(job.status)) {
      await store.markAttemptsUnknown(job.executionId)
      await store.setStatus({ executionId: job.executionId, expected: job.status as 'extracting' | 'comparing' | 'generating', next: 'failed', errorCode: 'provider_uncertain', generations: snapshot.generations })
    }
    return
  }
  try {
    await env.EVIDENCE_WORKFLOW.create({ id: job.executionId, params: { jobId: job.id } })
  } catch {
    // 同時請求可能已用相同 ID 建立；必須確認 instance 確實存在。
    const existing = instance ?? await env.EVIDENCE_WORKFLOW.get(job.executionId)
    await existing.status()
  }
}

export async function recoverActiveWorkflows(env: EvidenceBindings, coldStart = false): Promise<void> {
  const store = new EvidenceStore(env.DB)
  for (const job of await store.listActiveWorkflowJobs()) await ensureWorkflow(env, job, coldStart)
}

function sourceMetadata(): { commit: string | null; dirty: boolean } {
  if (typeof __CIVIC_SOURCE__ === 'undefined') return { commit: null, dirty: true }
  return { commit: __CIVIC_SOURCE__.commit, dirty: __CIVIC_SOURCE__.dirty }
}

function generationProgress(events: unknown[], status: ExecutionStatus, errorCode: string | null) {
  const sections = Object.fromEntries(GENERATION_SECTIONS.map(section => [
    section, { status: 'pending', reason: null as string | null, artifact_id: null as string | null, raw_artifact_id: null as string | null },
  ])) as Record<GenerationSection, { status: string; reason: string | null; artifact_id: string | null; raw_artifact_id: string | null }>
  let currentSection: GenerationSection | null = null
  let estimatedMicroUsd: number | null = null
  let present = false
  for (const event of events) {
    if (!object(event) || event.stage !== 'generation') continue
    present = true
    if (event.phase === 'planned' && typeof event.estimated_micro_usd === 'number') estimatedMicroUsd = event.estimated_micro_usd
    if (event.phase === 'started' && GENERATION_SECTIONS.includes(event.section as GenerationSection)) {
      currentSection = event.section as GenerationSection
      sections[currentSection].status = 'running'
    }
    if (event.phase === 'finished' && object(event.outcome) && GENERATION_SECTIONS.includes(event.outcome.section as GenerationSection)) {
      const outcome = event.outcome
      const section = outcome.section as GenerationSection
      if (!['completed', 'no_findings', 'failed', 'not_started'].includes(String(outcome.status))) continue
      sections[section] = {
        status: String(outcome.status),
        reason: typeof outcome.reason === 'string' ? outcome.reason : null,
        artifact_id: typeof outcome.artifact_id === 'string' ? outcome.artifact_id : null,
        raw_artifact_id: typeof outcome.raw_artifact_id === 'string' ? outcome.raw_artifact_id : null,
      }
      if (currentSection === section) currentSection = null
    }
  }
  if (!present) return null
  if (status === 'failed') {
    for (const section of GENERATION_SECTIONS) {
      if (sections[section].status === 'pending' || sections[section].status === 'running') {
        sections[section].status = sections[section].status === 'running' ? 'failed' : 'not_started'
        sections[section].reason = errorCode
      }
    }
    currentSection = null
  }
  return { current_section: currentSection, estimated_micro_usd: estimatedMicroUsd, sections }
}

export function registerEvidenceRoutes(app: EvidenceApp): void {
  // 僅保存綁定對應的啟動結果，不在模組記憶體快取任何私有 payload。
  const startups = new WeakMap<D1Database, Promise<void>>()
  async function ensureStartup(env: EvidenceBindings): Promise<void> {
    let startup = startups.get(env.DB)
    if (!startup) {
      startup = (async () => {
        await reconcileSources(env)
        await recoverActiveWorkflows(env, true)
      })()
      startups.set(env.DB, startup)
    }
    try {
      await startup
    } catch (error) {
      if (startups.get(env.DB) === startup) startups.delete(env.DB)
      throw error
    }
  }

  app.onError((error, c) => {
    // 不記錄 exception：provider 或資料庫的錯誤字串可能包含私人正文。
    if (error instanceof SourceInputError) return c.json({ error: error.code, ...error.details }, error.status)
    if (error instanceof RequestProblem) return c.json({ error: error.code }, error.status)
    if (error instanceof SourceUnavailable) return c.json({ error: error.code }, 503)
    return c.json({ error: 'service_unavailable' }, 503)
  })

  app.post('/api/evidence-maintenance/reconcile', async c => {
    const auth = await requireUser(c)
    if ('denied' in auth) return auth.denied
    if (!isAdminRole(auth.context.role)) return c.json({ error: 'Forbidden' }, 403)
    const body = await jsonBody(c.req.raw)
    if (!object(body) || Object.keys(body).length !== 0) return c.json({ error: 'invalid_request' }, 400)
    const result = await reconcileSources(c.env)
    await recoverActiveWorkflows(c.env)
    return c.json({ ok: true, ...result })
  })

  app.post('/api/evidence-maintenance/erase', async c => {
    const auth = await requireUser(c)
    if ('denied' in auth) return auth.denied
    if (!isAdminRole(auth.context.role)) return c.json({ error: 'Forbidden' }, 403)
    const body = await jsonBody(c.req.raw)
    if (!object(body) || Object.keys(body).length !== 2 || (body.kind !== 'issue' && body.kind !== 'material') || typeof body.id !== 'number' || !Number.isSafeInteger(body.id) || body.id <= 0) return c.json({ error: 'invalid_request' }, 400)
    await new EvidenceStore(c.env.DB).eraseSource({ namespace: SOURCE_NAMESPACE, kind: body.kind, id: body.id, reason: 'request' })
    return c.json({ ok: true })
  })


  app.post('/api/issues/:id/evidence-jobs', async c => {
    const auth = await requireUser(c)
    if ('denied' in auth) return auth.denied
    const id = issueId(c.req.param('id'))
    if (id === null) return c.json({ error: 'invalid_issue_id' }, 400)
    const body = await jsonBody(c.req.raw)
    if (!object(body) || Object.keys(body).some(key => !['material_ids', 'language', 'consent'].includes(key)) || body.consent !== true) return c.json({ error: 'invalid_request' }, 400)
    const language = body.language === undefined ? 'zh-TW' : body.language
    if (language !== 'zh-TW' && language !== 'en' && language !== 'ja') return c.json({ error: 'invalid_language' }, 400)
    if (body.material_ids !== undefined && !Array.isArray(body.material_ids)) return c.json({ error: 'invalid_material_ids' }, 400)
    await ensureStartup(c.env)
    const input = await readSourceInput(c.env.SOURCE_DB, id, body.material_ids as number[] | undefined)
    const issue = input.sources[0]
    const manifest: InputManifest = {
      namespace: SOURCE_NAMESPACE,
      issue: { id, hash: issue.hash },
      materials: input.materials.map(material => ({ id: material.id, hash: input.sources.find(source => source.kind === 'material' && source.id === material.id)!.hash, content_hash: material.content_hash })),
      language,
      settings: { ...(await pipelineSettings()), source_code: sourceMetadata() },
    }
    const inputKey = await sha256(JSON.stringify(manifest))
    const first = buildClairicRequest(input.materials[0].content)
    const store = new EvidenceStore(c.env.DB)
    const claim = await store.claimJob({
      ownerId: auth.context.user.id,
      issueId: id,
      inputKey,
      manifest,
      sources: input.sources,
      consentVersion: CONSENT_VERSION,
      consentAt: new Date().toISOString(),
      initialEstimateMicroUsd: estimateCall(MODEL_SELECTORS.clairic, first.input),
    })
    if (claim.outcome === 'quota') return c.json({ error: 'account_daily_quota', reset_at: claim.resetAt }, 429)
    if (claim.outcome === 'cooldown') return c.json({ error: 'issue_cooldown', retry_at: claim.retryAt }, 429)
    if (claim.outcome === 'budget') return c.json({ error: 'daily_budget_exhausted', reset_at: claim.resetAt }, 503)
    if (claim.outcome === 'erased' || claim.outcome === 'withdrawn') return c.json({ error: `source_${claim.outcome}` }, 422)
    if (claim.outcome === 'conflict') return c.json({ error: 'input_conflict' }, 409)
    if (!('jobId' in claim)) return c.json({ error: 'service_unavailable' }, 503)
    if (claim.outcome === 'created') {
      const snapshot = await store.getSnapshot(claim.executionId)
      if (!snapshot) return c.json({ error: 'source_unavailable' }, 503)
      const saved = await store.saveArtifact({
        executionId: claim.executionId,
        kind: 'diagnostics',
        payload: { stage: 'input', material_ids: input.materials.map(material => material.id), initial_issue_exclusions: input.exclusions },
        generations: snapshot.generations,
      })
      if (saved.outcome !== 'saved') return c.json({ error: 'source_unavailable' }, 503)
      await ensureWorkflow(c.env, { id: claim.jobId, executionId: claim.executionId, status: claim.status })
    }
    const cache = claim.outcome === 'created' ? 'miss' : claim.outcome === 'cached' ? 'hit' : 'joined'
    const result = {
      job_id: claim.jobId,
      status: claim.status,
      cache,
      input_coverage: {
        selection: body.material_ids === undefined ? 'all_eligible' : 'selected',
        material_ids: input.materials.map(material => material.id),
        exclusions: body.material_ids === undefined ? input.exclusions : [],
      },
    }
    return claim.outcome === 'cached' || claim.status === 'failed' ? c.json(result, 200) : c.json(result, 202)
  })

  app.get('/api/evidence-jobs/:jobId', async c => {
    const auth = await requireUser(c)
    if ('denied' in auth) return auth.denied
    const jobId = c.req.param('jobId')
    if (!validJobId(jobId)) return c.json({ error: 'Not found' }, 404)
    const store = new EvidenceStore(c.env.DB)
    const admin = isAdminRole(auth.context.role)
    if (!await store.getJob(jobId, auth.context.user.id, admin)) return c.json({ error: 'Not found' }, 404)
    await ensureStartup(c.env)
    const job = await store.getJob(jobId, auth.context.user.id, admin)
    if (!job) return c.json({ error: 'Not found' }, 404)
    const base = { job_id: job.id, input_key: job.inputKey, status: job.status, error_code: job.errorCode, created_at: job.createdAt, updated_at: job.updatedAt, source_checked_at: job.sourceCheckedAt, usage: job.usage }
    if (job.status === 'erased') return c.json(base)
    if (job.status === 'withdrawn') {
      await reconcileSources(c.env, job.executionId)
      const updated = await store.getJob(jobId, auth.context.user.id, admin)
      return c.json(updated ? { ...base, status: updated.status, error_code: updated.errorCode, source_checked_at: updated.sourceCheckedAt } : base)
    }
    try {
      await checkedSnapshot(c.env, job.executionId)
    } catch (error) {
      if (error instanceof SourceUnavailable && (error.code === 'source_withdrawn' || error.code === 'source_erased')) {
        const updated = await store.getJob(jobId, auth.context.user.id, admin)
        if (updated && (updated.status === 'withdrawn' || updated.status === 'erased')) {
          return c.json({ job_id: updated.id, input_key: updated.inputKey, status: updated.status, error_code: updated.errorCode, created_at: updated.createdAt, updated_at: updated.updatedAt, source_checked_at: updated.sourceCheckedAt, usage: updated.usage })
        }
      }
      throw error
    }
    const diagnostics = await store.listArtifacts(job.executionId, 'diagnostics')
    const artifactSummaries = await store.listArtifactSummaries(job.executionId)
    const artifact = job.artifactId ? await store.getArtifact(job.executionId, job.artifactId) : null
    // 這是當下議題的隱藏狀態，不是工作原始輸入的一部分，故不影響快取鍵。
    const currentIssueExclusions = (await readMaterialStatuses(c.env.SOURCE_DB, job.issueId)).filter(item => item.abuse_flagged !== 0).map(item => ({ id: item.id, reason: 'hidden' }))
    // 最後再以同一持久 fence 讀取快照，避免已完成清除的競態把記憶體舊內容送出。
    const snapshot = await store.getSnapshot(job.executionId)
    const updated = await store.getJob(jobId, auth.context.user.id, admin)
    if (!updated) return c.json({ error: 'source_unavailable' }, 503)
    const refreshedBase = { ...base, status: updated.status, error_code: updated.errorCode, updated_at: updated.updatedAt, source_checked_at: updated.sourceCheckedAt, usage: updated.usage }
    // 清除／撤下可能恰在快照讀取與最後狀態查詢之間完成；已觀察失效時不可送出先前內容。
    if (updated.status === 'withdrawn' || updated.status === 'erased') return c.json(refreshedBase)
    if (!snapshot || updated.artifactId !== job.artifactId || (job.artifactId && !artifact)) return c.json({ error: 'source_unavailable' }, 503)
    const initialInputDiagnostics = diagnostics.map(item => item.payload).filter(item => object(item) && item.stage === 'input')
    const payload = artifact && object(artifact.payload) ? artifact.payload : {}
    const provenance = { ...(object(payload.provenance) ? payload.provenance : {}), artifacts: artifactSummaries }
    const generationArtifact = artifact ? { id: artifact.id, sha256: artifact.payloadHash } : null
    return c.json({ ...payload, ...refreshedBase, provenance, generation_artifact: generationArtifact, generation_progress: generationProgress(diagnostics.map(item => item.payload), updated.status, updated.errorCode), input_manifest: snapshot.manifest, sources: snapshot.sources, initial_input_diagnostics: initialInputDiagnostics, current_issue_exclusions: currentIssueExclusions, diagnostics: payload.diagnostics ?? diagnostics.map(item => item.payload) })
  })

  app.get('/api/evidence-jobs/:jobId/revisions', async c => {
    const auth = await requireUser(c)
    if ('denied' in auth) return auth.denied
    const jobId = c.req.param('jobId')
    if (!validJobId(jobId)) return c.json({ error: 'Not found' }, 404)
    const store = new EvidenceStore(c.env.DB)
    const admin = isAdminRole(auth.context.role)
    if (!await store.getJob(jobId, auth.context.user.id, admin)) return c.json({ error: 'Not found' }, 404)
    await ensureStartup(c.env)
    const job = await store.getJob(jobId, auth.context.user.id, admin)
    if (!job || !job.artifactId || !['ai_draft', 'partial_draft'].includes(job.status)) return c.json({ error: 'draft_unavailable' }, 422)
    await checkedSnapshot(c.env, job.executionId)
    const artifact = await store.getArtifact(job.executionId, job.artifactId)
    const revisions = await store.listRevisions(jobId, auth.context.user.id, admin)
    if (!artifact || !object(artifact.payload) || !revisions || !await store.getSnapshot(job.executionId)) return c.json({ error: 'draft_unavailable' }, 422)
    return c.json({ job_id: jobId, ai_base: { id: 'ai', verification: 'ai_unverified', data: artifact.payload.data, citation_map: artifact.payload.citation_map }, revisions })
  })

  app.post('/api/evidence-jobs/:jobId/revisions', async c => {
    const auth = await requireUser(c)
    if ('denied' in auth) return auth.denied
    const jobId = c.req.param('jobId')
    if (!validJobId(jobId)) return c.json({ error: 'Not found' }, 404)
    const store = new EvidenceStore(c.env.DB)
    if (!await store.getJob(jobId, auth.context.user.id, false)) return c.json({ error: 'Not found' }, 404)
    const body = await jsonBody(c.req.raw)
    if (!object(body) || Object.keys(body).length !== 2 || typeof body.parent_revision_id !== 'string' || !Object.hasOwn(body, 'data')) return c.json({ error: 'invalid_revision' }, 400)
    await ensureStartup(c.env)
    const job = await store.getJob(jobId, auth.context.user.id, false)
    if (!job || !job.artifactId || !['ai_draft', 'partial_draft'].includes(job.status)) return c.json({ error: 'draft_unavailable' }, 422)
    const snapshot = await checkedSnapshot(c.env, job.executionId)
    const materials = snapshot.sources.filter(source => source.kind === 'material').map(source => source.payload)
    if (!validateHumanData(body.data, materials)) return c.json({ error: 'invalid_revision_data' }, 400)
    const result = await store.createRevision({ jobId, ownerId: auth.context.user.id, parentId: body.parent_revision_id, payload: body.data, generations: snapshot.generations })
    if (result.outcome === 'conflict') return c.json({ error: 'revision_conflict' }, 409)
    if (result.outcome === 'unavailable') return c.json({ error: 'draft_unavailable' }, 422)
    if (!('revisionId' in result)) return c.json({ error: 'service_unavailable' }, 503)
    return c.json({ revision_id: result.revisionId, parent_revision_id: body.parent_revision_id, verification: 'human_unverified' }, 201)
  })
}
