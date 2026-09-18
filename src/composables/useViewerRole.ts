import { readonly, ref } from 'vue'

/** 使用者瀏覽 Civic Talk 時選擇的介面角色；與登入帳號的權限角色無關。 */
export type ViewerRole = 'citizen' | 'volunteer'

const STORAGE_KEY = 'civic_viewer_role'
const viewerRole = ref<ViewerRole>('citizen')

function normalizeViewerRole(value: string | null): ViewerRole {
  return value === 'volunteer' ? 'volunteer' : 'citizen'
}

/**
 * 全站共用的檢視角色。
 *
 * 模組層級的 ref 讓同一頁的 navbar 與內容即時同步；localStorage 則讓目前選擇在
 * 整頁換頁後仍保留。SSR 固定使用 citizen，且所有寫入都由瀏覽器端觸發，避免
 * 跨請求共享可變狀態及 hydration mismatch。
 */
export function useViewerRole() {
  return {
    viewerRole: readonly(viewerRole),

    /** hydration 後讀取先前選擇。 */
    initViewerRole(): void {
      if (typeof window === 'undefined') return
      try {
        viewerRole.value = normalizeViewerRole(window.localStorage.getItem(STORAGE_KEY))
      } catch {
        viewerRole.value = 'citizen'
      }
    },

    setViewerRole(next: ViewerRole): void {
      if (typeof window === 'undefined') return
      viewerRole.value = next
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* localStorage 不可用時，仍保留目前頁面的選擇。 */
      }
    },
  }
}
