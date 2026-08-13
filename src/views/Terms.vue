<script setup lang="ts">
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import { useI18n } from '../l10n'
import { TERMS_VERSION } from '../legal/terms'

const { t } = useI18n()
</script>

<template>
  <div>
    <AppHeader current="home" />

    <main class="py-10">
      <div class="container max-w-3xl">
        <div class="card">
          <h1 class="mb-8 font-serif text-3xl font-bold">{{ t('terms_page_title') }}</h1>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s1_h') }}</h2>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('terms_s1_p') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s2_h') }}</h2>
            <p class="leading-relaxed text-gray-700" v-html="t('terms_s2_p')"></p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s3_h') }}</h2>
            <div class="mb-4 border-l-4 border-red-400 bg-red-50 p-4">
              <p class="font-semibold text-red-800">{{ t('terms_s3_alert') }}</p>
            </div>
            <p class="mb-3 leading-relaxed text-gray-700" v-html="t('terms_s3_p1')"></p>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('terms_s3_p2') }}</p>
            <p class="leading-relaxed text-gray-700">{{ t('terms_s3_p3') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s4_h') }}</h2>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('terms_s4_p1') }}</p>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('terms_s4_p2') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s5_h') }}</h2>
            <div class="mb-4 border-l-4 border-amber-400 bg-amber-50 p-4">
              <p class="font-semibold text-amber-800">{{ t('terms_s5_alert') }}</p>
            </div>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li>{{ t('terms_s5_li1') }}</li>
              <li v-html="t('terms_s5_li2')"></li>
              <li>{{ t('terms_s5_li3') }}</li>
            </ul>
            <p class="leading-relaxed text-gray-700">{{ t('terms_s5_footer') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s6_h') }}</h2>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('terms_s6_intro') }}</p>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li>{{ t('terms_s6_li1') }}</li>
              <li>{{ t('terms_s6_li2') }}</li>
              <li>{{ t('terms_s6_li3') }}</li>
              <li>{{ t('terms_s6_li4') }}</li>
            </ul>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s7_h') }}</h2>
            <div class="mb-4 border-l-4 border-amber-400 bg-amber-50 p-4">
              <p class="font-semibold text-amber-800">{{ t('terms_s7_alert_h') }}</p>
              <p class="mt-1 text-amber-900" v-html="t('terms_s7_alert_body')"></p>
            </div>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s8_h') }}</h2>
            <p class="leading-relaxed text-gray-700" v-html="t('terms_s8_p')"></p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s9_h') }}</h2>
            <p class="leading-relaxed text-gray-700">{{ t('terms_s9_p') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s10_h') }}</h2>
            <p class="mb-2 leading-relaxed text-gray-700">{{ t('terms_s10_p') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s11_h') }}</h2>
            <div class="rounded-lg bg-gray-50 p-4">
              <p class="mb-2"><strong>{{ t('terms_s11_email_label') }}</strong> info@vtaiwan.tw</p>
              <p class="mb-0">
                <strong>{{ t('terms_s11_github_label') }}</strong>
                <a href="https://github.com/g0v/civic-talk-hono" class="text-red underline hover:opacity-80" target="_blank" rel="noopener noreferrer">github.com/g0v/civic-talk-hono</a>
              </p>
            </div>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('terms_s12_h') }}</h2>
            <p class="text-sm text-muted">{{ t('terms_s12_p') }}{{ TERMS_VERSION }}</p>
          </section>

          <div class="mt-8">
            <a href="/" class="btn btn-secondary">{{ t('policy_back_home') }}</a>
          </div>
        </div>
      </div>
    </main>

    <AppFooter />
  </div>
</template>
