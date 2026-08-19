<script setup lang="ts">
// 卡片根節點刻意不是連結：投稿者 email 以 mailto 連結呈現，巢狀連結會被瀏覽器拆開而造成 hydration mismatch。
// 改以標題上的 stretched link（after:absolute after:inset-0）覆蓋整張卡片，email 連結加 relative 疊在其上。
import { computed } from 'vue'
import AuthorEmailLink from './AuthorEmailLink.vue'
import StatusBadge from './StatusBadge.vue'
import { formatDate, useI18n } from '../l10n'
import type { IssueListItem } from '../db/queries'

const props = defineProps<{
  issue: IssueListItem
}>()

const { t, locale } = useI18n()

const href = computed(() => `/issues/${props.issue.id}`)
const date = computed(() => formatDate(props.issue.created_at, locale.value))
</script>

<template>
  <div class="card relative mb-4 transition hover:border-red/30 hover:shadow-md">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <StatusBadge :status="issue.status" short />
      <span class="text-sm text-muted">{{ date }}</span>
    </div>
    <h2 class="m-0 font-serif text-xl font-bold">
      <a :href="href" class="text-ink no-underline hover:no-underline after:absolute after:inset-0">{{ issue.title }}</a>
    </h2>
    <p v-if="issue.description" class="mt-2 mb-0 text-sm text-muted">
      {{ issue.description }}
    </p>
    <p class="mt-3 mb-0 text-sm text-muted">
      {{ issue.material_count }} {{ t('idx_materials_unit') }} · {{ issue.opinion_count }} {{ t('idx_opinions_unit') }} · {{ t('issue_author_label') }}：{{ issue.author_name || t('author_system') }}
      <template v-if="issue.author_email"> <AuthorEmailLink :email="issue.author_email" :name="issue.author_name" class="relative" /></template>
    </p>
  </div>
</template>
