<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Toast from '../components/Toast.vue'
import { formatDate, useI18n } from '../l10n'
import {
  isAdminSession,
  loadAuthSession,
  signInWith,
  signOut,
  type AuthSession,
} from '../client/auth-session'
import type { Briefing, IssueListItem, IssueStatus, Material, Opinion } from '../db/queries'

type AdminTab = 'issues' | 'materials' | 'opinions'

/**
 * 'loading' 是 SSR 與 hydration 首幀共用的狀態——伺服器端不知道也不該猜登入狀態，
 * 兩邊都先畫同一個骨架，等 onMounted 打 /api/me 才分岔，避免 hydration mismatch。
 */
type AuthState = 'loading' | 'anonymous' | 'forbidden' | 'admin'

const { t, locale } = useI18n()
const toast = ref<{ show: (msg: string) => void } | null>(null)

const authState = ref<AuthState>('loading')
const session = ref<AuthSession | null>(null)
const authError = ref(false)
const activeTab = ref<AdminTab>('issues')
const stats = ref({ issues: 0, materials: 0, opinions: 0, briefings: 0 })
const issues = ref<IssueListItem[]>([])
const materials = ref<Material[]>([])
const opinions = ref<Opinion[]>([])
const matIssueId = ref<number | ''>('')
const opIssueId = ref<number | ''>('')

const modalEdit = ref(false)
const modalNew = ref(false)
const modalBriefing = ref(false)
const editId = ref<number | null>(null)
const formTitle = ref('')
const formDesc = ref('')
const formStatus = ref<IssueStatus>('collecting')
const formPolis = ref(false)
const briefConsensus = ref('')
const briefDisputes = ref('')
const briefPositions = ref('')
const briefNarrative = ref('')
const briefingIssueId = ref<number | null>(null)

// 管理端請求靠同源 cookie 帶 session，不再有 X-Admin-Token
function authHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' }
}

onMounted(() => {
  void refreshSession()
})

async function refreshSession() {
  authError.value = false
  try {
    const current = await loadAuthSession()
    session.value = current
    if (!current) {
      authState.value = 'anonymous'
      return
    }
    authState.value = isAdminSession(current) ? 'admin' : 'forbidden'
    if (authState.value === 'admin') await bootstrap()
  } catch {
    // 讀 session 失敗是「壞掉」不是「未登入」——照樣顯示登入畫面，但要說明白
    authState.value = 'anonymous'
    authError.value = true
  }
}

async function login(provider: 'google' | 'github') {
  authError.value = false
  try {
    // 導向 OAuth；回來時再落回 /admin 由 onMounted 重讀 session
    await signInWith(provider, '/admin')
  } catch {
    authError.value = true
  }
}

async function logout() {
  await signOut()
  window.location.reload()
}

async function bootstrap() {
  await Promise.all([loadStats(), loadIssues()])
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

function openNew() {
  formTitle.value = ''
  formDesc.value = ''
  formPolis.value = false
  modalNew.value = true
}

function openEdit(issue: IssueListItem) {
  editId.value = issue.id
  formTitle.value = issue.title
  formDesc.value = issue.description ?? ''
  formStatus.value = issue.status
  formPolis.value = !!issue.polis_id
  modalEdit.value = true
}

async function openBriefing(issue: IssueListItem) {
  briefingIssueId.value = issue.id
  const res = await fetch(`/api/issues/${issue.id}/briefing`)
  const b = (res.ok ? await res.json() : null) as Briefing | null
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
  const res = await fetch('/api/issues', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      title: formTitle.value.trim(),
      description: formDesc.value,
      polis_id: formPolis.value ? 'enabled' : null,
    }),
  })
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
      status: formStatus.value,
      polis_id: formPolis.value ? 'enabled' : null,
    }),
  })
  if (!res.ok) return
  toast.value?.show(t('adm_toast_save'))
  modalEdit.value = false
  await bootstrap()
}

