<script setup lang="ts">
import { useI18n } from '../l10n'

const { t } = useI18n()
</script>

<template>
  <footer class="mt-16 border-t border-border bg-white">
    <div class="container py-10">
      <div class="mb-4">
        <img src="/vtaiwan-logo.svg" alt="vTaiwan" class="h-7 w-auto" />
      </div>
      <p class="mb-4 max-w-xl text-sm text-muted">
        {{ t('footer_desc') }}
      </p>
      <div class="mb-3 h-px bg-border" />
      <div class="text-xs text-muted">{{ t('footer_copy') }}</div>
      <div class="mt-3 flex flex-wrap gap-4 text-sm">
        <a href="https://www.vtaiwan.tw" target="_blank" rel="noopener noreferrer">vtaiwan.tw</a>
        <a href="https://make.vtaiwan.tw" target="_blank" rel="noopener noreferrer">make.vtaiwan.tw</a>
        <a href="/about">{{ t('nav_about') }}</a>
      </div>
    </div>
  </footer>
</template>
