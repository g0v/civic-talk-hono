import type { WorkflowStep } from 'cloudflare:workers'
import type { EvidenceBindings } from './env'
import { analyzeComparisons, createEvidencePairs, type ComparisonAnalysis, type ComparisonFailure, type DirectComparison } from './comparison'
import { extractClairicEvidence, MAX_EVIDENCE, type Evidence, type EvidenceExtraction } from './evidence'
import { buildGemmaRequest, GEMMA_PARAMETERS, parseGemmaResponse, pipelineSettings, type GenerationCandidates, type GenerationLanguage } from './generation'
import { checkInitiator, checkedSnapshot, SourceUnavailable } from './lifecycle'
import { buildClairicRequest, buildClefBatches, modelUsageStatus, ModelContextLimitError, parseClairicResponse, parseClefResponse, type ClefBatch, type ModelRequest } from './models'
import { actualCallCost, estimateCall, requestProvenance, type ModelSelector } from './pricing'
import { EvidenceStore, type ErrorCode, type Snapshot } from './store'

const NO_RETRIES = { retries: { limit: 0, delay: '1 second' as const }, timeout: '10 minutes' as const }
// Workflows paid 預設 10,000 subrequests / 10,000 steps；不修改帳戶或配置來繞過。
const MAX_PROJECTED_SUBREQUESTS = 9000
const MAX_WORKFLOW_STEPS = 1024

type ActiveStatus = 'queued' | 'extracting' | 'comparing' | 'generating'
type PaidStatus = 'ok' | 'provider_error' | 'provider_uncertain' | 'budget_exhausted' | 'source_unavailable' | 'workflow_limit'
type PaidResult = { status: PaidStatus; artifactId: string | null }
type ArtifactRef = { status: 'ok' | 'failed'; artifactId: string | null }
type Coverage = { material_id: number; status: 'complete' | 'partial' | 'failed'; evidence_count: number; rejected: EvidenceExtraction['rejected']; duplicates: number; state_mapping: EvidenceExtraction['state_mapping']; error_code: string | null; usage_status: 'reported' | 'missing' | 'malformed' | null }
type RawPayload = { selector: ModelSelector; request: unknown; response: unknown; provenance: Record<string, unknown> }
type ExtractionPayload = { evidence: Evidence[]; coverage: Coverage[]; partial: boolean; raw_artifact_ids: string[] }
type ComparisonPlan = { batches: ClefBatch[] }
type ComparisonPayload = { analysis: ComparisonAnalysis; partial: boolean; raw_artifact_ids: string[] }

class PipelineStop extends Error {
  constructor(readonly code: ErrorCode) { super(code) }
}

function active(status: string): status is ActiveStatus {
  return status === 'queued' || status === 'extracting' || status === 'comparing' || status === 'generating'
}

async function finishFailure(env: EvidenceBindings, jobId: string, code: ErrorCode): Promise<void> {
  const store = new EvidenceStore(env.DB)
  const job = await store.getWorkflowJob(jobId)
  if (!job || !active(job.status)) return
  const snapshot = await store.getSnapshot(job.executionId)
  if (snapshot) await store.setStatus({ executionId: job.executionId, expected: job.status, next: 'failed', errorCode: code, generations: snapshot.generations })
}

async function advance(env: EvidenceBindings, jobId: string, snapshot: Snapshot, expected: ActiveStatus, next: 'extracting' | 'comparing' | 'generating'): Promise<void> {
  const store = new EvidenceStore(env.DB)
  if (await store.setStatus({ executionId: snapshot.executionId, expected, next, generations: snapshot.generations })) return
  const job = await store.getWorkflowJob(jobId)
  const order: ActiveStatus[] = ['queued', 'extracting', 'comparing', 'generating']
  if (!job || !active(job.status) || order.indexOf(job.status) < order.indexOf(next)) throw new PipelineStop('source_unavailable')
}

async function current(env: EvidenceBindings, jobId: string, checkAccount = false): Promise<Snapshot> {
  const store = new EvidenceStore(env.DB)
  const job = await store.getWorkflowJob(jobId)
  if (!job || !active(job.status)) throw new PipelineStop('source_unavailable')
  const snapshot = await checkedSnapshot(env, job.executionId)
  if (checkAccount) await checkInitiator(env.DB_AUTH, job.ownerId)
  return snapshot
}

