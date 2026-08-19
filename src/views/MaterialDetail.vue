<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import AuthorEmailLink from '../components/AuthorEmailLink.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { formatDate, useI18n } from '../l10n'
import { useAuth } from '../composables/useAuth'
import type { Issue, Material } from '../db/queries'

const props = defineProps<{
  issueId: number
  materialId: number
  initialData?: {
    material: Material
    issue: Issue
  } | null
}>()

const { t, locale } = useI18n()
const { ensureAuthSession } = useAuth()

const material = ref<Material | null>(props.initialData?.material ?? null)
const issue = ref<Issue | null>(props.initialData?.issue ?? null)
const loading = ref(!props.initialData)
const notFound = ref(false)
const linkCopied = ref(false)

async function load() {
  loading.value = true
  try {
    // 從議題詳情端點撈全部素材，再根據 materialId 找到目標
    const res = await fetch(`/api/issues/${props.issueId}`)
    if (!res.ok) {
      notFound.value = true
      return
    }
    const data = (await res.json()) as {
      issue: Issue
      materials?: Material[]
    }
    issue.value = data.issue
    const found = (data.materials ?? []).find(m => m.id === props.materialId)
    if (!found) {
      notFound.value = true
      return
    }
    material.value = found
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!props.initialData) void load()
  void ensureAuthSession()
})

function stanceLabel(s: string) {
  if (s === 'pro') return t('stance_pro')
  if (s === 'con') return t('stance_con')
  if (s === 'neutral') return t('stance_neutral')
  return t('stance_unknown')
}

function stanceClass(s: string) {
  if (s === 'pro') return 'stance-pro'
  if (s === 'con') return 'stance-con'
  if (s === 'neutral') return 'stance-neutral'
  return 'text-muted'
}

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
          {{ t('src_not_found') }}
          <div class="mt-4">
            <a :href="`/issues/${issueId}`" class="btn btn-secondary btn-sm">{{ t('src_back') }}</a>
          </div>
        </div>

        <template v-else-if="material && issue">
          <!-- 麵包屑 / 所屬議題 -->
          <div class="mb-6">
            <a :href="`/issues/${issue.id}`" class="text-sm text-muted hover:underline">
              {{ t('src_back') }}
            </a>
            <p class="mt-2 mb-0 text-sm text-muted">
              {{ t('src_issue_label') }}：
              <a :href="`/issues/${issue.id}`" class="font-medium hover:underline">{{ issue.title }}</a>
              <span class="ml-2"><StatusBadge :status="issue.status" /></span>
            </p>
          </div>

          <!-- 素材主卡 -->
          <div class="card mb-6">
            <!-- 來源 & 立場 -->
            <div class="mb-3 flex flex-wrap items-center gap-3">
              <h1 class="m-0 font-serif text-2xl font-bold">
                {{ material.source_name || t('mat_source_unknown') }}
              </h1>
              <span class="text-sm font-medium" :class="stanceClass(material.stance)">
                {{ stanceLabel(material.stance) }}
              </span>
            </div>

            <!-- 來源連結 -->
            <p v-if="material.source_url" class="mb-3 text-sm">
              <a :href="material.source_url" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1">
                {{ t('mat_link') }}
              </a>
            </p>

            <div v-if="material.abuse_flagged === 3" class="whitespace-pre-wrap leading-relaxed text-muted">{{ t('moderation_hidden_placeholder') }}</div>
            <div v-else class="whitespace-pre-wrap leading-relaxed">{{ material.content }}</div>

            <!-- 後設資訊 -->
            <p class="mt-4 mb-0 text-sm text-muted">
              {{ t('issue_created') }} {{ formatDate(material.created_at, locale) }} · {{ material.verified_count }} {{ t('mat_contributor') }} · {{ t('mat_author_label') }}：{{
                material.author_name || t('author_system')
              }}
              <template v-if="material.author_email"> <AuthorEmailLink :email="material.author_email" :name="material.author_name" /></template>
            </p>
          </div>

          <!-- 分享區塊 -->
          <div class="card mb-6">
            <p class="mt-0 mb-2 text-sm text-muted">{{ t('src_share_hint') }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <code class="flex-1 truncate rounded bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-xs text-muted">
                {{ typeof window !== 'undefined' ? window.location.href : '' }}
              </code>
              <button type="button" class="btn btn-secondary btn-sm shrink-0" @click="copyLink">
                {{ linkCopied ? t('src_link_copied') : t('src_copy_link') }}
              </button>
            </div>
          </div>

          <!-- 返回連結 -->
          <a :href="`/issues/${issue.id}#materials`" class="btn btn-secondary btn-sm">
            {{ t('src_back') }}
          </a>
        </template>
      </div>
    </main>

    <AppFooter />
  </div>
</template>
