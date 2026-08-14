<script setup lang="ts">
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import { useI18n } from '../l10n'

const { t } = useI18n()
</script>

<template>
  <div>
    <AppHeader current="home" />

    <main class="py-10">
      <div class="container max-w-3xl">
        <div class="card">
          <h1 class="mb-8 font-serif text-3xl font-bold">{{ t('privacy_page_title') }}</h1>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s1_h') }}</h2>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('privacy_s1_p') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s2_h') }}</h2>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('privacy_s2_intro') }}</p>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li v-html="t('privacy_s2_li1')"></li>
              <li v-html="t('privacy_s2_li2')"></li>
              <li v-html="t('privacy_s2_li3')"></li>
              <li v-html="t('privacy_s2_li4')"></li>
            </ul>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s3_h') }}</h2>
            <div class="mb-4 border-l-4 border-red-400 bg-red-50 p-4">
              <p class="font-semibold text-red-800">{{ t('privacy_s3_alert') }}</p>
            </div>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('privacy_s3_p1') }}</p>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('privacy_s3_p2') }}</p>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('privacy_s3_p3') }}</p>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li v-html="t('privacy_s3_li1')"></li>
              <li v-html="t('privacy_s3_li2')"></li>
            </ul>
            <p class="leading-relaxed text-gray-700">{{ t('privacy_s3_p4') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s4_h') }}</h2>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li>{{ t('privacy_s4_li1') }}</li>
              <li>{{ t('privacy_s4_li2') }}</li>
              <li>{{ t('privacy_s4_li3') }}</li>
            </ul>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s5_h') }}</h2>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('privacy_s5_p') }}</p>
            <div class="mb-3 border-l-4 border-amber-400 bg-amber-50 p-4">
              <p class="font-semibold text-amber-800">{{ t('privacy_s5_alert_h') }}</p>
              <p class="mt-1 text-amber-900" v-html="t('privacy_s5_alert_body')"></p>
            </div>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s6_h') }}</h2>
            <p class="leading-relaxed text-gray-700">{{ t('privacy_s6_p') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s7_h') }}</h2>
            <p class="mb-3 leading-relaxed text-gray-700">{{ t('privacy_s7_intro') }}</p>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li v-html="t('privacy_s7_li1')"></li>
              <li v-html="t('privacy_s7_li2')"></li>
              <li v-html="t('privacy_s7_li3')"></li>
            </ul>
            <p class="leading-relaxed text-gray-700">{{ t('privacy_s7_footer') }}</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s8_h') }}</h2>
            <div class="rounded-lg bg-gray-50 p-4">
              <p class="mb-2">
                <strong>{{ t('privacy_s8_email_label') }}</strong> info@vtaiwan.tw
              </p>
              <p class="mb-0">
                <strong>{{ t('privacy_s8_github_label') }}</strong>
                <a href="https://github.com/g0v/civic-talk-hono" class="text-red underline hover:opacity-80" target="_blank" rel="noopener noreferrer">github.com/g0v/civic-talk-hono</a>
              </p>
            </div>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">{{ t('privacy_s9_h') }}</h2>
            <p class="mb-2 leading-relaxed text-gray-700">{{ t('privacy_s9_p') }}</p>
            <p class="text-sm text-muted">{{ t('privacy_s9_date') }}</p>
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
