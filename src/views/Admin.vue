<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import SignInButtons from '../components/SignInButtons.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Toast from '../components/Toast.vue'
import { formatDate, useI18n } from '../l10n'
import type { MessageKey } from '../l10n/zh-TW'
import { useAuth } from '../composables/useAuth'
import { postSubmissionWithDuplicateNameCheck } from '../client/submission'
import { isAdminSession } from '../client/auth-session'
import { parseIssueTagsInput } from '../lib/issueTags'
import type { AbuseReport, BriefingWithAuthor, Feedback, IssueListItemWithAuthor, IssueStatus, MaterialWithAuthor, ModerationAppeal, OpinionWithAuthor } from '../db/queries'

type AdminTab = 'issues' | 'materials' | 'opinions' | 'reports' | 'moderation' | 'feedback'

const { t, locale } = useI18n()
const toast = ref<{ show: (msg: string) => void } | null>(null)

/**
 * 登入狀態走全站共用的 useAuth（與 AppHeader 共用同一次 /api/me）。'loading' 是 SSR 與
 * hydration 首幀共用的狀態——伺服器端不知道也不該猜登入狀態，兩邊都先畫同一個骨架，
 * 等 onMounted 打 /api/me 才分岔，避免 hydration mismatch。
 *
 * 管理頁多一個 'forbidden'（登入了但角色不足）：從共用的 session 推導出來，
 * 因為只有這一頁在乎角色。
 */
const { authState, session, authFailed, ensureAuthSession, signOutAndReload } = useAuth()
const adminView = computed<'loading' | 'anonymous' | 'forbidden' | 'admin'>(() => {
  if (authState.value === 'loading') return 'loading'
  if (authState.value === 'anonymous' || !session.value) return 'anonymous'
  return isAdminSession(session.value) ? 'admin' : 'forbidden'
})
const duplicateNameRequiresEmail = computed(() => session.value?.hasDuplicateDisplayName === true)
const activeTab = ref<AdminTab>('feedback')
const stats = ref({ issues: 0, materials: 0, opinions: 0, briefings: 0 })
// 管理端讀到的議題／素材／意見都含建立者或投稿者（#9）；一般讀取者拿到的是公開形狀
const issues = ref<IssueListItemWithAuthor[]>([])
const materials = ref<MaterialWithAuthor[]>([])
const opinions = ref<OpinionWithAuthor[]>([])
const abuseReports = ref<AbuseReport[]>([])
const moderationAppeals = ref<ModerationAppeal[]>([])
const feedback = ref<Feedback[]>([])
const feedbackLoading = ref(false)
const feedbackError = ref(false)
const feedbackLoaded = ref(false)
const matIssueId = ref<number | ''>('')
const opIssueId = ref<number | ''>('')
const issueSearch = ref('')
const materialSearch = ref('')
const opinionSearch = ref('')
const reportSearch = ref('')

const modalEdit = ref(false)
const modalNew = ref(false)
const modalBriefing = ref(false)
const closureIssue = ref<IssueListItemWithAuthor | null>(null)
const closureReason = ref('')
const closurePending = ref(false)
const closureError = ref('')
const closureDialog = ref<HTMLDialogElement | null>(null)
const closureReasonInput = ref<HTMLTextAreaElement | null>(null)
let closureTrigger: HTMLElement | null = null
let closureDraft: { issueId: number; reason: string } | null = null
const editId = ref<number | null>(null)
const formTitle = ref('')
const formDesc = ref('')
const formTags = ref('')
const formStatus = ref<IssueStatus>('collecting')
const formTermsAgreed = ref(false)
const formShowEmailConfirmed = ref(false)
const briefConsensus = ref('')
const briefDisputes = ref('')
const briefPositions = ref('')
const briefNarrative = ref('')
const briefingIssueId = ref<number | null>(null)
const briefingAuthor = ref<BriefingWithAuthor | null>(null)

// 管理端請求靠同源 cookie 帶 session，不再有 X-Admin-Token
function authHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' }
}

onMounted(async () => {
  syncAdminTabFromUrl()
  window.addEventListener('popstate', syncAdminTabFromUrl)
  await ensureAuthSession()
  if (adminView.value === 'admin') {
    await bootstrap()
    await activateTab(activeTab.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', syncAdminTabFromUrl)
})

async function bootstrap() {
  await Promise.all([loadStats(), loadIssues(), loadAbuseReports(), loadModeration()])
}

async function loadStats() {
  const res = await fetch('/api/admin/stats', { headers: authHeaders() })
  if (res.ok) stats.value = await res.json()
}

async function loadIssues() {
  const res = await fetch('/api/issues')
  if (res.ok) issues.value = await res.json()
}

async function loadMaterials() {
  if (!matIssueId.value) {
    materials.value = []
    return
  }
  const res = await fetch(`/api/issues/${matIssueId.value}/materials`)
  if (res.ok) materials.value = await res.json()
}

async function loadOpinions() {
  if (!opIssueId.value) {
    opinions.value = []
    return
  }
  const res = await fetch(`/api/issues/${opIssueId.value}/opinions`)
  if (res.ok) opinions.value = await res.json()
}

async function onMatIssueChange() {
  materialSearch.value = ''
  await loadMaterials()
}
async function onOpIssueChange() {
  opinionSearch.value = ''
  await loadOpinions()
}

async function loadAbuseReports() {
  const res = await fetch('/api/admin/abuse-reports', { headers: authHeaders() })
  if (res.ok) abuseReports.value = await res.json()
}
async function loadModeration() {
  const appealsRes = await fetch('/api/admin/moderation/appeals', { headers: authHeaders() })
  if (appealsRes.ok) moderationAppeals.value = await appealsRes.json()
}

async function loadFeedback() {
  if (feedbackLoading.value) return
  feedbackLoading.value = true
  feedbackError.value = false
  try {
    const res = await fetch('/api/admin/feedback', { headers: authHeaders() })
    if (!res.ok) throw new Error('Failed to load feedback')
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) throw new Error('Invalid feedback response')
    feedback.value = data as Feedback[]
    feedbackLoaded.value = true
  } catch {
    feedbackError.value = true
  } finally {
    feedbackLoading.value = false
  }
}

type LiveUserEntry = { name: string | null; email: string; role: string | null; banned: boolean; banReason: string | null }
// 現值查詢快取（避免同一個 userId 重複打 API）
const liveUserCache = ref<Record<string, LiveUserEntry | 'loading' | 'not_found'>>({})

async function fetchLiveUser(userId: string) {
  if (liveUserCache.value[userId]) return
  liveUserCache.value = { ...liveUserCache.value, [userId]: 'loading' }
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { headers: authHeaders() })
  if (res.ok) {
    const data = (await res.json()) as LiveUserEntry
    liveUserCache.value = { ...liveUserCache.value, [userId]: data }
  } else {
    liveUserCache.value = { ...liveUserCache.value, [userId]: 'not_found' }
  }
}

