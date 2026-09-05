<script setup lang="ts">
import { computed } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import AboutFlowIllustration from '../components/AboutFlowIllustration.vue'
import { useI18n } from '../l10n'

const { t } = useI18n()

const GITHUB_URL = 'https://github.com/g0v/civic-talk-hono'

const heroTitleHtml = computed(() => t('abt_hero_title').replace(/\n/g, '<br>'))

const roles = computed(() =>
  [1, 2, 3, 4].map(n => ({
    icon: t(`abt_role${n}_icon` as 'abt_role1_icon'),
    title: t(`abt_role${n}_title` as 'abt_role1_title'),
    desc: t(`abt_role${n}_desc` as 'abt_role1_desc'),
  }))
)

type FlowStep = {
  n: 1 | 2 | 3 | 4 | 5
  label: string
  title: string
  desc: string
  /** 顯示「功能研發中」徽章 */
  wip: boolean
  /** 研發中的子功能說明；徽章掛在這一段，desc 本身描述的是已上線的部分 */
  wipNote: string
}

// 平台導覽流程（issue #83）：五個步驟取代原本三階段循環。
// 明確逐項列出而不用索引迴圈，讓步驟 3、5 能各自帶「研發中」標示。
const steps = computed<FlowStep[]>(() => [
  { n: 1, label: t('abt_step1_label'), title: t('abt_step1_title'), desc: t('abt_step1_desc'), wip: false, wipNote: '' },
  { n: 2, label: t('abt_step2_label'), title: t('abt_step2_title'), desc: t('abt_step2_desc'), wip: false, wipNote: '' },
  { n: 3, label: t('abt_step3_label'), title: t('abt_step3_title'), desc: t('abt_step3_desc'), wip: true, wipNote: t('abt_step3_wip_note') },
  { n: 4, label: t('abt_step4_label'), title: t('abt_step4_title'), desc: t('abt_step4_desc'), wip: false, wipNote: '' },
  { n: 5, label: t('abt_step5_label'), title: t('abt_step5_title'), desc: t('abt_step5_desc'), wip: true, wipNote: t('abt_step5_wip_note') },
])

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
          <ol class="flow-list m-0 list-none p-0">
            <li v-for="step in steps" :key="step.n" class="flow-step card flex flex-col gap-5 md:flex-row md:items-center">
              <div class="flow-figure mx-auto w-full max-w-xs shrink-0 rounded-lg bg-gray-100 p-3 md:mx-0 md:w-52">
                <AboutFlowIllustration :step="step.n" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="mb-2 flex items-center gap-2 text-xs font-bold tracking-widest text-red">
                  <span class="flow-num" aria-hidden="true">{{ step.n }}</span>
                  <span>{{ step.label }}</span>
                </div>
                <h3 class="mt-0 mb-2 font-serif text-lg">{{ step.title }}</h3>
                <p class="m-0 text-sm text-muted">{{ step.desc }}</p>
                <p v-if="step.wip" class="mt-3 mb-0 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span v-if="step.wipNote">{{ step.wipNote }}</span>
                  <span class="status-badge flow-wip">🚧 {{ t('abt_wip_badge') }}</span>
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section class="card border-teal/20 bg-teal/5">
          <h2 class="mt-0 mb-2 font-serif text-2xl font-bold">{{ t('abt_principle_title') }}</h2>
          <p class="mb-2 text-muted">{{ t('abt_principle_desc') }}</p>
          <p class="m-0 text-sm text-muted">
            {{ t('abt_principle_note_prefix') }}<a :href="GITHUB_URL" target="_blank" rel="noopener noreferrer">{{ t('abt_principle_note_link') }}</a
            >{{ t('abt_principle_note_suffix') }}
          </p>
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
              <a href="https://join.g0v.tw" target="_blank" rel="noopener noreferrer">{{ t('abt_contact_join') }}</a>
            </li>
            <li>
              <a :href="GITHUB_URL" target="_blank" rel="noopener noreferrer">{{ t('abt_contact_github') }}</a>
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
                  <th class="bg-gray-100 dark:bg-gray-800 px-4 py-3 text-left font-semibold w-36">{{ row.label }}</th>
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
