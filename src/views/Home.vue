<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import IssueCard from '../components/IssueCard.vue'
import SignInButtons from '../components/SignInButtons.vue'
import Toast from '../components/Toast.vue'
import ModerationAppealNotice from '../components/ModerationAppealNotice.vue'
import { useI18n } from '../l10n'
import { useAuth } from '../composables/useAuth'
import { useViewerRole, type ViewerRole } from '../composables/useViewerRole'
import type { IssueListItem } from '../db/queries'
import { filterAndSortHomeIssues, type SortOrder } from '../lib/homeSorting'

const props = defineProps<{
  initialIssues?: IssueListItem[]
}>()

const { t } = useI18n()
const issues = ref<IssueListItem[]>(props.initialIssues ?? [])
const loading = ref(!props.initialIssues)
const showForm = ref(false)
const title = ref('')
const description = ref('')
const submitting = ref(false)
const issueTosAgreed = ref(false)
// Email 公開選項（#27）
const issueShowEmail = ref(false)
const toast = ref<{ show: (msg: string) => void } | null>(null)

// 全站共用的登入狀態（與 AppHeader 共用同一次 /api/me）；SSR 期間永遠是 'loading'
const { authState, session, ensureAuthSession } = useAuth()
// 送出時才發現 session 過期：表單留著（別吃掉使用者打的字），只在上方補一列重新登入
const sessionExpired = ref(false)
const moderationNotice = ref<{ appealType: 'rejected_submission' | 'account_ban'; reportId?: number; policyCode?: string; rationale?: string } | null>(null)

const searchQuery = ref('')
const sortOrder = ref<SortOrder>('newest')
// 全站檢視角色（#77、#90、#99）：navbar 切換後，首頁清單立即依角色更新。
const { viewerRole, preferredViewerRole, initViewerRole, setViewerRole } = useViewerRole()

// 首頁歡迎提示：角色偏好與「不再顯示」是兩個互相獨立的 localStorage 設定。
const WELCOME_PROMPT_HIDDEN_KEY = 'civic_welcome_prompt_hidden'
const showWelcomePrompt = ref(false)
const welcomeRole = ref<ViewerRole | null>(null)
const rememberWelcomeRole = ref(false)
const hideWelcomePromptNextTime = ref(false)
const welcomeDialog = ref<HTMLElement | null>(null)

