import { createAuthClient } from 'better-auth/client'

/**
 * client 端的 Better Auth 入口，**延遲建立**。
 *
 * 🚫 不可以在模組頂層 `createAuthClient()`：這個模組會被 Admin.vue 匯入，而 Admin.vue
 * 又被 src/index.ts（SSR）匯入——模組頂層的程式碼會在 SSR 期間執行，而 client 建構
 * 過程可能讀 window.location 來推 baseURL，那就違反不變量 3 了。改成第一次真的要用
 * （使用者按下登入／登出）才建立，那時一定在瀏覽器裡。
 *
 * 刻意不掛 adminClient plugin——本站不做成員管理（見 src/auth/createAuth.ts 與
 * AGENTS.md 不變量 11），掛了只會在前端多出用不到、也不該用的管理動作。
 * baseURL 留白：同源部署時 better-auth 會自動用 window.location.origin。
 */
let client: ReturnType<typeof createAuthClient> | null = null

function getAuthClient() {
  if (!client) client = createAuthClient()
  return client
}

export type AppRole = 'user' | 'admin' | 'super-admin'

/** 與伺服器端 /api/me 的回應形狀一致（見 src/auth/authorization.ts 的 AuthContext） */
export interface AuthSession {
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
  role: AppRole
  /** 帳號是否已被停權（vTaiwan-hono admin 管理）。停權者伺服器端寫入一律 403。 */
  banned: boolean
}

/**
 * 讀取目前登入者。未登入回 null；其他錯誤 throw——
 * 「未登入」與「系統壞掉」要分得開，後者被壓成 null 會讓故障看起來像登出。
 */
export async function loadAuthSession(): Promise<AuthSession | null> {
  const res = await fetch('/api/me')
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Failed to load auth session: ${res.status}`)
  return (await res.json()) as AuthSession
}

export function isAdminSession(session: AuthSession | null | undefined): boolean {
  return session?.role === 'admin' || session?.role === 'super-admin'
}

export async function signInWith(provider: 'google' | 'github', callbackURL: string): Promise<void> {
  await getAuthClient().signIn.social({ provider, callbackURL })
}

export async function signOut(): Promise<void> {
  await getAuthClient().signOut()
}
