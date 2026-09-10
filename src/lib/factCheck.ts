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

export function buildFactCheckUrl(content: string, sourceUrl: string): string {
  const params = new URLSearchParams({ text: content.trim() })
  const trimmedSourceUrl = sourceUrl.trim()
  if (trimmedSourceUrl) params.set('url', trimmedSourceUrl)
  return `https://check.vtaiwan.tw/api/fact-check?${params.toString()}`
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
