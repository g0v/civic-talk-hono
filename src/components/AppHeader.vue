<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n, useLocaleLabel, type Locale } from '../l10n'

const props = withDefaults(
  defineProps<{
    current?: 'home' | 'about' | 'admin' | 'issue' | 'contribute'
    showNewIssue?: boolean
    backHref?: string
    backLabel?: string
  }>(),
  {
    current: 'home',
    showNewIssue: false,
  },
)

const emit = defineEmits<{
  'new-issue': []
}>()

const { t, toggleLocale, setLocale, locale } = useI18n()
const langLabel = useLocaleLabel()
const ready = ref(false)

onMounted(() => {
  // hydration 後才讀 localStorage，避免 SSR mismatch
  const stored =
    typeof window !== 'undefined'
      ? (() => {
          try {
            return window.localStorage.getItem('civic_lang')
          } catch {
            return null
          }
        })()
      : null
  if (stored === 'en' || stored === 'zh' || stored === 'zh-TW') {
    const next: Locale = stored === 'en' ? 'en' : 'zh-TW'
    if (next !== locale.value) setLocale(next)
  }
  ready.value = true
})

const backText = computed(() => props.backLabel ?? t('back_to_issues'))
</script>

<template>
  <header class="sticky top-0 z-[100] px-4 pt-3 bg-transparent">
    <div
      class="mx-auto flex h-16 max-w-[980px] items-center justify-between rounded-xl border border-white/75 bg-white/88 px-4 pl-6 shadow-md backdrop-blur-[20px]"
    >
      <a href="/" class="flex shrink-0 items-center no-underline" aria-label="vTaiwan Civic Talk">
        <img src="/vtaiwan-logo.svg" alt="vTaiwan" class="h-7 w-auto" />
      </a>
      <nav class="flex items-center gap-0.5">
        <a
          v-if="backHref"
          :href="backHref"
          class="rounded-pill px-3 py-1.5 text-[13px] text-[#2a2a30] no-underline hover:bg-black/5"
        >
          {{ backText }}
        </a>
        <a
          v-else
          href="/"
          class="rounded-pill px-3 py-1.5 text-[13px] text-[#2a2a30] no-underline hover:bg-black/5"
          :class="{ 'font-semibold text-red': current === 'home' }"
        >
          {{ t('nav_issues') }}
        </a>
        <a
          href="/about"
          class="rounded-pill px-3 py-1.5 text-[13px] text-[#2a2a30] no-underline hover:bg-black/5"
          :class="{ 'font-semibold text-red': current === 'about' }"
        >
          {{ t('nav_about') }}
        </a>
        <span class="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
        <button type="button" class="btn btn-ghost btn-sm" @click="toggleLocale">
          {{ ready ? langLabel : 'EN' }}
        </button>
        <button
          v-if="showNewIssue"
          type="button"
          class="btn btn-primary btn-sm"
          @click="emit('new-issue')"
        >
          {{ t('idx_new_issue_btn') }}
        </button>
      </nav>
    </div>
  </header>
</template>
