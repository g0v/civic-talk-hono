<script setup lang="ts">
import { computed } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import { useI18n } from '../l10n'

const { t } = useI18n()

const heroTitleHtml = computed(() => t('abt_hero_title').replace(/\n/g, '<br>'))

const roles = computed(() =>
  [1, 2, 3, 4].map((n) => ({
    icon: t(`abt_role${n}_icon` as 'abt_role1_icon'),
    title: t(`abt_role${n}_title` as 'abt_role1_title'),
    desc: t(`abt_role${n}_desc` as 'abt_role1_desc'),
  })),
)

const steps = computed(() =>
  [1, 2, 3].map((n) => ({
    label: t(`abt_step${n}_label` as 'abt_step1_label'),
    title: t(`abt_step${n}_title` as 'abt_step1_title'),
    desc: t(`abt_step${n}_desc` as 'abt_step1_desc'),
  })),
)

const techRows = computed(() => [
  { label: 'Frontend', value: t('abt_tech_frontend') },
  { label: 'Backend', value: t('abt_tech_backend') },
  { label: 'Database', value: t('abt_tech_db') },
  { label: 'Deploy', value: t('abt_tech_deploy') },
  { label: 'Auth', value: t('abt_tech_auth') },
])
</script>

<template>
  <div>
    <AppHeader current="about" />

    <section class="vt-hero">
      <div class="vt-hero-inner">
        <div class="hero-tag">{{ t('abt_hero_tag') }}</div>
        <h1 class="hero-title" v-html="heroTitleHtml" />
        <p class="hero-desc">{{ t('abt_hero_desc') }}</p>
      </div>
    </section>

    <main class="py-10">
      <div class="container space-y-12">
        <section>
          <h2 class="mt-0 mb-2 font-serif text-2xl font-bold">{{ t('abt_how_title') }}</h2>
          <p class="mt-0 mb-6 text-muted">{{ t('abt_how_desc') }}</p>
          <div class="grid gap-4 md:grid-cols-3">
            <div v-for="step in steps" :key="step.label" class="card">
              <div class="mb-2 text-xs font-bold tracking-widest text-red">{{ step.label }}</div>
              <h3 class="mt-0 mb-2 font-serif text-lg">{{ step.title }}</h3>
              <p class="m-0 text-sm text-muted">{{ step.desc }}</p>
            </div>
          </div>
        </section>

        <section class="card border-teal/20 bg-teal/5">
          <h2 class="mt-0 mb-2 font-serif text-2xl font-bold">{{ t('abt_principle_title') }}</h2>
          <p class="mb-2 text-muted">{{ t('abt_principle_desc') }}</p>
          <p class="m-0 text-sm text-muted">{{ t('abt_principle_note') }}</p>
        </section>

        <section>
          <h2 class="mt-0 mb-6 font-serif text-2xl font-bold">{{ t('abt_join_title') }}</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <div v-for="role in roles" :key="role.title" class="card">
              <div class="mb-2 text-2xl">{{ role.icon }}</div>
              <h3 class="mt-0 mb-2 font-serif text-lg">{{ role.title }}</h3>
              <p class="m-0 text-sm text-muted">{{ role.desc }}</p>
            </div>
          </div>
        </section>

        <section>
          <h2 class="mt-0 mb-2 font-serif text-2xl font-bold">{{ t('abt_contact_title') }}</h2>
          <p class="mb-4 text-muted">{{ t('abt_contact_desc') }}</p>
          <ul class="m-0 list-none space-y-2 p-0 text-sm">
            <li>{{ t('abt_contact_slack') }}</li>
            <li>{{ t('abt_contact_channel') }}</li>
            <li>
              <a href="https://join.g0v.tw" target="_blank" rel="noopener noreferrer">{{
                t('abt_contact_join')
              }}</a>
            </li>
            <li>
              <a
                href="https://github.com/bestian/civic-talk-hono"
                target="_blank"
                rel="noopener noreferrer"
                >{{ t('abt_contact_github') }}</a
              >
            </li>
          </ul>
          <div class="mt-6">
            <a href="/" class="btn btn-primary">{{ t('abt_start_btn') }}</a>
          </div>
        </section>

        <section>
          <h2 class="mt-0 mb-4 font-serif text-2xl font-bold">{{ t('abt_tech_title') }}</h2>
          <div class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full border-collapse text-sm">
              <tbody>
                <tr v-for="row in techRows" :key="row.label" class="border-b border-border last:border-0">
                  <th class="bg-gray-100 px-4 py-3 text-left font-semibold w-36">{{ row.label }}</th>
                  <td class="px-4 py-3">{{ row.value }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>

    <AppFooter />
  </div>
</template>
