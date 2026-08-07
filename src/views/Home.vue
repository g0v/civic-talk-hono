<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import IssueCard from '../components/IssueCard.vue'
import SignInButtons from '../components/SignInButtons.vue'
import Toast from '../components/Toast.vue'
import { useI18n } from '../l10n'
import { useAuth } from '../composables/useAuth'
import type { IssueListItem } from '../db/queries'

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
const toast = ref<{ show: (msg: string) => void } | null>(null)

// 全站共用的登入狀態（與 AppHeader 共用同一次 /api/me）；SSR 期間永遠是 'loading'
const { authState, ensureAuthSession } = useAuth()
// 送出時才發現 session 過期：表單留著（別吃掉使用者打的字），只在上方補一列重新登入
const sessionExpired = ref(false)

const searchQuery = ref('')
type SortOrder = 'newest' | 'most' | 'least'
const sortOrder = ref<SortOrder>('newest')

const filteredAndSortedIssues = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  let result = q
    ? issues.value.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.description ?? '').toLowerCase().includes(q),
      )
    : [...issues.value]
  if (sortOrder.value === 'most') {
    result.sort((a, b) => (b.material_count + b.opinion_count) - (a.material_count + a.opinion_count))
  } else if (sortOrder.value === 'least') {
    result.sort((a, b) => (a.material_count + a.opinion_count) - (b.material_count + b.opinion_count))
  } else {
    // newest: created_at DESC (API already returns this order; preserve stable sort)
    result.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  }
  return result
})

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
})

async function createIssue() {
  if (!title.value.trim()) {
    toast.value?.show(t('idx_toast_title_required'))
    return
  }
  submitting.value = true
  try {
    const res = await fetch('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.value.trim(), description: description.value }),
    })
    // session 可能在填表期間過期——守門在伺服器端，前端接住 401 但保留已填內容
    if (res.status === 401) {
      sessionExpired.value = true
      toast.value?.show(t('login_expired_toast'))
      return
    }
    // 帳號被停權：提示並保留表單內容（不清表單、不切登入狀態，守門在伺服器端）
    if (res.status === 403) {
      toast.value?.show(t('banned_toast'))
      return
    }
    if (!res.ok) {
      toast.value?.show(t('idx_toast_create_fail'))
      return
    }
    const data = (await res.json()) as { id: number }
    toast.value?.show(t('idx_toast_create_ok'))
    showForm.value = false
    title.value = ''
    description.value = ''
    setTimeout(() => {
      window.location.href = `/issues/${data.id}`
    }, 800)
  } catch {
    toast.value?.show(t('idx_toast_create_fail'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <AppHeader current="home" show-new-issue @new-issue="showForm = true" />

    <div class="vt-hero">
      <div class="vt-hero-inner">
        <div class="hero-tag">{{ t('site_tagline') }}</div>
        <h1 class="hero-title">{{ t('idx_page_title') }}</h1>
        <p class="hero-desc">{{ t('idx_page_subtitle') }}</p>
        <div class="hero-btns">
          <a href="/about" class="btn btn-outline-white">{{ t('nav_about') }}</a>
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
            <div class="form-group">
              <label>
                <span>{{ t('idx_label_title') }}</span>
                <span class="label-hint">{{ t('idx_hint_title') }}</span>
              </label>
              <input v-model="title" type="text" :placeholder="t('idx_ph_title')" />
            </div>
            <div class="form-group">
              <label>
                <span>{{ t('idx_label_desc') }}</span>
                <span class="label-hint">{{ t('idx_hint_desc') }}</span>
              </label>
              <textarea
                v-model="description"
                rows="3"
                :placeholder="t('idx_ph_desc')"
              />
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
            <button
              v-for="s in (['newest', 'most', 'least'] as const)"
              :key="s"
              type="button"
              class="btn btn-sm"
              :class="sortOrder === s ? 'btn-primary' : 'btn-secondary'"
              @click="sortOrder = s"
            >
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
