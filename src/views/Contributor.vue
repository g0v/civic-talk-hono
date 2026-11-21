<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import HomeNatureBackdrop from '../components/HomeNatureBackdrop.vue'
import { useI18n } from '../l10n'
import type { Contribution, ContributorHistory } from '../lib/contributors'
import { contributionHref, contributionKinds, parseContributorNavigation, writeContributorNavigation } from '../lib/contributorNavigation'
import type { ContributorView } from '../lib/contributorNavigation'

const props = withDefaults(
  defineProps<{
    initialHistory: ContributorHistory
    initialView?: ContributorView
    initialExpanded?: string[]
  }>(),
  { initialView: 'timeline', initialExpanded: () => [] }
)

const { t, locale } = useI18n()
const view = ref<ContributorView>(props.initialView)
const expanded = ref<readonly string[]>(props.initialExpanded)
const categoryKeys = {
  issue: 'contributor_kind_issue',
  material: 'contributor_kind_material',
  briefing: 'contributor_kind_briefing',
  opinion: 'contributor_kind_opinion',
} as const

// D1 datetime() 沒有時區尾碼；明確視為 UTC，避免 SSR 與瀏覽器依本地時區分年。
function utcDate(value: string): Date {
  const normalized = value.replace(' ', 'T')
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`)
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(utcDate(value))
}

const sorted = computed(() => [...props.initialHistory.contributions].sort((a, b) => utcDate(b.created_at).getTime() - utcDate(a.created_at).getTime() || b.id - a.id))
const timeline = computed(() =>
  [
    ...sorted.value.map(item => ({ key: `${item.kind}-${item.id}`, created_at: item.created_at, contribution: item })),
    { key: 'joined', created_at: props.initialHistory.joined_at, contribution: null },
  ].sort((a, b) => utcDate(b.created_at).getTime() - utcDate(a.created_at).getTime())
)
const joinedYear = computed(() => utcDate(props.initialHistory.joined_at).getUTCFullYear())
const years = computed(() => {
  const values = new Set([joinedYear.value, ...sorted.value.map(item => utcDate(item.created_at).getUTCFullYear())])
  return [...values]
    .sort((a, b) => b - a)
    .map(year => ({
      year,
      groups: contributionKinds.map(kind => ({
        kind,
        key: `${year}:${kind}`,
        items: sorted.value.filter(item => item.kind === kind && utcDate(item.created_at).getUTCFullYear() === year),
      })),
    }))
})

function itemLabel(item: Contribution): string {
  const title = item.title || t('contributor_untitled')
  switch (item.kind) {
    case 'briefing':
      return item.version !== null ? t('contributor_version_title', { title, version: item.version }) : title
    case 'issue':
    case 'material':
    case 'opinion':
      return title
    default: {
      const exhaustive: never = item.kind
      return exhaustive
    }
  }
}

function restoreNavigation() {
  const state = parseContributorNavigation(window.location.search)
  view.value = state.view
  expanded.value = state.expanded
}

function saveNavigation() {
  const url = writeContributorNavigation(window.location.href, { view: view.value, expanded: expanded.value })
  window.history.pushState(null, '', url)
}

function setView(next: ContributorView) {
  if (view.value === next) return
  view.value = next
  saveNavigation()
}

function toggleGroup(key: string) {
  expanded.value = expanded.value.includes(key) ? expanded.value.filter(value => value !== key) : [...expanded.value, key]
  saveNavigation()
}

onMounted(() => {
  restoreNavigation()
  window.addEventListener('popstate', restoreNavigation)
})
onUnmounted(() => {
  window.removeEventListener('popstate', restoreNavigation)
})
</script>

<template>
  <div>
    <AppHeader current="other" />
    <main class="relative isolate py-10">
      <div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-50" aria-hidden="true">
        <HomeNatureBackdrop placement="issues" />
      </div>
      <div class="page-container">
        <div class="mx-auto max-w-prose">
          <header class="mb-8">
            <h1 class="page-title wrap-anywhere">{{ initialHistory.name || t('contributor_unnamed') }}</h1>
            <p class="text-muted">
              {{ t('contributor_joined') }}
              <time :datetime="utcDate(initialHistory.joined_at).toISOString()">{{ dateLabel(initialHistory.joined_at) }}</time>
            </p>
          </header>
          <h2 class="mb-4 font-serif text-vt-2xl font-bold">{{ t('contributor_history') }}</h2>
          <div class="mb-8 flex flex-wrap gap-3" role="group" :aria-label="t('contributor_view_label')">
            <button
              type="button"
              class="btn min-h-12 active:opacity-80"
              :class="view === 'timeline' ? 'btn-primary' : 'btn-secondary'"
              :aria-pressed="view === 'timeline'"
              @click="setView('timeline')"
            >
              {{ t('contributor_timeline') }}
            </button>
            <button type="button" class="btn min-h-12 active:opacity-80" :class="view === 'list' ? 'btn-primary' : 'btn-secondary'" :aria-pressed="view === 'list'" @click="setView('list')">
              {{ t('contributor_list') }}
            </button>
          </div>
          <p class="mb-6 text-sm text-muted">{{ t('contributor_public_hint') }}</p>
          <div v-if="!sorted.length" class="mb-8">
            <p>{{ t('contributor_empty') }}</p>
            <a href="/" class="btn btn-secondary min-h-12">{{ t('contributor_browse') }}</a>
          </div>
          <ol v-if="view === 'timeline'" class="m-0 list-none p-0">
            <li v-for="event in timeline" :key="event.key" class="relative border-s border-border ps-6 pb-8 last:border-transparent">
              <span class="absolute -start-1 top-2 h-2 w-2 rounded-full bg-muted" aria-hidden="true"></span>
              <time class="text-sm text-muted" :datetime="utcDate(event.created_at).toISOString()">{{ dateLabel(event.created_at) }}</time>
              <template v-if="event.contribution">
                <p class="mt-2 mb-1 font-medium">{{ t(categoryKeys[event.contribution.kind]) }}</p>
                <a :href="contributionHref(event.contribution)" class="inline-block min-h-12 content-center wrap-anywhere text-vt-fg-1 underline underline-offset-4 hover:text-vt-fg-2">{{ itemLabel(event.contribution) }}</a>
                <p v-if="event.contribution.kind === 'briefing'" class="mt-1 mb-0 text-sm text-muted">{{ t('contributor_briefing_link_hint') }}</p>
              </template>
              <p v-else class="mt-2 mb-0 font-medium">{{ t('contributor_join_event') }}</p>
            </li>
          </ol>
          <div v-else class="space-y-12">
            <section v-for="year in years" :key="year.year" :aria-labelledby="`year-${year.year}`">
              <h3 :id="`year-${year.year}`" class="mt-0 mb-4 text-vt-xl font-bold">{{ t('contributor_year', { year: year.year }) }}</h3>
              <div v-for="group in year.groups" :key="group.key" class="border-b border-border py-2">
                <button
                  type="button"
                  class="btn btn-ghost min-h-12 w-full justify-between gap-3 whitespace-normal text-start active:opacity-80"
                  :aria-expanded="expanded.includes(group.key)"
                  :aria-controls="`items-${group.key}`"
                  :disabled="!group.items.length"
                  @click="toggleGroup(group.key)"
                >
                  <span>{{ t(categoryKeys[group.kind]) }}</span>
                  <span class="shrink-0 tabular-nums">{{ t('contributor_count', { count: group.items.length }) }}</span>
                </button>
                <ul v-show="expanded.includes(group.key)" :id="`items-${group.key}`" class="m-0 list-none space-y-4 px-4 py-4">
                  <li v-for="item in group.items" :key="item.id">
                    <a :href="contributionHref(item)" class="inline-block min-h-12 content-center wrap-anywhere text-vt-fg-1 underline underline-offset-4 hover:text-vt-fg-2">{{ itemLabel(item) }}</a>
                    <time class="block text-sm text-muted" :datetime="utcDate(item.created_at).toISOString()">{{ dateLabel(item.created_at) }}</time>
                    <p v-if="item.kind === 'briefing'" class="mt-1 mb-0 text-sm text-muted">{{ t('contributor_briefing_link_hint') }}</p>
                  </li>
                </ul>
              </div>
              <p v-if="year.year === joinedYear" class="mt-6 mb-0 text-muted">
                <time :datetime="utcDate(initialHistory.joined_at).toISOString()">{{ dateLabel(initialHistory.joined_at) }}</time>
                · {{ t('contributor_join_event') }}
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
    <AppFooter />
  </div>
</template>