function isWelcomePromptHidden(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(WELCOME_PROMPT_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

function saveWelcomePromptVisibility(): void {
  try {
    if (hideWelcomePromptNextTime.value) window.localStorage.setItem(WELCOME_PROMPT_HIDDEN_KEY, 'true')
    else window.localStorage.removeItem(WELCOME_PROMPT_HIDDEN_KEY)
  } catch {
    /* localStorage 不可用時，只關閉目前這次提示。 */
  }
}

function confirmWelcomeRole(): void {
  if (!welcomeRole.value) return
  setViewerRole(welcomeRole.value, { remember: rememberWelcomeRole.value })
  saveWelcomePromptVisibility()
  showWelcomePrompt.value = false
}

function skipWelcomePrompt(): void {
  saveWelcomePromptVisibility()
  showWelcomePrompt.value = false
}

// 建立議題表單：標題相近的既有議題提示（僅供參考，不擋送出、不做審核判斷，見 #36）
const similarIssues = computed(() => {
  const q = title.value.trim().toLowerCase()
  if (q.length < 2) return []
  return issues.value.filter(i => (i.title ?? '').toLowerCase().includes(q)).slice(0, 5)
})

const filteredAndSortedIssues = computed(() => filterAndSortHomeIssues(issues.value, viewerRole.value, sortOrder.value, searchQuery.value))

async function loadIssues() {
  loading.value = true
  try {
    const res = await fetch('/api/issues')
    if (res.ok) issues.value = await res.json()
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!props.initialIssues) void loadIssues()
  void ensureAuthSession()
  initViewerRole()
  welcomeRole.value = preferredViewerRole.value
  rememberWelcomeRole.value = preferredViewerRole.value !== null
  showWelcomePrompt.value = !isWelcomePromptHidden()
  if (showWelcomePrompt.value) void nextTick(() => welcomeDialog.value?.focus())
})

async function createIssue() {
  if (!title.value.trim()) {
    toast.value?.show(t('idx_toast_title_required'))
    return
  }
  if (!issueTosAgreed.value) {
    toast.value?.show(t('tos_required_toast'))
    return
  }
  submitting.value = true
  try {
    const res = await fetch('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.value.trim(),
        description: description.value,
        show_email: issueShowEmail.value,
        terms_accepted: issueTosAgreed.value,
      }),
    })
    // session 可能在填表期間過期——守門在伺服器端，前端接住 401 但保留已填內容
    if (res.status === 401) {
      sessionExpired.value = true
      toast.value?.show(t('login_expired_toast'))
      return
    }
    // 帳號被管理員停權：保留表單內容，另提供帳號申訴入口。
    if (res.status === 403) {
      moderationNotice.value = { appealType: 'account_ban' }
      toast.value?.show(t('banned_toast'))
      return
    }
    if (!res.ok) {
      toast.value?.show(t('idx_toast_create_fail'))
      return
    }
    const data = (await res.json()) as { id: number; moderation?: { hidden?: boolean; policy_code?: string; rationale?: string; report_id?: number | null } }
    if (data.moderation?.hidden) {
      moderationNotice.value = {
        appealType: 'rejected_submission',
        reportId: data.moderation.report_id ?? undefined,
        policyCode: data.moderation.policy_code,
        rationale: data.moderation.rationale,
      }
      toast.value?.show(t('moderation_hidden_title'))
      return
    }
    toast.value?.show(t('idx_toast_create_ok'))
    showForm.value = false
    title.value = ''
    description.value = ''
    issueTosAgreed.value = false
    issueShowEmail.value = false
    setTimeout(() => {
      window.location.href = `/issues/${data.id}`
    }, 800)
  } catch {
    toast.value?.show(t('idx_toast_create_fail'))
  } finally {
    submitting.value = false
  }
}

async function copyRssUrl() {
  const url = `${window.location.origin}/rss.xml`
  try {
    await navigator.clipboard.writeText(url)
    toast.value?.show(t('rss_copy_ok'))
  } catch {
    toast.value?.show(t('rss_copy_fail', { url }))
  }
}
</script>

