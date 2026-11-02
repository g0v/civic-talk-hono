import type { WorkflowStep } from 'cloudflare:workers'
import type { EvidenceBindings } from './env'
import { analyzeComparisons, createEvidencePairs, type ComparisonAnalysis, type ComparisonFailure, type DirectComparison } from './comparison'
import { extractClairicEvidence, MAX_EVIDENCE, type Evidence, type EvidenceExtraction } from './evidence'
import { assembleGeneratedDraft, buildCompletionRequest, buildGemmaRequest, finalizeDraftCompletion, GEMMA_PARAMETERS, GENERATION_SECTIONS, GENERATION_VALIDATION_CODES, parseCompletionResponse, parseGemmaResponse, pipelineSettings, prepareDraftCompletion, type CompletedDraft, type DraftCompletionPlan, type GeneratedSection, type GenerationInput, type GenerationSection, type GemmaRequest, type SectionStates } from './generation'
import { checkInitiator, checkedSnapshot, SourceUnavailable } from './lifecycle'
import { buildClairicRequest, buildClefBatches, modelUsageStatus, ModelContextLimitError, parseClairicResponse, parseClefResponse, type ClefBatch, type ModelRequest } from './models'
import { actualCallCost, estimateCall, requestProvenance, type ModelSelector } from './pricing'
import { EvidenceStore, EvidenceStoreError, type ErrorCode, type Snapshot } from './store'
import { WORKFLOW_CONTROL_POLICY } from './workflowPolicy'

const NO_RETRIES = WORKFLOW_CONTROL_POLICY.non_model_step
const PAID_STEP_OPTIONS = WORKFLOW_CONTROL_POLICY.paid_step
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
type GenerationPlan = {
  stage: 'generation_plan'
  requests: Partial<Record<GenerationSection, GemmaRequest>>
  estimates: Partial<Record<GenerationSection, number>>
  limits: Partial<Record<GenerationSection, { request_bytes: number; limit_bytes: number }>>
  estimated_micro_usd: number
}
type SectionOutcome = {
  section: GenerationSection
  status: 'completed' | 'no_findings' | 'failed' | 'not_started'
  reason: ErrorCode | null
  artifact_id: string | null
  raw_artifact_id: string | null
  validation_code: string | null
}
type GenerationResumeState = {
  available_sections: GenerationSection[]
  estimated_micro_usd: number
  sections: SectionOutcome[]
  outcomes: SectionOutcome[]
}
type CompletionPlanRef = ArtifactRef & { targets: string[] }
type SectionArtifact = { stage: 'generation_section'; raw_artifact_id: string; result: GeneratedSection }
type CompletionPlanArtifact = { stage: 'completion_plan'; plan: DraftCompletionPlan }
type CompletionArtifact = { stage: 'completion_result'; plan_artifact_id: string; raw_artifact_id: string | null; result: CompletedDraft }
type CompletionOutcome = {
  status: 'not_needed' | 'completed' | 'failed' | 'not_started'
  reason: ErrorCode | null
  validation_code: string | null
  artifact_id: string | null
  raw_artifact_id: string | null
  targets: string[]
}

class PipelineStop extends Error {
  constructor(readonly code: ErrorCode) { super(code) }
}

