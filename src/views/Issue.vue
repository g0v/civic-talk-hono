<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import SignInButtons from '../components/SignInButtons.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Toast from '../components/Toast.vue'
import { formatDate, useI18n } from '../l10n'
import { useAuth } from '../composables/useAuth'
import type { Briefing, Issue, Material, Opinion } from '../db/queries'
import { renderSafeMarkdown } from '../markdown/renderSafeMarkdown'

type TabName = 'briefing' | 'materials' | 'volunteer' | 'opinions'

const props = defineProps<{
  issueId: number
  initialDetail?: {
    issue: Issue
    materials: Material[]
    briefing: Briefing | null
    opinions: Opinion[]
  } | null
}>()

const { t, locale } = useI18n()
const toast = ref<{ show: (msg: string) => void } | null>(null)

const issue = ref<Issue | null>(props.initialDetail?.issue ?? null)
const materials = ref<Material[]>(props.initialDetail?.materials ?? [])
const briefing = ref<Briefing | null>(props.initialDetail?.briefing ?? null)
const opinions = ref<Opinion[]>(props.initialDetail?.opinions ?? [])
const loading = ref(!props.initialDetail)
const activeTab = ref<TabName>('briefing')
const renderedBriefing = computed(() => {
  const current = briefing.value
  if (!current) return null

  return {
    consensus: renderSafeMarkdown(current.consensus),
    disputes: renderSafeMarkdown(current.disputes),
    positions: renderSafeMarkdown(current.positions),
  }
})

const promptText = ref<Record<string, string>>({
  summarize: '',
  narrative: '',
  synthesis: '',
})
const promptVisible = ref<Record<string, boolean>>({
  summarize: false,
  narrative: false,
  synthesis: false,
})
const consensus = ref('')
const disputes = ref('')
const positions = ref('')
const narrative = ref('')
const opinionInput = ref('')
// ToS 同意 checkbox（#27）
const opinionTosAgreed = ref(false)
// Email 公開選項（#27）
const opinionShowEmail = ref(false)
// 志願者送出說明頁時的 email 公開選項
const volunteerShowEmail = ref(false)

// 全站共用的登入狀態（與 AppHeader 共用同一次 /api/me）；SSR 期間永遠是 'loading'
const { authState, session, ensureAuthSession } = useAuth()
// 送出時才發現 session 過期：意見框留著（別吃掉使用者打的字），只在上方補一列重新登入
const sessionExpired = ref(false)
// 志願者工具同樣需要登入；若操作時 session 過期，保留已填內容並引導重新登入。
const volunteerSessionExpired = ref(false)
// 登入後導回這一頁的意見分頁
const loginCallbackUrl = computed(() => `/issues/${props.issueId}`)

const tabs = computed(() => [
  { id: 'briefing' as const, label: t('tab_briefing') },
  { id: 'materials' as const, label: t('tab_materials') },
  { id: 'volunteer' as const, label: t('tab_volunteer') },
  { id: 'opinions' as const, label: t('tab_opinions') },
])

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

async function loadIssue() {
  loading.value = true
  try {
    const res = await fetch(`/api/issues/${props.issueId}`)
    if (!res.ok) {
      toast.value?.show(t('vol_toast_load_fail'))
      return
    }
    const data = (await res.json()) as {
      issue: Issue
      materials?: Material[]
      briefing?: Briefing | null
      opinions?: Opinion[]
    }
    issue.value = data.issue
    materials.value = data.materials ?? []
    briefing.value = data.briefing ?? null
    opinions.value = data.opinions ?? []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!props.initialDetail) void loadIssue()
  void ensureAuthSession()
  void nextTick(() => renderPolis())
})

watch(
  () => [issue.value?.polis_id, issue.value?.id, activeTab.value, locale.value] as const,
  () => {
    if (activeTab.value === 'briefing') void nextTick(() => renderPolis())
  }
)

