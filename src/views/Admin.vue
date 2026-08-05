<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import SignInButtons from '../components/SignInButtons.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Toast from '../components/Toast.vue'
import { formatDate, useI18n } from '../l10n'
import { useAuth } from '../composables/useAuth'
import { isAdminSession } from '../client/auth-session'
import type {
  Briefing,
  IssueListItemWithAuthor,
  IssueStatus,
  MaterialWithAuthor,
  OpinionWithAuthor,
} from '../db/queries'

type AdminTab = 'issues' | 'materials' | 'opinions'

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
const activeTab = ref<AdminTab>('issues')
const stats = ref({ issues: 0, materials: 0, opinions: 0, briefings: 0 })
// 管理端讀到的議題／素材／意見都含建立者或投稿者（#9）；一般讀取者拿到的是公開形狀
const issues = ref<IssueListItemWithAuthor[]>([])
const materials = ref<MaterialWithAuthor[]>([])
const opinions = ref<OpinionWithAuthor[]>([])
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

onMounted(async () => {
  await ensureAuthSession()
  if (adminView.value === 'admin') await bootstrap()
})

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

function openEdit(issue: IssueListItemWithAuthor) {
  editId.value = issue.id
  formTitle.value = issue.title
  formDesc.value = issue.description ?? ''
  formStatus.value = issue.status
  formPolis.value = !!issue.polis_id
  modalEdit.value = true
}

async function openBriefing(issue: IssueListItemWithAuthor) {
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

async function deleteIssue(issue: IssueListItemWithAuthor) {
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
                    <th class="px-3 py-2 text-left">{{ t('adm_th_author') }}</th>
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
                    <td class="px-3 py-2">{{ issue.author_name || t('adm_author_unknown') }}</td>
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
                <!-- #9：投稿者只在管理端顯示，公開的素材列表不含這個欄位 -->
                <p class="mt-2 mb-0 text-sm text-muted">
                  {{ t('adm_author') }}{{ m.author_name || t('adm_author_unknown') }}
                </p>
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
                <!-- #9：投稿者只在管理端顯示，公開的意見列表不含這個欄位 -->
                <p class="mt-2 mb-0 text-sm text-muted">
                  {{ t('adm_author') }}{{ o.author_name || t('adm_author_unknown') }}
                </p>
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
