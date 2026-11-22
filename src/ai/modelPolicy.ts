import { PRICING_VERSION } from './pricing'

// Selector不是不可變權重版本；provider未回報revision時不得補造。
export const MODEL_SELECTORS = {
  clairic: '@cf/cloudflare/clairic',
  clef: '@cf/cloudflare/clef',
  generation: '@cf/google/gemma-4-26b-a4b-it',
} as const

export const MODEL_VERSIONS = {
  clairic_prompt: 'claims-list-p1-v1',
  clef_prompt: 'symmetric-four-way-v3-claim-context',
  clef_batching: 'canonical-byte-budget-v1',
  generation_prompt: 'specialized-evidence-v18-local-evidence-ids',
  generation_schema: 'specialized-cited-v8-local-evidence-ids',
  generation_input: 'section-values-v9-local-evidence-ids',
  generation_completion_prompt: 'missing-fields-only-v6-local-evidence-ids',
  generation_completion_schema: 'cited-field-patches-v3-local-evidence-ids',
  pricing: PRICING_VERSION,
} as const

export const CLEF_EVIDENCE_ID_PREFIX = ' Evidence IDs: '
export const CLEF_QUESTION_PREFIX = 'q'
export const CLEF_MAX_QUESTIONS = 64
// 完整JSON UTF-8 bytes保守上限，不是token數。
export const CLEF_MAX_REQUEST_BYTES = 12_288
export const CLAIRIC_MAX_STATE_BYTES = 48 * 1024