function materials(snapshot: Snapshot) {
  return snapshot.sources.filter(source => source.kind === 'material').map(source => source.payload)
}

async function artifact<T>(env: EvidenceBindings, executionId: string, artifactId: string): Promise<T> {
  const found = await new EvidenceStore(env.DB).getArtifact(executionId, artifactId)
  if (!found) throw new PipelineStop('source_unavailable')
  // 工件由本程式寫入、並受 fence 保護；不是由呼叫者提供。
  return found.payload as T
}

async function save(env: EvidenceBindings, snapshot: Snapshot, kind: 'extraction' | 'comparison' | 'generation' | 'diagnostics', payload: unknown): Promise<string> {
  const result = await new EvidenceStore(env.DB).saveArtifact({ executionId: snapshot.executionId, kind, payload, generations: snapshot.generations })
  if (result.outcome !== 'saved') throw new PipelineStop('source_unavailable')
  return result.artifactId
}

/** 每一 provider 呼叫有自己的不可重試 step 與已持久化的付費嘗試。 */
async function paid(
  env: EvidenceBindings,
  jobId: string,
  stepKey: string,
  build: (snapshot: Snapshot) => Promise<ModelRequest<unknown>> | ModelRequest<unknown>,
  maxOutput = 0
): Promise<PaidResult> {
  const store = new EvidenceStore(env.DB)
  const snapshot = await current(env, jobId, true)
  const request = await build(snapshot)
  const selector = request.selector as ModelSelector
  if (!['@cf/cloudflare/clairic', '@cf/cloudflare/clef', '@cf/google/gemma-4-26b-a4b-it'].includes(selector)) throw new PipelineStop('internal_error')
  const attempt = await store.beginAttempt({ executionId: snapshot.executionId, stepKey, estimateMicroUsd: estimateCall(selector, request.input, maxOutput), generations: snapshot.generations })
  if (attempt.outcome === 'budget') return { status: 'budget_exhausted', artifactId: null }
  if (attempt.outcome === 'fenced') return { status: 'source_unavailable', artifactId: null }
  if (attempt.outcome === 'existing') {
    if (!attempt.artifactId) {
      await store.settleAttempt(attempt.attemptId, null)
      return { status: 'provider_uncertain', artifactId: null }
    }
    const raw = await artifact<RawPayload>(env, snapshot.executionId, attempt.artifactId)
    await store.settleAttempt(attempt.attemptId, actualCallCost(selector, raw.response))
    return { status: 'ok', artifactId: attempt.artifactId }
  }
  let response: unknown
  try {
    // 顯式非串流、未啟用 provider retry；不得將 cookie／憑證／作者欄送入模型。
    const ai = env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }
    response = await ai.run(selector, request.input)
  } catch {
    await store.settleAttempt(attempt.attemptId, null)
    return { status: 'provider_error', artifactId: null }
  }
  const actual = actualCallCost(selector, response)
  try {
    const provenance = await requestProvenance(selector, request.input, response)
    const usage = response && typeof response === 'object' && 'usage' in response ? response.usage : undefined
    provenance.usage_status = selector === '@cf/google/gemma-4-26b-a4b-it'
      ? usage === undefined ? 'missing' : actual === null ? 'malformed' : 'reported'
      : modelUsageStatus(usage)
    const result = await store.saveArtifact({
      executionId: snapshot.executionId,
      attemptId: attempt.attemptId,
      kind: 'raw',
      payload: { selector, request: request.input, response, provenance } satisfies RawPayload,
      generations: snapshot.generations,
    })
    await store.settleAttempt(attempt.attemptId, actual)
    return result.outcome === 'saved' ? { status: 'ok', artifactId: result.artifactId } : { status: 'source_unavailable', artifactId: null }
  } catch {
    // 即使來源已清除或原始回應無法保存，也要以不含正文的方式結算。
    await store.settleAttempt(attempt.attemptId, actual)
    return { status: 'source_unavailable', artifactId: null }
  }
}

