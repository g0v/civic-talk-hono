import { reactive } from 'vue'
import type { Locale } from '../l10n'

export type SummaryPhase = 'idle' | 'loading' | 'ready' | 'submitting' | 'progress' | 'saved' | 'superseded' | 'unsaved' | 'partial' | 'failed' | 'withdrawn' | 'erased' | 'unknown' | 'error'
export type SummaryUsage = { attempts: number; reservedMicroUsd: number; actualMicroUsd: number; uncertain: number }
export type SummaryState = {
  language: Locale | null
  phase: SummaryPhase
  version: number | null
  hasSummary: boolean
  jobId: string | null
  status: string | null
  usage: SummaryUsage | null
  error: string | null
  canResume: boolean
}

type SummaryContext = {
  version: number
  has_summary: boolean
  job: { job_id: string; status: string } | null
  summary: { job_id: string; data: unknown; verification: 'ai_unverified' } | null
}

type Dependencies = {
  fetch?: typeof fetch
  onOutcome?: (phase: SummaryPhase, error: string | null) => void
  onSessionExpired?: () => void
  onBanned?: () => void
  onSaved?: (data: unknown) => void
  pollInterval?: number
}

const activeStatuses: Record<string, true> = { queued: true, extracting: true, comparing: true, generating: true }
const terminalStatuses: Record<string, true> = { ai_draft: true, partial_draft: true, failed: true, withdrawn: true, erased: true }
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function contextFrom(value: unknown): SummaryContext | null {
  if (!isObject(value) || !Number.isSafeInteger(value.version) || (value.version as number) < 0 || typeof value.has_summary !== 'boolean') return null
  const job = value.job
  if (job !== null && (!isObject(job) || typeof job.job_id !== 'string' || !job.job_id || typeof job.status !== 'string')) return null
  const summary = value.summary
  if (summary !== null && (!isObject(summary) || typeof summary.job_id !== 'string' || !summary.job_id || summary.verification !== 'ai_unverified' || !Object.hasOwn(summary, 'data'))) return null
  return value as SummaryContext
}

function usageFrom(value: unknown): SummaryUsage | null {
  if (!isObject(value)) return null
  const fields = ['attempts', 'reservedMicroUsd', 'actualMicroUsd', 'uncertain'] as const
  if (fields.some(field => typeof value[field] !== 'number' || !Number.isSafeInteger(value[field]) || (value[field] as number) < 0)) return null
  return value as SummaryUsage
}

