<script setup lang="ts">
import { computed } from 'vue'
import AuthorEmailLink from './AuthorEmailLink.vue'
import StatusBadge from './StatusBadge.vue'
import { formatDate, useI18n } from '../l10n'
import type { IssueListItem } from '../db/queries'

const props = defineProps<{
  issue: IssueListItem
}>()

const { t, locale } = useI18n()
const date = computed(() => formatDate(props.issue.created_at, locale.value))
</script>

<template>
  <article class="card flex flex-col">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <StatusBadge :status="issue.status" short />
      <span class="text-sm text-muted">{{ date }}</span>
    </div>

    <h2 class="mt-0 mb-3 font-serif text-2xl font-bold text-ink">{{ issue.title }}</h2>
    <p v-if="issue.description" class="mt-0 mb-4 whitespace-pre-line leading-relaxed text-vt-fg-2">
      {{ issue.description }}
    </p>

    <p class="mt-0 mb-0 text-sm text-muted">
      {{ issue.material_count }} {{ t('idx_materials_unit') }} · {{ issue.opinion_count }} {{ t('idx_opinions_unit') }}
      <span> · {{ t('issue_author_label') }}：{{ issue.author_name || t('author_system') }}</span>
      <template v-if="issue.author_email"> · <AuthorEmailLink :email="issue.author_email" :name="issue.author_name" /> </template>
    </p>

    <div class="mt-6 flex justify-center">
      <a :href="`/issues/${issue.id}`" class="btn btn-primary">{{ t('issue_preview_enter') }}</a>
    </div>
  </article>
</template>