<template>
  <div>
    <AppHeader current="home" show-new-issue @new-issue="showForm = true" />

    <div v-if="showWelcomePrompt" class="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-black/55 p-4" @click.self="skipWelcomePrompt" @keydown.esc="skipWelcomePrompt">
      <section
        ref="welcomeDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        tabindex="-1"
        class="relative my-auto max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl border border-vt-border bg-vt-bg-1 p-5 shadow-xl outline-none sm:p-7"
      >
        <button
          type="button"
          class="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none text-vt-fg-2 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vt-democratic-red dark:hover:bg-white/10"
          :aria-label="t('welcome_close')"
          @click="skipWelcomePrompt"
        >
          <span aria-hidden="true">×</span>
        </button>

        <div class="mb-5 pr-10">
          <div class="section-label mb-2">WELCOME</div>
          <h2 id="welcome-title" class="mt-0 mb-2 font-serif text-2xl font-bold text-vt-fg-1">{{ t('welcome_title') }}</h2>
          <p class="m-0 text-vt-fg-2">{{ t('welcome_intro') }}</p>
        </div>

        <div class="mb-5 grid gap-3 sm:grid-cols-2">
          <label
            v-for="role in ['citizen', 'volunteer'] as const"
            :key="role"
            class="cursor-pointer rounded-xl border-2 p-4 text-left transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-vt-democratic-red"
            :class="welcomeRole === role ? 'border-vt-democratic-red bg-vt-democratic-red/5' : 'border-vt-border bg-vt-bg-1 hover:border-vt-democratic-red/50'"
          >
            <input v-model="welcomeRole" type="radio" name="welcome-role" :value="role" class="sr-only" />
            <span class="mb-2 block text-2xl" aria-hidden="true">{{ role === 'citizen' ? '💬' : '🤝' }}</span>
            <span class="mb-1 block font-serif text-lg font-bold text-vt-fg-1">{{ t(role === 'citizen' ? 'idx_role_citizen' : 'idx_role_volunteer') }}</span>
            <span class="block text-sm leading-relaxed text-vt-fg-2">{{ t(role === 'citizen' ? 'welcome_citizen_desc' : 'welcome_volunteer_desc') }}</span>
            <span class="mt-2 block text-sm font-medium text-vt-democratic-red">{{ t(role === 'citizen' ? 'welcome_citizen_priority' : 'welcome_volunteer_priority') }}</span>
          </label>
        </div>

        <div class="mb-5 space-y-3 rounded-lg bg-vt-bg-2 p-4">
          <label class="flex cursor-pointer items-start gap-2.5">
            <input v-model="rememberWelcomeRole" type="checkbox" class="mt-1 w-auto" />
            <span>
              <span class="block font-medium text-vt-fg-1">{{ t('welcome_remember_role') }}</span>
              <span class="block text-sm text-vt-fg-3">{{ t('welcome_remember_role_hint') }}</span>
            </span>
          </label>
          <label class="flex cursor-pointer items-start gap-2.5">
            <input v-model="hideWelcomePromptNextTime" type="checkbox" class="mt-1 w-auto" />
            <span>
              <span class="block font-medium text-vt-fg-1">{{ t('welcome_hide_prompt') }}</span>
              <span class="block text-sm text-vt-fg-3">{{ t('welcome_hide_prompt_hint') }}</span>
            </span>
          </label>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="btn btn-secondary" @click="skipWelcomePrompt">{{ t('welcome_later') }}</button>
          <button type="button" class="btn btn-primary" :disabled="welcomeRole === null" @click="confirmWelcomeRole">{{ t('welcome_start') }}</button>
        </div>
      </section>
    </div>

    <div class="vt-hero">
      <div class="vt-hero-inner">
        <div class="hero-tag">{{ t('site_tagline') }}</div>
        <h1 class="hero-title">{{ t('idx_page_title') }}</h1>
        <p class="hero-desc">{{ t('idx_page_subtitle') }}</p>
        <div class="hero-btns">
          <a href="/about" class="btn btn-outline-white">{{ t('nav_about') }}</a>
          <button type="button" class="btn btn-outline-white" @click="copyRssUrl">{{ t('rss_subscribe_btn') }}</button>
        </div>
      </div>
    </div>

    <main class="pt-9 pb-8">
      <div class="container">
        <div v-if="showForm" class="card mb-6">
          <h2 class="mb-4 mt-0 font-bold">{{ t('idx_form_title') }}</h2>

          <!-- 還在讀 session（onMounted 打 /api/me）：先不決定要出表單還是登入卡 -->
          <p v-if="authState === 'loading'" class="m-0 text-muted">{{ t('loading') }}</p>

          <!-- 未登入：建立議題需登入，表單不出現（守門在伺服器端） -->
          <template v-else-if="authState === 'anonymous'">
            <p class="mb-4 text-muted">{{ t('idx_login_desc') }}</p>
            <SignInButtons callback-url="/" />
            <p class="mt-4 mb-4 text-sm text-muted">{{ t('login_shared_account_hint') }}</p>
            <button type="button" class="btn btn-secondary" @click="showForm = false">
              {{ t('cancel') }}
            </button>
          </template>

          <template v-else>
            <!-- 填表期間 session 過期：表單留著，只補一列重新登入 -->
            <div v-if="sessionExpired" class="alert alert-warn mb-5">
              <p class="mt-0 mb-3">{{ t('login_expired_hint') }}</p>
              <SignInButtons callback-url="/" />
            </div>
            <ModerationAppealNotice
              v-if="moderationNotice"
              :appeal-type="moderationNotice.appealType"
              :report-id="moderationNotice.reportId"
              :policy-code="moderationNotice.policyCode"
              :rationale="moderationNotice.rationale"
            />
            <div class="form-group">
              <label>
                <span>{{ t('idx_label_title') }}</span>
                <span class="label-hint">{{ t('idx_hint_title') }}</span>
              </label>
              <input v-model="title" type="text" :placeholder="t('idx_ph_title')" />
              <ul v-if="similarIssues.length" class="mt-2 space-y-1 text-sm">
                <li class="text-muted">{{ t('idx_similar_hint') }}</li>
                <li v-for="s in similarIssues" :key="s.id">
                  <a :href="`/issues/${s.id}`" target="_blank" rel="noopener noreferrer">{{ s.title }}</a>
                </li>
              </ul>
            </div>
            <div class="form-group">
              <label>
                <span>{{ t('idx_label_desc') }}</span>
                <span class="label-hint">{{ t('idx_hint_desc') }}</span>
              </label>
              <textarea v-model="description" rows="3" :placeholder="t('idx_ph_desc')" />
            </div>
            <div class="form-group">
              <label class="flex items-start gap-2 font-normal">
                <input v-model="issueTosAgreed" type="checkbox" class="mt-1 w-auto" />
                <span
                  >{{ t('tos_agree_prefix') }}<a href="/terms" target="_blank" class="underline">{{ t('tos_terms_link') }}</a
                  >{{ t('tos_agree_mid') }}<a href="/privacy" target="_blank" class="underline">{{ t('tos_privacy_link') }}</a
                  >{{ t('tos_agree_suffix') }}</span
                >
              </label>
            </div>
            <div class="form-group">
              <label class="flex items-start gap-2 font-normal">
                <input v-model="issueShowEmail" type="checkbox" class="mt-1 w-auto" />
                <span
                  >{{ t('show_email_label', { email: session?.user.email || '' }) }} <span class="text-muted">{{ t('show_email_hint') }}</span></span
                >
              </label>
            </div>
            <div class="flex gap-2">
              <button type="button" class="btn btn-primary" :disabled="submitting" @click="createIssue">
                {{ t('idx_submit') }}
              </button>
              <button type="button" class="btn btn-secondary" @click="showForm = false">
                {{ t('cancel') }}
              </button>
            </div>
          </template>
        </div>

        <div class="mb-4 flex flex-wrap items-center gap-3">
          <div class="section-label shrink-0">ISSUES</div>
          <input
            v-model="searchQuery"
            type="search"
            class="flex-1 min-w-40 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-vt-democratic-red/40"
            :placeholder="t('idx_search_ph')"
          />
          <div class="flex gap-1 shrink-0">
            <button v-for="s in ['newest', 'most', 'least'] as const" :key="s" type="button" class="btn btn-sm" :class="sortOrder === s ? 'btn-primary' : 'btn-secondary'" @click="sortOrder = s">
              {{ t(s === 'newest' ? 'idx_sort_newest' : s === 'most' ? 'idx_sort_most' : 'idx_sort_least') }}
            </button>
          </div>
        </div>

        <div v-if="loading" class="empty">
          <div class="empty-icon">⏳</div>
          {{ t('loading') }}
        </div>
        <div v-else-if="!issues.length" class="empty">
          <div class="empty-icon">🌱</div>
          {{ t('idx_empty') }}
        </div>
        <div v-else-if="!filteredAndSortedIssues.length" class="empty">
          <div class="empty-icon">🔍</div>
          {{ t('idx_search_no_result', { keyword: searchQuery.trim() }) }}
        </div>
        <div v-else>
          <IssueCard v-for="issue in filteredAndSortedIssues" :key="issue.id" :issue="issue" />
        </div>
      </div>
    </main>

    <AppFooter />
    <Toast ref="toast" />
  </div>
</template>
