export type FactCheckStatus = 'completed' | 'partial' | 'blocked'
export type FactCheckModerationDecision = 'allow' | 'review' | 'block' | 'skipped'
export type FactCheckVerdict = 'supported' | 'mostly_supported' | 'mixed' | 'mostly_refuted' | 'refuted' | 'insufficient_evidence'

export interface FactCheckModeration {
  decision: FactCheckModerationDecision
}

export interface FactCheckResult {
  status: FactCheckStatus
  moderation: FactCheckModeration
  verdict: FactCheckVerdict | null
  factuality: number | null
  confidence: number | null
  feedback: string
}
export type FactCheckErrorKind = 'session_expired' | 'token_expired' | 'rate_limited' | 'upstream_unavailable' | 'generic'

/**
 * 把 /api/fact-check 的錯誤回應分類成前端可對應到不同文案的種類。本站守門錯誤是
 * `{ error: 'CODE' }`，core 的錯誤是 `{ status: 'error', error: 'UPSTREAM_UNAVAILABLE', ... }`。
 * `status` 是 HTTP 狀態碼：body 不是 JSON（例如 HTML 錯誤頁）時，502／503 仍要歸為上游故障。
 */
export function factCheckErrorKind(body: unknown, status?: number): FactCheckErrorKind {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (record.error === 'UNAUTHORIZED') return 'session_expired'
    if (record.error === 'TOKEN_EXPIRED' || record.error === 'INVALID_TOKEN') return 'token_expired'
    if (record.error === 'RATE_LIMITED') return 'rate_limited'
    if (record.status === 'error' && record.error === 'UPSTREAM_UNAVAILABLE') return 'upstream_unavailable'
  }
  if (status === 502 || status === 503) return 'upstream_unavailable'
  return 'generic'
}

const FACT_CHECK_STATUSES: readonly FactCheckStatus[] = ['completed', 'partial', 'blocked']
const MODERATION_DECISIONS: readonly FactCheckModerationDecision[] = ['allow', 'review', 'block', 'skipped']
const VERDICTS: readonly FactCheckVerdict[] = ['supported', 'mostly_supported', 'mixed', 'mostly_refuted', 'refuted', 'insufficient_evidence']

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

export function parseFactCheckResult(value: unknown): FactCheckResult | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const moderation = record.moderation
  const moderationRecord = moderation && typeof moderation === 'object' ? (moderation as Record<string, unknown>) : null
  const factuality = record.factuality
  const confidence = record.confidence
  if (!isOneOf(record.status, FACT_CHECK_STATUSES)) return null
  if (!moderationRecord || !isOneOf(moderationRecord.decision, MODERATION_DECISIONS)) return null
  if (record.verdict !== null && !isOneOf(record.verdict, VERDICTS)) return null
  if (typeof record.feedback !== 'string') return null
  if (factuality !== null && (typeof factuality !== 'number' || !Number.isFinite(factuality) || factuality < 0 || factuality > 1)) return null
  if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return null
  return {
    status: record.status,
    moderation: { decision: moderationRecord.decision },
    verdict: (record.verdict as FactCheckVerdict | null | undefined) ?? null,
    factuality: (factuality as number | null | undefined) ?? null,
    confidence: (confidence as number | null | undefined) ?? null,
    feedback: record.feedback,
  }
}

/**
 * 站內查核 API（issue #92）：同源相對路徑，由 `/api/fact-check` 以 Service Binding
 * 轉送至 `fact-check-core`。刻意用相對路徑而非寫死正式網域——不論在正式站或預覽
 * 網址開啟，呼叫都會落在同一個 origin，不會踩到站內端點的同源 `Origin` 檢查。
 */
export const FACT_CHECK_ENDPOINT = '/api/fact-check'

/**
 * 前端回傳短效 token 時使用的標頭名稱（#92）。定義在這個 client 安全的模組（無 crypto），
 * 伺服器端模組 `factCheckToken.ts` 與 `api/factCheck.ts` 都 import 它，全專案只有一份。
 */
export const FACT_CHECK_TOKEN_HEADER = 'X-Civic-Talk-Token'

export interface FactCheckRequestBody {
  text: string
  url?: string
}

/** 只有非空的來源網址才帶 `url`，維持與 query string 版本一致的語意。 */
export function buildFactCheckRequestBody(content: string, sourceUrl: string): FactCheckRequestBody {
  const body: FactCheckRequestBody = { text: content.trim() }
  const trimmedSourceUrl = sourceUrl.trim()
  if (trimmedSourceUrl) body.url = trimmedSourceUrl
  return body
}

/**
 * 查核結果的有效性 key：內容或來源網址一改，先前的查核結果就失效。以正規化後的 request
 * body 為來源，讓 trim 與「空白來源網址不送 url」的規則兩邊一致。非空物件的 JSON 永遠
 * 不會是空字串，因此不會與重設路徑寫入的 `''` sentinel 相撞。
 */
export function factCheckInputKey(content: string, sourceUrl: string): string {
  return JSON.stringify(buildFactCheckRequestBody(content, sourceUrl))
}

export type FactCheckBlockReason = 'community_guidelines' | 'factuality' | null

export function factCheckBlockReason(result: FactCheckResult): FactCheckBlockReason {
  if (result.status !== 'completed' && result.status !== 'partial') return 'community_guidelines'
  if (result.moderation?.decision === 'block') return 'community_guidelines'
  if (result.verdict === null || result.factuality === null || result.confidence === null) return 'community_guidelines'
  if (result.factuality < 0.5 && result.confidence > 0.5) return 'factuality'
  return null
}

export function factCheckAllowsPosting(result: FactCheckResult): boolean {
  return factCheckBlockReason(result) === null
}
