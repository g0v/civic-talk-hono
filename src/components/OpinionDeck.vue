<script setup lang="ts">
import { computed, nextTick, ref, toRef } from 'vue'
import type { Opinion, OpinionVoteState } from '../db/queries'
import { useAuth } from '../composables/useAuth'
import { useOpinionDeck } from '../composables/useOpinionDeck'
import { formatDate, useI18n } from '../l10n'
import { renderSafeMarkdown } from '../markdown/renderSafeMarkdown'
import { writeIssueOpinionAnchor } from '../lib/issueNavigation'
import AuthorEmailLink from './AuthorEmailLink.vue'
import AuthorName from './AuthorName.vue'
import OpinionVote from './OpinionVote.vue'

const props = defineProps<{
  opinions: Array<Opinion & Partial<OpinionVoteState>>
  ready: boolean
  error: boolean
  callbackUrl: string
  initialOpinionId: number | null
}>()
const emit = defineEmits<{
  update: [id: number, state: OpinionVoteState]
  compose: []
  retry: []
  'sign-in-required': [id: number]
}>()
const { t, locale } = useI18n()
const { authState, session } = useAuth()
const ready = computed(() => props.ready && !props.error && authState.value !== 'loading')
const viewerId = computed(() => session.value?.user.id ?? null)
const { current, total, completed, initialized, advance } = useOpinionDeck(toRef(props, 'opinions'), ready, { id: viewerId, opinionId: toRef(props, 'initialOpinionId') })
const expanded = ref<number | null>(null)
const message = ref('')
const card = ref<HTMLElement | null>(null)
const rendered = computed(() => renderSafeMarkdown(current.value?.summary ?? ''))
const hasVisibleOpinions = computed(() => props.opinions.some(opinion => opinion.abuse_flagged < 2))
const callback = computed(() => (current.value ? writeIssueOpinionAnchor(props.callbackUrl, current.value.id) : props.callbackUrl))

async function finish(state?: OpinionVoteState) {
  const opinion = current.value
  if (!opinion) return
  advance(opinion.id)
  if (state) emit('update', opinion.id, state)
  message.value = t(state ? 'op_card_thanks' : 'op_card_skipped')
  await nextTick()
  card.value?.focus({ preventScroll: true })
  card.value?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
}
</script>

<template>
  <div class="opinion-deck mx-auto max-w-prose">
    <p class="my-3 min-h-6 text-sm text-vt-fg-2" role="status" aria-live="polite" aria-atomic="true">{{ message }}</p>
    <div v-if="error" class="card text-center" role="alert">
      <p>{{ t('op_card_load_error') }}</p>
      <button type="button" class="btn btn-secondary" @click="emit('retry')">{{ t('op_card_retry') }}</button>
    </div>
    <div v-else-if="!ready || !initialized" class="card min-h-48" role="status">
      <p class="text-muted">{{ t('loading') }}</p>
      <div class="h-4 w-full animate-pulse rounded bg-gray-200" aria-hidden="true" />
    </div>
    <template v-else>
      <div v-if="total > 0" class="mb-4">
        <p id="opinion-deck-progress" class="mt-0 mb-2 text-sm text-vt-fg-2 tabular-nums">{{ t('op_card_progress', { completed, total }) }}</p>
        <div role="progressbar" aria-labelledby="opinion-deck-progress" :aria-valuenow="completed" :aria-valuemax="total" aria-valuemin="0" class="h-2 overflow-hidden rounded-full bg-gray-200">
          <div class="h-full bg-vt-jade-green" :style="{ width: `${(completed / total) * 100}%` }" />
        </div>
      </div>
      <article v-if="current" :id="`opinion-${current.id}`" ref="card" tabindex="-1" class="card" :aria-label="t('op_card_view')">
        <div v-if="current.abuse_flagged === 1 && expanded !== current.id" class="text-center">
          <p class="text-vt-fg-2">{{ t('flagged_warning') }}</p>
          <button type="button" class="btn btn-secondary" @click="expanded = current.id">{{ t('flagged_expand_btn') }}</button>
        </div>
        <template v-else>
          <p v-if="current.abuse_flagged === 1" class="mt-0 text-sm text-vt-fg-2">{{ t('flagged_warning') }}</p>
          <p class="mt-0 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-vt-fg-2">
            <span>{{ formatDate(current.created_at, locale) }}</span>
            <span class="break-words">
              <AuthorName :name="current.author_name" :public-id="current.author_public_id" />
              <AuthorEmailLink v-if="current.author_email" :email="current.author_email" :name="current.author_name" />
            </span>
            <a :href="`/issues/${current.issue_id}/comment/${current.id}`" class="text-vt-fg-2 underline">{{ t('card_permalink') }}</a>
          </p>
          <div class="markdown-content mobile-readable min-h-24 break-words" v-html="rendered" />
          <OpinionVote :key="current.id" :opinion="current" :callback-url="callback" card @update="finish" @pass-anonymous="finish()" @sign-in-required="emit('sign-in-required', current.id)" />
        </template>
      </article>
      <div v-else ref="card" tabindex="-1" class="card py-12 text-center">
        <svg
          v-if="hasVisibleOpinions"
          class="mx-auto mb-6 h-12 w-12 text-vt-fg-1"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m7 12 3 3 7-7" />
        </svg>
        <h3 class="mt-0 mb-4 font-serif text-2xl">{{ t(!hasVisibleOpinions ? 'op_card_empty_title' : authState === 'anonymous' ? 'op_card_reviewed_title' : 'op_card_done_title') }}</h3>
        <p class="mb-6 text-vt-fg-2">{{ t(!hasVisibleOpinions ? 'op_empty' : authState === 'anonymous' ? 'op_card_reviewed_desc' : 'op_card_done_desc') }}</p>
        <button type="button" class="btn btn-primary" @click="emit('compose')">{{ t('op_start_commit') }}</button>
      </div>
    </template>
  </div>
</template>