function renderPolis() {
  if (typeof document === 'undefined') return
  const el = document.getElementById('polis-section')
  if (!el) return
  const iss = issue.value
  if (!iss?.polis_id) {
    el.style.display = 'none'
    el.innerHTML = ''
    return
  }
  el.style.display = 'block'
  const isZh = locale.value === 'zh-TW'
  el.innerHTML = `
    <div class="divider"></div>
    <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:8px;">📊 ${t('polis_title')}</h2>
    <p style="color:var(--color-muted);font-size:0.9rem;margin-bottom:16px;">${t('polis_desc')}</p>
    <div class="polis" data-page_id="civic-talk-issue-${iss.id}" data-site_id="polis_site_id_rdf0tsbfxaRo35qf1P"></div>
    <p style="font-size:0.8rem;color:var(--color-muted);margin-top:8px;">
      ${t('polis_powered')} <a href="https://polis.tw" target="_blank" rel="noopener noreferrer">polis.tw</a>
    </p>
  `
  if (!document.getElementById('polis-embed-script')) {
    const script = document.createElement('script')
    script.id = 'polis-embed-script'
    script.async = true
    script.src = 'https://polis.tw/embed.js'
    document.head.appendChild(script)
  }
  void isZh
}

async function loadPrompt(type: 'summarize' | 'narrative' | 'synthesis') {
  const res = await fetch(`/api/issues/${props.issueId}/prompt?type=${type}`)
  if (res.status === 401) {
    volunteerSessionExpired.value = true
    toast.value?.show(t('login_expired_toast'))
    return
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    toast.value?.show((e as { error?: string }).error || t('vol_toast_load_fail'))
    return
  }
  const data = (await res.json()) as { prompt: string }
  promptText.value[type] = data.prompt
  promptVisible.value[type] = true
}

async function copyPrompt(type: string) {
  const text = promptText.value[type]
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.value?.show(t('vol_toast_copied'))
  } catch {
    toast.value?.show(t('vol_toast_load_fail'))
  }
}

async function submitSummarize() {
  const body = {
    consensus: consensus.value.trim(),
    disputes: disputes.value.trim(),
    positions: positions.value.trim(),
  }
  if (!body.consensus && !body.disputes && !body.positions) {
    toast.value?.show(t('vol_toast_fill_one'))
    return
  }
  const res = await fetch(`/api/issues/${props.issueId}/briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, show_email: volunteerShowEmail.value }),
  })
  if (res.status === 401) {
    volunteerSessionExpired.value = true
    toast.value?.show(t('login_expired_toast'))
    return
  }
  if (res.ok) {
    toast.value?.show(t('vol_toast_summarize_ok'))
    await loadIssue()
  } else toast.value?.show(t('vol_toast_save_fail'))
}

async function submitNarrative() {
  const text = narrative.value.trim()
  if (!text) {
    toast.value?.show(t('vol_toast_no_content'))
    return
  }
  if (typeof window !== 'undefined' && !window.confirm(t('vol_confirm_submit_narrative'))) return
  const body = {
    consensus: briefing.value?.consensus ?? '',
    disputes: briefing.value?.disputes ?? '',
    positions: briefing.value?.positions ?? '',
    narrative: text,
  }
  const res = await fetch(`/api/issues/${props.issueId}/briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, show_email: volunteerShowEmail.value }),
  })
  if (res.status === 401) {
    volunteerSessionExpired.value = true
    toast.value?.show(t('login_expired_toast'))
    return
  }
  if (res.ok) {
    narrative.value = ''
    toast.value?.show(t('vol_toast_narrative_ok'))
    await loadIssue()
    activeTab.value = 'briefing'
  } else toast.value?.show(t('vol_toast_save_fail'))
}

