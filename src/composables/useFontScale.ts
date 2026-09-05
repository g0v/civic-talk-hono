/**
 * 全站字級切換（client-only，issue #79）。
 * 偏好存 localStorage.civic_font：'normal' | 'large'，null = normal。
 * 切換時在 <html> 掛 `font-large` class，由 app.css 放大字級 token。
 * SSR 期間不碰 DOM；防 FOUC 的 inline script 見 src/ssr/render.ts。
 */
import { ref, readonly } from 'vue'

const STORAGE_KEY = 'civic_font'
const fontLarge = ref(false)

function applyFontScale(large: boolean) {
  fontLarge.value = large
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('font-large', large)
  }
}

export function useFontScale() {
  return {
    fontLarge: readonly(fontLarge),

    /** 在 onMounted 呼叫一次，讀 localStorage（inline script 已先掛 class，這裡只同步狀態）。 */
    init() {
      if (typeof window === 'undefined') return
      let stored: string | null = null
      try {
        stored = localStorage.getItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      applyFontScale(stored === 'large')
    },

    /** 切換正常／放大字級，並持久化偏好。 */
    toggle() {
      const next = !fontLarge.value
      applyFontScale(next)
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'large' : 'normal')
      } catch {
        /* ignore */
      }
    },
  }
}