async function deleteIssue(issue: IssueListItem) {
  const msg = t('adm_confirm_delete', { title: issue.title })
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
  const res = await fetch(`/api/issues/${briefingIssueId.value}/briefing`, {
    method: has ? 'PUT' : 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
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

const tabs = computed(() => [
  { id: 'issues' as const, label: t('adm_tab_issues') },
  { id: 'materials' as const, label: t('adm_tab_materials') },
  { id: 'opinions' as const, label: t('adm_tab_opinions') },
])
</script>

<template>
  <div>
    <AppHeader current="admin" />

    <main class="py-9">
      <div class="container">
        <!-- 讀取 session 中：SSR 與 hydration 首幀共用這個骨架 -->
        <div v-if="authState === 'loading'" class="mx-auto max-w-md">
          <div class="card">
            <h1 class="mt-0 mb-2 font-serif text-2xl">{{ t('adm_login_title') }}</h1>
            <p class="m-0 text-muted">{{ t('loading') }}</p>
          </div>
        </div>

        <!-- 未登入 -->
        <div v-else-if="authState === 'anonymous'" class="mx-auto max-w-md">
          <div class="card">
            <h1 class="mt-0 mb-2 font-serif text-2xl">{{ t('adm_login_title') }}</h1>
            <p class="mb-4 text-muted">{{ t('adm_login_desc') }}</p>
            <!--
              兩顆都用 btn-secondary（白底）：品牌標誌有各自的使用規範，四色 Google G
              放在 btn-primary 的紅底上既不好看也不符合 Google 的品牌指引。兩個 provider
              本來也是平行選項，不該有主次之分。
              SVG 內嵌而非拉外部資源：Worker 不打外部請求，也不為兩個圖示加 icon 套件。
              下面的色碼是品牌資產的一部分（不是設計決策），所以刻意不走 vt-* token。
            -->
            <div class="flex flex-col gap-2">
              <button type="button" class="btn btn-secondary" @click="login('google')">
                <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"
                  />
                </svg>
                {{ t('adm_login_google') }}
              </button>
              <button type="button" class="btn btn-secondary" @click="login('github')">
                <svg class="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path
                    d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                  />
                </svg>
                {{ t('adm_login_github') }}
              </button>
            </div>
            <p v-if="authError" class="mt-3 mb-0 text-sm text-red">{{ t('adm_login_err') }}</p>
            <p class="mt-4 mb-0 text-sm text-muted">{{ t('adm_login_hint') }}</p>
          </div>
        </div>

        <!-- 登入了，但這個帳號沒有管理權限 -->
        <div v-else-if="authState === 'forbidden'" class="mx-auto max-w-md">
          <div class="card">
            <h1 class="mt-0 mb-2 font-serif text-2xl">{{ t('adm_forbidden_title') }}</h1>
            <p class="mb-4 text-muted">
              {{ t('adm_forbidden_desc', { email: session?.user.email ?? '' }) }}
            </p>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn btn-secondary" @click="logout">
                {{ t('adm_logout') }}
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
                {{ t('adm_signed_in_as', { name: session.user.name || session.user.email }) }}
              </span>
              <a href="/" class="btn btn-secondary btn-sm">{{ t('adm_back') }}</a>
              <button type="button" class="btn btn-ghost btn-sm" @click="logout">
                {{ t('adm_logout') }}
              </button>
            </div>
          </div>

          <div class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div class="card text-center">
              <div class="text-2xl font-bold text-red">{{ stats.issues }}</div>
              <div class="text-xs text-muted">{{ t('adm_stat_issues') }}</div>
            </div>
            <div class="card text-center">
              <div class="text-2xl font-bold text-teal">{{ stats.materials }}</div>
              <div class="text-xs text-muted">{{ t('adm_stat_materials') }}</div>
            </div>
            <div class="card text-center">
              <div class="text-2xl font-bold text-amber">{{ stats.opinions }}</div>
              <div class="text-xs text-muted">{{ t('adm_stat_opinions') }}</div>
            </div>
            <div class="card text-center">
              <div class="text-2xl font-bold text-ink">{{ stats.briefings }}</div>
              <div class="text-xs text-muted">{{ t('adm_stat_briefings') }}</div>
            </div>
          </div>

          <div class="tabs">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              class="tab"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- Issues -->
          <section v-show="activeTab === 'issues'">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="m-0 font-serif text-xl">{{ t('adm_issues_title') }}</h2>
              <button type="button" class="btn btn-primary btn-sm" @click="openNew">
                {{ t('adm_new_issue_btn') }}
              </button>
            </div>
            <div class="overflow-x-auto rounded-lg border border-border">
              <table class="w-full border-collapse text-sm">
                <thead class="bg-gray-100">
                  <tr>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_id') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_title') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_status') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_materials') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_created') }}</th>
                    <th class="px-3 py-2 text-left">{{ t('adm_th_actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="issue in issues" :key="issue.id" class="border-t border-border">
                    <td class="px-3 py-2">{{ issue.id }}</td>
                    <td class="px-3 py-2">
                      <a :href="`/issues/${issue.id}`">{{ issue.title }}</a>
                    </td>
                    <td class="px-3 py-2"><StatusBadge :status="issue.status" short /></td>
                    <td class="px-3 py-2">{{ issue.material_count }}</td>
                    <td class="px-3 py-2">{{ formatDate(issue.created_at, locale) }}</td>
                    <td class="px-3 py-2">
                      <div class="flex flex-wrap gap-1">
                        <button type="button" class="btn btn-ghost btn-sm" @click="openEdit(issue)">
                          {{ t('adm_btn_edit') }}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" @click="openBriefing(issue)">
                          {{ t('adm_btn_briefing') }}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm text-red" @click="deleteIssue(issue)">
                          {{ t('adm_btn_delete') }}
                        </button>
                      </div>
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
              <select
                v-model="matIssueId"
                @change="loadMaterials"
              >
                <option value="">{{ t('adm_select_placeholder') }}</option>
                <option v-for="issue in issues" :key="issue.id" :value="issue.id">
                  {{ issue.title }}
                </option>
              </select>
            </div>
            <div v-if="!matIssueId" class="empty">{{ t('adm_empty_select') }}</div>
            <div v-else-if="!materials.length" class="empty">{{ t('adm_empty_materials') }}</div>
            <template v-else>
              <p class="mb-3 text-sm text-muted">
                {{ t('adm_mat_count_prefix') }}{{ materials.length }}{{ t('adm_mat_count_suffix') }}
              </p>
              <div v-for="m in materials" :key="m.id" class="card mb-3">
                <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong>{{ m.source_name || t('adm_mat_source_unknown') }}</strong>
                  <button type="button" class="btn btn-ghost btn-sm text-red" @click="deleteMaterial(m.id)">
                    {{ t('delete') }}
                  </button>
                </div>
                <a
                  v-if="m.source_url"
                  :href="m.source_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm"
                  >{{ t('adm_mat_link') }}</a
                >
                <div class="mt-2 whitespace-pre-wrap text-sm">{{ m.content }}</div>
              </div>
            </template>
          </section>

          <!-- Opinions -->
          <section v-show="activeTab === 'opinions'">
            <h2 class="mt-0 mb-4 font-serif text-xl">{{ t('adm_op_section_title') }}</h2>
            <div class="form-group max-w-md">
              <label>{{ t('adm_select_issue_label') }}</label>
              <select v-model="opIssueId" @change="loadOpinions">
                <option value="">{{ t('adm_select_placeholder') }}</option>
                <option v-for="issue in issues" :key="issue.id" :value="issue.id">
                  {{ issue.title }}
                </option>
              </select>
            </div>
            <div v-if="!opIssueId" class="empty">{{ t('adm_empty_select') }}</div>
            <div v-else-if="!opinions.length" class="empty">{{ t('adm_empty_opinions') }}</div>
            <template v-else>
              <p class="mb-3 text-sm text-muted">
                {{ t('adm_op_count_prefix') }}{{ opinions.length }}{{ t('adm_op_count_suffix') }}
              </p>
              <div v-for="o in opinions" :key="o.id" class="card mb-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <span class="text-sm text-muted">{{ formatDate(o.created_at, locale) }}</span>
                  <button type="button" class="btn btn-ghost btn-sm text-red" @click="deleteOpinion(o.id)">
                    {{ t('delete') }}
                  </button>
                </div>
                <div class="whitespace-pre-wrap text-sm">{{ o.summary }}</div>
              </div>
            </template>
          </section>
        </template>
      </div>
    </main>

    <!-- Modals -->
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
          <label class="flex items-start gap-2 font-normal">
            <input v-model="formPolis" type="checkbox" class="mt-1 w-auto" />
            <span>
              <strong>{{ t('adm_polis_label') }}</strong>
              <span class="mt-1 block text-sm text-muted">{{ t('adm_polis_hint_new') }}</span>
            </span>
          </label>
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
          <label>{{ t('adm_label_status') }}</label>
          <select v-model="formStatus">
            <option value="collecting">{{ t('status_collecting') }}</option>
            <option value="summarizing">{{ t('status_summarizing') }}</option>
            <option value="published">{{ t('status_published') }}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="flex items-start gap-2 font-normal">
            <input v-model="formPolis" type="checkbox" class="mt-1 w-auto" />
            <span>
              <strong>{{ t('adm_polis_label') }}</strong>
              <span class="mt-1 block text-sm text-muted">{{ t('adm_polis_hint') }}</span>
            </span>
          </label>
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
