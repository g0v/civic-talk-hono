import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { adminAc, defaultAc, userAc } from 'better-auth/plugins/admin/access'
import type { AppBindings } from '../api/types'

/**
 * admin plugin 的角色存取控制表：
 * - `user`        → userAc（空：無任何 admin 操作權限）
 * - `admin`       → 自訂 role，只給 user:['ban']——可停權一般用戶，無法升降角色
 * - `super-admin` → adminAc（完整存取）
 *
 * userAc = newRole({ user: [], session: [] }) ——內建的「空」角色，
 * 不能用來代表「有 ban 權限的管理員」（banUser 要求 user:['ban']，空 role 會 FORBIDDEN）。
 */
const adminRoleAccess = {
  user: userAc,
  admin: defaultAc.newRole({ user: ['ban'] }),
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