function downloadOpinionMd() {
  const isEn = locale.value === 'en'
  const b = briefing.value
  const iss = issue.value
  const briefingText = b
    ? isEn
      ? `## Consensus\n${b.consensus}\n\n## Key Disputes\n${b.disputes}\n\n## Position Map\n${b.positions}\n\n## Overview\n${b.narrative}`
      : `## 共識\n${b.consensus}\n\n## 爭點\n${b.disputes}\n\n## 立場地圖\n${b.positions}\n\n## 議題說明\n${b.narrative}`
    : isEn
      ? '(Briefing not yet published)'
      : '（說明頁尚未發布）'

  const md = isEn
    ? `# OPINION.md | Civic Talk
## What is this?
This is a guided reflection document generated by Civic Talk for the issue: "${iss?.title || 'this issue'}".
Copy and paste this entire document into your AI chatbot (Claude, ChatGPT, or Gemini),
and let the AI guide you through your own thinking on this issue.
---
## Issue Background
${briefingText}
---
## Instructions for the AI
Please act as a civic deliberation facilitator. Based on the issue background above, guide me through my thinking in a conversational way.
Start with this question: **What is your first instinct or feeling about this issue?**
Then, based on my responses:
1. Help me identify the deeper values behind my instinct
2. Raise perspectives I might not have considered
3. Don't take sides — help me clarify what I actually think
At the end of our conversation, please summarize my views in 100–300 words, covering:
- What aspects I care most about
- My general stance or perspective
- Any remaining questions or uncertainties
This summary can be submitted back to Civic Talk as a public opinion contribution.
---
*Generated ${new Date().toLocaleDateString('en-US')} | civic-talk.pages.dev*
`
    : `# OPINION.md｜Civic Talk
## 這是什麼？
這是 Civic Talk 平台為「${iss?.title || '本議題'}」生成的對話引導文件。
請將這整份文件複製貼上到你慣用的 AI chatbot（Claude、ChatGPT、Gemini 皆可），
讓 AI 根據你的生活情境，引導你思考你自己對這個議題的看法。
---
## 議題背景說明
${briefingText}
---
## 對 AI 的指示
請你扮演一位公民審議引導員，根據以上議題說明，用對話方式引導我思考這個議題。
請從這個問題開始：**你對這個議題的第一個直覺或感受是什麼？**
接著根據我的回答：
1. 幫我找出我這個直覺背後更深層的在乎是什麼
2. 提出我可能沒有考慮到的面向
3. 不要幫我選邊站，而是幫我說清楚自己真正的想法
對話結束後，請幫我整理一份 100-300 字的意見摘要，說明：
- 我最在乎的面向是什麼
- 我的觀點或立場大概是什麼
- 有沒有我還有疑問或不確定的地方
這份摘要可以回傳到 Civic Talk 平台，作為民眾意見參考。
---
*生成於 ${new Date().toLocaleDateString('zh-TW')}｜civic-talk.pages.dev*
`

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `OPINION_${props.issueId}.md`
  a.click()
  toast.value?.show(t('op_toast_download_ok'))
}

