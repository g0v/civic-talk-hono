import { readonly, ref } from 'vue'
import { loadAuthSession, signOut, type AuthSession } from '../client/auth-session'

/**
 * 全站共用的登入狀態（client-only）。
 *
 * 為什麼放模組層級：同一頁往往有兩個以上的消費者（AppHeader 的登入狀態列 + 頁面上的
 * 投稿表單），各自打一次 `/api/me` 是浪費。這裡用模組層級的 ref + in-flight promise
 * 去重，一個頁面生命週期只打一次。
 *
 * 🚫 **SSR 期間絕不寫入**（那會變成跨請求共享的可變狀態，違反不變量 3）：唯一的寫入點
 * 是 `ensureAuthSession()`，而它開頭就用 `typeof window === 'undefined'` 擋掉伺服器端。
 * 所以 SSR 永遠看到 `'loading'`——這正是我們要的：伺服器端不猜登入狀態，SSR 與 hydration
 * 首幀畫同一個骨架，不會有 mismatch。
 */
export type AuthState = 'loading' | 'anonymous' | 'signed-in'

const state = ref<AuthState>('loading')
const session = ref<AuthSession | null>(null)
/** 讀 session 失敗（壞掉，不是未登入）——UI 該說明白，而不是靜靜當成登出 */
const failed = ref(false)

let inflight: Promise<void> | null = null

async function fetchSession(): Promise<void> {
  failed.value = false
  try {
    const current = await loadAuthSession()
    session.value = current
    state.value = current ? 'signed-in' : 'anonymous'
  } catch {
    session.value = null
    state.value = 'anonymous'
    failed.value = true
  }
}

export function useAuth() {
  return {
    authState: readonly(state),
    session: readonly(session),
    authFailed: readonly(failed),

    /** 只讀一次；重複呼叫會共用同一個請求。onMounted 呼叫它就對了。 */
    ensureAuthSession(): Promise<void> {
      if (typeof window === 'undefined') return Promise.resolve()
      if (!inflight) inflight = fetchSession()
      return inflight
    },

    /** 強制重讀（登入／登出後）。 */
    refreshAuthSession(): Promise<void> {
      if (typeof window === 'undefined') return Promise.resolve()
      inflight = fetchSession()
      return inflight
    },

    /** 登出後整頁重載：最省事也最不會漏掉任何頁面狀態的作法。 */
    async signOutAndReload(): Promise<void> {
      await signOut()
      window.location.reload()
    },
  }
}