/** 各議題元件獨立持有；不以網址或 localStorage 接受任意工作 ID。 */
export function createEvidenceSummary(issueId: number, dependencies: Dependencies = {}) {
  const state = reactive<SummaryState>({ language: null, phase: 'idle', version: null, hasSummary: false, jobId: null, status: null, usage: null, error: null, canResume: false })
  const request = dependencies.fetch ?? ((input, init) => fetch(input, init))
  const announced = new Set<string>()
  let generation = 0
  let abort: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let jobVersion: number | null = null

  function begin(): number {
    generation++
    clearTimeout(timer ?? undefined)
    timer = null
    abort?.abort()
    abort = new AbortController()
    return generation
  }

  function current(token: number): boolean {
    return token === generation && state.language !== null
  }

  function outcome(phase: SummaryPhase, error: string | null = null, canResume = false) {
    state.phase = phase
    state.error = error
    state.canResume = canResume
    dependencies.onOutcome?.(phase, error)
  }

  async function json(path: string, token: number, init: RequestInit = {}, posting = false): Promise<unknown | null> {
    const controller = abort
    if (!controller || !current(token)) return null
    const deadline = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await request(path, { ...init, signal: controller.signal })
      const body: unknown = await response.json().catch(() => null)
      if (!current(token)) return null
      if (!response.ok) {
        if (response.status === 401) {
          outcome('error', 'session_expired')
          dependencies.onSessionExpired?.()
        } else if (response.status === 403) {
          outcome('error', 'banned')
          dependencies.onBanned?.()
        } else {
          const code = isObject(body) && typeof body.error === 'string' ? body.error : 'service_unavailable'
          outcome('error', posting && response.status >= 500 && code !== 'daily_budget_exhausted' ? 'post_unknown' : code, true)
        }
        return null
      }
      if (!isObject(body)) {
        outcome('error', posting ? 'post_unknown' : 'invalid_response', true)
        return null
      }
      return body
    } catch {
      if (current(token)) outcome('error', posting ? 'post_unknown' : 'network_error', true)
      return null
    } finally {
      clearTimeout(deadline)
    }
  }

  async function fetchContext(token: number): Promise<SummaryContext | null> {
    const language = state.language
    if (!language) return null
    const body = await json(`/api/issues/${issueId}/evidence-summary?language=${encodeURIComponent(language)}`, token)
    if (!body || !current(token)) return null
    const context = contextFrom(body)
    if (!context) {
      outcome('error', 'invalid_response', true)
      return null
    }
    state.version = context.version
    state.hasSummary = context.has_summary
    return context
  }

  async function poll(token: number): Promise<void> {
    const jobId = state.jobId
    const language = state.language
    if (!jobId || !language || !current(token)) return
    const body = await json(`/api/evidence-jobs/${encodeURIComponent(jobId)}`, token)
    if (!body || !current(token)) return
    if (!isObject(body) || body.job_id !== jobId || typeof body.status !== 'string') {
      outcome('error', 'invalid_response', true)
      return
    }
    state.status = body.status
    state.usage = usageFrom(body.usage)
    if (Object.hasOwn(activeStatuses, body.status)) {
      state.phase = 'progress'
      state.error = null
      state.canResume = false
      timer = setTimeout(() => {
        timer = null
        void poll(token)
      }, dependencies.pollInterval ?? 3000)
      return
    }
    if (body.status === 'ai_draft') {
      // 僅在本議題、所選語言的持久結果確實指向此工作時才宣告成功。
      // 保存成功本身也會遞增版本；同一最新工作已存妥時，不能僅因版本增加就判為被取代。
      const context = await fetchContext(token)
      if (!context || !current(token)) return
      if (context.job?.job_id !== jobId) {
        outcome('superseded')
      } else if (context.summary?.job_id === jobId) {
        outcome('saved')
        const key = `${language}:${jobId}:${context.version}`
        if (!announced.has(key)) {
          announced.add(key)
          dependencies.onSaved?.(context.summary.data)
        }
      } else if (context.version !== jobVersion) {
        outcome('superseded')
      } else {
        outcome('unsaved', null, true)
      }
      return
    }
    if (body.status === 'partial_draft') outcome('partial')
    else if (body.status === 'failed') outcome('failed')
    else if (body.status === 'withdrawn') outcome('withdrawn')
    else if (body.status === 'erased') outcome('erased')
    else outcome('unknown', null, true)
  }

  async function restore(token: number): Promise<void> {
    const context = await fetchContext(token)
    if (!context || !current(token)) return
    if (!context.job) {
      state.phase = 'ready'
      state.jobId = null
      state.status = null
      state.usage = null
      return
    }
    state.jobId = context.job.job_id
    state.status = context.job.status
    jobVersion = context.version
    state.phase = 'progress'
    await poll(token)
  }

  async function setScope(language: Locale | null): Promise<void> {
    const token = begin()
    state.language = language
    state.phase = language ? 'loading' : 'idle'
    state.version = null
    state.hasSummary = false
    state.jobId = null
    state.status = null
    state.usage = null
    state.error = null
    state.canResume = false
    jobVersion = null
    if (language) await restore(token)
  }

  /** 開啟告知前重讀版本，避免在舊的替換確認上送出。 */
  async function prepare(): Promise<boolean> {
    if (!state.language || ['loading', 'submitting', 'progress', 'error', 'unknown', 'unsaved'].includes(state.phase)) return false
    const previousPhase = state.phase
    const previousVersion = state.version
    const previousJob = state.jobId
    const token = begin()
    state.phase = 'loading'
    const context = await fetchContext(token)
    if (!context || !current(token)) return false
    if (context.job && !Object.hasOwn(terminalStatuses, context.job.status)) {
      state.jobId = context.job.job_id
      state.status = context.job.status
      jobVersion = context.version
      state.phase = 'progress'
      await poll(token)
      return false
    }
    if (previousJob && context.job?.job_id === previousJob && context.version === previousVersion) {
      state.phase = previousPhase
    } else {
      state.phase = 'ready'
      state.jobId = null
      state.status = null
      state.usage = null
    }
    return true
  }

  /** 每次 POST 都只能由明確同意觸發；不在任何錯誤路徑重送。 */
  async function start(): Promise<void> {
    const language = state.language
    const version = state.version
    if (!language || version === null || ['idle', 'loading', 'submitting', 'progress', 'error', 'unknown', 'unsaved'].includes(state.phase)) return
    const token = begin()
    state.phase = 'submitting'
    state.jobId = null
    state.status = null
    state.usage = null
    state.error = null
    state.canResume = false
    const body = await json(`/api/issues/${issueId}/evidence-summary`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true, language, expected_version: version }),
    }, true)
    if (!body || !current(token)) return
    if (!isObject(body) || typeof body.job_id !== 'string' || !body.job_id || typeof body.status !== 'string' || !Number.isSafeInteger(body.version) || (body.version as number) < 0) {
      outcome('error', 'post_unknown', true)
      return
    }
    state.version = body.version as number
    jobVersion = state.version
    state.jobId = body.job_id
    state.status = body.status
    state.phase = 'progress'
    announced.delete(`${language}:${body.job_id}:${state.version}`)
    await poll(token)
  }

  async function resume(): Promise<void> {
    if (!state.language || !state.canResume) return
    const token = begin()
    state.error = null
    state.canResume = false
    if (state.jobId) {
      state.phase = 'progress'
      await poll(token)
    } else {
      state.phase = 'loading'
      await restore(token)
    }
  }

  function dispose(): void {
    begin()
    state.language = null
  }

  return { state, setScope, prepare, start, resume, dispose }
}
