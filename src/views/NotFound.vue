<script setup lang="ts">
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import { useI18n } from '../l10n'

const { t } = useI18n()
</script>

<template>
  <div>
    <AppHeader current="other" />

    <main class="py-20">
      <div class="container text-center">
        <div class="mb-4 text-6xl">🧭</div>
        <h1 class="mt-0 mb-2 font-serif text-2xl font-bold">{{ t('nf_title') }}</h1>
        <p class="mx-auto mb-6 max-w-md text-muted">{{ t('nf_desc') }}</p>
        <a href="/" class="btn btn-primary">{{ t('nf_home_btn') }}</a>
      </div>
    </main>

    <AppFooter />
  </div>
</template>
