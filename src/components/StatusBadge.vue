<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../l10n'
import type { IssueStatus } from '../db/queries'

const props = defineProps<{
  status: IssueStatus | string
  short?: boolean
}>()

const { t } = useI18n()

const label = computed(() => {
  if (props.status === 'collecting') return t('status_collecting')
  if (props.status === 'summarizing') return t('status_summarizing')
  if (props.status === 'published') {
    return props.short ? t('status_published_short') : t('status_published')
  }
  return props.status
})

const cls = computed(() => {
  if (props.status === 'collecting') return 'status-collecting'
  if (props.status === 'summarizing') return 'status-summarizing'
  if (props.status === 'published') return 'status-published'
  return ''
})
</script>

<template>
  <span class="status-badge" :class="cls">{{ label }}</span>
</template>
