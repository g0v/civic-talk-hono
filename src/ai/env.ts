import type { AuthBindings } from '../api/types'

/** SOURCE_DB 僅由 source repository 讀取。 */
export type EvidenceBindings = AuthBindings & {
  DB: D1Database
  SOURCE_DB: D1Database
  AI: Ai
  EVIDENCE_WORKFLOW: Workflow<{ jobId: string }>
  EVIDENCE_API_ENABLED?: string
}

/** Worker 入口可省略 SOURCE_DB；未指定時以業務 DB 作來源。 */
export type EvidenceRuntimeBindings = Omit<EvidenceBindings, 'SOURCE_DB'> & {
  SOURCE_DB?: D1Database
}

/** 缺少必要 capability 或認證設定時，不進入任何證據處理流程。 */
export function hasEvidenceBindings(env: Partial<EvidenceRuntimeBindings>): boolean {
  return Boolean(
    env.DB &&
    env.DB_AUTH &&
    env.AI &&
    env.EVIDENCE_WORKFLOW &&
    env.BETTER_AUTH_URL &&
    env.BETTER_AUTH_SECRET &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GITHUB_CLIENT_ID &&
    env.GITHUB_CLIENT_SECRET
  )
}

export function withEvidenceSource<T extends { DB: D1Database; SOURCE_DB?: D1Database }>(env: T): T & { SOURCE_DB: D1Database } {
  return env.SOURCE_DB != null ? (env as T & { SOURCE_DB: D1Database }) : { ...env, SOURCE_DB: env.DB }
}
