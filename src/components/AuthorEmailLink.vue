<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../l10n'

const props = defineProps<{
  email: string
  /** 投稿者顯示名稱；缺漏時無障礙名稱退回泛用字串（不以 email 代替） */
  name?: string | null
}>()

const { t } = useI18n()

const href = computed(() => `mailto:${props.email}`)
// 無障礙名稱只用顯示名稱，不放 email（避免 hover/朗讀時又把地址攤出來）
const label = computed(() => t('author_email_link_title', { name: props.name || t('author_system') }))
</script>

<template>
  <a :href="href" :title="label" :aria-label="label" rel="nofollow" class="no-underline">✉️</a>
</template>
