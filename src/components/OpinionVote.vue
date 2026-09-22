<script setup lang="ts">
import { computed, ref } from 'vue'
import SignInButtons from './SignInButtons.vue'
import { useAuth } from '../composables/useAuth'
import type { Opinion } from '../db/queries'
import { useI18n } from '../l10n'

type OpinionVoteValue = -1 | 0 | 1

interface OpinionVoteState {
  vote_agree: number | null
  vote_disagree: number | null
  vote_pass: number | null
  my_vote: OpinionVoteValue | null
  can_view_vote_distribution: boolean
  can_vote: boolean
  is_author: boolean
}

type OpinionWithVote = Opinion & Partial<OpinionVoteState>

const props = withDefaults(
  defineProps<{
    opinion: OpinionWithVote
    callbackUrl?: string
    expanded?: boolean
  }>(),
  { callbackUrl: '/', expanded: true }
)

const emit = defineEmits<{
  update: [state: OpinionVoteState]
}>()

const { t } = useI18n()
const { authState } = useAuth()
const pending = ref(false)
const signInVisible = ref(false)
const error = ref('')

const eligible = computed(() => props.opinion.abuse_flagged !== 2 && props.opinion.abuse_flagged !== 3 && (props.opinion.abuse_flagged !== 1 || props.expanded))
const hasDistribution = computed(
  () =>
    props.opinion.can_view_vote_distribution === true &&
    typeof props.opinion.vote_agree === 'number' &&
    typeof props.opinion.vote_disagree === 'number' &&
    typeof props.opinion.vote_pass === 'number'
)
const canVote = computed(() => eligible.value && props.opinion.can_vote !== false)
const isAuthor = computed(() => props.opinion.is_author === true)
const voted = computed(() => props.opinion.my_vote !== null && props.opinion.my_vote !== undefined)

function voteLabel(value: OpinionVoteValue) {
  if (value === 1) return t('vote_agree')
  if (value === -1) return t('vote_disagree')
  return t('vote_pass')
}

async function choose(value: OpinionVoteValue) {
  error.value = ''
  if (authState.value === 'loading' || pending.value || !eligible.value) return
  if (authState.value !== 'signed-in') {
    signInVisible.value = true
    return
  }
  if (!canVote.value) return

  pending.value = true
  try {
    const current = props.opinion.my_vote
    const res = current === value
      ? await fetch(`/api/opinions/${props.opinion.id}/vote`, { method: 'DELETE' })
      : await fetch(`/api/opinions/${props.opinion.id}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        })
    if (res.status === 401) {
      signInVisible.value = true
      error.value = t('vote_session_expired')
      return
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      error.value = body.error || t('vote_error')
      return
    }
    const state = (await res.json()) as OpinionVoteState
    emit('update', state)
  } catch {
    error.value = t('vote_error')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div v-if="eligible" class="mt-4 border-t border-border pt-3">
    <div v-if="authState === 'loading'" class="flex flex-wrap items-center gap-2 text-sm text-muted" aria-hidden="true">
      <span class="h-8 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      <span class="h-8 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      <span class="h-8 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
    </div>

    <template v-else>
      <p v-if="isAuthor" class="mb-2 text-sm text-muted">{{ t('vote_author_implicit') }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="authState === 'anonymous' || canVote"
          type="button"
          class="btn btn-secondary btn-sm"
          :class="{ 'ring-2 ring-green-600': opinion.my_vote === 1 }"
          :disabled="pending"
          @click="choose(1)"
        >
          {{ voteLabel(1) }}<span v-if="hasDistribution" class="ml-1">{{ opinion.vote_agree }}</span>
        </button>
        <button
          v-if="authState === 'anonymous' || canVote"
          type="button"
          class="btn btn-secondary btn-sm"
          :class="{ 'ring-2 ring-red-600': opinion.my_vote === -1 }"
          :disabled="pending"
          @click="choose(-1)"
        >
          {{ voteLabel(-1) }}<span v-if="hasDistribution" class="ml-1">{{ opinion.vote_disagree }}</span>
        </button>
        <button
          v-if="authState === 'anonymous' || canVote"
          type="button"
          class="btn btn-secondary btn-sm"
          :class="{ 'ring-2 ring-amber-600': opinion.my_vote === 0 }"
          :disabled="pending"
          @click="choose(0)"
        >
          {{ voteLabel(0) }}<span v-if="hasDistribution" class="ml-1">{{ opinion.vote_pass }}</span>
        </button>
        <span v-else-if="!isAuthor" class="text-sm text-muted">{{ t('vote_unavailable') }}</span>
      </div>
      <p v-if="voted && !isAuthor" class="mt-2 mb-0 text-sm text-muted">{{ t('vote_your_choice', { choice: voteLabel(opinion.my_vote as OpinionVoteValue) }) }}</p>
      <p v-if="!hasDistribution && voted" class="mt-1 mb-0 text-xs text-muted">{{ t('vote_distribution_visible') }}</p>
      <p v-if="error" class="mt-2 mb-0 text-sm text-red" role="alert">{{ error }}</p>
      <div v-if="signInVisible" class="mt-3 rounded border border-border bg-gray-50 p-3 dark:bg-gray-800">
        <p class="mt-0 mb-3 text-sm text-muted">{{ t('vote_login_prompt') }}</p>
        <SignInButtons :callback-url="callbackUrl" />
      </div>
    </template>
  </div>
</template>
