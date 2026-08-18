<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import AppFooter from '../components/AppFooter.vue'
import AppHeader from '../components/AppHeader.vue'
import ModerationAppealForm from '../components/ModerationAppealForm.vue'
import SignInButtons from '../components/SignInButtons.vue'
import { useAuth } from '../composables/useAuth'
import type { MyModerationReport } from '../db/queries'
import { formatDate, useI18n } from '../l10n'
import type { MessageKey } from '../l10n/zh-TW'

type AppealableItems = {
  account_ban: boolean
  reports: MyModerationReport[]
}

type SnapshotField = {
  key: string
  label: string
  value: string
}

const SNAPSHOT_LABELS: Partial<Record<string, MessageKey>> = {
  title: 'idx_label_title',
  description: 'idx_label_desc',
  source_name: 'contrib_label_source',
  source_url: 'contrib_label_url',
  stance: 'contrib_label_stance',
  content: 'contrib_label_content',
  summary: 'op_label_summary',
  consensus: 'vol_label_consensus',
  disputes: 'vol_label_disputes',
  positions: 'vol_label_positions',
  narrative: 'vol_paste_narrative',
}

const TYPE_LABELS: Record<MyModerationReport['submission_type'], MessageKey> = {
  issue: 'appeals_type_issue',
  material: 'appeals_type_material',
  opinion: 'appeals_type_opinion',
  briefing: 'appeals_type_briefing',
}

const { t, locale } = useI18n()
const { authState, ensureAuthSession } = useAuth()
const items = ref<AppealableItems>({ account_ban: false, reports: [] })
const loading = ref(false)
const loadFailed = ref(false)
const highlightedReportId = ref<number | null>(null)
const hasItems = computed(() => items.value.account_ban || items.value.reports.length > 0)

function snapshotFields(snapshot: string): SnapshotField[] {
  try {
    const parsed = JSON.parse(snapshot) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return Object.entries(parsed)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(([key, value]) => ({
        key,
        label: SNAPSHOT_LABELS[key] ? t(SNAPSHOT_LABELS[key]) : key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }))
  } catch {
    return [{ key: 'content', label: t('appeals_content_snapshot'), value: snapshot }]
  }
}

async function loadItems() {
  loading.value = true
  loadFailed.value = false
  try {
    const response = await fetch('/api/me/appealable-moderation-items')
    if (!response.ok) throw new Error(`Failed to load appealable items: ${response.status}`)
    items.value = (await response.json()) as AppealableItems
  } catch {
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

async function focusLinkedReport() {
  if (typeof window === 'undefined') return
  const raw = new URLSearchParams(window.location.search).get('report')
  const reportId = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(reportId) || reportId <= 0) return
  highlightedReportId.value = reportId
  await nextTick()
  document.getElementById(`appeal-report-${reportId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

onMounted(async () => {
  await ensureAuthSession()
  if (authState.value !== 'signed-in') return
  await loadItems()
  await focusLinkedReport()
})
</script>

<template>
  <div>
    <AppHeader current="appeals" />

    <main class="py-10">
      <div class="container max-w-3xl">
        <p class="section-label">{{ t('appeals_eyebrow') }}</p>
        <h1 class="page-title">{{ t('appeals_title') }}</h1>
        <p class="page-subtitle">{{ t('appeals_intro') }}</p>

        <section v-if="authState === 'loading'" class="card" aria-busy="true">
          <div class="h-7 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div class="mt-5 h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
        </section>

        <section v-else-if="authState === 'anonymous'" class="card">
          <p class="mt-0 mb-4 text-muted">{{ t('appeals_login_required') }}</p>
          <SignInButtons callback-url="/appeals" />
        </section>

        <section v-else>
          <div v-if="loading" class="card text-muted" aria-busy="true">{{ t('appeals_loading') }}</div>
          <div v-else-if="loadFailed" class="alert alert-warn">
            <p class="mt-0 mb-3">{{ t('appeals_load_failed') }}</p>
            <button type="button" class="btn btn-secondary" @click="loadItems">{{ t('appeals_retry') }}</button>
          </div>
          <div v-else-if="!hasItems" class="empty">
            <div class="empty-icon" aria-hidden="true">✓</div>
            {{ t('appeals_empty') }}
          </div>
          <div v-else class="space-y-6">
            <article v-if="items.account_ban" class="card">
              <p class="section-label">{{ t('appeals_type_account_ban') }}</p>
              <h2 class="mt-0 mb-2 font-serif text-xl">{{ t('appeals_account_ban_item_title') }}</h2>
              <p class="mb-0 text-muted">{{ t('appeals_account_ban_item_body') }}</p>
              <ModerationAppealForm appeal-type="account_ban" />
            </article>

            <article
              v-for="report in items.reports"
              :id="`appeal-report-${report.id}`"
              :key="report.id"
              class="card scroll-mt-28 transition-shadow"
              :class="{ 'ring-2 ring-vt-democratic-red': highlightedReportId === report.id }"
            >
              <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
                <span class="rounded-pill bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">{{ t(TYPE_LABELS[report.submission_type]) }}</span>
                <time class="text-sm text-muted" :datetime="report.created_at">{{ formatDate(report.created_at, locale) }}</time>
              </div>
              <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('moderation_hidden_title') }}</h2>
              <div class="mb-4 rounded-lg border border-border bg-gray-50 p-4 dark:bg-gray-800">
                <p class="mt-0 mb-3 text-sm font-semibold">{{ t('appeals_content_snapshot') }}</p>
                <dl class="m-0 space-y-3">
                  <div v-for="field in snapshotFields(report.content_snapshot)" :key="field.key">
                    <dt class="text-xs font-semibold text-muted">{{ field.label }}</dt>
                    <dd class="m-0 whitespace-pre-wrap break-words text-sm">{{ field.value }}</dd>
                  </div>
                </dl>
              </div>
              <ModerationAppealForm
                appeal-type="rejected_submission"
                :report-id="report.id"
                :policy-code="report.policy_code"
                :rationale="report.description ?? undefined"
              />
            </article>
          </div>
        </section>
      </div>
    </main>

    <AppFooter />
  </div>
</template>
