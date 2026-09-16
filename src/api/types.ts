import type { Hono } from 'hono'

export type AppBindings = {
  /** 業務資料庫 vtaiwan-civic-talks——所有資料表一律 ct_ 前綴 */
  DB: D1Database
  /**
   * 共用認證資料庫 vtaiwan-auth（Better Auth 的 user／session／account／verification）。
   * schema 由 ../vTaiwan-hono 維護，本站只是消費端：不建表、不改表、不寫 user.role。
   * 見 AGENTS.md 不變量 11。
   */
  DB_AUTH: D1Database
  /** Better Auth 對外網址，逐環境不同（本機 http://localhost:5173） */
  BETTER_AUTH_URL: string
  /** 簽章密鑰，與 vTaiwan-hono 共用同一個值 */
  BETTER_AUTH_SECRET: string
  /** Google OAuth 憑證，與 vTaiwan-hono 共用同一組應用程式 */
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  /** GitHub OAuth 憑證，與 vTaiwan-hono 共用同一組應用程式 */
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  /** OpenRouter API key；只供 issue #29 投稿安全審查使用，內容生成不得呼叫模型。 */
  OPEN_ROUTER_API_KEY?: string
  /**
   * fact-check-core 的 Service Binding（#92）。core 沒有公開 route，本站只能這樣呼叫；
   * 由 `wrangler.jsonc` 的 `services` 提供。宣告成 optional：缺少時端點回 503 而不是崩潰。
   */
  FACT_CHECK_CORE?: Fetcher
  /**
   * 簽發／驗證 /api/fact-check 短效 token 的密鑰（#92）。原始值只留在 Worker 內——
   * SSR 注入前端的只有以它簽出的 `v1.<payload>.<signature>`，見 src/lib/factCheckToken.ts。
   */
  CIVIC_TALK_API_KEY?: string
  /** 用於執行時讀取 public/rules/community-guidelines.md */
  ASSETS?: {
    fetch: (request: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }
}

export type App = Hono<{ Bindings: AppBindings }>
