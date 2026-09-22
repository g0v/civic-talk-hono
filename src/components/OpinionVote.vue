<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../l10n'
import type { OpinionVoteState, VoteValue } from '../db/queries'
import type { AuthState } from '../composables/useAuth'

/**
 * 公民意見投票列（issue #107）。
 *
 * 純呈現元件：自己不打 API，狀態由父層（Issue.vue／OpinionDetail.vue）統一載入後傳進來。
 * 這樣一頁 N 則意見只會發一次請求，元件本身也好測。
 *
 * 票值沿用 pol.is：1 同意、-1 不同意、0 略過。
 *
 * 兩條規則直接體現在畫面上：
 *   - 投票前不揭露分布（#107 決策 5）：state.tally 為 null 時只出提示，不出數字。
 *     判斷一律看伺服器給的 tally，不在前端自己算，前端藏數字等於沒藏。
 *   - 提議者當然贊成（#107 決策 4）：is_author 為 true 時不給投票鈕。
 */
const props = defineProps<{
  opinionId: number
  state: OpinionVoteState | null
  authState: AuthState
  /** 送出中的意見 id，用來把該列的按鈕鎖住，避免連點送出兩次 */
  pending?: boolean
}>()

const emit = defineEmits<{
  (event: 'vote', opinionId: number, value: VoteValue): void
  (event: 'retract', opinionId: number): void
  (event: 'login-required'): void
}>()

const { t } = useI18n()

const OPTIONS = [
  { value: 1 as VoteValue, key: 'vote_agree' },
  { value: -1 as VoteValue, key: 'vote_disagree' },
  { value: 0 as VoteValue, key: 'vote_pass' },
]

const isAuthor = computed(() => props.state?.is_author === true)
const myVote = computed(() => props.state?.my_vote ?? null)
const tally = computed(() => props.state?.tally ?? null)

function countFor(value: VoteValue): number | null {
  const current = tally.value
  if (!current) return null
  if (value === 1) return current.agree
  if (value === -1) return current.disagree
  return current.pass
}

function choose(value: VoteValue) {
  if (props.pending) return
  // SSR 與登入狀態未定時什麼都不做：伺服器端不猜登入狀態（AGENTS.md 不變量 3）
  if (props.authState === 'loading') return
  if (props.authState === 'anonymous') {
    emit('login-required')
    return
  }
  if (isAuthor.value) return
  // 再點一次自己投過的選項＝收回
  if (myVote.value === value) emit('retract', props.opinionId)
  else emit('vote', props.opinionId, value)
}
</script>

<template>
  <!-- authState 為 loading（含 SSR）時整列不輸出，避免 hydration mismatch -->
  <div v-if="authState !== 'loading'" class="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
    <template v-if="isAuthor">
      <span class="status-badge">{{ t('vote_author_badge') }}</span>
    </template>
    <template v-else>
      <button
        v-for="option in OPTIONS"
        :key="option.value"
        type="button"
        class="btn btn-ghost btn-sm"
        :class="{ 'btn-secondary': myVote === option.value }"
        :aria-pressed="myVote === option.value"
        :disabled="pending"
        @click="choose(option.value)"
      >
        {{ t(option.key) }}
        <span v-if="countFor(option.value) !== null" class="ml-1 tabular-nums">{{ countFor(option.value) }}</span>
      </button>
    </template>

    <span v-if="!isAuthor && !tally" class="text-xs text-muted">
      {{ authState === 'anonymous' ? t('vote_login_hint') : t('vote_hidden_hint') }}
    </span>
    <span v-else-if="myVote !== null" class="text-xs text-muted">{{ t('vote_change_hint') }}</span>
  </div>
</template>
