import { extractClairicClaimAnchors, type ClairicEvidenceInput, type EvidenceExtraction, type ValidatedRawAnchor } from './evidence'
import { buildEvidenceCandidates, type EvidenceCandidateSnapshot } from './evidenceCandidates'
import { parseClairicResponse } from './models'

export const CLAIM_EXTRACTION_VERSION = 'evidence-3-claim-context' as const

export interface ClaimSnapshot extends EvidenceCandidateSnapshot {
  readonly anchor_index_kind: 'value' | 'span'
  readonly anchors: readonly ValidatedRawAnchor[]
}

export interface ClaimExtraction extends EvidenceExtraction {
  readonly candidates: ClaimSnapshot
}

export class EvidenceMappingError extends Error {
  constructor() { super('evidence_candidate_mapping_mismatch') }
}

/** 模型raw不改寫；以同一驗證器接受的錨點建立正式claim與獨立context。 */
export async function extractEvidenceClaims(input: Omit<ClairicEvidenceInput, 'field'>): Promise<ClaimExtraction> {
  parseClairicResponse(input.response, input.state)
  const normalized = extractClairicClaimAnchors(input)
  const snapshot = await buildEvidenceCandidates(input.material_id, input.content, normalized.anchors)
  const evidence = snapshot.claims.map(claim => {
    const original = normalized.evidence.find(item => item.expanded_span.start === claim.span.start && item.expanded_span.end === claim.span.end)
    const raw = snapshot.raw.find(item => item.claim_id === claim.id)
    const context = snapshot.contexts.find(item => item.id === raw?.context_id)
    if (!original || !context) throw new EvidenceMappingError()
    return { ...original, id: claim.id, context }
  })
  return {
    status: normalized.status,
    evidence,
    rejected: normalized.rejected,
    duplicates: normalized.duplicates,
    state_mapping: normalized.state_mapping,
    candidates: { ...snapshot, anchors: normalized.anchors, anchor_index_kind: normalized.anchor_index_kind },
  }
}
