import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { adminAc, userAc } from 'better-auth/plugins/admin/access'
import type { AppBindings } from '../api/types'

/**
 * admin plugin 的角色存取控制表：
 * - `user`        → userAc（空：無任何 admin 操作權限）
 * - `admin`       → userAc（同上：可進管理後台、看資料，但無 ban 權限）
 * - `super-admin` → adminAc（完整存取，含 ban/unban）
 *
 * 對齊 vTaiwan-hono：ban 權限保留給 super-admin，admin 只有讀取能力。
 */
const adminRoleAccess = {
  user: userAc,
  admin: userAc,
  'super-admin': adminAc,
}

/**
 * 每請求新建一個 Better Auth 實例（Workers 不能跨請求共用可變狀態）。
 *
 * admin plugin 開放 ban/unban 供濫用回報審核使用（#21，AGENTS.md 不變量 5／11）。
 * 危險端點（set-role、remove-user、impersonate）在 src/api/auth.ts 以路由前攔截。
 */
export function createAuth(env: AppBindings) {
  return betterAuth({
    appName: 'Civic Talk',
    database: env.DB_AUTH,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    user: {
      additionalFields: {
        // input: false —— 不接受任何請求端直接寫入；寫入走 admin plugin API（不變量 11）。
        role: { type: 'string', required: false, input: false },
        banned: { type: 'boolean', required: false, input: false },
        banReason: { type: 'string', required: false, input: false },
        banExpires: { type: 'date', required: false, input: false },
      },
    },
    account: {
      accountLinking: {
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
    plugins: [
      admin({
        adminRoles: ['super-admin', 'admin'],
        roles: adminRoleAccess,
      }),
    ],
  })
}
