import { expandEvidenceCandidateRanges, type Span } from './evidence'
import { sha256 } from './source'

export const EVIDENCE_CANDIDATE_VERSION = 'e1-candidates-2' as const

export type CandidateId<K extends 'claim' | 'context'> = `${K}:${number}:${string}:${number}:${number}`

export interface CandidatePassage<K extends 'claim' | 'context'> {
  readonly id: CandidateId<K>
  readonly text: string
  readonly span: Readonly<Span<'utf16'>>
}

/** 上游已驗證的素材 UTF-16 定位；index 保留原始 raw 索引，不冒稱 provider 單位。 */
export interface ValidatedCandidateAnchor {
  readonly index: number
  readonly span: Readonly<Span<'utf16'>>
}

export interface CandidateRaw extends ValidatedCandidateAnchor {
  readonly text: string
  readonly claim_id: CandidateId<'claim'>
  readonly context_id: CandidateId<'context'>
}

export interface EvidenceCandidateSnapshot {
  readonly version: typeof EVIDENCE_CANDIDATE_VERSION
  readonly verification: 'unreviewed'
  readonly material_id: number
  readonly content_hash: string
  readonly raw: readonly CandidateRaw[]
  readonly claims: readonly CandidatePassage<'claim'>[]
  readonly contexts: readonly CandidatePassage<'context'>[]
}

/**
 * 對應已接受的 raw；素材 ID 為正整數、raw 索引唯一且定位有效的前置條件由上游保證。
 * 不解析 provider response；原 provider spans／拒收診斷由共用驗證器保存。
 */
export async function buildEvidenceCandidates(material_id: number, content: string, anchors: readonly ValidatedCandidateAnchor[]): Promise<EvidenceCandidateSnapshot> {
  const content_hash = await sha256(content)
  // Maps 僅於本次建構累積，按原文範圍去重；所有 raw 仍各有一列對應。
  const claims = new Map<CandidateId<'claim'>, CandidatePassage<'claim'>>()
  const contexts = new Map<CandidateId<'context'>, CandidatePassage<'context'>>()
  const raw = [...anchors].sort((a, b) => a.index - b.index).map(anchor => {
    const { claim, context } = expandEvidenceCandidateRanges(content, anchor.span.start, anchor.span.end)
    const claim_id = `claim:${material_id}:${content_hash}:${claim.start}:${claim.end}` as const
    const context_id = `context:${material_id}:${content_hash}:${context.start}:${context.end}` as const
    claims.set(claim_id, { id: claim_id, text: content.slice(claim.start, claim.end), span: claim })
    contexts.set(context_id, { id: context_id, text: content.slice(context.start, context.end), span: context })
    return { index: anchor.index, text: content.slice(anchor.span.start, anchor.span.end), span: { ...anchor.span }, claim_id, context_id }
  })
  const bySpan = (a: CandidatePassage<'claim' | 'context'>, b: CandidatePassage<'claim' | 'context'>) => a.span.start - b.span.start || a.span.end - b.span.end
  return {
    version: EVIDENCE_CANDIDATE_VERSION,
    verification: 'unreviewed',
    material_id,
    content_hash,
    raw,
    claims: [...claims.values()].sort(bySpan),
    contexts: [...contexts.values()].sort(bySpan),
  }
}
