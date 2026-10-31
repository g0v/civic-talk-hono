<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../l10n'
import SourceLicenseLinks from './SourceLicenseLinks.vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { t } = useI18n()
const licenseDialog = ref<HTMLDialogElement | null>(null)

function openLicenseDialog() {
  licenseDialog.value?.showModal()
}

function closeLicenseDialog() {
  licenseDialog.value?.close()
}

function closeOnBackdropClick(event: MouseEvent) {
  const element = licenseDialog.value
  if (!element || event.target !== element) return
  // 原生 dialog 的霧面點擊也以 dialog 為 target，框內留白不應觸發關閉。
  const bounds = element.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeLicenseDialog()
}
</script>

<template>
  <footer :class="compact ? 'shrink-0 border-t border-border bg-vt-bg-1' : 'mt-16 border-t border-border bg-vt-bg-1'">
    <div :class="compact ? 'page-container py-2' : 'page-container py-10'">
      <template v-if="!compact">
        <div class="mb-4">
          <img src="/vtaiwan-logo.svg" alt="vTaiwan" class="h-7 w-auto dark:hidden" />
          <img src="/vtaiwan-logo-dark.svg" alt="vTaiwan" class="hidden h-7 w-auto dark:block" />
        </div>
        <p class="mb-4 max-w-xl text-sm text-muted">
          {{ t('footer_desc') }}
        </p>
        <div class="mb-3 h-px bg-border" />
        <div class="hidden text-xs text-muted sm:block">{{ t('footer_copy') }}</div>
        <p class="mt-2 text-xs text-muted">{{ t('footer_content_license') }}</p>
        <p class="mt-2 hidden text-xs text-muted sm:block">{{ t('footer_software') }}</p>
      </template>
      <div :class="compact ? 'flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted' : 'mt-3 flex flex-wrap items-center gap-4 text-sm'">
        <button type="button" class="btn btn-ghost btn-sm sm:hidden" aria-haspopup="dialog" @click="openLicenseDialog">
          {{ t('footer_license_button') }}
        </button>
        <div class="hidden sm:contents">
          <SourceLicenseLinks />
        </div>
        <template v-if="!compact">
          <a href="https://www.vtaiwan.tw" target="_blank" rel="noopener noreferrer">vtaiwan.tw</a>
          <a href="https://make.vtaiwan.tw" target="_blank" rel="noopener noreferrer">make.vtaiwan.tw</a>
          <a href="/about">{{ t('nav_about') }}</a>
          <a href="/terms">{{ t('footer_terms') }}</a>
          <a href="/privacy">{{ t('footer_privacy') }}</a>
          <a href="https://github.com/g0v/civic-talk-hono/issues/" target="_blank" rel="noopener noreferrer">
            {{ t('footer_feedback') }}
          </a>
        </template>
      </div>
    </div>
    <dialog
      ref="licenseDialog"
      class="modal m-auto max-h-[90dvh] max-w-[calc(100%-2rem)] border border-vt-border text-left text-vt-fg-1 backdrop:bg-black/50"
      aria-labelledby="software-license-title"
      @click="closeOnBackdropClick"
    >
      <div class="mb-4 flex items-start justify-between gap-4">
        <h2 id="software-license-title" class="m-0 font-vt-serif text-xl">{{ t('footer_license_button') }}</h2>
        <button type="button" class="btn btn-ghost btn-sm shrink-0" :aria-label="t('footer_license_close')" @click="closeLicenseDialog">✕</button>
      </div>
      <p class="mb-3 text-sm text-muted">{{ t('footer_copy') }}</p>
      <p class="mb-3 text-sm text-muted">{{ t('footer_content_license') }}</p>
      <p class="mb-4 text-sm text-muted">{{ t('footer_software') }}</p>
      <div class="flex flex-col items-start gap-3 text-sm">
        <SourceLicenseLinks />
      </div>
    </dialog>
  </footer>
</template>
