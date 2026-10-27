<script setup lang="ts">
// 卡片根節點刻意不是連結；標題上的 stretched link（after:absolute after:inset-0）覆蓋整張卡片。
import { computed } from 'vue'
import StatusBadge from './StatusBadge.vue'
import { formatDate, useI18n } from '../l10n'
import type { IssueListItem } from '../db/queries'

const props = defineProps<{
  issue: IssueListItem
}>()

const emit = defineEmits<{
  select: [issue: IssueListItem]
}>()

const { t, locale } = useI18n()

const href = computed(() => `/issues/${props.issue.id}`)
const publishedDate = computed(() => formatDate(props.issue.created_at, locale.value))
const activityDate = computed(() => formatDate(props.issue.last_activity_at ?? props.issue.created_at, locale.value))
const canShowTags = computed(() => props.issue.tags.length > 0 && props.issue.abuse_flagged !== 2 && props.issue.abuse_flagged !== 3)
const opinionCountLabel = computed(() => `${props.issue.opinion_count} ${t('idx_opinions_unit')}`)
const voteCountLabel = computed(() => t('issue_vote_count_label', { count: props.issue.vote_count }))

function selectIssue(event: MouseEvent): void {
  // 保留另開分頁／視窗的瀏覽器原生行為；一般點擊則在首頁切成 query 驅動的預覽版面。
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('select', props.issue)
}
</script>

<template>
  <div class="card issue-list-card relative mb-4 grid grid-cols-1 gap-y-2 md:grid-cols-[minmax(0,1fr)_minmax(0,38%)] md:gap-x-4">
    <div class="mb-2 flex flex-wrap items-center gap-2 md:col-span-2">
      <StatusBadge :status="issue.status" short />
      <span class="text-sm whitespace-nowrap text-muted">{{ t('idx_published_date', { date: publishedDate }) }}</span>
      <span class="text-sm whitespace-nowrap text-muted">{{ t('idx_activity_date', { date: activityDate }) }}</span>
    </div>
    <h2 class="m-0 min-w-0 font-serif text-xl font-bold [overflow-wrap:anywhere]" :class="canShowTags || issue.opinion_count > 0 || issue.vote_count > 0 ? '' : 'md:col-span-2'">
      <a :href="href" class="text-ink no-underline hover:no-underline after:absolute after:inset-0" @click="selectIssue">{{ issue.title }}</a>
    </h2>
    <div v-if="canShowTags || issue.opinion_count > 0 || issue.vote_count > 0" class="mt-2 flex min-w-0 items-end justify-end gap-2 md:mt-0 md:self-end">
      <div v-if="canShowTags" role="list" class="flex min-w-0 flex-1 flex-wrap gap-1 md:justify-end" :aria-label="t('issue_tags_label')">
        <span
          v-for="tag in issue.tags"
          :key="tag.toLowerCase()"
          role="listitem"
          class="min-w-0 max-w-full break-words rounded bg-gray-100 px-2 py-1 text-xs text-ink [overflow-wrap:anywhere] dark:bg-gray-800"
          >#{{ tag }}</span
        >
      </div>
      <span v-if="issue.opinion_count > 0" role="img" :aria-label="opinionCountLabel" :title="opinionCountLabel" class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-muted">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </svg>
        {{ issue.opinion_count }}
      </span>
      <span v-if="issue.vote_count > 0" role="img" :aria-label="voteCountLabel" :title="voteCountLabel" class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-muted">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M2.25 12s3.5-6 9.75-6 9.75 6 9.75 6-3.5 6-9.75 6-9.75-6-9.75-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
        {{ issue.vote_count }}
      </span>
    </div>
  </div>
</template>
