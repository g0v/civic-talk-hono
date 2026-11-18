<script setup lang="ts">
import { useI18n } from '../l10n'

defineProps<{
  name: string | null | undefined
  publicId?: string | null
}>()

const { t } = useI18n()
const isDev = import.meta.env.DEV
</script>

<template>
  <a v-if="isDev && name && publicId" :href="`/contributors/${encodeURIComponent(publicId)}`" class="text-vt-fg-1 underline underline-offset-4 hover:text-vt-fg-2">{{ name }}</a>
  <span v-else>{{ name || t('author_system') }}</span>
</template>
