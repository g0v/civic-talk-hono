import { createAuth } from './createAuth'
import type { AppBindings } from '../api/types'

/** 角色沿用 vTaiwan 的三級制；欄位就是共用 auth DB 的 user.role */
export type AppRole = 'user' | 'admin' | 'super-admin'

export interface AuthContext {
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
  role: AppRole
  /**
   * 帳號是否被停權。由 vTaiwan-hono 的 admin plugin 管理（user.banned 欄位）；
   * 本站只讀取。被停權的使用者不得執行任何寫入動作（見 requireUser()）。
   */
  banned: boolean
}

/**
 * 角色字串正規化：認不得的值（null、空字串、未來新增的角色）一律當成一般使用者。
 * 寧可少給權限，也不要把未知字串當成管理員。
 */
export function resolveRole(role: string | null | undefined): AppRole {
  return role === 'admin' || role === 'super-admin' ? role : 'user'
}

/**
 * 管理員判定（admin 或 super-admin）——/admin 路由守衛與所有管理端點的單一來源。
 *
 * 本站刻意不區分 admin 與 super-admin：兩者差異在 vTaiwan-hono 是「能不能管成員」，
 * 而本站不做成員管理（不變量 11），所以只有「是不是管理員」這一個問題。
 */
export function isAdminRole(role: AppRole): boolean {
  return role === 'admin' || role === 'super-admin'
}

/**
 * 讀出目前登入者。未登入回 null。
 *
 * ✅ 這是伺服器端行為（從請求的 Cookie 標頭解析），**SSR 期間可以用**，
 * 不受「SSR 不得碰瀏覽器 API」限制——不變量 3 禁的是 localStorage／document／window。
 */
export async function getAuthContext(env: AppBindings, headers: Headers): Promise<AuthContext | null> {
  const auth = createAuth(env)
  const session = await auth.api.getSession({ headers })
  if (!session) return null

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    role: resolveRole(session.user.role),
    // Better Auth admin plugin 在 banExpires 到期後會自動把 banned 改回 false，
    // 所以直接信任 session.user.banned，不需要額外對照 banExpires。
    banned: session.user.banned === true,
  }
}

/**
 * 同 getAuthContext，但把例外（缺 DB_AUTH 綁定、auth 表不存在、初始化失敗）壓成「未登入」。
 *
 * 授權判斷用這支：寧可誤判為未登入回 401，也不要讓例外冒泡成 500——後者會讓
 * 「本機 dev 沒有 auth 表」這種環境問題看起來像端點壞掉。
 */
export async function tryGetAuthContext(env: AppBindings, headers: Headers): Promise<AuthContext | null> {
  try {
    return await getAuthContext(env, headers)
  } catch (error) {
    // 本機 npm run dev 最常見的原因是 DB_AUTH 是空的本機模擬庫（auth 表只存在遠端）——
    // 要實測登入請用 npm run dev:remote。
    console.error('Failed to resolve auth context:', error)
    return null
  }
}