async function submitOpinion() {
  const summary = opinionInput.value.trim()
  if (!summary) {
    toast.value?.show(t('op_toast_required'))
    return
  }
  if (summary.length < 20) {
    toast.value?.show(t('op_toast_too_short'))
    return
  }
  if (!opinionTosAgreed.value) {
    toast.value?.show(t('tos_required_toast'))
    return
  }
  const res = await fetch(`/api/issues/${props.issueId}/opinions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary,
      show_email: opinionShowEmail.value,
      terms_accepted: opinionTosAgreed.value,
    }),
  })
  // session 可能在打字期間過期——守門在伺服器端，前端接住 401 但保留已寫的意見
  if (res.status === 401) {
    sessionExpired.value = true
    toast.value?.show(t('login_expired_toast'))
    return
  }
  // 帳號被停權（#11）：提示並保留意見內容
  if (res.status === 403) {
    toast.value?.show(t('banned_toast'))
    return
  }
  if (res.ok) {
    toast.value?.show(t('op_toast_submit_ok'))
    opinionInput.value = ''
    opinionTosAgreed.value = false
    opinionShowEmail.value = false
    await loadIssue()
  } else toast.value?.show(t('op_toast_submit_fail'))
}
</script>

<template>
  <div>
    <AppHeader current="issue" />

    <main class="py-8">
      <div class="container">
        <div v-if="loading && !issue" class="empty">
          <div class="empty-icon">⏳</div>
          {{ t('loading') }}
        </div>

        <template v-else-if="issue">
          <div class="mb-6">
            <StatusBadge :status="issue.status" />
            <h1 class="mt-3 mb-2 font-serif text-3xl font-bold">{{ issue.title }}</h1>
            <p v-if="issue.description" class="mt-0 mb-3 text-muted">{{ issue.description }}</p>
            <p class="m-0 text-sm text-muted">
              {{ t('issue_created') }} {{ formatDate(issue.created_at, locale) }} · {{ materials.length }} {{ t('issue_materials_unit') }} · {{ t('issue_author_label') }}：{{
                issue.author_name || t('author_system')
              }}<template v-if="issue.author_email"> · {{ t('author_email_label') }}：{{ issue.author_email }}</template>
            </p>
          </div>

          <div class="tabs">
            <button v-for="tab in tabs" :key="tab.id" type="button" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
              {{ tab.label }}
            </button>
          </div>

          <!-- Briefing -->
          <section v-show="activeTab === 'briefing'">
            <template v-if="!briefing">
              <div class="alert alert-warn mb-4">{{ t('brief_no_briefing_alert') }}</div>
              <div class="empty">
                <div class="empty-icon">📝</div>
                {{ t('brief_go_volunteer') }}
              </div>
              <div class="mt-4 flex gap-2">
                <a :href="`/contribute/${issueId}`" class="btn btn-primary">{{ t('brief_submit_material') }}</a>
                <button type="button" class="btn btn-secondary" @click="activeTab = 'volunteer'">
                  {{ t('tab_volunteer') }}
                </button>
              </div>
            </template>
            <template v-else>
              <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('brief_overview') }}</h2>
              <div class="mb-6 whitespace-pre-wrap leading-relaxed">{{ briefing.narrative }}</div>
              <div class="grid-2 mb-6">
                <div class="card">
                  <h3 class="mt-0 mb-2 text-base">{{ t('brief_consensus') }}</h3>
                  <div class="markdown-content text-sm" v-html="renderedBriefing?.consensus ?? ''" />
                </div>
                <div class="card">
                  <h3 class="mt-0 mb-2 text-base">{{ t('brief_disputes') }}</h3>
                  <div class="markdown-content text-sm" v-html="renderedBriefing?.disputes ?? ''" />
                </div>
              </div>
              <div class="card mb-6">
                <h3 class="mt-0 mb-2 text-base">{{ t('brief_positions') }}</h3>
                <div class="markdown-content text-sm" v-html="renderedBriefing?.positions ?? ''" />
              </div>
              <div class="alert alert-info mb-4">
                {{ t('brief_opinion_alert') }}
                <br />
                <button type="button" class="btn btn-primary btn-sm mt-2.5" @click="activeTab = 'opinions'">
                  {{ t('brief_go_opinion') }}
                </button>
              </div>
              <p class="text-sm text-muted">
                {{ t('brief_version_prefix') }}{{ briefing.version }}，{{ t('brief_updated') }}
                {{ formatDate(briefing.created_at, locale) }} · {{ t('brief_author_label') }}：{{ briefing.author_name || t('author_system') }}
                <template v-if="briefing.author_email"> · {{ t('author_email_label') }}：{{ briefing.author_email }}</template>
              </p>
            </template>
            <div id="polis-section" class="my-8" style="display: none" />
          </section>

          <!-- Materials -->
          <section v-show="activeTab === 'materials'">
            <div class="mb-4 flex items-center justify-between gap-3">
              <h2 class="m-0 font-serif text-xl">{{ t('mat_title') }}</h2>
              <a :href="`/contribute/${issueId}`" class="btn btn-primary btn-sm">{{ t('mat_submit_btn') }}</a>
            </div>
            <div class="alert alert-info mb-4">{{ t('mat_alert') }}</div>
            <div v-if="!materials.length" class="empty">
              <div class="empty-icon">📭</div>
              {{ t('mat_empty') }}
            </div>
            <div v-for="m in materials" :key="m.id" class="card mb-4">
              <div class="mb-2 flex flex-wrap items-center gap-3">
                <span class="font-medium">{{ m.source_name || t('mat_source_unknown') }}</span>
                <span class="text-sm" :class="stanceClass(m.stance)">{{ stanceLabel(m.stance) }}</span>
                <a v-if="m.source_url" :href="m.source_url" target="_blank" rel="noopener noreferrer" class="text-sm">{{ t('mat_link') }}</a>
              </div>
              <div class="whitespace-pre-wrap text-sm leading-relaxed">{{ m.content }}</div>
              <p class="mt-2 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span>{{ formatDate(m.created_at, locale) }} · {{ m.verified_count }} {{ t('mat_contributor') }}</span>
                <span
                  >{{ t('mat_author_label') }}：{{ m.author_name || t('author_system') }}<template v-if="m.author_email"> · {{ t('author_email_label') }}：{{ m.author_email }}</template></span
                >
                <a :href="`/issues/${issueId}/source/${m.id}`" class="ml-auto text-xs text-muted hover:underline"> 🔗 {{ t('card_permalink') }} </a>
              </p>
            </div>
          </section>

          <!-- Volunteer -->
          <section v-show="activeTab === 'volunteer'">
            <h2 class="mt-0 mb-2 font-serif text-xl">{{ t('vol_title') }}</h2>
            <p class="mb-6 text-muted">{{ t('vol_intro') }}</p>
            <p v-if="authState === 'loading'" class="m-0 text-muted">{{ t('loading') }}</p>

            <template v-else-if="authState === 'anonymous'">
              <p class="mb-4 text-muted">{{ t('vol_login_desc') }}</p>
              <SignInButtons :callback-url="loginCallbackUrl" />
              <p class="mt-4 mb-0 text-sm text-muted">{{ t('login_shared_account_hint') }}</p>
            </template>

            <template v-else>
              <div v-if="volunteerSessionExpired" class="alert alert-warn mb-5">
                <p class="mt-0 mb-3">{{ t('login_expired_hint') }}</p>
                <SignInButtons :callback-url="loginCallbackUrl" />
              </div>
              <p class="mb-6 text-sm text-muted">{{ t('vol_step1') }} → {{ t('vol_step2') }} → {{ t('vol_step3') }}</p>
              <div class="form-group mb-6">
                <label class="flex items-start gap-2 font-normal">
                  <input v-model="volunteerShowEmail" type="checkbox" class="mt-1 w-auto" />
                  <span
                    >{{ t('show_email_label', { email: session?.user.email || '' }) }} <span class="text-muted">{{ t('show_email_hint') }}</span></span
                  >
                </label>
              </div>

              <div class="card mb-4">
                <h3 class="mt-0 mb-2 text-base">{{ t('vol_s1_title') }}</h3>
                <p class="mb-3 text-sm text-muted">{{ t('vol_s1_desc') }}</p>
                <div class="mb-3 flex flex-wrap gap-2">
                  <button type="button" class="btn btn-primary btn-sm" @click="loadPrompt('summarize')">
                    {{ t('vol_gen_summarize') }}
                  </button>
                  <button v-if="promptVisible.summarize" type="button" class="btn btn-secondary btn-sm" @click="copyPrompt('summarize')">
                    {{ t('vol_copy') }}
                  </button>
                </div>
                <div v-if="promptVisible.summarize" class="prompt-box mb-4">{{ promptText.summarize }}</div>
                <p class="mb-2 text-sm font-medium">{{ t('vol_paste_title') }}</p>
                <p class="mb-3 text-sm text-muted">{{ t('vol_paste_desc') }}</p>
                <div class="form-group">
                  <label>{{ t('vol_label_consensus') }}</label>
                  <textarea v-model="consensus" rows="3" :placeholder="t('vol_ph_consensus')" />
                </div>
                <div class="form-group">
                  <label>{{ t('vol_label_disputes') }}</label>
                  <textarea v-model="disputes" rows="3" :placeholder="t('vol_ph_disputes')" />
                </div>
                <div class="form-group">
                  <label>{{ t('vol_label_positions') }}</label>
                  <textarea v-model="positions" rows="4" :placeholder="t('vol_ph_positions')" />
                </div>
                <button type="button" class="btn btn-primary" @click="submitSummarize">
                  {{ t('vol_submit_summarize') }}
                </button>
              </div>

              <div class="card mb-4">
                <h3 class="mt-0 mb-2 text-base">{{ t('vol_s2_title') }}</h3>
                <p class="mb-3 text-sm text-muted">{{ t('vol_s2_desc') }}</p>
                <div class="mb-3 flex flex-wrap gap-2">
                  <button type="button" class="btn btn-primary btn-sm" @click="loadPrompt('narrative')">
                    {{ t('vol_gen_narrative') }}
                  </button>
                  <button v-if="promptVisible.narrative" type="button" class="btn btn-secondary btn-sm" @click="copyPrompt('narrative')">
                    {{ t('vol_copy') }}
                  </button>
                </div>
                <div v-if="promptVisible.narrative" class="prompt-box mb-4">{{ promptText.narrative }}</div>
                <div class="form-group">
                  <label>{{ t('vol_paste_narrative') }}</label>
                  <textarea v-model="narrative" rows="6" :placeholder="t('vol_ph_narrative')" />
                </div>
                <button type="button" class="btn btn-primary" @click="submitNarrative">
                  {{ t('vol_submit_narrative') }}
                </button>
              </div>

              <div class="card">
                <h3 class="mt-0 mb-2 text-base">{{ t('vol_s3_title') }}</h3>
                <p class="mb-3 text-sm text-muted">{{ t('vol_s3_desc') }}</p>
                <div class="mb-3 flex flex-wrap gap-2">
                  <button type="button" class="btn btn-primary btn-sm" @click="loadPrompt('synthesis')">
                    {{ t('vol_gen_synthesis') }}
                  </button>
                  <button v-if="promptVisible.synthesis" type="button" class="btn btn-secondary btn-sm" @click="copyPrompt('synthesis')">
                    {{ t('vol_copy') }}
                  </button>
                </div>
                <div v-if="promptVisible.synthesis" class="prompt-box">{{ promptText.synthesis }}</div>
              </div>
            </template>
          </section>

          <!-- Opinions -->
          <section v-show="activeTab === 'opinions'">
            <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('op_title') }}</h2>
            <div class="alert alert-info mb-4" v-html="t('op_alert')" />
            <button type="button" class="btn btn-secondary mb-6" @click="downloadOpinionMd">
              {{ t('op_download_btn') }}
            </button>
            <div class="card mb-6">
              <h3 class="mt-0 mb-3 text-base">{{ t('op_submit_title') }}</h3>

              <!-- 讀取 session 中：SSR 與 hydration 首幀共用這個骨架 -->
              <p v-if="authState === 'loading'" class="m-0 text-muted">{{ t('loading') }}</p>

              <!-- 未登入：意見投稿需登入，輸入框不出現（守門在伺服器端） -->
              <template v-else-if="authState === 'anonymous'">
                <p class="mb-4 text-muted">{{ t('op_login_desc') }}</p>
                <SignInButtons :callback-url="loginCallbackUrl" />
                <p class="mt-4 mb-0 text-sm text-muted">{{ t('login_shared_account_hint') }}</p>
              </template>

              <template v-else>
                <!-- 打字期間 session 過期：輸入框留著，只補一列重新登入 -->
                <div v-if="sessionExpired" class="alert alert-warn mb-5">
                  <p class="mt-0 mb-3">{{ t('login_expired_hint') }}</p>
                  <SignInButtons :callback-url="loginCallbackUrl" />
                </div>
                <div class="form-group">
                  <label>
                    <span>{{ t('op_label_summary') }}</span>
                    <span class="label-hint">{{ t('op_hint_summary') }}</span>
                  </label>
                  <textarea v-model="opinionInput" rows="5" :placeholder="t('op_ph_summary')" />
                </div>
                <div class="form-group">
                  <label class="flex items-start gap-2 font-normal">
                    <input v-model="opinionTosAgreed" type="checkbox" class="mt-1 w-auto" />
                    <span
                      >{{ t('tos_agree_prefix') }}<a href="/terms" target="_blank" class="underline">{{ t('tos_terms_link') }}</a
                      >{{ t('tos_agree_mid') }}<a href="/privacy" target="_blank" class="underline">{{ t('tos_privacy_link') }}</a
                      >{{ t('tos_agree_suffix') }}</span
                    >
                  </label>
                </div>
                <div class="form-group">
                  <label class="flex items-start gap-2 font-normal">
                    <input v-model="opinionShowEmail" type="checkbox" class="mt-1 w-auto" />
                    <span
                      >{{ t('show_email_label', { email: session?.user.email || '' }) }} <span class="text-muted">{{ t('show_email_hint') }}</span></span
                    >
                  </label>
                </div>
                <button type="button" class="btn btn-primary" @click="submitOpinion">
                  {{ t('op_submit_btn') }}
                </button>
              </template>
            </div>
            <div v-if="!opinions.length" class="empty">
              <div class="empty-icon">💬</div>
              {{ t('op_empty') }}
            </div>
            <template v-else>
              <h3 class="mb-4 font-medium">{{ t('op_count_prefix') }}{{ opinions.length }}{{ t('op_count_suffix') }}</h3>
              <div v-for="o in opinions" :key="o.id" class="card mb-4">
                <p class="mt-0 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  <span>{{ formatDate(o.created_at, locale) }}</span>
                  <span
                    >{{ t('op_author_label') }}：{{ o.author_name || t('author_system') }}<template v-if="o.author_email"> · {{ t('author_email_label') }}：{{ o.author_email }}</template></span
                  >
                  <a :href="`/issues/${issueId}/comment/${o.id}`" class="ml-auto text-xs text-muted hover:underline"> 🔗 {{ t('card_permalink') }} </a>
                </p>
                <div class="whitespace-pre-wrap text-sm leading-relaxed">{{ o.summary }}</div>
              </div>
            </template>
          </section>
        </template>
      </div>
    </main>

    <AppFooter />
    <Toast ref="toast" />
  </div>
</template>