/** 只包住不呼叫模型且可冪等重放的銜接；確定性守門回傳代碼，避免 SDK 重試。 */
async function controlStep<T extends Rpc.Serializable<T>>(step: WorkflowStep, name: string, callback: () => Promise<T>): Promise<T> {
  const result = await step.do(name, WORKFLOW_CONTROL_POLICY.handoff_step, async () => {
    try {
      return { status: 'ok' as const, value: await callback() }
    } catch (error) {
      if (error instanceof PipelineStop || error instanceof SourceUnavailable) return { status: 'stopped' as const, code: error.code }
      if (error instanceof EvidenceStoreError && error.code === 'invalid_input') return { status: 'stopped' as const, code: 'internal_error' as const }
      // 原生重試會記錄例外；只交固定代碼，不讓資料庫原始訊息進入 step 日誌。
      throw new EvidenceStoreError('storage_error')
    }
  })
  if (result.status === 'stopped') throw new PipelineStop(result.code)
  return result.value
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

// 結束事件可能已落盤但 native checkpoint 尚未提交；重放不得重複寫入。
async function recordSectionOutcome(env: EvidenceBindings, snapshot: Snapshot, outcome: SectionOutcome): Promise<void> {
  const events = await new EvidenceStore(env.DB).listArtifacts(snapshot.executionId, 'diagnostics')
  const exists = events.some(item => {
    const event = item.payload as { stage?: string; phase?: string; outcome?: SectionOutcome } | null
    const previous = event?.outcome
    return event?.stage === 'generation' && event.phase === 'finished' && previous?.section === outcome.section &&
      previous.status === outcome.status && previous.reason === outcome.reason && previous.validation_code === outcome.validation_code &&
      previous.artifact_id === outcome.artifact_id && previous.raw_artifact_id === outcome.raw_artifact_id
  })
  if (!exists) await save(env, snapshot, 'diagnostics', { stage: 'generation', phase: 'finished', outcome })
}

function providerErrorDiagnostic(error: unknown) {
  const detail = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  const name = typeof detail.name === 'string' && ['Error', 'TypeError', 'InferenceUpstreamError', 'AiInternalError', 'AbortError', 'TimeoutError'].includes(detail.name) ? detail.name : null
  // SDK 將 provider code 放在訊息開頭；只取數字與固定分類，絕不保存可能含輸入的原文。
  const message = typeof detail.message === 'string' ? detail.message.slice(0, 4096) : ''
  const code = /^(\d{3,6}):/.exec(message)
  return {
    error_name: name,
    provider_code: code ? Number(code[1]) : null,
    http_status: typeof detail.status === 'number' && Number.isInteger(detail.status) && detail.status >= 400 && detail.status <= 599 ? detail.status : null,
    category: name === 'TimeoutError' ? 'timeout' : name === 'AbortError' ? 'aborted' : message.includes("JSON Mode couldn't be met") ? 'json_mode_unmet' : 'unknown',
  }
}

function generationValidationCode(error: unknown): string | null {
  return error instanceof Error && GENERATION_VALIDATION_CODES.includes(error.message) ? error.message : null
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
    // 不啟用串流或 provider retry；不得將 cookie／憑證／作者欄送入模型。
    const ai = env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }
    response = await ai.run(selector, request.input)
  } catch (error) {
    await store.settleAttempt(attempt.attemptId, null)
    try {
      await save(env, snapshot, 'diagnostics', {
        stage: 'provider', code: 'provider_error', step_key: stepKey, model_selector: selector, ...providerErrorDiagnostic(error),
      })
    } catch {
      // 診斷儲存失敗或來源已撤下，不覆蓋原 provider 失敗與未知費用；不輸出例外。
      console.error('evidence_provider_diagnostic_unavailable')
    }
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
    const extractionProjection = materialIds.length * (sourceCount + 8) + 220
    if (extractionProjection > MAX_PROJECTED_SUBREQUESTS || materialIds.length + WORKFLOW_CONTROL_POLICY.fixed_step_upper_bound > MAX_WORKFLOW_STEPS) {
      await step.do('reject-workflow-limit', NO_RETRIES, async () => {
        const snapshot = await current(env, jobId)
        await save(env, snapshot, 'diagnostics', { code: 'workflow_limit', projected_subrequests: extractionProjection, limit: MAX_PROJECTED_SUBREQUESTS })
        return { status: 'failed' }
      })
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
      const result = await step.do(`extract-${materialId}`, PAID_STEP_OPTIONS, async () => paid(env, jobId, `extract:${materialId}`, snapshot => {
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
        const projection = extractionProjection + batches.length * (sourceCount + 8) + WORKFLOW_CONTROL_POLICY.generation_guard_checks_upper_bound * (sourceCount + 12) + 80
        if (projection > MAX_PROJECTED_SUBREQUESTS || materialIds.length + batches.length + WORKFLOW_CONTROL_POLICY.fixed_step_upper_bound > MAX_WORKFLOW_STEPS) {
          await save(env, snapshot, 'diagnostics', { code: 'workflow_limit', projected_subrequests: projection, projected_steps: materialIds.length + batches.length + WORKFLOW_CONTROL_POLICY.fixed_step_upper_bound, limit: MAX_PROJECTED_SUBREQUESTS })
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
      const result = await step.do(`compare-${index}`, PAID_STEP_OPTIONS, async () => paid(env, jobId, `compare:${index}`, async snapshot => {
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
    const generationInput = (snapshot: Snapshot): GenerationInput => ({
      evidence: extraction.evidence,
      comparison: comparison.analysis,
      language: snapshot.manifest.language as GenerationInput['language'],
      sources: materials(snapshot),
    })
    const plannedGeneration = await step.do('plan-generation', NO_RETRIES, async (): Promise<ArtifactRef> => {
      const snapshot = await current(env, jobId, true)
      const input = generationInput(snapshot)
      const plan: GenerationPlan = { stage: 'generation_plan', requests: {}, estimates: {}, limits: {}, estimated_micro_usd: 0 }
      for (const section of GENERATION_SECTIONS) {
        try {
          const request = buildGemmaRequest(section, input)
          plan.requests[section] = request
          const estimate = estimateCall(request.selector as ModelSelector, request.input, request.input.max_tokens)
          plan.estimates[section] = estimate
          plan.estimated_micro_usd += estimate
        } catch (error) {
          if (!(error instanceof ModelContextLimitError)) throw error
          plan.limits[section] = { request_bytes: error.request_bytes, limit_bytes: error.limit_bytes }
        }
      }
      await save(env, snapshot, 'diagnostics', {
        stage: 'generation', phase: 'planned', estimated_micro_usd: plan.estimated_micro_usd,
        sections: GENERATION_SECTIONS.map(section => ({
          section,
          estimated_micro_usd: plan.estimates[section] ?? null,
          context_limit: plan.limits[section] ?? null,
        })),
      })
      return { status: 'ok', artifactId: await save(env, snapshot, 'generation', plan) }
    })
    if (!plannedGeneration.artifactId) throw new PipelineStop('internal_error')
    // 只將可重放的識別符與狀態交給 checkpoint，原文／模型請求仍留在隔離工件。
    const resume = await controlStep(step, 'load-generation-state', async (): Promise<GenerationResumeState> => {
      const snapshot = await current(env, jobId, true)
      const plan = await artifact<GenerationPlan>(env, snapshot.executionId, plannedGeneration.artifactId!)
      const sections = new Map<GenerationSection, SectionOutcome>()
      for (const saved of await store.listArtifacts(snapshot.executionId, 'generation')) {
        const payload = saved.payload as Partial<SectionArtifact> | null
        if (payload?.stage === 'generation_section' && payload.result && GENERATION_SECTIONS.includes(payload.result.section)) {
          sections.set(payload.result.section, {
            section: payload.result.section, status: payload.result.data.items.length ? 'completed' : 'no_findings', reason: null,
            artifact_id: saved.id, raw_artifact_id: payload.raw_artifact_id!, validation_code: null,
          })
        }
      }
      const outcomes = new Map<GenerationSection, SectionOutcome>()
      for (const saved of await store.listArtifacts(snapshot.executionId, 'diagnostics')) {
        const event = saved.payload as { stage?: string; phase?: string; outcome?: SectionOutcome } | null
        if (event?.stage === 'generation' && event.phase === 'finished' && event.outcome && GENERATION_SECTIONS.includes(event.outcome.section)) outcomes.set(event.outcome.section, event.outcome)
      }
      return {
        available_sections: GENERATION_SECTIONS.filter(section => Boolean(plan.requests[section])),
        estimated_micro_usd: plan.estimated_micro_usd, sections: [...sections.values()], outcomes: [...outcomes.values()],
      }
    })
    const savedSections = new Map(resume.sections.map(outcome => [outcome.section, outcome]))
    const savedOutcomes = new Map(resume.outcomes.map(outcome => [outcome.section, outcome]))
    const outcomes: SectionOutcome[] = []
    let budgetStopped = false
    for (const section of GENERATION_SECTIONS) {
      const restored = await controlStep(step, `prepare-generation-${section}`, async (): Promise<SectionOutcome | null> => {
        const snapshot = await current(env, jobId, true)
        const saved = savedSections.get(section)
        if (saved) {
          await recordSectionOutcome(env, snapshot, saved)
          return saved
        }
        return savedOutcomes.get(section) ?? null
      })
      if (restored) {
        outcomes.push(restored)
        if (restored.reason === 'budget_exhausted') budgetStopped = true
        continue
      }
      let outcome: SectionOutcome = {
        section, status: 'not_started', reason: null, artifact_id: null, raw_artifact_id: null, validation_code: null,
      }
      const available = resume.available_sections.includes(section)
      if (budgetStopped) {
        outcome.reason = 'budget_exhausted'
      } else if (!available) {
        outcome.reason = 'workflow_limit'
      } else {
        const generated = await step.do(`generate-${section}`, PAID_STEP_OPTIONS, async (): Promise<PaidResult> => {
          const snapshot = await current(env, jobId, true)
          const plan = await artifact<GenerationPlan>(env, snapshot.executionId, plannedGeneration.artifactId!)
          const request = plan.requests[section]
          if (!request) return { status: 'workflow_limit', artifactId: null }
          await save(env, snapshot, 'diagnostics', { stage: 'generation', phase: 'started', section })
          return paid(env, jobId, `generate:${section}`, () => request, request.input.max_tokens)
        })
        if (generated.status === 'source_unavailable') throw new PipelineStop('source_unavailable')
        if (generated.status === 'budget_exhausted' || generated.status === 'workflow_limit') {
          outcome.reason = generated.status
          budgetStopped = generated.status === 'budget_exhausted'
        } else if (generated.status !== 'ok' || !generated.artifactId) {
          outcome.status = 'failed'
          outcome.reason = generated.status === 'provider_uncertain' ? 'provider_uncertain' : 'provider_error'
        } else {
          const rawId = generated.artifactId
          outcome = await step.do(`validate-generation-${section}`, NO_RETRIES, async (): Promise<SectionOutcome> => {
            const snapshot = await current(env, jobId, true)
            const raw = await artifact<RawPayload>(env, snapshot.executionId, rawId)
            let parsed: GeneratedSection
            try {
              parsed = await parseGemmaResponse(section, raw.response, generationInput(snapshot))
            } catch (error) {
              const validationCode = error instanceof Error && GENERATION_VALIDATION_CODES.includes(error.message) ? error.message : null
              return { section, status: 'failed', reason: 'invalid_generation', artifact_id: null, raw_artifact_id: rawId, validation_code: validationCode }
            }
            const artifactId = await save(env, snapshot, 'generation', { stage: 'generation_section', raw_artifact_id: rawId, result: parsed } satisfies SectionArtifact)
            return { section, status: parsed.data.items.length ? 'completed' : 'no_findings', reason: null, artifact_id: artifactId, raw_artifact_id: rawId, validation_code: null }
          })
        }
      }
      outcomes.push(await controlStep(step, `finish-generation-${section}`, async (): Promise<SectionOutcome> => {
        const snapshot = await current(env, jobId, true)
        await recordSectionOutcome(env, snapshot, outcome)
        return outcome
      }))
    }

    const plannedCompletion = await step.do('plan-completion', NO_RETRIES, async (): Promise<CompletionPlanRef> => {
      const snapshot = await current(env, jobId, true)
      // 失敗結果可能已保存但 checkpoint 未提交；這項讀取也必須在受控步驟內。
      let previousCompletion: CompletionOutcome | undefined
      for (const saved of await store.listArtifacts(snapshot.executionId, 'diagnostics')) {
        const event = saved.payload as { stage?: string; phase?: string; outcome?: CompletionOutcome } | null
        if (event?.stage === 'completion' && event.phase === 'finished') previousCompletion = event.outcome
      }
      if (previousCompletion?.status === 'failed') {
        await finishFailure(env, jobId, previousCompletion.reason ?? 'invalid_generation')
        return { status: 'failed', artifactId: null, targets: [] }
      }
      const sections: GeneratedSection[] = []
      for (const outcome of outcomes) {
        if (outcome.artifact_id) sections.push((await artifact<SectionArtifact>(env, snapshot.executionId, outcome.artifact_id)).result)
      }
      if (sections.length === 0) {
        await finishFailure(env, jobId, outcomes.find(item => item.status === 'failed')?.reason ?? outcomes.find(item => item.reason)?.reason ?? 'invalid_generation')
        return { status: 'failed', artifactId: null, targets: [] }
      }
      await save(env, snapshot, 'diagnostics', { stage: 'completion', phase: 'started' })
      const saved = (await store.listArtifacts(snapshot.executionId, 'generation'))
        .find(item => (item.payload as Partial<CompletionPlanArtifact> | null)?.stage === 'completion_plan')
      if (saved) {
        const payload = saved.payload as CompletionPlanArtifact
        return { status: 'ok', artifactId: saved.id, targets: payload.plan.targets.map(target => target.pointer) }
      }
      let plan: DraftCompletionPlan
      try {
        const input = generationInput(snapshot)
        const draft = await assembleGeneratedDraft(sections, input)
        const states = Object.fromEntries(outcomes.map(outcome => [outcome.section, outcome.status])) as SectionStates
        plan = await prepareDraftCompletion(draft, sections, states, input)
      } catch (error) {
        if (error instanceof PipelineStop || error instanceof SourceUnavailable) throw error
        const outcome: CompletionOutcome = {
          status: 'failed', reason: 'invalid_generation', validation_code: generationValidationCode(error),
          artifact_id: null, raw_artifact_id: null, targets: [],
        }
        await save(env, snapshot, 'diagnostics', { stage: 'completion', phase: 'finished', outcome })
        await finishFailure(env, jobId, outcome.reason!)
        return { status: 'failed', artifactId: null, targets: [] }
      }
      const artifactId = await save(env, snapshot, 'generation', { stage: 'completion_plan', plan } satisfies CompletionPlanArtifact)
      return { status: 'ok', artifactId, targets: plan.targets.map(target => target.pointer) }
    })
    if (plannedCompletion.status !== 'ok' || !plannedCompletion.artifactId) return { status: 'failed' }
    const completionPlanId = plannedCompletion.artifactId
    const targets = plannedCompletion.targets
    let completionRawId: string | null = null
    if (targets.length) {
      const completionPaid = await step.do('complete-draft', PAID_STEP_OPTIONS, async (): Promise<PaidResult | ArtifactRef> => {
        const snapshot = await current(env, jobId, true)
        let result: PaidResult
        let validationCode: string | null = null
        try {
          result = await paid(env, jobId, 'complete:draft', async live => {
            const saved = await artifact<CompletionPlanArtifact>(env, live.executionId, completionPlanId)
            return buildCompletionRequest(saved.plan, generationInput(live))
          }, GEMMA_PARAMETERS.max_tokens)
        } catch (error) {
          if (error instanceof ModelContextLimitError) {
            await recordLimit(env, jobId, error)
            result = { status: 'workflow_limit', artifactId: null }
          } else {
            validationCode = generationValidationCode(error)
            if (!validationCode) throw error
            const outcome: CompletionOutcome = { status: 'failed', reason: 'invalid_generation', validation_code: validationCode, artifact_id: null, raw_artifact_id: null, targets }
            await save(env, snapshot, 'diagnostics', { stage: 'completion', phase: 'finished', outcome })
            await finishFailure(env, jobId, outcome.reason!)
            return { status: 'failed', artifactId: null }
          }
        }
        if (result.status === 'source_unavailable') throw new PipelineStop('source_unavailable')
        if (result.status !== 'ok' || !result.artifactId) {
          const reason = result.status === 'budget_exhausted' || result.status === 'workflow_limit' || result.status === 'provider_uncertain'
            ? result.status : 'provider_error'
          const outcome: CompletionOutcome = { status: 'failed', reason, validation_code: validationCode, artifact_id: null, raw_artifact_id: null, targets }
          await save(env, snapshot, 'diagnostics', { stage: 'completion', phase: 'finished', outcome })
          await finishFailure(env, jobId, reason)
        }
        return result
      })
      if (completionPaid.status !== 'ok' || !completionPaid.artifactId) return { status: 'failed' }
      completionRawId = completionPaid.artifactId
    }
    const completed = await step.do('validate-completion', NO_RETRIES, async (): Promise<ArtifactRef> => {
      const snapshot = await current(env, jobId, true)
      const savedPlan = await artifact<CompletionPlanArtifact>(env, snapshot.executionId, completionPlanId)
      const existing = (await store.listArtifacts(snapshot.executionId, 'generation')).find(item => {
        const payload = item.payload as Partial<CompletionArtifact> | null
        return payload?.stage === 'completion_result' && payload.plan_artifact_id === completionPlanId && payload.raw_artifact_id === completionRawId
      })
      let artifactId = existing?.id ?? null
      if (!artifactId) {
        let result: CompletedDraft
        try {
          const input = generationInput(snapshot)
          result = completionRawId
            ? await parseCompletionResponse((await artifact<RawPayload>(env, snapshot.executionId, completionRawId)).response, savedPlan.plan, input)
            : await finalizeDraftCompletion(savedPlan.plan, input)
        } catch (error) {
          if (error instanceof PipelineStop || error instanceof SourceUnavailable) throw error
          const outcome: CompletionOutcome = {
            status: 'failed', reason: 'invalid_generation', validation_code: generationValidationCode(error),
            artifact_id: null, raw_artifact_id: completionRawId, targets,
          }
          await save(env, snapshot, 'diagnostics', { stage: 'completion', phase: 'finished', outcome })
          await finishFailure(env, jobId, outcome.reason!)
          return { status: 'failed', artifactId: null }
        }
        artifactId = await save(env, snapshot, 'generation', { stage: 'completion_result', plan_artifact_id: completionPlanId, raw_artifact_id: completionRawId, result } satisfies CompletionArtifact)
      }
      const outcome: CompletionOutcome = {
        status: completionRawId ? 'completed' : 'not_needed', reason: null, validation_code: null,
        artifact_id: artifactId, raw_artifact_id: completionRawId, targets,
      }
      await save(env, snapshot, 'diagnostics', { stage: 'completion', phase: 'finished', outcome })
      return { status: 'ok', artifactId }
    })
    if (completed.status !== 'ok' || !completed.artifactId) return { status: 'failed' }
    return await step.do('assemble-generation', NO_RETRIES, async () => {
      const snapshot = await current(env, jobId, true)
      const sections: GeneratedSection[] = []
      for (const outcome of outcomes) {
        if (outcome.artifact_id) sections.push((await artifact<SectionArtifact>(env, snapshot.executionId, outcome.artifact_id)).result)
      }
      const draft = (await artifact<CompletionArtifact>(env, snapshot.executionId, completed.artifactId!)).result
      const plan = (await artifact<CompletionPlanArtifact>(env, snapshot.executionId, completionPlanId)).plan
      const partial = comparison.partial || sections.length !== GENERATION_SECTIONS.length
      const sectionDiagnostics = Object.fromEntries(outcomes.map(outcome => [
        outcome.section, { ...outcome, details: sections.find(section => section.section === outcome.section)?.diagnostics ?? null },
      ]))
      const completion: CompletionOutcome = {
        status: completionRawId ? 'completed' : 'not_needed', reason: null, validation_code: null,
        artifact_id: completed.artifactId, raw_artifact_id: completionRawId, targets,
      }
      const payload = {
        ...draft,
        verification: 'ai_unverified',
        diagnostics: {
          coverage: extraction.coverage, partial, comparisons: comparison.analysis,
          generation: { sections: sectionDiagnostics, completion, status_overviews: plan.status_overviews, estimated_micro_usd: resume.estimated_micro_usd },
        },
        provenance: {
          input_manifest: snapshot.manifest,
          extraction_artifact_id: extracted.artifactId,
          comparison_artifact_id: compared.artifactId,
          generation_plan_artifact_id: plannedGeneration.artifactId,
          generation_sections: outcomes.map(({ section, artifact_id, raw_artifact_id }) => ({ section, artifact_id, raw_artifact_id })),
          completion_plan_artifact_id: completionPlanId,
          completion_artifact_id: completed.artifactId,
          completion_raw_artifact_id: completionRawId,
          raw_artifact_ids: [...extraction.raw_artifact_ids, ...comparison.raw_artifact_ids, ...outcomes.flatMap(item => item.raw_artifact_id ? [item.raw_artifact_id] : []), ...(completionRawId ? [completionRawId] : [])],
        },
      }
      const id = await save(env, snapshot, 'generation', payload)
      if (!await store.completeExecution({ executionId: snapshot.executionId, artifactId: id, generations: snapshot.generations, partial })) throw new PipelineStop('source_unavailable')
      return { status: partial ? 'partial_draft' : 'ai_draft' }
    })
  } catch (error) {
    const code: ErrorCode = error instanceof PipelineStop ? error.code : error instanceof SourceUnavailable ? error.code : 'internal_error'
    try {
      await controlStep(step, 'fail-workflow', async () => {
        const job = await store.getWorkflowJob(jobId)
        if (job) await store.markAttemptsUnknown(job.executionId)
        await finishFailure(env, jobId, code)
        return { status: 'failed' }
      })
    } catch {
      // 清理也失敗時讓引擎進入終態，GET 可再對帳；不洩漏原始例外或私人內容。
      throw new Error('evidence_workflow_cleanup_failed')
    }
    return { status: 'failed' }
  }
}