function requirePaid(result: PaidResult): void {
  if (result.status === 'budget_exhausted') throw new PipelineStop('budget_exhausted')
  if (result.status === 'source_unavailable') throw new PipelineStop('source_unavailable')
  if (result.status === 'workflow_limit') throw new PipelineStop('workflow_limit')
}

async function recordLimit(env: EvidenceBindings, jobId: string, error: ModelContextLimitError): Promise<void> {
  const snapshot = await current(env, jobId)
  await save(env, snapshot, 'diagnostics', { code: error.code, request_bytes: error.request_bytes, limit_bytes: error.limit_bytes })
}

/** 供 Workflow 及行為測試共用；step 的輸入／回傳僅識別符與狀態。 */
export async function runEvidenceWorkflow(env: EvidenceBindings, jobId: string, step: WorkflowStep): Promise<{ status: string }> {
  const store = new EvidenceStore(env.DB)
  try {
    const job = await store.getWorkflowJob(jobId)
    if (!job || !active(job.status)) return { status: job?.status ?? 'unavailable' }
    const initial = await store.getSnapshot(job.executionId)
    if (!initial) return { status: 'unavailable' }
    const settings = initial.manifest.settings
    const savedHashes = settings && typeof settings === 'object' && 'hashes' in settings ? settings.hashes : null
    if (!savedHashes || typeof savedHashes !== 'object' || !('config' in savedHashes) || savedHashes.config !== (await pipelineSettings()).hashes.config) {
      throw new PipelineStop('configuration_changed')
    }
    const materialIds = materials(initial).map(material => material.id)
    const sourceCount = initial.sources.length
    const extractionProjection = materialIds.length * (sourceCount + 8) + 100
    if (extractionProjection > MAX_PROJECTED_SUBREQUESTS || materialIds.length + 8 > MAX_WORKFLOW_STEPS) {
      const snapshot = await current(env, jobId)
      await save(env, snapshot, 'diagnostics', { code: 'workflow_limit', projected_subrequests: extractionProjection, limit: MAX_PROJECTED_SUBREQUESTS })
      throw new PipelineStop('workflow_limit')
    }
    await step.do('start', NO_RETRIES, async () => {
      const snapshot = await current(env, jobId, true)
      const latest = await store.getWorkflowJob(jobId)
      if (latest?.status === 'queued') await advance(env, jobId, snapshot, 'queued', 'extracting')
      return { status: 'ok' }
    })

    const extractionResults: Array<{ materialId: number; result: PaidResult }> = []
    for (const materialId of materialIds) {
      const result = await step.do(`extract-${materialId}`, NO_RETRIES, async () => paid(env, jobId, `extract:${materialId}`, snapshot => {
        const material = materials(snapshot).find(candidate => candidate.id === materialId)
        if (!material) throw new PipelineStop('source_unavailable')
        return buildClairicRequest(material.content)
      }))
      requirePaid(result)
      extractionResults.push({ materialId, result })
    }
    const extracted = await step.do('validate-extraction', NO_RETRIES, async (): Promise<ArtifactRef> => {
      const snapshot = await current(env, jobId)
      const evidence: Evidence[] = []
      const coverage: Coverage[] = []
      const rawIds: string[] = []
      for (const { materialId, result } of extractionResults) {
        const material = materials(snapshot).find(candidate => candidate.id === materialId)
        if (!material) throw new PipelineStop('source_unavailable')
        if (result.status !== 'ok' || !result.artifactId) {
          coverage.push({ material_id: materialId, status: 'failed', evidence_count: 0, rejected: [], duplicates: 0, state_mapping: null, error_code: result.status, usage_status: null })
          continue
        }
        rawIds.push(result.artifactId)
        const raw = await artifact<RawPayload>(env, snapshot.executionId, result.artifactId)
        const usage = raw.response && typeof raw.response === 'object' && 'usage' in raw.response ? raw.response.usage : undefined
        let extracted: EvidenceExtraction
        try {
          parseClairicResponse(raw.response, material.content)
          extracted = extractClairicEvidence({ material_id: material.id, content: material.content, state: material.content, response: raw.response })
        } catch {
          coverage.push({ material_id: materialId, status: 'failed', evidence_count: 0, rejected: [], duplicates: 0, state_mapping: null, error_code: 'invalid_extraction', usage_status: modelUsageStatus(usage) })
          continue
        }
        evidence.push(...extracted.evidence)
        coverage.push({ material_id: materialId, status: extracted.status, evidence_count: extracted.evidence.length, rejected: extracted.rejected, duplicates: extracted.duplicates, state_mapping: extracted.state_mapping, error_code: null, usage_status: modelUsageStatus(usage) })
      }
      const partial = coverage.some(item => item.status !== 'complete')
      const diagnostics = { stage: 'extraction', evidence_count: evidence.length, maximum: MAX_EVIDENCE, coverage }
      await save(env, snapshot, 'diagnostics', diagnostics)
      if (evidence.length > MAX_EVIDENCE || evidence.length === 0) {
        const code = evidence.length > MAX_EVIDENCE ? 'too_many_evidence' : coverage.some(item => item.error_code === 'provider_uncertain') ? 'provider_uncertain' : 'invalid_extraction'
        await finishFailure(env, jobId, code)
        return { status: 'failed', artifactId: null }
      }
      const payload: ExtractionPayload = { evidence, coverage, partial, raw_artifact_ids: rawIds }
      const artifactId = await save(env, snapshot, 'extraction', payload)
      await advance(env, jobId, snapshot, 'extracting', 'comparing')
      return { status: 'ok', artifactId }
    })
    if (extracted.status !== 'ok' || !extracted.artifactId) return { status: 'failed' }
    const extraction = await artifact<ExtractionPayload>(env, job.executionId, extracted.artifactId)

    const planned = await step.do('plan-comparisons', NO_RETRIES, async (): Promise<ArtifactRef> => {
      const snapshot = await current(env, jobId)
      try {
        const batches = buildClefBatches(extraction.evidence, createEvidencePairs(extraction.evidence))
        const projection = extractionProjection + batches.length * (sourceCount + 8) + sourceCount + 80
        if (projection > MAX_PROJECTED_SUBREQUESTS || materialIds.length + batches.length + 8 > MAX_WORKFLOW_STEPS) {
          await save(env, snapshot, 'diagnostics', { code: 'workflow_limit', projected_subrequests: projection, projected_steps: materialIds.length + batches.length + 8, limit: MAX_PROJECTED_SUBREQUESTS })
          await finishFailure(env, jobId, 'workflow_limit')
          return { status: 'failed', artifactId: null }
        }
        return { status: 'ok', artifactId: await save(env, snapshot, 'comparison', { batches } satisfies ComparisonPlan) }
      } catch (error) {
        if (!(error instanceof ModelContextLimitError)) throw error
        await recordLimit(env, jobId, error)
        await finishFailure(env, jobId, 'workflow_limit')
        return { status: 'failed', artifactId: null }
      }
    })
    if (planned.status !== 'ok' || !planned.artifactId) return { status: 'failed' }
    const plan = await artifact<ComparisonPlan>(env, job.executionId, planned.artifactId)
    const comparisonResults: PaidResult[] = []
    for (let index = 0; index < plan.batches.length; index++) {
      const result = await step.do(`compare-${index}`, NO_RETRIES, async () => paid(env, jobId, `compare:${index}`, async snapshot => {
        const saved = await artifact<ComparisonPlan>(env, snapshot.executionId, planned.artifactId!)
        if (!saved.batches[index]) throw new PipelineStop('internal_error')
        return saved.batches[index]
      }))
      requirePaid(result)
      comparisonResults.push(result)
    }

    const compared = await step.do('validate-comparisons', NO_RETRIES, async (): Promise<ArtifactRef> => {
      const snapshot = await current(env, jobId)
      const judgments: DirectComparison[] = []
      const failures: ComparisonFailure[] = []
      const rawIds: string[] = []
      for (let index = 0; index < plan.batches.length; index++) {
        const batch = plan.batches[index]
        const result = comparisonResults[index]
        if (result.status !== 'ok' || !result.artifactId) {
          failures.push(...batch.pairs.map(pair => ({ pair_key: pair.pair_key, error_code: result.status })))
          continue
        }
        rawIds.push(result.artifactId)
        const raw = await artifact<RawPayload>(env, snapshot.executionId, result.artifactId)
        try {
          judgments.push(...parseClefResponse(raw.response, batch))
        } catch {
          failures.push(...batch.pairs.map(pair => ({ pair_key: pair.pair_key, error_code: 'invalid_comparison' })))
        }
      }
      const analysis = analyzeComparisons(extraction.evidence, judgments, failures)
      const payload: ComparisonPayload = { analysis, partial: extraction.partial || analysis.incomplete_pairs.length > 0, raw_artifact_ids: rawIds }
      await save(env, snapshot, 'diagnostics', { stage: 'comparison', ...analysis })
      const artifactId = await save(env, snapshot, 'comparison', payload)
      await advance(env, jobId, snapshot, 'comparing', 'generating')
      return { status: 'ok', artifactId }
    })
    if (compared.status !== 'ok' || !compared.artifactId) return { status: 'failed' }
    const comparison = await artifact<ComparisonPayload>(env, job.executionId, compared.artifactId)
    const candidates: GenerationCandidates = {
      consensus: comparison.analysis.consensus_groups,
      disputes: comparison.analysis.disputes.map(({ id, evidence_ids }) => ({ id, evidence_ids })),
      positions: comparison.analysis.position_candidates,
    }

    const generated = await step.do('generate', NO_RETRIES, async (): Promise<PaidResult> => {
      try {
        return await paid(env, jobId, 'generate', snapshot =>
          buildGemmaRequest(extraction.evidence, candidates, snapshot.manifest.language as GenerationLanguage, materials(snapshot)), GEMMA_PARAMETERS.max_completion_tokens)
      } catch (error) {
        if (!(error instanceof ModelContextLimitError)) throw error
        await recordLimit(env, jobId, error)
        return { status: 'workflow_limit', artifactId: null }
      }
    })
    requirePaid(generated)
    if (generated.status !== 'ok' || !generated.artifactId) throw new PipelineStop(generated.status === 'provider_uncertain' ? 'provider_uncertain' : 'provider_error')
    const completed = await step.do('validate-generation', NO_RETRIES, async () => {
      const snapshot = await current(env, jobId)
      const raw = await artifact<RawPayload>(env, snapshot.executionId, generated.artifactId!)
      let draft
      try {
        draft = parseGemmaResponse(raw.response, extraction.evidence, candidates, materials(snapshot))
      } catch {
        await save(env, snapshot, 'diagnostics', { stage: 'generation', code: 'invalid_generation' })
        await finishFailure(env, jobId, 'invalid_generation')
        return { status: 'failed' }
      }
      const payload = {
        ...draft,
        verification: 'ai_unverified',
        diagnostics: { coverage: extraction.coverage, partial: comparison.partial, comparisons: comparison.analysis },
        provenance: {
          input_manifest: snapshot.manifest,
          extraction_artifact_id: extracted.artifactId,
          comparison_artifact_id: compared.artifactId,
          raw_artifact_ids: [...extraction.raw_artifact_ids, ...comparison.raw_artifact_ids, generated.artifactId],
        },
      }
      const id = await save(env, snapshot, 'generation', payload)
      if (!await store.completeExecution({ executionId: snapshot.executionId, artifactId: id, generations: snapshot.generations, partial: comparison.partial })) throw new PipelineStop('source_unavailable')
      return { status: comparison.partial ? 'partial_draft' : 'ai_draft' }
    })
    return completed
  } catch (error) {
    const code: ErrorCode = error instanceof PipelineStop ? error.code : error instanceof SourceUnavailable ? error.code : 'internal_error'
    try {
      const job = await store.getWorkflowJob(jobId)
      if (job) await store.markAttemptsUnknown(job.executionId)
      await finishFailure(env, jobId, code)
    } catch { /* 不輸出例外或私人內容。 */ }
    return { status: 'failed' }
  }
}
