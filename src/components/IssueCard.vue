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

const { locale } = useI18n()

const href = computed(() => `/issues/${props.issue.id}`)
const date = computed(() => formatDate(props.issue.created_at, locale.value))

function selectIssue(event: MouseEvent): void {
  // 保留另開分頁／視窗的瀏覽器原生行為；一般點擊則在首頁切成 query 驅動的預覽版面。
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('select', props.issue)
}
</script>

<template>
  <div class="card relative mb-4 transition hover:border-red/30 hover:shadow-md">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <StatusBadge :status="issue.status" short />
      <span class="text-sm text-muted">{{ date }}</span>
    </div>
    <h2 class="m-0 font-serif text-xl font-bold">
      <a :href="href" class="text-ink no-underline hover:no-underline after:absolute after:inset-0" @click="selectIssue">{{ issue.title }}</a>
    </h2>
  </div>
</template>
