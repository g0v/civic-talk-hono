<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { formatDate, useI18n } from '../l10n'
import { useAuth } from '../composables/useAuth'
import type { Issue, Opinion } from '../db/queries'

const props = defineProps<{
  issueId: number
  opinionId: number
  initialData?: {
    opinion: Opinion
    issue: Issue
  } | null
}>()

const { t, locale } = useI18n()
const { ensureAuthSession } = useAuth()

const opinion = ref<Opinion | null>(props.initialData?.opinion ?? null)
const issue = ref<Issue | null>(props.initialData?.issue ?? null)
const loading = ref(!props.initialData)
const notFound = ref(false)
const linkCopied = ref(false)

async function load() {
  loading.value = true
  try {
    // 從議題詳情端點撈全部意見，再根據 opinionId 找到目標
    const res = await fetch(`/api/issues/${props.issueId}`)
    if (!res.ok) {
      notFound.value = true
      return
    }
    const data = (await res.json()) as {
      issue: Issue
      opinions?: Opinion[]
    }
    issue.value = data.issue
    const found = (data.opinions ?? []).find(o => o.id === props.opinionId)
    if (!found) {
      notFound.value = true
      return
    }
    opinion.value = found
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!props.initialData) void load()
  void ensureAuthSession()
})

async function copyLink() {
  if (typeof navigator === 'undefined') return
  try {
    await navigator.clipboard.writeText(window.location.href)
    linkCopied.value = true
    setTimeout(() => {
      linkCopied.value = false
    }, 2000)
  } catch {
    // clipboard 拒絕（非 https 環境）：fallback 至選取
  }
}
</script>

<template>
  <div>
    <AppHeader current="issue" />

    <main class="py-8">
      <div class="container">
        <!-- 載入中 -->
        <div v-if="loading" class="empty">
          <div class="empty-icon">⏳</div>
          {{ t('loading') }}
        </div>

        <!-- 找不到 -->
        <div v-else-if="notFound" class="empty">
          <div class="empty-icon">🔍</div>
          {{ t('op_detail_not_found') }}
          <div class="mt-4">
            <a :href="`/issues/${issueId}`" class="btn btn-secondary btn-sm">{{ t('op_detail_back') }}</a>
          </div>
        </div>

        <template v-else-if="opinion && issue">
          <!-- 麵包屑 / 所屬議題 -->
          <div class="mb-6">
            <a :href="`/issues/${issue.id}`" class="text-sm text-muted hover:underline">
              {{ t('op_detail_back') }}
            </a>
            <p class="mt-2 mb-0 text-sm text-muted">
              {{ t('op_detail_issue_label') }}：
              <a :href="`/issues/${issue.id}`" class="font-medium hover:underline">{{ issue.title }}</a>
              <span class="ml-2"><StatusBadge :status="issue.status" /></span>
            </p>
          </div>

          <!-- 意見主卡 -->
          <div class="card mb-6">
            <h1 class="mt-0 mb-3 font-serif text-2xl font-bold">{{ t('op_detail_page_title') }}</h1>
            <p class="mb-4 text-sm text-muted">
              {{ t('issue_created') }} {{ formatDate(opinion.created_at, locale) }} · {{ t('op_author_label') }}：{{ opinion.author_name || t('author_system') }}
              <template v-if="opinion.author_email"> · {{ t('author_email_label') }}：{{ opinion.author_email }}</template>
            </p>

            <div v-if="opinion.abuse_flagged === 3" class="whitespace-pre-wrap leading-relaxed text-muted">{{ t('moderation_hidden_placeholder') }}</div>
            <div v-else class="whitespace-pre-wrap leading-relaxed">{{ opinion.summary }}</div>
          </div>

          <!-- 分享區塊 -->
          <div class="card mb-6">
            <p class="mt-0 mb-2 text-sm text-muted">{{ t('op_detail_share_hint') }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <code class="flex-1 truncate rounded bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-xs text-muted">
                {{ typeof window !== 'undefined' ? window.location.href : '' }}
              </code>
              <button type="button" class="btn btn-secondary btn-sm shrink-0" @click="copyLink">
                {{ linkCopied ? t('op_detail_link_copied') : t('op_detail_copy_link') }}
              </button>
            </div>
          </div>

          <!-- 返回連結 -->
          <a :href="`/issues/${issue.id}#opinions`" class="btn btn-secondary btn-sm">
            {{ t('op_detail_back') }}
          </a>
        </template>
      </div>
    </main>

    <AppFooter />
  </div>
</template>
