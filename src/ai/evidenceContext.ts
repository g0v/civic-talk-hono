import { sliceEvidenceSpan, type Evidence } from './evidence'

export const CLAIM_CONTEXT_RULE =
  'Each quote is the selected claim. Its optional context is an original surrounding passage for attribution and necessary qualifications, not an additional selected claim. Do not attribute other speakers or other propositions in context to the quote, infer endorsement from co-occurrence, or cite a context as if it were a selected claim.'

export class EvidenceContextError extends Error {
  constructor() { super('generation_evidence_mismatch') }
}

/** 生成邊界只接受可切回同一素材、且包含主張的原文語境。 */
export function validateEvidenceContext(item: Evidence, content: string): void {
  const context = item.context
  if (context === undefined) return
  if (!context || typeof context.text !== 'string' || !context.text || !context.span || context.span.unit !== 'utf16' ||
      context.span.start > item.expanded_span.start || context.span.end < item.expanded_span.end ||
      sliceEvidenceSpan(content, context.span) !== context.text) throw new EvidenceContextError()
}
