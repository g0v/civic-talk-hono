<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import AuthorEmailLink from '../components/AuthorEmailLink.vue'
import OpinionVote from '../components/OpinionVote.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Toast from '../components/Toast.vue'
import { formatDate, useI18n } from '../l10n'
import { useAuth } from '../composables/useAuth'
import type { Issue, Opinion, OpinionVoteState, VoteValue } from '../db/queries'

const props = defineProps<{
  issueId: number
  opinionId: number
  initialData?: {
    opinion: Opinion
    issue: Issue
  } | null
}>()

const { t, locale } = useI18n()
const { authState, ensureAuthSession } = useAuth()

const opinion = ref<Opinion | null>(props.initialData?.opinion ?? null)
const issue = ref<Issue | null>(props.initialData?.issue ?? null)
const loading = ref(!props.initialData)
const notFound = ref(false)
const linkCopied = ref(false)
const toast = ref<{ show: (msg: string) => void } | null>(null)

// ---- 公民意見投票（#107）：與議題頁共用 OpinionVote 元件與同一組端點 ----
const voteState = ref<OpinionVoteState | null>(null)
const votePending = ref(false)

async function loadVoteState() {
  if (authState.value !== 'signed-in') {
    voteState.value = null
    return
  }
  const res = await fetch(`/api/issues/${props.issueId}/opinion-votes`)
  if (!res.ok) return
  const states = (await res.json()) as OpinionVoteState[]
  voteState.value = states.find(state => state.opinion_id === props.opinionId) ?? null
}

async function sendVote(request: RequestInit) {
  if (votePending.value) return
  votePending.value = true
  try {
    const res = await fetch(`/api/opinions/${props.opinionId}/vote`, request)
    if (!res.ok) {
      toast.value?.show(t('vote_failed'))
      return
    }
    const data = (await res.json()) as { state: OpinionVoteState | null }
    voteState.value = data.state
  } finally {
    votePending.value = false
  }
}

function castVote(_opinionId: number, value: VoteValue) {
  void sendVote({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
}

function retractVote() {
  void sendVote({ method: 'DELETE' })
}

function promptVoteLogin() {
  toast.value?.show(t('vote_login_required'))
}

// 登入狀態要等 /api/me 回來才確定，所以用 watch 而不是 onMounted 直接抓
watch(
  () => authState.value,
  () => {
    void loadVoteState()
  },
  { immediate: true }
)

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
              <template v-if="opinion.author_email"> <AuthorEmailLink :email="opinion.author_email" :name="opinion.author_name" /></template>
            </p>

            <div v-if="opinion.abuse_flagged === 3" class="whitespace-pre-wrap leading-relaxed text-muted">{{ t('moderation_hidden_placeholder') }}</div>
            <div v-else class="whitespace-pre-wrap leading-relaxed">{{ opinion.summary }}</div>
            <OpinionVote
              v-if="opinion.abuse_flagged !== 2 && opinion.abuse_flagged !== 3"
              :opinion-id="opinion.id"
              :state="voteState"
              :auth-state="authState"
              :pending="votePending"
              @vote="castVote"
              @retract="retractVote"
              @login-required="promptVoteLogin"
            />
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
    <Toast ref="toast" />
  </div>
</template>
