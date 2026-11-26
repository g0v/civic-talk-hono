import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { buildClairicCandidateRequest, CLAIRIC_CANDIDATE_PROMPT_VERSION } from './extractionCandidate'
import { MODEL_SELECTORS, type ClairicRequest } from './models'
import { actualCallCost, estimateCall, requestProvenance } from './pricing'
import { sha256 } from './source'

/** 僅供另行核可的操作者驗收；不是網站 job、quota 或來源權限的替代入口。 */
export interface P1AcceptanceGrant {
  readonly id: string
  readonly account_id: string
  readonly source: `source:${string}`
  readonly request: `request:${string}`
  readonly estimate_micro_usd: number
  readonly authorized_at: string
}

export interface P1AcceptanceInput {
  readonly grant: P1AcceptanceGrant
  readonly operator: { readonly account_id: string; readonly ai_write: boolean }
  readonly content: string
}

export type P1AcceptanceOutcome =
  | { readonly status: 'already_attempted' }
  | { readonly status: 'provider_uncertain' }
  | { readonly status: 'received'; readonly actual_micro_usd: number | null }

export class P1AcceptanceError extends Error {
  constructor(readonly code: 'authorization_mismatch' | 'request_changed') {
    super(code)
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 本機JSON授權檔只在入口解析一次；內部使用明確型別，不以truthy值冒充權限。 */
export function parseP1AcceptanceInput(value: unknown): P1AcceptanceInput {
  if (!record(value) || !record(value.grant) || !record(value.operator)) throw new P1AcceptanceError('authorization_mismatch')
  const grant = value.grant
  const operator = value.operator
  if (
    typeof value.content !== 'string' ||
    typeof grant.id !== 'string' ||
    typeof grant.account_id !== 'string' ||
    typeof grant.source !== 'string' || !/^source:[a-f0-9]{64}$/.test(grant.source) ||
    typeof grant.request !== 'string' || !/^request:[a-f0-9]{64}$/.test(grant.request) ||
    typeof grant.estimate_micro_usd !== 'number' || !Number.isSafeInteger(grant.estimate_micro_usd) || grant.estimate_micro_usd <= 0 ||
    typeof grant.authorized_at !== 'string' ||
    typeof operator.account_id !== 'string' ||
    typeof operator.ai_write !== 'boolean'
  ) {
    throw new P1AcceptanceError('authorization_mismatch')
  }
  return {
    content: value.content,
    operator: { account_id: operator.account_id, ai_write: operator.ai_write },
    grant: {
      id: grant.id,
      account_id: grant.account_id,
      source: `source:${grant.source.slice(7)}`,
      request: `request:${grant.request.slice(8)}`,
      estimate_micro_usd: grant.estimate_micro_usd,
      authorized_at: grant.authorized_at,
    },
  }
}

async function writeReceipt(path: string, value: unknown): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try {
    await file.writeFile(JSON.stringify(value, null, 2), 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
}

/**
 * operator/grant 由受控本機入口核對；沒有 HTTP 路由，也不接受任意模型或指令覆寫。
 * directory 是同一grant固定保留的私有receipt路徑。中斷／unknown不得刪attempt重跑。
 */
export async function runP1Acceptance(
  input: P1AcceptanceInput,
  directory: string,
  invoke: (request: ClairicRequest) => Promise<unknown>
): Promise<P1AcceptanceOutcome> {
  const { grant, operator, content } = input
  if (!grant.id || !operator.ai_write || operator.account_id !== grant.account_id || !/^[a-f0-9]{32}$/.test(grant.account_id)) {
    throw new P1AcceptanceError('authorization_mismatch')
  }
  const request = buildClairicCandidateRequest(content)
  const estimate = estimateCall(MODEL_SELECTORS.clairic, request.input)
  if (
    request.selector !== MODEL_SELECTORS.clairic ||
    grant.source !== `source:${await sha256(content)}` ||
    grant.request !== `request:${await sha256(JSON.stringify(request))}` ||
    estimate !== grant.estimate_micro_usd ||
    !Number.isFinite(Date.parse(grant.authorized_at))
  ) {
    throw new P1AcceptanceError('request_changed')
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    // 不覆寫的attempt是dispatch前持久化的單次閘門；沒有TTL或「失敗釋放」。
    await writeReceipt(join(directory, 'attempt.json'), {
      grant,
      prompt_version: CLAIRIC_CANDIDATE_PROMPT_VERSION,
      request,
      state: 'started',
      started_at: new Date().toISOString(),
      reserved_micro_usd: estimate,
      accounting_scope: 'separately_authorized_operator_call_not_website_job',
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return { status: 'already_attempted' }
    throw error
  }
  let response: unknown
  try {
    response = await invoke(request)
  } catch (error) {
    await writeReceipt(join(directory, 'uncertain.json'), {
      state: 'unknown',
      reserved_micro_usd: estimate,
      actual_micro_usd: null,
      error_name: error instanceof Error && ['Error', 'TypeError', 'AbortError', 'TimeoutError', 'AiInternalError', 'InferenceUpstreamError'].includes(error.name) ? error.name : null,
      provider_code: error instanceof Error ? (/^(\d{3,6}):/.exec(error.message)?.[1] ?? null) : null,
      recorded_at: new Date().toISOString(),
    })
    return { status: 'provider_uncertain' }
  }
  const actual = actualCallCost(MODEL_SELECTORS.clairic, response)
  await writeReceipt(join(directory, 'response.json'), {
    response,
    provenance: await requestProvenance(MODEL_SELECTORS.clairic, request.input, response),
    usage_state: actual === null ? 'unknown' : 'settled',
    reserved_micro_usd: actual === null ? estimate : 0,
    actual_micro_usd: actual,
    received_at: new Date().toISOString(),
  })
  return { status: 'received', actual_micro_usd: actual }
}
