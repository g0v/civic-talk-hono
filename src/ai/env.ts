import type { AuthBindings } from '../api/types'

/** 與正式入口分離；SOURCE_DB 僅由 source repository 讀取。 */
export type EvidenceBindings = AuthBindings & {
  DB: D1Database
  SOURCE_DB: D1Database
  AI: Ai
  EVIDENCE_WORKFLOW: Workflow<{ jobId: string }>
}