/** 從快取中取回已確認的 LiveUserEntry；若仍在 loading / not_found / 未查詢，回 null。 */
function liveUser(userId: string): LiveUserEntry | null {
  const v = liveUserCache.value[userId]
  return v && typeof v === 'object' ? v : null
}

async function resolveReport(id: number, action: 'false_report' | 'confirmed_abuse' | 'confirmed_broken', banUser = true) {
  const confirmKey =
    action === 'false_report'
      ? banUser
        ? 'adm_rpt_confirm_false'
        : 'adm_rpt_confirm_false_no_ban'
      : action === 'confirmed_abuse'
        ? banUser
          ? 'adm_rpt_confirm_abuse'
          : 'adm_rpt_confirm_abuse_no_ban'
        : 'adm_rpt_confirm_broken'
  if (!confirm(t(confirmKey))) return
  const res = await fetch(`/api/admin/abuse-reports/${id}/resolve`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ action, banUser }),
  })
  if (res.ok) {
    toast.value?.show(t('adm_rpt_toast_resolved'))
    await loadAbuseReports()
  } else {
    let msg = t('adm_rpt_toast_fail')
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) msg = data.error
    } catch {
      /* 忽略 */
    }
    toast.value?.show(msg)
  }
}

async function resolveAppeal(id: number, action: 'uphold' | 'overturn') {
  const confirmKey = action === 'uphold' ? 'adm_mod_confirm_uphold' : 'adm_mod_confirm_overturn'
  if (!confirm(t(confirmKey))) return
  const res = await fetch(`/api/admin/moderation/appeals/${id}/resolve`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ action }),
  })
  if (res.ok) {
    toast.value?.show(t('adm_mod_toast_done'))
    await loadModeration()
  } else {
    let msg = t('adm_mod_toast_fail')
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) msg = data.error
    } catch {
      /* 忽略 */
    }
    toast.value?.show(msg)
  }
}

function openNew() {
  formTitle.value = ''
  formDesc.value = ''
  formTags.value = ''
  formTermsAgreed.value = false
  formShowEmailConfirmed.value = false
  modalNew.value = true
}

function openEdit(issue: IssueListItemWithAuthor) {
  editId.value = issue.id
  formTitle.value = issue.title ?? ''
  formDesc.value = issue.description ?? ''
  formTags.value = issue.tags.join(', ')
  formStatus.value = issue.status
  modalEdit.value = true
}

async function openBriefing(issue: IssueListItemWithAuthor) {
  briefingIssueId.value = issue.id
  const res = await fetch(`/api/issues/${issue.id}/briefing`)
  const b = (res.ok ? await res.json() : null) as BriefingWithAuthor | null
  briefingAuthor.value = b
  briefConsensus.value = b?.consensus ?? ''
  briefDisputes.value = b?.disputes ?? ''
  briefPositions.value = b?.positions ?? ''
  briefNarrative.value = b?.narrative ?? ''
  modalBriefing.value = true
}

async function createIssue() {
  if (!formTitle.value.trim()) {
    toast.value?.show(t('adm_toast_title_required'))
    return
  }
  if (!formTermsAgreed.value) {
    toast.value?.show(t('tos_required_toast'))
    return
  }
  const res = await postSubmissionWithDuplicateNameCheck(
    '/api/issues',
    {
      title: formTitle.value.trim(),
      description: formDesc.value,
      tags: parseIssueTagsInput(formTags.value),
      show_email: formShowEmailConfirmed.value,
      terms_accepted: formTermsAgreed.value,
    },
    () => window.confirm(t('duplicate_name_submission_confirm', { email: session.value?.user.email || '' }))
  )
  if (!res) return
  if (!res.ok) return
  toast.value?.show(t('adm_toast_create'))
  modalNew.value = false
  await bootstrap()
}

async function saveIssue() {
  if (!editId.value || !formTitle.value.trim()) {
    toast.value?.show(t('adm_toast_title_required'))
    return
  }
  const res = await fetch(`/api/issues/${editId.value}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      title: formTitle.value.trim(),
      description: formDesc.value,
      tags: parseIssueTagsInput(formTags.value),
      status: formStatus.value,
      polis_id: issues.value.find(issue => issue.id === editId.value)?.polis_id ?? null,
    }),
  })
  if (!res.ok) return
  toast.value?.show(t('adm_toast_save'))
  modalEdit.value = false
  await bootstrap()
}

function openClosure(issue: IssueListItemWithAuthor, event: MouseEvent) {
  closureIssue.value = issue
  closureReason.value = closureDraft?.issueId === issue.id ? closureDraft.reason : ''
  closureError.value = ''
  closureTrigger = event.currentTarget as HTMLElement | null
  void nextTick(() => {
    closureDialog.value?.showModal()
    closureReasonInput.value?.focus()
  })
}

function closeClosure() {
  if (closurePending.value) return
  if (closureIssue.value) closureDraft = { issueId: closureIssue.value.id, reason: closureReason.value }
  closureDialog.value?.close()
  closureIssue.value = null
  void nextTick(() => closureTrigger?.focus())
}

function closeClosureOnBackdropClick(event: MouseEvent) {
  const element = closureDialog.value
  if (!element || event.target !== element) return
  const bounds = element.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeClosure()
}

async function saveClosure() {
  if (!closureIssue.value || closurePending.value) return
  const reason = closureReason.value.trim()
  if (!reason || [...reason].length > 1000) {
    closureError.value = t('adm_closure_reason_invalid')
    return
  }
  const closed = closureIssue.value.is_closed !== 1
  closurePending.value = true
  closureError.value = ''
  try {
    const res = await fetch(`/api/issues/${closureIssue.value.id}/closure`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ closed, reason }),
    })
    if (!res.ok) {
      closureError.value = t(res.status === 409 ? 'adm_closure_conflict' : 'adm_closure_failed')
      if (res.status === 409) await loadIssues()
      return
    }
    await loadIssues()
    toast.value?.show(t(closed ? 'adm_closure_closed' : 'adm_closure_reopened'))
    closurePending.value = false
    closeClosure()
    closureDraft = null
  } catch {
    closureError.value = t('adm_closure_failed')
  } finally {
    closurePending.value = false
  }
}

async function deleteIssue(issue: IssueListItemWithAuthor) {
  const msg = t('adm_confirm_delete', { title: issue.title ?? '' })
  if (!confirm(msg)) return
  const res = await fetch(`/api/issues/${issue.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) return
  toast.value?.show(t('adm_toast_delete'))
  await bootstrap()
}

async function saveBriefing() {
  if (!briefingIssueId.value) return
  const body = {
    consensus: briefConsensus.value,
    disputes: briefDisputes.value,
    positions: briefPositions.value,
    narrative: briefNarrative.value,
  }
  const existing = await fetch(`/api/issues/${briefingIssueId.value}/briefing`)
  const has = existing.ok && (await existing.json())
  const url = `/api/issues/${briefingIssueId.value}/briefing`
  let res: Response | null
  if (has) {
    res = await fetch(url, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(body),
    })
  } else {
    res = await postSubmissionWithDuplicateNameCheck(url, { ...body, show_email: false }, () => window.confirm(t('duplicate_name_submission_confirm', { email: session.value?.user.email || '' })))
  }
  if (!res) return
  if (!res.ok) return
  toast.value?.show(t('adm_toast_briefing_save'))
  modalBriefing.value = false
  await loadStats()
}

