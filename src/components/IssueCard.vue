<script setup lang="ts">
import { computed } from 'vue'
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
  <a
    :href="href"
    class="card mb-4 block no-underline transition hover:border-red/30 hover:shadow-md"
  >
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <StatusBadge :status="issue.status" short />
      <span class="text-xs text-muted">{{ date }}</span>
    </div>
    <h2 class="m-0 font-serif text-xl font-bold text-ink">{{ issue.title }}</h2>
    <p v-if="issue.description" class="mt-2 mb-0 text-sm text-muted">
      {{ issue.description }}
    </p>
    <p class="mt-3 mb-0 text-xs text-muted">
      {{ issue.material_count }} {{ t('idx_materials_unit') }}
    </p>
  </a>
</template>
