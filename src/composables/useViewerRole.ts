import { readonly, ref } from 'vue'

/** 使用者瀏覽 Civic Talk 時選擇的介面角色；與登入帳號的權限角色無關。 */
export type ViewerRole = 'citizen' | 'volunteer'

const STORAGE_KEY = 'civic_viewer_role'
const SESSION_STORAGE_KEY = 'civic_viewer_role_session'
const viewerRole = ref<ViewerRole>('citizen')
const preferredViewerRole = ref<ViewerRole | null>(null)

function parseViewerRole(value: string | null): ViewerRole | null {
  return value === 'citizen' || value === 'volunteer' ? value : null
}

/**
 * 全站共用的檢視角色。
 *
 * 模組層級的 ref 讓同一頁的 navbar 與內容即時同步；sessionStorage 讓未記住的選擇
 * 在目前分頁換頁後仍保留，localStorage 只保存使用者明確選擇記住的偏好。SSR 固定
 * 使用 citizen，且所有寫入都由瀏覽器端觸發，避免跨請求共享可變狀態及 hydration mismatch。
 */
export function useViewerRole() {
  return {
    viewerRole: readonly(viewerRole),
    preferredViewerRole: readonly(preferredViewerRole),

    /** hydration 後讀取先前選擇。 */
    initViewerRole(): void {
      if (typeof window === 'undefined') return
      try {
        const preferred = parseViewerRole(window.localStorage.getItem(STORAGE_KEY))
        const sessionRole = parseViewerRole(window.sessionStorage.getItem(SESSION_STORAGE_KEY))
        preferredViewerRole.value = preferred
        viewerRole.value = preferred ?? sessionRole ?? 'citizen'
      } catch {
        preferredViewerRole.value = null
        viewerRole.value = 'citizen'
      }
    },

    /**
     * 未指定 remember 時，沿用使用者既有的記憶偏好：曾選擇記住者會更新偏好，
     * 尚未選擇記住者只在目前瀏覽分頁保留。
     */
    setViewerRole(next: ViewerRole, options?: { remember?: boolean }): void {
      if (typeof window === 'undefined') return
      viewerRole.value = next
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, next)
        const shouldRemember = options?.remember ?? preferredViewerRole.value !== null
        if (shouldRemember) {
          window.localStorage.setItem(STORAGE_KEY, next)
          preferredViewerRole.value = next
        } else if (options?.remember === false) {
          window.localStorage.removeItem(STORAGE_KEY)
          preferredViewerRole.value = null
        }
      } catch {
        /* browser storage 不可用時，仍保留目前頁面的選擇。 */
      }
    },
  }
}
