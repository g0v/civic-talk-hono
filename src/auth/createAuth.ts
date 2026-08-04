import { betterAuth } from 'better-auth'
import type { AppBindings } from '../api/types'

/**
 * 每請求新建一個 Better Auth 實例（Workers 不能跨請求共用可變狀態）。
 *
 * 🚫 **刻意不開 admin plugin。** vTaiwan-hono 開了它是為了做成員管理；開了就會在
 * `/api/auth/admin/*` 長出 set-role／list-users／remove-user 等**會寫入共用 auth DB
 * （vtaiwan-auth）**的端點，而本站不做二次驗證（step-up），保護強度不如 vTaiwan-hono。
 * 角色管理一律留在 vTaiwan-hono——見 AGENTS.md 不變量 11 與 issue #5。
 *
 * 因此這裡改用 `user.additionalFields` 把**既有的** role 欄位唯讀讀出來：
 * 該欄位是 vTaiwan-hono 的 admin plugin 建立並維護的，本站只讀不寫。
 */
export function createAuth(env: AppBindings) {
  return betterAuth({
    appName: 'Civic Talk',
    database: env.DB_AUTH,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    user: {
      additionalFields: {
        // input: false —— 不接受任何請求端寫入，杜絕自我升權的路徑。
        role: { type: 'string', required: false, input: false },
      },
    },
    account: {
      accountLinking: {
        // 與 vTaiwan-hono 一致：同一個 email 不論用 Google 或 GitHub 登入，
        // 都連到同一個 user，不會各自開一個帳號。
        trustedProviders: ['google', 'github'],
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
  })
}
