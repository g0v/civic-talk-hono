import { MODEL_VERSIONS } from './models'

// 保留操作者驗收入口的相容名稱；正式builder只有models.ts這一份。
export { buildClairicRequest as buildClairicCandidateRequest, CLAIRIC_INSTRUCTIONS as CLAIRIC_CANDIDATE_INSTRUCTIONS } from './models'
export const CLAIRIC_CANDIDATE_PROMPT_VERSION = MODEL_VERSIONS.clairic_prompt