async function deleteMaterial(id: number) {
  if (!confirm(t('adm_confirm_mat'))) return
  const res = await fetch(`/api/materials/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) return
  toast.value?.show(t('adm_toast_delete'))
  await loadMaterials()
  await loadStats()
}

async function deleteOpinion(id: number) {
  if (!confirm(t('adm_confirm_op'))) return
  const res = await fetch(`/api/opinions/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) return
  toast.value?.show(t('adm_toast_delete'))
  await loadOpinions()
  await loadStats()
}

const ABUSE_REASON_LABELS: Record<string, MessageKey> = {
  spam: 'report_reason_spam',
  hate_speech: 'report_reason_hate_speech',
  defamation: 'report_reason_defamation',
  misinformation: 'report_reason_misinformation',
  other: 'report_reason_other',
  broken_link: 'report_reason_broken_link',
}
const REVIEW_STATUS_LABELS: Record<string, MessageKey> = {
  pending: 'adm_rpt_status_pending',
  resolved_false: 'adm_rpt_status_resolved_false',
  resolved_abuse: 'adm_rpt_status_resolved_abuse',
  resolved_broken: 'adm_rpt_status_resolved_broken',
}
const MODERATION_POLICY_LABELS: Record<string, MessageKey> = {
  spam: 'adm_mod_policy_spam',
  sexual_content: 'adm_mod_policy_sexual_content',
  hate_speech: 'adm_mod_policy_hate_speech',
  defamation: 'adm_mod_policy_defamation',
  misinformation: 'adm_mod_policy_misinformation',
  illegal: 'adm_mod_policy_illegal',
}
const APPEAL_STATUS_LABELS: Record<string, MessageKey> = {
  pending: 'adm_mod_appeal_pending',
  upheld: 'adm_mod_appeal_upheld',
  overturned: 'adm_mod_appeal_overturned',
}
const tabs = computed(() => [
  { id: 'feedback' as const, label: t('feedback_title') },
  { id: 'reports' as const, label: t('adm_tab_reports') },
  { id: 'moderation' as const, label: t('adm_tab_moderation') },
  { id: 'issues' as const, label: t('adm_tab_issues') },
  { id: 'materials' as const, label: t('adm_tab_materials') },
  { id: 'opinions' as const, label: t('adm_tab_opinions') },
])

function parseAdminTab(search: string): AdminTab {
  const tab = new URLSearchParams(search).get('tab')
  return ['issues', 'materials', 'opinions', 'reports', 'moderation', 'feedback'].includes(tab ?? '') ? (tab as AdminTab) : 'feedback'
}

function syncAdminTabFromUrl() {
  const nextTab = parseAdminTab(window.location.search)
  if (activeTab.value === nextTab) return
  activeTab.value = nextTab
  if (adminView.value === 'admin') void activateTab(nextTab)
}

async function activateTab(id: AdminTab) {
  if (id === 'reports' && abuseReports.value.length === 0) await loadAbuseReports()
  if (id === 'moderation' && moderationAppeals.value.length === 0) await loadModeration()
  if (id === 'feedback' && !feedbackLoaded.value && !feedbackError.value) await loadFeedback()
}

async function onTabChange(id: AdminTab) {
  if (activeTab.value === id) return
  activeTab.value = id
  const nextUrl = new URL(window.location.href)
  if (id === 'feedback') nextUrl.searchParams.delete('tab')
  else nextUrl.searchParams.set('tab', id)
  window.history.pushState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
  await activateTab(id)
}

const filteredIssues = computed(() => {
  if (!issueSearch.value.trim()) return issues.value
  const q = issueSearch.value.toLowerCase()
  return issues.value.filter(i => (i.title?.toLowerCase().includes(q) ?? false) || (i.description?.toLowerCase().includes(q) ?? false) || (i.author_name?.toLowerCase().includes(q) ?? false))
})

const filteredMaterials = computed(() => {
  if (!materialSearch.value.trim()) return materials.value
  const q = materialSearch.value.toLowerCase()
  return materials.value.filter(
    m =>
      (m.source_name?.toLowerCase().includes(q) ?? false) ||
      (m.source_url?.toLowerCase().includes(q) ?? false) ||
      (m.content?.toLowerCase().includes(q) ?? false) ||
      (m.author_name?.toLowerCase().includes(q) ?? false)
  )
})

const filteredOpinions = computed(() => {
  if (!opinionSearch.value.trim()) return opinions.value
  const q = opinionSearch.value.toLowerCase()
  return opinions.value.filter(o => (o.summary?.toLowerCase().includes(q) ?? false) || (o.author_name?.toLowerCase().includes(q) ?? false))
})

const filteredReports = computed(() => {
  if (!reportSearch.value.trim()) return abuseReports.value
  const q = reportSearch.value.toLowerCase()
  return abuseReports.value.filter(
    r =>
      (r.reporter_name?.toLowerCase().includes(q) ?? false) ||
      r.reporter_email.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q) ||
      t(ABUSE_REASON_LABELS[r.reason] ?? 'report_reason_other')
        .toLowerCase()
        .includes(q) ||
      (r.description?.toLowerCase().includes(q) ?? false)
  )
})

/**
 * 這裡刻意使用「內容快照」，而不是回查並複製完整的 ct_* 業務資料：
 * AI 複核與申訴需要看到模型判定當下實際收到的投稿欄位，不能讓內容後續被編輯、
 * 解除隱藏或刪除後改變審核依據。快照也讓 issue／material／opinion／briefing
 * 共用同一種稽核格式，且不額外複製作者資料、同意紀錄與狀態等非審查必要資訊。
 * AI 審查快照是 JSON；舊資料或帳號停權申訴則不保證是 JSON。
 */
