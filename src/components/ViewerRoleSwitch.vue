<script setup lang="ts">
import { useViewerRole, type ViewerRole } from '../composables/useViewerRole'
import { useI18n } from '../l10n'

withDefaults(
  defineProps<{
    compact?: boolean
  }>(),
  {
    compact: false,
  }
)

const { t } = useI18n()
const { viewerRole, setViewerRole } = useViewerRole()
const roles: ViewerRole[] = ['citizen', 'volunteer']
</script>

<template>
  <div class="flex shrink-0 items-center gap-1" role="group" :aria-label="t('idx_role_label')">
    <button
      v-for="role in roles"
      :key="role"
      type="button"
      class="inline-flex items-center justify-center rounded-pill border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vt-democratic-red"
      :class="[
        compact ? 'px-1.5 py-1 text-[11px] sm:px-2 sm:text-xs' : 'px-2.5 py-1.5 text-sm',
        viewerRole === role ? 'border-vt-democratic-red bg-vt-democratic-red text-white' : 'border-vt-border bg-vt-bg-1 text-vt-fg-2 hover:bg-black/5 dark:hover:bg-white/10',
      ]"
      :aria-pressed="viewerRole === role"
      @click="setViewerRole(role)"
    >
      {{ t(role === 'citizen' ? 'idx_role_citizen' : 'idx_role_volunteer') }}
    </button>
  </div>
</template>
