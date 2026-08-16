/**
 * 全站暗黑模式（client-only）。
 * 偏好存 localStorage.civic_dark：'light' | 'dark'，null = 跟系統走。
 * SSR 期間不寫 DOM，返回 isDark = false。
 */
import { ref, readonly } from 'vue'

const STORAGE_KEY = 'civic_dark'
const isDark = ref(false)
let mediaQuery: MediaQueryList | null = null

function applyDark(dark: boolean) {
  isDark.value = dark
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', dark)
  }
}

function getSystemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function useDarkMode() {
  return {
    isDark: readonly(isDark),

    /** 在 onMounted 呼叫一次，讀 localStorage 或跟系統走。 */
    init() {
      if (typeof window === 'undefined') return
      const stored = (() => {
        try {
          return localStorage.getItem(STORAGE_KEY)
        } catch {
          return null
        }
      })()
      applyDark(stored === 'dark' || (stored === null && getSystemDark()))

      // 若無手動偏好，監聽系統變化
      if (stored === null && !mediaQuery) {
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        mediaQuery.addEventListener('change', e => {
          const current = (() => {
            try {
              return localStorage.getItem(STORAGE_KEY)
            } catch {
              return null
            }
          })()
          if (current === null) applyDark(e.matches)
        })
      }
    },

    /** 切換亮/暗，並持久化手動偏好。 */
    toggle() {
      const next = !isDark.value
      applyDark(next)
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light')
      } catch {}
    },
  }
}