function parseSnapshot(snapshotJSON: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(snapshotJSON) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function snapshotSummary(snapshotJSON: string): string {
  const summary = parseSnapshot(snapshotJSON)?.summary
  return typeof summary === 'string' && summary.trim() ? summary : snapshotJSON
}

const FEEDBACK_CATEGORY_LABELS: Record<Feedback['category'], MessageKey> = {
  bug: 'feedback_category_bug',
  usability: 'feedback_category_usability',
  suggestion: 'feedback_category_suggestion',
}

function isSafeFeedbackPagePath(pagePath: string): boolean {
  if (typeof pagePath !== 'string' || !pagePath.startsWith('/') || pagePath.startsWith('//') || /[\\#]/.test(pagePath)) return false
  for (const char of pagePath) {
    const code = char.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return false
  }
  try {
    const url = new URL(pagePath, 'https://civic-talk.invalid')
    return url.origin === 'https://civic-talk.invalid' && !url.hash
  } catch {
    return false
  }
}
</script>

<template>
  <div>
    <AppHeader current="admin" />

    <main class="py-9">
      <div class="page-container">
        <!-- 讀取 session 中：SSR 與 hydration 首幀共用這個骨架 -->
        <div v-if="adminView === 'loading'" class="mx-auto max-w-md">
          <div class="card">
            <h1 class="mt-0 mb-2 font-serif text-2xl">{{ t('adm_login_title') }}</h1>
            <p class="m-0 text-muted">{{ t('loading') }}</p>
          </div>
        </div>

        <!-- 未登入 -->
        <div v-else-if="adminView === 'anonymous'" class="mx-auto max-w-md">
          <div class="card">
            <h1 class="mt-0 mb-2 font-serif text-2xl">{{ t('adm_login_title') }}</h1>
            <p class="mb-4 text-muted">{{ t('adm_login_desc') }}</p>
            <SignInButtons callback-url="/admin" />
            <p v-if="authFailed" class="mt-3 mb-0 text-sm text-red">{{ t('login_err') }}</p>
            <p class="mt-4 mb-0 text-sm text-muted">{{ t('adm_login_hint') }}</p>
          </div>
        </div>

        <!-- 登入了，但這個帳號沒有管理權限 -->
        <div v-else-if="adminView === 'forbidden'" class="mx-auto max-w-md">
          <div class="card">
            <h1 class="mt-0 mb-2 font-serif text-2xl">{{ t('adm_forbidden_title') }}</h1>
            <p class="mb-4 text-muted">
              {{ t('adm_forbidden_desc', { email: session?.user.email ?? '' }) }}
            </p>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn btn-secondary" @click="signOutAndReload">
                {{ t('logout') }}
              </button>
              <a href="/" class="btn btn-ghost">{{ t('adm_back') }}</a>
            </div>
          </div>
        </div>

        <!-- Admin UI -->
        <template v-else>
          <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span class="status-badge status-published">{{ t('adm_badge') }}</span>
              <h1 class="mt-2 mb-0 font-serif text-2xl">{{ t('adm_login_title') }}</h1>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="session" class="text-sm text-muted">
                {{ t('signed_in_as', { name: session.user.name || session.user.email }) }}
              </span>
              <a href="/" class="btn btn-secondary btn-sm">{{ t('adm_back') }}</a>
            </div>
          </div>

          <div class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div class="card text-center">
              <div class="text-2xl font-bold text-red">{{ stats.issues }}</div>
              <div class="text-sm text-muted">{{ t('adm_stat_issues') }}</div>
            </div>
            <div class="card text-center">
              <div class="text-2xl font-bold text-teal">{{ stats.materials }}</div>
              <div class="text-sm text-muted">{{ t('adm_stat_materials') }}</div>
            </div>
            <div class="card text-center">
              <div class="text-2xl font-bold text-amber">{{ stats.opinions }}</div>
              <div class="text-sm text-muted">{{ t('adm_stat_opinions') }}</div>
            </div>
            <div class="card text-center">
              <div class="text-2xl font-bold text-ink">{{ stats.briefings }}</div>
              <div class="text-sm text-muted">{{ t('adm_stat_briefings') }}</div>
            </div>
          </div>

          <div class="tabs">
            <button v-for="tab in tabs" :key="tab.id" type="button" class="tab" :class="{ active: activeTab === tab.id }" @click="onTabChange(tab.id)">
              {{ tab.label }}
            </button>
          </div>

          <!-- AI moderation and appeals -->
          <section v-show="activeTab === 'moderation'">
            <h2 class="mt-0 mb-4 font-serif text-xl">{{ t('adm_mod_title') }}</h2>

            <div>
              <h3 class="mb-3 font-serif text-lg">{{ t('adm_mod_appeals_title') }}</h3>
              <div v-if="!moderationAppeals.length" class="empty">{{ t('adm_mod_empty_appeals') }}</div>
              <div v-else class="space-y-3">
                <article v-for="appeal in moderationAppeals" :key="appeal.id" class="card">
                  <div class="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <strong>{{ appeal.user_name || t('adm_author_unknown') }}</strong>
                      <span class="ml-2 text-sm text-muted">{{ appeal.user_email }}</span>
                    </div>
                    <span class="text-sm" :class="appeal.status === 'pending' ? 'text-amber' : appeal.status === 'overturned' ? 'text-teal' : 'text-muted'">
                      {{ t(APPEAL_STATUS_LABELS[appeal.status] ?? 'adm_mod_appeal_pending') }}
                    </span>
                  </div>
                  <p class="mb-2 text-sm text-muted">
                    {{ appeal.appeal_type === 'account_ban' ? t('adm_mod_type_account_ban') : t('adm_mod_type_rejected') }}
                    · {{ formatDate(appeal.created_at, locale) }}
                  </p>
                  <div v-if="appeal.content_snapshot" class="mb-2">
                    <strong class="text-sm">{{ t('adm_mod_th_content') }}</strong>
                    <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{{ snapshotSummary(appeal.content_snapshot) }}</pre>
                  </div>
                  <div class="mb-2">
                    <strong class="text-sm">{{ t('adm_mod_th_message') }}</strong>
                    <p class="mt-1 whitespace-pre-wrap text-sm">{{ appeal.message }}</p>
                  </div>
                  <div v-if="appeal.status === 'pending'" class="flex flex-wrap gap-2">
                    <button type="button" class="btn btn-ghost btn-sm" @click="resolveAppeal(appeal.id, 'uphold')">
                      {{ t('adm_mod_btn_uphold') }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm text-teal"
                      :disabled="appeal.appeal_type === 'account_ban' && session?.role !== 'super-admin'"
                      :title="appeal.appeal_type === 'account_ban' && session?.role !== 'super-admin' ? t('adm_mod_need_super_admin') : undefined"
                      @click="resolveAppeal(appeal.id, 'overturn')"
                    >
                      {{ t('adm_mod_btn_overturn') }}
                    </button>
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section v-show="activeTab === 'issues'">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="m-0 font-serif text-xl">{{ t('adm_issues_title') }}</h2>
              <button type="button" class="btn btn-primary btn-sm" @click="openNew">
                {{ t('adm_new_issue_btn') }}
              </button>
            </div>
            <div class="mb-3">
              <input
                v-model="issueSearch"
                type="search"
                class="w-full max-w-sm rounded border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red"
                :placeholder="t('adm_search_ph')"
              />
            </div>
            <div class="overflow-x-auto rounded-lg border border-border">
              <table class="w-full border-collapse text-sm">
                <thead class="bg-gray-100 dark:bg-gray-800">
                  <tr>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_id') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_title') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_status') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_materials') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_author') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_created') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="issue in filteredIssues" :key="issue.id" class="border-t border-border">
                    <td class="px-3 py-2">{{ issue.id }}</td>
                    <td class="px-3 py-2">
                      <a :href="`/issues/${issue.id}`">{{ issue.title }}</a>
                      <div v-if="issue.tags.length" class="mt-1 flex flex-wrap gap-1" :aria-label="t('issue_tags_label')">
                        <span v-for="tag in issue.tags" :key="tag" class="max-w-full wrap-break-word rounded bg-gray-100 px-2 py-1 text-xs text-ink dark:bg-gray-800">#{{ tag }}</span>
                      </div>
                    </td>
                    <td class="px-3 py-2">
                      <StatusBadge :status="issue.status" short />
                      <span class="mt-1 block text-xs text-muted">{{ t(issue.is_closed === 1 ? 'idx_tab_closed' : 'idx_tab_open') }}</span>
                    </td>
                    <td class="px-3 py-2">{{ issue.material_count }}</td>
                    <td class="px-3 py-2">
                      <div>{{ issue.author_name || t('adm_author_unknown') }}</div>
                      <div v-if="issue.author_id" class="text-xs text-muted">{{ t('adm_author_id') }}{{ issue.author_id }}</div>
                      <div v-if="issue.author_email" class="text-xs text-muted">
                        {{ t('adm_author_email') }}{{ issue.author_email }} · {{ issue.show_email === 1 ? t('adm_email_public') : t('adm_email_private') }}
                      </div>
                      <div v-if="issue.terms_version" class="text-xs text-muted">{{ t('adm_terms_record') }}{{ issue.terms_version }} · {{ issue.terms_accepted_at }}</div>
                    </td>
                    <td class="px-3 py-2">{{ formatDate(issue.created_at, locale) }}</td>
                    <td class="px-3 py-2">
                      <div class="flex flex-wrap gap-1">
                        <button type="button" class="btn btn-ghost btn-sm" @click="openEdit(issue)">
                          {{ t('adm_btn_edit') }}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" @click="openBriefing(issue)">
                          {{ t('adm_btn_briefing') }}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" @click="openClosure(issue, $event)">
                          {{ t(issue.is_closed === 1 ? 'adm_issue_reopen' : 'adm_issue_close') }}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm text-red" @click="deleteIssue(issue)">
                          {{ t('adm_btn_delete') }}
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="filteredIssues.length === 0">
                    <td colspan="7" class="px-3 py-4 text-center text-sm text-muted">
                      {{ issueSearch ? t('adm_search_no_result', { keyword: issueSearch }) : '' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Materials -->
          <section v-show="activeTab === 'materials'">
            <h2 class="mt-0 mb-4 font-serif text-xl">{{ t('adm_mat_section_title') }}</h2>
            <div class="form-group max-w-md">
              <label>{{ t('adm_select_issue_label') }}</label>
              <select v-model="matIssueId" @change="onMatIssueChange">
                <option value="">{{ t('adm_select_placeholder') }}</option>
                <option v-for="issue in issues" :key="issue.id" :value="issue.id">
                  {{ issue.title }}
                </option>
              </select>
            </div>
            <div v-if="!matIssueId" class="empty">{{ t('adm_empty_select') }}</div>
            <div v-else-if="!materials.length" class="empty">{{ t('adm_empty_materials') }}</div>
            <template v-else>
              <div class="mb-3 flex flex-wrap items-center gap-3">
                <p class="m-0 text-sm text-muted">
                  {{ t('adm_mat_count_prefix') }}{{ filteredMaterials.length }}{{ t('adm_mat_count_suffix') }}
                  <span v-if="materialSearch && filteredMaterials.length !== materials.length" class="text-xs">{{ t('adm_search_total', { total: materials.length }) }}</span>
                </p>
                <input v-model="materialSearch" type="search" class="rounded border border-border px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-red" :placeholder="t('adm_search_ph')" />
              </div>
              <div v-for="m in filteredMaterials" :key="m.id" class="card mb-3">
                <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong>{{ m.source_name || t('adm_mat_source_unknown') }}</strong>
                  <button type="button" class="btn btn-ghost btn-sm text-red" @click="deleteMaterial(m.id)">
                    {{ t('adm_btn_delete') }}
                  </button>
                </div>
                <a v-if="m.source_url" :href="m.source_url" target="_blank" rel="noopener noreferrer" class="text-sm">{{ t('adm_mat_link') }}</a>
                <div class="mt-2 whitespace-pre-wrap text-sm">{{ m.content }}</div>
                <div class="mt-2 text-sm text-muted">
                  <p class="m-0">{{ t('adm_author') }}{{ m.author_name || t('adm_author_unknown') }}</p>
                  <p v-if="m.author_id" class="m-0 text-xs">{{ t('adm_author_id') }}{{ m.author_id }}</p>
                  <p v-if="m.author_email" class="m-0 text-xs">{{ t('adm_author_email') }}{{ m.author_email }} · {{ m.show_email === 1 ? t('adm_email_public') : t('adm_email_private') }}</p>
                  <p v-if="m.terms_version" class="m-0 text-xs">{{ t('adm_terms_record') }}{{ m.terms_version }} · {{ m.terms_accepted_at }}</p>
                </div>
              </div>
              <div v-if="filteredMaterials.length === 0 && materialSearch" class="empty">
                {{ t('adm_search_no_result', { keyword: materialSearch }) }}
              </div>
            </template>
          </section>

          <!-- Opinions -->
          <section v-show="activeTab === 'opinions'">
            <h2 class="mt-0 mb-4 font-serif text-xl">{{ t('adm_op_section_title') }}</h2>
            <div class="form-group max-w-md">
              <label>{{ t('adm_select_issue_label') }}</label>
              <select v-model="opIssueId" @change="onOpIssueChange">
                <option value="">{{ t('adm_select_placeholder') }}</option>
                <option v-for="issue in issues" :key="issue.id" :value="issue.id">
                  {{ issue.title }}
                </option>
              </select>
            </div>
            <div v-if="!opIssueId" class="empty">{{ t('adm_empty_select') }}</div>
            <div v-else-if="!opinions.length" class="empty">{{ t('adm_empty_opinions') }}</div>
            <template v-else>
              <div class="mb-3 flex flex-wrap items-center gap-3">
                <p class="m-0 text-sm text-muted">
                  {{ t('adm_op_count_prefix') }}{{ filteredOpinions.length }}{{ t('adm_op_count_suffix') }}
                  <span v-if="opinionSearch && filteredOpinions.length !== opinions.length" class="text-xs">{{ t('adm_search_total', { total: opinions.length }) }}</span>
                </p>
                <input v-model="opinionSearch" type="search" class="rounded border border-border px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-red" :placeholder="t('adm_search_ph')" />
              </div>
              <div v-for="o in filteredOpinions" :key="o.id" class="card mb-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <span class="text-sm text-muted">{{ formatDate(o.created_at, locale) }}</span>
                  <button type="button" class="btn btn-ghost btn-sm text-red" @click="deleteOpinion(o.id)">
                    {{ t('adm_btn_delete') }}
                  </button>
                </div>
                <div class="whitespace-pre-wrap text-sm">{{ o.summary }}</div>
                <div class="mt-2 text-sm text-muted">
                  <p class="m-0">{{ t('adm_author') }}{{ o.author_name || t('adm_author_unknown') }}</p>
                  <p v-if="o.author_id" class="m-0 text-xs">{{ t('adm_author_id') }}{{ o.author_id }}</p>
                  <p v-if="o.author_email" class="m-0 text-xs">{{ t('adm_author_email') }}{{ o.author_email }} · {{ o.show_email === 1 ? t('adm_email_public') : t('adm_email_private') }}</p>
                  <p v-if="o.terms_version" class="m-0 text-xs">{{ t('adm_terms_record') }}{{ o.terms_version }} · {{ o.terms_accepted_at }}</p>
                </div>
              </div>
              <div v-if="filteredOpinions.length === 0 && opinionSearch" class="empty">
                {{ t('adm_search_no_result', { keyword: opinionSearch }) }}
              </div>
            </template>
          </section>

          <!-- Abuse Reports -->
          <section v-show="activeTab === 'reports'">
            <h2 class="mt-0 mb-4 font-serif text-xl">{{ t('adm_rpt_title') }}</h2>
            <div class="mb-3">
              <input
                v-model="reportSearch"
                type="search"
                class="w-full max-w-sm rounded border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red"
                :placeholder="t('adm_search_ph')"
              />
            </div>
            <div v-if="!abuseReports.length" class="empty">
              <div class="empty-icon">✅</div>
              {{ t('adm_rpt_empty') }}
            </div>
            <div v-else class="overflow-x-auto rounded-lg border border-border">
              <table class="admin-report-table w-full border-collapse text-sm">
                <thead class="bg-gray-100 dark:bg-gray-800">
                  <tr>
                    <th class="w-1/12 px-3 py-2 text-left">{{ t('adm_rpt_th_id') }}</th>
                    <th class="w-1/6 px-3 py-2 text-left">{{ t('adm_rpt_th_reporter') }}</th>
                    <th class="w-1/12 px-3 py-2 text-left">{{ t('adm_rpt_th_target') }}</th>
                    <th class="w-1/12 px-3 py-2 text-left">{{ t('adm_rpt_th_reason') }}</th>
                    <th class="w-1/4 px-3 py-2 text-left">{{ t('adm_rpt_th_desc') }}</th>
                    <th class="w-1/12 px-3 py-2 text-left">{{ t('adm_rpt_th_status') }}</th>
                    <th class="w-1/12 px-3 py-2 text-left">{{ t('adm_rpt_th_created') }}</th>
                    <th class="w-1/6 px-3 py-2 text-left">{{ t('adm_th_actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in filteredReports" :key="r.id" class="border-t border-border">
                    <td class="px-3 py-2" :data-label="t('adm_rpt_th_id')">{{ r.id }}</td>
                    <td class="px-3 py-2" :data-label="t('adm_rpt_th_reporter')">
                      <div>{{ r.reporter_name || t('adm_author_unknown') }}</div>
                      <div class="text-xs text-muted">{{ r.reporter_email }}</div>
                      <!-- 現值查詢（snapshot 之外） -->
                      <div class="mt-1">
                        <button v-if="!liveUserCache[r.reporter_id]" type="button" class="text-xs text-muted hover:underline" @click="fetchLiveUser(r.reporter_id)">
                          {{ t('adm_live_user_btn') }}
                        </button>
                        <span v-else-if="liveUserCache[r.reporter_id] === 'loading'" class="text-xs text-muted">{{ t('loading') }}</span>
                        <div v-else-if="liveUserCache[r.reporter_id] === 'not_found'" class="text-xs text-muted">{{ t('adm_live_user_not_found') }}</div>
                        <div v-else class="text-xs text-muted border-t border-border mt-1 pt-1">
                          <div>{{ t('adm_live_user_label') }}{{ liveUser(r.reporter_id)?.name || t('author_system') }}</div>
                          <div>{{ liveUser(r.reporter_id)?.email }}</div>
                          <div v-if="liveUser(r.reporter_id)?.banned" class="text-red">{{ t('adm_live_user_banned') }}{{ liveUser(r.reporter_id)?.banReason }}</div>
                        </div>
                      </div>
                    </td>
                    <td class="px-3 py-2" :data-label="t('adm_rpt_th_target')">
                      <template v-if="r.target_issue_id">
                        <a v-if="r.material_id" :href="`/issues/${r.target_issue_id}/source/${r.material_id}`" class="underline" target="_blank" rel="noopener"
                          >{{ t('adm_rpt_target_material') }}{{ r.material_id }}</a
                        >
                        <a v-else-if="r.opinion_id" :href="`/issues/${r.target_issue_id}/comment/${r.opinion_id}`" class="underline" target="_blank" rel="noopener"
                          >{{ t('adm_rpt_target_opinion') }}{{ r.opinion_id }}</a
                        >
                        <a v-else-if="r.briefing_id" :href="`/issues/${r.target_issue_id}`" class="underline" target="_blank" rel="noopener"
                          >{{ t('adm_rpt_target_briefing') }}{{ r.briefing_id }}（議題 {{ r.target_issue_id }}）</a
                        >
                      </template>
                      <span v-else class="text-muted text-xs">（目標已刪除）</span>
                      <!-- 被回報者現值查詢（有 target_author_id 時才顯示） -->
                      <div v-if="r.target_author_id" class="mt-1">
                        <button v-if="!liveUserCache[r.target_author_id]" type="button" class="text-xs text-muted hover:underline" @click="fetchLiveUser(r.target_author_id)">
                          {{ t('adm_live_user_btn') }}
                        </button>
                        <span v-else-if="liveUserCache[r.target_author_id] === 'loading'" class="text-xs text-muted">{{ t('loading') }}</span>
                        <div v-else-if="liveUserCache[r.target_author_id] === 'not_found'" class="text-xs text-muted">{{ t('adm_live_user_not_found') }}</div>
                        <div v-else class="text-xs text-muted border-t border-border mt-1 pt-1">
                          <div>{{ t('adm_live_user_label') }}{{ liveUser(r.target_author_id)?.name || t('author_system') }}</div>
                          <div>{{ liveUser(r.target_author_id)?.email }}</div>
                          <div v-if="liveUser(r.target_author_id)?.banned" class="text-red">{{ t('adm_live_user_banned') }}{{ liveUser(r.target_author_id)?.banReason }}</div>
                        </div>
                      </div>
                    </td>
                    <td class="px-3 py-2" :data-label="t('adm_rpt_th_reason')">
                      <div>{{ t(ABUSE_REASON_LABELS[r.reason] ?? 'report_reason_other') }}</div>
                      <div v-if="r.source === 'ai'" class="mt-1 text-xs text-red">{{ t('adm_rpt_source_ai') }} · {{ t(MODERATION_POLICY_LABELS[r.policy_code ?? ''] ?? 'report_reason_other') }}</div>
                    </td>
                    <td class="px-3 py-2 max-w-xs" :data-label="t('adm_rpt_th_desc')">
                      <span v-if="r.description" class="whitespace-pre-wrap text-xs">{{ r.description }}</span>
                      <span v-else class="text-muted">—</span>
                      <div v-if="r.source === 'ai' && r.content_snapshot" class="mt-2">
                        <strong class="text-xs">{{ t('adm_rpt_snapshot') }}</strong>
                        <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{{ snapshotSummary(r.content_snapshot) }}</pre>
                      </div>
                    </td>
                    <td class="px-3 py-2" :data-label="t('adm_rpt_th_status')">
                      <span
                        :class="
                          r.review_status === 'pending' ? 'text-amber' : r.review_status === 'resolved_abuse' ? 'text-red' : r.review_status === 'resolved_broken' ? 'text-amber-600' : 'text-muted'
                        "
                      >
                        {{ t(REVIEW_STATUS_LABELS[r.review_status] ?? 'adm_rpt_status_pending') }}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-xs text-muted" :data-label="t('adm_rpt_th_created')">{{ formatDate(r.created_at, locale) }}</td>
                    <td class="px-3 py-2" :data-label="t('adm_th_actions')">
                      <template v-if="r.review_status === 'pending'">
                        <div class="flex flex-col gap-1">
                          <!-- 誤報（broken_link 不 ban，其餘停權回報者 → super-admin only） -->
                          <button
                            @click="resolveReport(r.id, 'false_report', r.source !== 'ai' && r.reason !== 'broken_link')"
                            class="btn btn-ghost btn-sm text-amber-700"
                            :disabled="(r.source !== 'ai' && r.reason !== 'broken_link' && session?.role !== 'super-admin') || (r.source !== 'ai' && r.reporter_id === session?.user?.id)"
                            :title="
                              r.source !== 'ai' && r.reason !== 'broken_link' && session?.role !== 'super-admin'
                                ? t('adm_rpt_need_super_admin')
                                : r.source !== 'ai' && r.reporter_id === session?.user?.id
                                  ? t('adm_rpt_cannot_ban_self')
                                  : undefined
                            "
                          >
                            {{ r.source === 'ai' || r.reason === 'broken_link' ? t('adm_rpt_btn_false_no_ban') : t('adm_rpt_btn_false') }}
                          </button>
                          <!-- 確認失效（藏住素材，不停權）→ 所有 admin 都可以；僅 broken_link 顯示 -->
                          <button v-if="r.reason === 'broken_link'" type="button" class="btn btn-ghost btn-sm text-amber-600" @click="resolveReport(r.id, 'confirmed_broken')">
                            {{ t('adm_rpt_btn_broken') }}
                          </button>
                          <!-- 確認濫用（停權張貼者）→ super-admin only；非 broken_link 才顯示 -->
                          <button
                            v-else
                            type="button"
                            class="btn btn-ghost btn-sm text-red"
                            :disabled="session?.role !== 'super-admin' || r.target_author_id === session?.user?.id"
                            :title="session?.role !== 'super-admin' ? t('adm_rpt_need_super_admin') : r.target_author_id === session?.user?.id ? t('adm_rpt_cannot_ban_self') : undefined"
                            @click="resolveReport(r.id, 'confirmed_abuse')"
                          >
                            {{ t('adm_rpt_btn_abuse') }}
                          </button>
                          <!-- 不停權裁判只更新內容與回報，所有 admin 皆可使用。 -->
                          <button v-if="r.source !== 'ai' && r.reason !== 'broken_link'" type="button" class="btn btn-ghost btn-sm text-amber-700" @click="resolveReport(r.id, 'false_report', false)">
                            {{ t('adm_rpt_btn_false_no_ban') }}
                          </button>
                          <button v-if="r.reason !== 'broken_link'" type="button" class="btn btn-ghost btn-sm text-red" @click="resolveReport(r.id, 'confirmed_abuse', false)">
                            {{ t('adm_rpt_btn_abuse_no_ban') }}
                          </button>
                          <span v-if="!r.target_author_id && r.review_status === 'pending' && r.reason !== 'broken_link'" class="text-xs text-muted">{{ t('adm_rpt_no_author') }}</span>
                        </div>
                      </template>
                      <span v-else class="text-xs text-muted">—</span>
                    </td>
                  </tr>
                  <tr v-if="filteredReports.length === 0">
                    <td colspan="8" class="px-3 py-4 text-center text-sm text-muted">
                      {{ reportSearch ? t('adm_search_no_result', { keyword: reportSearch }) : t('adm_rpt_empty') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section v-show="activeTab === 'feedback'">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 class="m-0 font-serif text-xl">{{ t('feedback_title') }}</h2>
              <a href="https://github.com/g0v/civic-talk-hono/issues" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">
                {{ t('feedback_github') }}
              </a>
            </div>
            <div v-if="feedbackLoading" class="empty">{{ t('feedback_loading') }}</div>
            <div v-else-if="feedbackError" class="empty">
              <p>{{ t('feedback_load_error') }}</p>
              <button type="button" class="btn btn-secondary btn-sm" @click="loadFeedback">
                {{ t('feedback_retry') }}
              </button>
            </div>
            <div v-else-if="!feedback.length" class="empty">{{ t('feedback_empty') }}</div>
            <div v-else class="space-y-3">
              <article v-for="item in feedback" :key="item.id" class="card min-w-0">
                <div class="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <strong>{{ t(FEEDBACK_CATEGORY_LABELS[item.category]) }}</strong>
                  <time class="text-sm text-muted" :datetime="item.created_at"> {{ t('feedback_created_at') }} · {{ formatDate(item.created_at, locale) }} </time>
                </div>
                <a
                  v-if="isSafeFeedbackPagePath(item.page_path)"
                  :href="item.page_path"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mb-3 inline-block max-w-full wrap-break-word text-sm underline"
                >
                  {{ t('feedback_page') }}: {{ item.page_path }}
                </a>
                <div class="min-w-0">
                  <strong class="text-sm">{{ t('feedback_description') }}</strong>
                  <div class="mt-1 whitespace-pre-wrap wrap-break-word text-sm">{{ item.description }}</div>
                </div>
              </article>
            </div>
          </section>
        </template>
      </div>
    </main>

    <!-- Modals -->
    <dialog
      v-if="closureIssue"
      ref="closureDialog"
      class="modal m-auto max-h-[90dvh] max-w-[calc(100%-2rem)] border border-vt-border text-vt-fg-1 backdrop:bg-black/50"
      aria-labelledby="closure-title"
      @cancel.prevent="closeClosure"
      @click="closeClosureOnBackdropClick"
    >
      <form :aria-busy="closurePending" @submit.prevent="saveClosure">
        <h2 id="closure-title" class="mt-0 mb-4 font-serif text-xl">{{ t(closureIssue.is_closed === 1 ? 'adm_issue_reopen' : 'adm_issue_close') }}</h2>
        <p class="break-words font-medium">{{ closureIssue.title }}</p>
        <p class="text-sm text-muted">{{ t('adm_closure_hint') }}</p>
        <div class="form-group">
          <label for="closure-reason">{{ t('adm_closure_reason') }}</label>
          <textarea
            id="closure-reason"
            ref="closureReasonInput"
            v-model="closureReason"
            rows="4"
            required
            :readonly="closurePending"
            aria-describedby="closure-reason-hint closure-error"
          />
          <p id="closure-reason-hint" class="mt-1 text-sm text-muted">{{ t('adm_closure_reason_hint') }}</p>
        </div>
        <p id="closure-error" class="text-sm text-red" role="alert">{{ closureError }}</p>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary" :disabled="closurePending">
            {{ t(closurePending ? 'submitting_pending' : closureIssue.is_closed === 1 ? 'adm_issue_reopen' : 'adm_issue_close') }}
          </button>
          <button type="button" class="btn btn-secondary" :disabled="closurePending" @click="closeClosure">{{ t('adm_btn_cancel') }}</button>
        </div>
      </form>
    </dialog>

    <div v-if="modalNew" class="modal-overlay" @click.self="modalNew = false">
      <div class="modal">
        <h2 class="mt-0 mb-4 font-serif text-xl">{{ t('adm_modal_new_title') }}</h2>
        <div class="form-group">
          <label>{{ t('adm_label_title') }}</label>
          <input v-model="formTitle" type="text" :placeholder="t('adm_new_ph_title')" />
        </div>
        <div class="form-group">
          <label>{{ t('adm_label_desc') }}</label>
          <textarea v-model="formDesc" rows="3" :placeholder="t('adm_new_ph_desc')" />
        </div>
        <div class="form-group">
          <label for="admin-new-tags">{{ t('issue_tags_label') }}</label>
          <input id="admin-new-tags" v-model="formTags" type="text" :placeholder="t('issue_tags_placeholder')" aria-describedby="admin-new-tags-hint" />
          <p id="admin-new-tags-hint" class="mt-1 text-sm text-muted">{{ t('issue_tags_hint') }}</p>
        </div>
        <div class="form-group">
          <label class="flex items-start gap-2 font-normal">
            <input v-model="formTermsAgreed" type="checkbox" class="mt-1 w-auto" />
            <span
              >{{ t('tos_agree_prefix') }}<a href="/terms" target="_blank" class="underline">{{ t('tos_terms_link') }}</a
              >{{ t('tos_agree_mid') }}<a href="/privacy" target="_blank" class="underline">{{ t('tos_privacy_link') }}</a
              >{{ t('tos_agree_suffix') }}</span
            >
          </label>
        </div>
        <div v-if="duplicateNameRequiresEmail" class="alert alert-info">
          {{ t('duplicate_name_email_required', { email: session?.user.email || '' }) }}
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-primary" @click="createIssue">{{ t('adm_btn_create') }}</button>
          <button type="button" class="btn btn-secondary" @click="modalNew = false">{{ t('adm_btn_cancel') }}</button>
        </div>
      </div>
    </div>

    <div v-if="modalEdit" class="modal-overlay" @click.self="modalEdit = false">
      <div class="modal">
        <h2 class="mt-0 mb-4 font-serif text-xl">{{ t('adm_modal_edit_title') }}</h2>
        <div class="form-group">
          <label>{{ t('adm_label_title') }}</label>
          <input v-model="formTitle" type="text" />
        </div>
        <div class="form-group">
          <label>{{ t('adm_label_desc') }}</label>
          <textarea v-model="formDesc" rows="3" />
        </div>
        <div class="form-group">
          <label for="admin-edit-tags">{{ t('issue_tags_label') }}</label>
          <input id="admin-edit-tags" v-model="formTags" type="text" :placeholder="t('issue_tags_placeholder')" aria-describedby="admin-edit-tags-hint" />
          <p id="admin-edit-tags-hint" class="mt-1 text-sm text-muted">{{ t('issue_tags_hint') }}</p>
        </div>
        <div class="form-group">
          <label>{{ t('adm_label_status') }}</label>
          <select v-model="formStatus">
            <option value="collecting">{{ t('status_collecting') }}</option>
            <option value="summarizing">{{ t('status_summarizing') }}</option>
            <option value="published">{{ t('status_published') }}</option>
          </select>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-primary" @click="saveIssue">{{ t('adm_btn_save') }}</button>
          <button type="button" class="btn btn-secondary" @click="modalEdit = false">{{ t('adm_btn_cancel') }}</button>
        </div>
      </div>
    </div>

    <div v-if="modalBriefing" class="modal-overlay" @click.self="modalBriefing = false">
      <div class="modal">
        <h2 class="mt-0 mb-4 font-serif text-xl">{{ t('adm_modal_briefing_title') }}</h2>
        <div v-if="briefingAuthor?.author_id" class="mb-4 rounded-lg bg-gray-50 dark:bg-gray-800 p-3 text-sm text-muted">
          <p class="m-0">{{ t('adm_briefing_author') }}{{ briefingAuthor.author_name || t('adm_author_unknown') }}</p>
          <p class="m-0 text-xs">{{ t('adm_author_id') }}{{ briefingAuthor.author_id }}</p>
          <p v-if="briefingAuthor.author_email" class="m-0 text-xs">{{ t('adm_author_email') }}{{ briefingAuthor.author_email }}</p>
        </div>
        <div class="form-group">
          <label>{{ t('adm_label_consensus') }}</label>
          <textarea v-model="briefConsensus" rows="3" />
        </div>
        <div class="form-group">
          <label>{{ t('adm_label_disputes') }}</label>
          <textarea v-model="briefDisputes" rows="3" />
        </div>
        <div class="form-group">
          <label>{{ t('adm_label_positions') }}</label>
          <textarea v-model="briefPositions" rows="3" />
        </div>
        <div class="form-group">
          <label>{{ t('adm_label_narrative') }}</label>
          <textarea v-model="briefNarrative" rows="5" />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-primary" @click="saveBriefing">{{ t('adm_btn_save') }}</button>
          <button type="button" class="btn btn-secondary" @click="modalBriefing = false">
            {{ t('adm_btn_cancel') }}
          </button>
        </div>
      </div>
    </div>

    <AppFooter />
    <Toast ref="toast" />
  </div>
</template>
