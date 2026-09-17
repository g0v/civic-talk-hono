import { ref } from 'vue'

/**
 * 送出防重入（#97）：請求進行中重複按下送出時直接忽略。
 *
 * `run()` 會在呼叫 callback **之前**同步把 `pending` 設為 true，所以即使 Vue 還沒把
 * 送出鈕的 `disabled` 更新到 DOM（同一 tick 的第二次點擊仍會進到 handler），第二次呼叫
 * 也會在此被擋下；callback 結束後（含拋錯）一律還原。
 */
export function useSubmitGuard() {
  const pending = ref(false)

  async function run(fn: () => Promise<void>): Promise<void> {
    if (pending.value) return
    pending.value = true
    try {
      await fn()
    } finally {
      pending.value = false
    }
  }

  return { pending, run }
}
