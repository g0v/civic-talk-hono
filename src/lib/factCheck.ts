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
export type FactCheckErrorKind = 'upstream_unavailable' | 'generic'

export function factCheckErrorKind(body: unknown): FactCheckErrorKind {
  if (!body || typeof body !== 'object') return 'generic'
  const record = body as Record<string, unknown>
  if (record.status === 'error' && record.error === 'UPSTREAM_UNAVAILABLE') return 'upstream_unavailable'
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
 * 上游查核 API。改用 POST 把參數放進 JSON body（PR #88 檢閱建議）——素材內容可以很長，
 * 放在 query string 會撞上網址長度上限。上游已對 `https://civic.vtaiwan.tw` 開放
 * POST 與 `Content-Type` 的 CORS preflight。
 */
export const FACT_CHECK_ENDPOINT = 'https://check.vtaiwan.tw/api/fact-check'

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
  if (result.factuality === 0 || (result.factuality < 0.5 && result.confidence > 0.5)) return 'factuality'
  return null
}

export function factCheckAllowsPosting(result: FactCheckResult): boolean {
  return factCheckBlockReason(result) === null
}
