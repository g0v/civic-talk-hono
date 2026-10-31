<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Carousel, Navigation, Pagination, Slide } from 'vue3-carousel'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import AuthorEmailLink from '../components/AuthorEmailLink.vue'
import LongTextContent from '../components/LongTextContent.vue'
import OpinionVote from '../components/OpinionVote.vue'
import SignInButtons from '../components/SignInButtons.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Toast from '../components/Toast.vue'
import ModerationAppealNotice from '../components/ModerationAppealNotice.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import { postSubmissionWithDuplicateNameCheck } from '../client/submission'
import { briefingMarkdown, copyTextWhenReady, type BriefingMarkdownField } from '../client/clipboard'
import { useAuth } from '../composables/useAuth'
import { useSubmitGuard } from '../composables/useSubmitGuard'
import { useViewerRole } from '../composables/useViewerRole'
import type { Briefing, Issue, Material, Opinion, OpinionVoteState } from '../db/queries'
import { formatDate, useI18n } from '../l10n'
import { renderSafeMarkdown } from '../markdown/renderSafeMarkdown'
import {
  parseIssueBriefingSlide,
  parseIssueCommentAction,
  parseIssueOpinionAnchor,
  parseIssueStep,
  writeIssueBriefingSlide,
  writeIssueCommentAction,
  writeIssueCommentSearch,
  writeIssueOpinionAnchor,
  writeIssueStep,
  type IssueCommentAction,
  type IssueStep,
} from '../lib/issueNavigation'

const props = defineProps<{
  issueId: number
  initialDetail?: {
    issue: Issue
    materials: Material[]
    briefing: Briefing | null
    opinions: Opinion[]
  } | null
  initialStep?: IssueStep | null
  initialBriefingSlide?: number
  initialCommentAction?: IssueCommentAction
  initialCommentSearch?: string
}>()

const { t, locale } = useI18n()
const isJapanese = computed(() => locale.value === 'ja')
const { viewerRole } = useViewerRole()
const toast = ref<{ show: (msg: string) => void } | null>(null)

const issue = ref<Issue | null>(props.initialDetail?.issue ?? null)
const materials = ref<Material[]>(props.initialDetail?.materials ?? [])
const briefing = ref<Briefing | null>(props.initialDetail?.briefing ?? null)
const opinions = ref<Opinion[]>(props.initialDetail?.opinions ?? [])
const opinionSort = ref<'recent' | 'responses'>('recent')
const opinionsLoading = ref(false)
const loading = ref(!props.initialDetail)
const activeStep = ref<IssueStep | null>(props.initialStep ?? null)
const commentAction = ref<IssueCommentAction>(props.initialCommentAction ?? 'start')
const commentSearch = ref(props.initialCommentSearch ?? '')
const lastBriefingSlideIndex = 3
// SSR 固定公民角色；志願者的第五張在 hydration 後才還原。
const carouselIndex = ref(Math.min(props.initialBriefingSlide ?? 0, lastBriefingSlideIndex))
const briefingTabKeys = ['issue_tab_overview', 'issue_tab_consensus', 'issue_tab_disputes', 'issue_tab_positions'] as const
const currentNavigationUrl = ref<string | null>(null)
const carouselI18n = computed(() => ({
  ariaGallery: t('issue_carousel_aria'),
  ariaNextSlide: t('issue_carousel_next'),
  ariaPreviousSlide: t('issue_carousel_previous'),
  ariaNavigateToSlide: t('issue_carousel_goto'),
  itemXofY: t('issue_carousel_position'),
}))
const renderedBriefing = computed(() => {
  const current = briefing.value
  if (!current) return null

  return {
    narrative: renderSafeMarkdown(current.narrative),
    consensus: renderSafeMarkdown(current.consensus),
    disputes: renderSafeMarkdown(current.disputes),
    positions: renderSafeMarkdown(current.positions),
  }
})
const renderedOpinions = computed(() => new Map(opinions.value.map(opinion => [opinion.id, renderSafeMarkdown(opinion.summary)])))
const isLongOpinion = (summary: string | null) => [...(summary ?? '')].length > 50
const opinionPreview = (summary: string | null) => `${[...(summary ?? '')].slice(0, 50).join('')}…`
const filteredOpinions = computed(() => {
  const keyword = commentSearch.value.trim().toLowerCase()
  if (!keyword) return opinions.value
  return opinions.value.filter(opinion => [opinion.summary ?? '', opinion.author_name ?? ''].some(value => value.toLowerCase().includes(keyword)))
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
// 送出防重入（#97）：意見送出請求進行中，重複點擊直接忽略
const { pending: opinionSubmitting, run: runOpinionSubmit } = useSubmitGuard()
const { pending: summarySubmitting, run: runSummarySubmit } = useSubmitGuard()
// ToS 同意 checkbox（#27）
const opinionTosAgreed = ref(false)
// Email 公開選項（#27）
const opinionShowEmail = ref(false)
// 志願者送出說明頁時的 email 公開選項
const volunteerShowEmail = ref(false)
// Step 3 再彙整的獨立輸入 ref（不與 Step 1 的 consensus/disputes/positions 共用）
const synthConsensus = ref('')
const synthDisputes = ref('')
const synthPositions = ref('')
// 再彙整送出成功後顯示「建議重跑 Step 2」提示
const synthesisDone = ref(false)

// 全站共用的登入狀態（與 AppHeader 共用同一次 /api/me）；SSR 期間永遠是 'loading'
const { authState, session, ensureAuthSession } = useAuth()
const duplicateNameRequiresEmail = computed(() => session.value?.hasDuplicateDisplayName === true)
// 送出時才發現 session 過期：意見框留著（別吃掉使用者打的字），只在上方補一列重新登入
const sessionExpired = ref(false)
// 志願者工具同樣需要登入；若操作時 session 過期，保留已填內容並引導重新登入。
const volunteerSessionExpired = ref(false)
type ModerationNotice = { appealType: 'rejected_submission' | 'account_ban'; reportId?: number; policyCode?: string; rationale?: string }
const volunteerModerationNotice = ref<ModerationNotice | null>(null)
const opinionModerationNotice = ref<ModerationNotice | null>(null)

async function postIssueSubmission(path: string, body: Record<string, unknown>): Promise<Response | null> {
  return postSubmissionWithDuplicateNameCheck(path, body, () => window.confirm(t('duplicate_name_submission_confirm', { email: session.value?.user.email || '' })))
}

async function handleModerationResult(res: Response, source: 'volunteer' | 'opinion'): Promise<boolean> {
  const notice = source === 'volunteer' ? volunteerModerationNotice : opinionModerationNotice
  if (res.status === 403) {
    notice.value = { appealType: 'account_ban' }
    toast.value?.show(t('banned_toast'))
    return true
  }
  if (!res.ok) return false
  const data = (await res.json().catch(() => ({}))) as {
    moderation?: { hidden?: boolean; policy_code?: string; rationale?: string; report_id?: number | null }
  }
  if (!data.moderation?.hidden) {
    notice.value = null
    return false
  }
  notice.value = {
    appealType: 'rejected_submission',
    reportId: data.moderation.report_id ?? undefined,
    policyCode: data.moderation.policy_code,
    rationale: data.moderation.rationale,
  }
  toast.value?.show(t('moderation_hidden_title'))
  return true
}

// 回報濫用 modal 狀態
const reportTarget = ref<{ type: 'material' | 'briefing' | 'opinion'; id: number } | null>(null)
const reportReason = ref<string>('spam')
const reportDesc = ref<string>('')
// 已展開的「折疊中」項目：key = `${type}-${id}`
const expandedFlagged = ref<Set<string>>(new Set())
const expandedOpinions = ref<Set<number>>(new Set())
const pendingOpinionId = ref<number | null>(null)

function toggleOpinion(id: number) {
  const next = new Set(expandedOpinions.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedOpinions.value = next
}

function toggleFlagged(type: string, id: number) {
  const key = `${type}-${id}`
  const next = new Set(expandedFlagged.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedFlagged.value = next
}

function openReport(type: 'material' | 'briefing' | 'opinion', id: number) {
  reportTarget.value = { type, id }
  reportReason.value = 'spam'
  reportDesc.value = ''
}

async function submitReport() {
  const target = reportTarget.value
  if (!target) return
  if (authState.value !== 'signed-in') {
    toast.value?.show(t('report_toast_no_login'))
    return
  }
  const body: Record<string, unknown> = {
    reason: reportReason.value,
    description: reportDesc.value.trim() || undefined,
  }
  body[`${target.type}_id`] = target.id
  const res = await fetch('/api/abuse-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  reportTarget.value = null
  if (res.ok) {
    toast.value?.show(t('report_toast_ok'))
    await loadIssue()
  } else {
    toast.value?.show(t('report_toast_fail'))
  }
}

async function submitBrokenLinkReport(materialId: number) {
  if (authState.value !== 'signed-in') {
    toast.value?.show(t('report_toast_no_login'))
    return
  }
  const res = await fetch('/api/abuse-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ material_id: materialId, reason: 'broken_link' }),
  })
  if (res.ok) {
    toast.value?.show(t('report_broken_toast_ok'))
    await loadIssue()
  } else {
    toast.value?.show(t('report_toast_fail'))
  }
}

const dragThresholdReached = ref(false)
let carouselDragEndListening = false
let carouselDragEndFrame: number | null = null

function clearCarouselDragEndListeners() {
  if (!carouselDragEndListening || typeof document === 'undefined') return
  document.removeEventListener('touchend', finishCarouselDrag)
  carouselDragEndListening = false
}

function finishCarouselDrag() {
  clearCarouselDragEndListeners()
  if (typeof window === 'undefined') return

  // 等拖曳結束事件處理完再切換版面，避免 carousel 在事件中途卸載
  carouselDragEndFrame = window.requestAnimationFrame(() => {
    carouselDragEndFrame = null
    const shouldEnterComments = dragThresholdReached.value && viewerRole.value === 'citizen' && !activeStep.value && carouselIndex.value === lastBriefingSlideIndex
    dragThresholdReached.value = false
    if (shouldEnterComments) setIssueStep('comments')
  })
}

function listenForCarouselDragEnd() {
  if (carouselDragEndListening || typeof document === 'undefined') return
  carouselDragEndListening = true
  document.addEventListener('touchend', finishCarouselDrag, { passive: true })
}

function updateNavigationUrl(url: string, replace = false) {
  if (typeof window === 'undefined') return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url)
  currentNavigationUrl.value = `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function setIssueStep(step: IssueStep | null, replace = false) {
  const enteringComments = step === 'comments' && activeStep.value !== 'comments'
  activeStep.value = step
  if (!step) dragThresholdReached.value = false
  if (step !== 'comments' || enteringComments) {
    commentAction.value = 'start'
    commentSearch.value = ''
  }
  if (typeof window === 'undefined') return
  let nextUrl = writeIssueStep(window.location.href, step)
  if (step !== 'comments' || enteringComments) {
    nextUrl = writeIssueCommentAction(nextUrl, 'start')
    nextUrl = writeIssueCommentSearch(nextUrl, '')
  }
  if (!step) nextUrl = writeIssueBriefingSlide(nextUrl, carouselIndex.value)
  updateNavigationUrl(nextUrl, replace)
}

function selectBriefingSlide(index: number) {
  carouselIndex.value = index
  setIssueStep(null)
}

function setIssueCommentAction(action: IssueCommentAction, replace = false) {
  commentAction.value = action
  if (typeof window === 'undefined') return
  const nextUrl = writeIssueCommentAction(window.location.href, action)
  updateNavigationUrl(nextUrl, replace)
}

function syncCommentSearch() {
  if (typeof window === 'undefined') return
  const nextUrl = writeIssueCommentSearch(window.location.href, commentSearch.value)
  updateNavigationUrl(nextUrl, true)
}

function rememberOpinionPosition(id: number) {
  if (typeof window === 'undefined') return
  updateNavigationUrl(writeIssueOpinionAnchor(window.location.href, id), true)
}

async function restoreOpinionPosition() {
  const id = pendingOpinionId.value
  if (id === null || loading.value || opinionsLoading.value || authState.value === 'loading' || activeStep.value !== 'comments' || commentAction.value !== 'browse') return
  const opinion = opinions.value.find(row => row.id === id)
  if (!opinion) {
    pendingOpinionId.value = null
    return
  }
  if (opinion.abuse_flagged !== 2 && opinion.abuse_flagged !== 3) {
    expandedOpinions.value.add(id)
    if (opinion.abuse_flagged === 1) expandedFlagged.value.add(`opinion-${id}`)
  }
  await nextTick()
  if (typeof window === 'undefined' || pendingOpinionId.value !== id || opinionsLoading.value || activeStep.value !== 'comments' || commentAction.value !== 'browse') return
  const target = document.getElementById(`opinion-vote-${id}`) ?? document.getElementById(`opinion-${id}`)
  target?.scrollIntoView({ block: 'center', behavior: 'auto' })
  pendingOpinionId.value = null
}

const loginCallbackUrl = computed(() => {
  if (currentNavigationUrl.value) return currentNavigationUrl.value
  let callback = writeIssueBriefingSlide(`/issues/${props.issueId}`, props.initialBriefingSlide ?? 0)
  if (props.initialStep) callback = writeIssueStep(callback, props.initialStep)
  if (props.initialStep === 'comments') {
    callback = writeIssueCommentAction(callback, props.initialCommentAction ?? 'start')
    callback = writeIssueCommentSearch(callback, props.initialCommentSearch ?? '')
  }
  return callback
})

function handleCarouselDrag({ deltaX, deltaY }: { deltaX: number; deltaY: number }) {
  if (viewerRole.value !== 'citizen' || activeStep.value) return
  if (Math.abs(deltaX) <= Math.abs(deltaY)) {
    dragThresholdReached.value = false
    return
  }
  if (carouselIndex.value < lastBriefingSlideIndex) {
    dragThresholdReached.value = false
    return
  }
  dragThresholdReached.value = deltaX < -80
  if (dragThresholdReached.value) listenForCarouselDragEnd()
}

function handlePopState() {
  const search = window.location.search
  currentNavigationUrl.value = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const nextStep = parseIssueStep(search)
  activeStep.value = nextStep
  commentAction.value = parseIssueCommentAction(search)
  commentSearch.value = new URLSearchParams(search).get('search') ?? ''
  pendingOpinionId.value = nextStep === 'comments' && commentAction.value === 'browse' ? parseIssueOpinionAnchor(window.location.hash) : null
  if (!nextStep) dragThresholdReached.value = false
  carouselIndex.value = Math.min(parseIssueBriefingSlide(search), viewerRole.value === 'volunteer' ? 4 : lastBriefingSlideIndex)
}

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
  if (authState.value === 'signed-in') await loadOpinions()
}

async function loadOpinions(sort: 'recent' | 'responses' = opinionSort.value) {
  opinionsLoading.value = true
  try {
    const res = await fetch(`/api/issues/${props.issueId}/opinions?sort=${sort}`)
    if (!res.ok) return
    opinions.value = (await res.json()) as Opinion[]
  } finally {
    opinionsLoading.value = false
  }
}

function updateOpinionVote(id: number, state: OpinionVoteState) {
  opinions.value = opinions.value.map(opinion => (opinion.id === id ? { ...opinion, ...state } : opinion))
}

function changeOpinionSort() {
  void loadOpinions(opinionSort.value)
}

async function refreshViewerOpinions() {
  await ensureAuthSession()
  if (authState.value === 'signed-in') await loadOpinions()
}

onMounted(() => {
  void nextTick(handlePopState)
  if (!props.initialDetail) void loadIssue()
  window.addEventListener('popstate', handlePopState)
  void refreshViewerOpinions()
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', handlePopState)
  clearCarouselDragEndListeners()
  if (carouselDragEndFrame !== null) window.cancelAnimationFrame(carouselDragEndFrame)
})

watch(activeStep, () => {
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
})

watch(commentAction, () => {
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
})

watch(
  () => [pendingOpinionId.value, opinions.value, loading.value, opinionsLoading.value, authState.value, activeStep.value, commentAction.value] as const,
  () => void restoreOpinionPosition(),
  { flush: 'post' }
)

watch(carouselIndex, index => {
  if (typeof window === 'undefined' || activeStep.value) return
  const current = parseIssueBriefingSlide(window.location.search)
  if (current === index || (current === 4 && viewerRole.value === 'citizen' && index === lastBriefingSlideIndex)) return
  updateNavigationUrl(writeIssueBriefingSlide(window.location.href, index))
})

watch(viewerRole, role => {
  dragThresholdReached.value = false
  if (role === 'citizen' && carouselIndex.value > lastBriefingSlideIndex) {
    carouselIndex.value = lastBriefingSlideIndex
  }
  if (role === 'volunteer') {
    void nextTick(() => {
      if (typeof window !== 'undefined' && viewerRole.value === 'volunteer' && !activeStep.value && parseIssueBriefingSlide(window.location.search) === 4) {
        carouselIndex.value = 4
      }
    })
  }
})

async function loadPrompt(type: 'summarize' | 'narrative' | 'synthesis', notifyError = true): Promise<string | null> {
  const res = await fetch(`/api/issues/${props.issueId}/prompt?type=${type}`)
  if (res.status === 401) {
    volunteerSessionExpired.value = true
    if (notifyError) toast.value?.show(t('login_expired_toast'))
    return null
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    if (notifyError) toast.value?.show((e as { error?: string }).error || t('vol_toast_load_fail'))
    return null
  }
  const data = (await res.json()) as { prompt: string }
  promptText.value[type] = data.prompt
  promptVisible.value[type] = true
  return data.prompt
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

async function copyRssUrl() {
  const url = `${window.location.origin}/issues/${props.issueId}/rss.xml`
  try {
    await navigator.clipboard.writeText(url)
    toast.value?.show(t('rss_copy_ok'))
  } catch {
    toast.value?.show(t('rss_copy_fail', { url }))
  }
}

async function submitSummarize(copyNarrative = false) {
  await runSummarySubmit(async () => {
    const body = {
      consensus: consensus.value.trim(),
      disputes: disputes.value.trim(),
      positions: positions.value.trim(),
    }
    if (!body.consensus && !body.disputes && !body.positions) {
      toast.value?.show(t('vol_toast_fill_one'))
      return
    }
    let saved = false
    const preparePrompt = async (): Promise<string | null> => {
      try {
        const res = await postIssueSubmission(`/api/issues/${props.issueId}/briefing`, {
          ...body,
          show_email: volunteerShowEmail.value,
        })
        if (!res) return null
        if (res.status === 401) {
          volunteerSessionExpired.value = true
          toast.value?.show(t('login_expired_toast'))
          return null
        }
        if (await handleModerationResult(res, 'volunteer')) return null
        if (!res.ok) {
          toast.value?.show(t('vol_toast_save_fail'))
          return null
        }
        saved = true
        return copyNarrative ? await loadPrompt('narrative', false) : null
      } catch {
        if (!saved) toast.value?.show(t('vol_toast_save_fail'))
        return null
      }
    }
    // ClipboardItem 在點擊的同一個 call stack 建立，內容等儲存與取得 prompt 後才寫入。
    const prompt = preparePrompt()
    const copying = copyNarrative ? copyTextWhenReady(prompt) : null
    const text = await prompt
    const copied = copying ? await copying : false
    if (!saved) return
    const message = !copyNarrative
      ? t('vol_toast_summarize_ok')
      : !text
        ? t('vol_toast_summarize_prompt_fail')
        : copied
          ? t('vol_toast_summarize_copied')
          : t('vol_toast_summarize_copy_fail')
    try {
      await loadIssue()
      toast.value?.show(message)
    } catch {
      toast.value?.show(`${message} ${t('vol_toast_load_fail')}`)
    }
  })
}

async function submitSynthesis() {
  const body = {
    consensus: synthConsensus.value.trim(),
    disputes: synthDisputes.value.trim(),
    positions: synthPositions.value.trim(),
  }
  if (!body.consensus && !body.disputes && !body.positions) {
    toast.value?.show(t('vol_toast_fill_one'))
    return
  }
  const res = await postIssueSubmission(`/api/issues/${props.issueId}/briefing`, {
    ...body,
    show_email: volunteerShowEmail.value,
  })
  if (!res) return
  if (res.status === 401) {
    volunteerSessionExpired.value = true
    toast.value?.show(t('login_expired_toast'))
    return
  }
  if (await handleModerationResult(res, 'volunteer')) return
  if (res.ok) {
    toast.value?.show(t('vol_toast_synthesis_ok'))
    synthesisDone.value = true
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
  const body = { narrative: text }
  const res = await postIssueSubmission(`/api/issues/${props.issueId}/briefing`, {
    ...body,
    show_email: volunteerShowEmail.value,
  })
  if (!res) return
  if (res.status === 401) {
    volunteerSessionExpired.value = true
    toast.value?.show(t('login_expired_toast'))
    return
  }
  if (await handleModerationResult(res, 'volunteer')) return
  if (res.ok) {
    narrative.value = ''
    toast.value?.show(t('vol_toast_narrative_ok'))
    await loadIssue()
    setIssueStep(null)
  } else toast.value?.show(t('vol_toast_save_fail'))
}

function buildOpinionMd(): string {
  const b = briefing.value
  const iss = issue.value
  const briefingText = b
    ? `## ${t('op_md_consensus')}\n${b.consensus}\n\n## ${t('op_md_disputes')}\n${b.disputes}\n\n## ${t('op_md_positions')}\n${b.positions}\n\n## ${t('op_md_overview')}\n${b.narrative}`
    : t('op_md_unpublished')

  return t('op_md_document', {
    title: iss?.title || t('op_md_default_title'),
    briefing: briefingText,
    date: formatDate(new Date().toISOString(), locale.value),
  })
}

function downloadOpinionMd() {
  const md = buildOpinionMd()

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  const objectUrl = URL.createObjectURL(blob)
  a.href = objectUrl
  a.download = `OPINION_${props.issueId}.md`
  a.click()
  URL.revokeObjectURL(objectUrl)
  toast.value?.show(t('op_toast_download_ok'))
}

async function copyBriefingMarkdown(field: BriefingMarkdownField) {
  if (!briefing.value) return
  try {
    await navigator.clipboard.writeText(briefingMarkdown(briefing.value, field))
    toast.value?.show(t('brief_copy_md_ok'))
  } catch {
    toast.value?.show(t('brief_copy_md_fail'))
  }
}

async function copyOpinionMd() {
  try {
    await navigator.clipboard.writeText(buildOpinionMd())
    toast.value?.show(t('op_toast_copy_ok'))
  } catch {
    toast.value?.show(t('op_toast_copy_fail'))
  }
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
  const res = await postIssueSubmission(`/api/issues/${props.issueId}/opinions`, {
    summary,
    show_email: opinionShowEmail.value,
    terms_accepted: opinionTosAgreed.value,
  })
  if (!res) return
  // session 可能在打字期間過期——守門在伺服器端，前端接住 401 但保留已寫的意見
  if (res.status === 401) {
    sessionExpired.value = true
    toast.value?.show(t('login_expired_toast'))
    return
  }
  if (await handleModerationResult(res, 'opinion')) return
  if (res.ok) {
    toast.value?.show(t('op_toast_submit_ok'))
    opinionInput.value = ''
    opinionTosAgreed.value = false
    opinionShowEmail.value = false
    await loadIssue()
    setIssueCommentAction('celebrate')
  } else toast.value?.show(t('op_toast_submit_fail'))
}
</script>

<template>
  <div :class="{ 'issue-carousel-page': !activeStep }">
    <AppHeader current="issue" :callback-url="loginCallbackUrl" />

    <main class="py-2" :class="{ 'issue-main-carousel': !activeStep }">
      <div class="page-container" :class="{ 'issue-container-carousel': !activeStep }">
        <div v-if="loading && !issue" class="empty">
          <div class="empty-icon">⏳</div>
          {{ t('loading') }}
        </div>

        <template v-else-if="issue">
          <section v-if="issue.closure_reason" class="mb-2 shrink-0 rounded-lg border border-border bg-vt-bg-2 px-3 py-2 text-sm" :aria-label="t('issue_closure_label')">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <strong>{{ t(issue.is_closed === 1 ? 'idx_tab_closed' : 'issue_reopened') }}</strong>
              <time v-if="issue.closure_changed_at" class="text-muted" :datetime="issue.closure_changed_at">{{ formatDate(issue.closure_changed_at, locale) }}</time>
            </div>
            <p class="my-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words">{{ issue.closure_reason }}</p>
            <p class="m-0 text-muted">{{ t('issue_closure_participation_hint') }}</p>
          </section>
          <div class="issue-page-heading mb-6">
            <div v-if="activeStep && activeStep !== 'comments'" class="hidden sm:flex">
              <StatusBadge :status="issue.status" />
            </div>
            <h1 class="mt-3 mb-2 font-serif font-bold" :class="activeStep === 'comments' ? 'text-lg sm:text-xl' : 'text-xl'">
              {{ issue.abuse_flagged === 3 ? t('moderation_hidden_placeholder') : issue.title }}
            </h1>
            <!-- <p v-if="issue.abuse_flagged !== 3 && issue.description" class="mt-0 mb-3 whitespace-pre-line text-muted">{{ issue.description }}</p> -->
            <p class="m-0 text-sm text-muted" :class="{ 'hidden sm:block': activeStep === 'comments' }" v-show="!activeStep || activeStep === 'comments'">
              {{ t('issue_created') }} {{ formatDate(issue.created_at, locale) }} · {{ materials.length }} {{ t('issue_materials_unit') }} · {{ t('issue_author_label') }}：{{
                issue.author_name || t('author_system')
              }}<template v-if="issue.author_email"> <AuthorEmailLink :email="issue.author_email" :name="issue.author_name" /></template>
            </p>
            <button type="button" class="btn btn-secondary btn-sm mt-3" :class="activeStep === 'comments' ? 'hidden sm:inline-flex' : 'inline-flex'" @click="copyRssUrl">{{ t('issue_rss_subscribe') }}</button>
          </div>

          <nav class="issue-briefing-tabs" :aria-label="t('issue_tabs_aria')">
            <button
              v-for="(key, index) in briefingTabKeys"
              :key="key"
              type="button"
              class="issue-briefing-tab"
              :aria-current="!activeStep && carouselIndex === index ? 'page' : undefined"
              @click="selectBriefingSlide(index)"
            >
              {{ t(key) }}
            </button>
            <button
              type="button"
              class="issue-briefing-tab"
              :aria-current="(viewerRole === 'volunteer' ? !activeStep && carouselIndex === 4 : activeStep === 'comments') ? 'page' : undefined"
              @click="viewerRole === 'volunteer' ? selectBriefingSlide(4) : setIssueStep('comments')"
            >
              {{ t(viewerRole === 'citizen' ? 'issue_tab_opinions' : 'issue_tab_actions') }}
            </button>
          </nav>

          <section v-if="!activeStep" class="issue-carousel-section">
            <Carousel
              v-model="carouselIndex"
              class="issue-carousel"
              :class="{ 'issue-carousel-at-end': viewerRole === 'citizen' && carouselIndex === lastBriefingSlideIndex }"
              :items-to-show="1"
              :wrap-around="false"
              :prevent-excessive-dragging="true"
              :touch-drag="true"
              :mouse-drag="false"
              :i18n="carouselI18n"
              @drag="handleCarouselDrag"
            >
              <Slide :index="0">
                <article class="issue-briefing-card card w-full">
                  <template v-if="!briefing">
                    <div class="alert alert-warn mb-4">{{ t('brief_no_briefing_alert') }}</div>
                    <div class="empty">
                      <div class="empty-icon">📝</div>
                      {{ t('brief_go_volunteer') }}
                    </div>
                    <div class="mt-4 flex gap-2">
                      <a :href="`/contribute/${issueId}`" class="btn btn-primary">{{ t('brief_submit_material') }}</a>
                      <button type="button" class="btn btn-secondary" @click="setIssueStep('volunteer')">{{ t('tab_volunteer') }}</button>
                    </div>
                  </template>
                  <template v-else-if="briefing.abuse_flagged === 2">
                    <div class="alert alert-error">{{ t('flagged_confirmed') }}</div>
                  </template>
                  <template v-else>
                    <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('brief_overview') }}</h2>
                    <div class="markdown-content mobile-readable" v-html="renderedBriefing?.narrative ?? ''" />
                    <p v-if="briefing.narrative" class="mt-6 flex">
                      <button type="button" class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted hover:text-teal" :aria-label="t('brief_copy_md_aria', { section: t(briefingTabKeys[0]) })" @click="copyBriefingMarkdown('narrative')">
                        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        {{ t('brief_copy_md') }}
                      </button>
                    </p>
                  </template>
                </article>
              </Slide>
              <Slide :index="1">
                <article class="issue-briefing-card card w-full">
                  <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('brief_consensus') }}</h2>
                  <div v-if="briefing && briefing.abuse_flagged !== 2" class="markdown-content mobile-readable" v-html="renderedBriefing?.consensus ?? ''" />
                  <div v-else class="empty">{{ t('brief_no_briefing_alert') }}</div>
                  <p v-if="briefing && briefing.abuse_flagged !== 2 && briefing.consensus" class="mt-6 flex">
                    <button type="button" class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted hover:text-teal" :aria-label="t('brief_copy_md_aria', { section: t(briefingTabKeys[1]) })" @click="copyBriefingMarkdown('consensus')">
                      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      {{ t('brief_copy_md') }}
                    </button>
                  </p>
                </article>
              </Slide>
              <Slide :index="2">
                <article class="issue-briefing-card card w-full">
                  <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('brief_disputes') }}</h2>
                  <div v-if="briefing && briefing.abuse_flagged !== 2" class="markdown-content mobile-readable" v-html="renderedBriefing?.disputes ?? ''" />
                  <div v-else class="empty">{{ t('brief_no_briefing_alert') }}</div>
                  <p v-if="briefing && briefing.abuse_flagged !== 2 && briefing.disputes" class="mt-6 flex">
                    <button type="button" class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted hover:text-teal" :aria-label="t('brief_copy_md_aria', { section: t(briefingTabKeys[2]) })" @click="copyBriefingMarkdown('disputes')">
                      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      {{ t('brief_copy_md') }}
                    </button>
                  </p>
                </article>
              </Slide>
              <Slide :index="3">
                <article class="issue-briefing-card card w-full">
                  <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('brief_positions') }}</h2>
                  <div v-if="briefing && briefing.abuse_flagged !== 2" class="markdown-content mobile-readable" v-html="renderedBriefing?.positions ?? ''" />
                  <div v-else class="empty">{{ t('brief_no_briefing_alert') }}</div>
                  <template v-if="briefing && briefing.abuse_flagged !== 2">
                    <p class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                      <span
                        >{{ t('brief_version_prefix') }}{{ briefing.version }}，{{ t('brief_updated') }} {{ formatDate(briefing.created_at, locale) }} · {{ t('brief_author_label') }}：{{
                          briefing.author_name || t('author_system')
                        }}</span
                      >
                      <AuthorEmailLink v-if="briefing.author_email" :email="briefing.author_email" :name="briefing.author_name" />
                      <button v-if="briefing.positions" type="button" class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted hover:text-teal" :aria-label="t('brief_copy_md_aria', { section: t(briefingTabKeys[3]) })" @click="copyBriefingMarkdown('positions')">
                        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        {{ t('brief_copy_md') }}
                      </button>
                      <button v-if="authState === 'signed-in' && !briefing.abuse_flagged" type="button" class="text-xs text-muted hover:text-red" @click="openReport('briefing', briefing.id)">
                        {{ t('report_btn') }}
                      </button>
                    </p>
                    <div v-if="briefing.abuse_flagged === 1" class="mt-2 text-sm text-amber-600">{{ t('flagged_warning') }}</div>
                  </template>
                </article>
              </Slide>
              <Slide v-if="viewerRole === 'volunteer'" :index="4">
                <article class="issue-briefing-card card w-full">
                  <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('tab_volunteer') }}</h2>
                  <div class="flex flex-col gap-3">
                    <button type="button" class="btn btn-primary" @click="setIssueStep('comments')">{{ t('tab_opinions') }}</button>
                    <button type="button" class="btn btn-secondary" @click="setIssueStep('materials')">{{ t('tab_materials') }}</button>
                    <button type="button" class="btn btn-secondary" @click="setIssueStep('volunteer')">{{ t('tab_volunteer') }}</button>
                  </div>
                </article>
              </Slide>
              <template #addons>
                <Navigation>
                  <template #prev>
                    <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </template>
                  <template #next>
                    <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </template>
                </Navigation>
                <Pagination />
                <button
                  v-if="viewerRole === 'citizen' && carouselIndex === lastBriefingSlideIndex"
                  type="button"
                  class="carousel__next issue-carousel-next"
                  :aria-label="t('issue_carousel_next_comments')"
                  :title="t('issue_carousel_next_comments')"
                  @click="setIssueStep('comments')"
                >
                  <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </template>
            </Carousel>
          </section>
          <div v-else>
            <!-- back to issue details -->
            <div class="mb-2 flex items-center gap-3">
              <button type="button" class="btn btn-ghost btn-sm" @click="setIssueStep(null)">
                {{ t('contrib_back') }}
              </button>
            </div>
          </div>
          <section v-show="activeStep === 'materials'">
            <div class="mb-2 flex items-center justify-between gap-3">
              <h2 class="m-0 font-serif text-xl">{{ t('mat_title') }}</h2>
              <a :href="`/contribute/${issueId}`" class="btn btn-primary btn-sm">{{ t('mat_submit_btn') }}</a>
            </div>
            <div class="alert alert-info mb-4">{{ t('mat_alert') }}</div>
            <div v-if="!materials.length" class="empty">
              <div class="empty-icon">📭</div>
              {{ t('mat_empty') }}
            </div>
            <div v-for="m in materials" :key="m.id" class="card mb-4">
              <!-- 已確認違規（2）：完全隱藏，無展開選項 -->
              <p v-if="m.abuse_flagged === 2" class="m-0 py-1 text-sm text-red">{{ t('flagged_confirmed') }}</p>
              <!-- AI 審查違規（3）：只顯示不可展開的佔位，不洩漏內容 -->
              <p v-else-if="m.abuse_flagged === 3" class="m-0 py-1 text-sm text-muted">{{ t('moderation_hidden_placeholder') }}</p>
              <!-- 待審核（1）：折疊 + 可展開 -->
              <div v-else-if="m.abuse_flagged === 1 && !expandedFlagged.has(`material-${m.id}`)" class="mb-2">
                <div class="alert alert-warn mb-2 flex items-center justify-between gap-2 py-2">
                  <span class="text-sm">{{ t('flagged_warning') }}</span>
                  <button type="button" class="btn btn-ghost btn-sm shrink-0" @click="toggleFlagged('material', m.id)">
                    {{ t('flagged_expand_btn') }}
                  </button>
                </div>
              </div>
              <!-- 正常或待審核已展開：顯示內容 -->
              <template v-if="m.abuse_flagged !== 2 && m.abuse_flagged !== 3 && (!m.abuse_flagged || expandedFlagged.has(`material-${m.id}`))">
                <div v-if="m.abuse_flagged === 1" class="mb-2 flex items-center justify-between gap-2">
                  <span class="text-xs text-amber-600">{{ t('flagged_warning') }}</span>
                  <button type="button" class="btn btn-ghost btn-sm shrink-0 text-xs" @click="toggleFlagged('material', m.id)">
                    {{ t('flagged_collapse_btn') }}
                  </button>
                </div>
                <div class="mb-2 flex flex-wrap items-center gap-3">
                  <span class="font-medium">{{ m.source_name || t('mat_source_unknown') }}</span>
                  <span class="text-sm" :class="stanceClass(m.stance)">{{ stanceLabel(m.stance) }}</span>
                  <a v-if="m.source_url" :href="m.source_url" target="_blank" rel="noopener noreferrer" class="text-sm">{{ t('mat_link') }}</a>
                </div>
                <LongTextContent :text="m.content ?? ''" :content-id="`material-content-${m.id}`" content-class="markdown-content mobile-readable" render-markdown />
              </template>
              <!-- metadata（已確認或 AI 審查違規時不顯示） -->
              <p v-if="m.abuse_flagged !== 2 && m.abuse_flagged !== 3" class="mt-2 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span>{{ formatDate(m.created_at, locale) }} · {{ m.verified_count }} {{ t('mat_contributor') }}</span>
                <span>
                  {{ t('mat_author_label') }}：{{ m.author_name || t('author_system') }}
                  <template v-if="m.author_email">
                    <AuthorEmailLink :email="m.author_email" :name="m.author_name" />
                  </template>
                </span>
                <a :href="`/issues/${issueId}/source/${m.id}`" class="text-xs text-muted hover:underline"> 🔗 {{ t('card_permalink') }} </a>
                <button v-if="authState === 'signed-in' && m.source_url && !m.abuse_flagged" type="button" class="text-xs text-muted hover:text-amber-600" @click="submitBrokenLinkReport(m.id)">
                  {{ t('report_broken_btn') }}
                </button>
                <button v-if="authState === 'signed-in' && !m.abuse_flagged" type="button" class="ml-auto text-xs text-muted hover:text-red" @click="openReport('material', m.id)">
                  {{ t('report_btn') }}
                </button>
              </p>
            </div>
          </section>

          <!-- Volunteer -->
          <section v-show="activeStep === 'volunteer'" :class="{ 'max-sm:[&_label]:text-sm': isJapanese }">
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
              <ModerationAppealNotice
                v-if="volunteerModerationNotice"
                :appeal-type="volunteerModerationNotice.appealType"
                :report-id="volunteerModerationNotice.reportId"
                :policy-code="volunteerModerationNotice.policyCode"
                :rationale="volunteerModerationNotice.rationale"
              />
              <p class="mb-6 text-sm text-muted">{{ t('vol_step1') }} → {{ t('vol_step2') }} → {{ t('vol_step3') }}</p>
              <div v-if="duplicateNameRequiresEmail" class="alert alert-info mb-6">
                {{ t('duplicate_name_email_required', { email: session?.user.email || '' }) }}
              </div>
              <div v-else class="form-group mb-6">
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
                  <label for="briefing-consensus">{{ t('vol_label_consensus') }}</label>
                  <MarkdownEditor id="briefing-consensus" v-model="consensus" :label="t('vol_label_consensus')" :rows="3" :placeholder="t('vol_ph_consensus')" />
                </div>
                <div class="form-group">
                  <label for="briefing-disputes">{{ t('vol_label_disputes') }}</label>
                  <MarkdownEditor id="briefing-disputes" v-model="disputes" :label="t('vol_label_disputes')" :rows="3" :placeholder="t('vol_ph_disputes')" />
                </div>
                <div class="form-group">
                  <label for="briefing-positions">{{ t('vol_label_positions') }}</label>
                  <MarkdownEditor id="briefing-positions" v-model="positions" :label="t('vol_label_positions')" :rows="4" :placeholder="t('vol_ph_positions')" />
                </div>
                <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap" :aria-busy="summarySubmitting">
                  <button type="button" class="btn btn-primary" :disabled="summarySubmitting" @click="submitSummarize()">
                    {{ summarySubmitting ? t('submitting_pending') : t('vol_submit_summarize') }}
                  </button>
                  <button type="button" class="btn btn-wheat-yellow whitespace-normal text-vt-black" :disabled="summarySubmitting" @click="submitSummarize(true)">
                    {{ summarySubmitting ? t('submitting_pending') : t('vol_submit_summarize_copy') }}
                  </button>
                </div>
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
                  <label for="briefing-narrative">{{ t('vol_paste_narrative') }}</label>
                  <MarkdownEditor id="briefing-narrative" v-model="narrative" :label="t('vol_paste_narrative')" :rows="6" :placeholder="t('vol_ph_narrative')" />
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
                <div v-if="promptVisible.synthesis" class="prompt-box mb-4">{{ promptText.synthesis }}</div>
                <p class="mb-2 text-sm font-medium">{{ t('vol_paste_title') }}</p>
                <div class="alert alert-info mb-3 text-sm">{{ t('vol_s3_partial_hint') }}</div>
                <div class="form-group">
                  <label for="synthesis-consensus">{{ t('vol_label_consensus') }}</label>
                  <MarkdownEditor id="synthesis-consensus" v-model="synthConsensus" :label="t('vol_label_consensus')" :rows="3" :placeholder="t('vol_ph_consensus')" />
                </div>
                <div class="form-group">
                  <label for="synthesis-disputes">{{ t('vol_label_disputes') }}</label>
                  <MarkdownEditor id="synthesis-disputes" v-model="synthDisputes" :label="t('vol_label_disputes')" :rows="3" :placeholder="t('vol_ph_disputes')" />
                </div>
                <div class="form-group">
                  <label for="synthesis-positions">{{ t('vol_label_positions') }}</label>
                  <MarkdownEditor id="synthesis-positions" v-model="synthPositions" :label="t('vol_label_positions')" :rows="4" :placeholder="t('vol_ph_positions')" />
                </div>
                <button type="button" class="btn btn-primary" @click="submitSynthesis">
                  {{ t('vol_submit_synthesis') }}
                </button>
                <div v-if="synthesisDone" class="alert alert-info mt-4 text-sm">{{ t('vol_synth_done_hint') }}</div>
              </div>
            </template>
          </section>

          <!-- Opinions -->
          <section v-show="activeStep === 'comments'">
            <template v-if="commentAction === 'start'">
              <div class="comment-action-panel">
                <h2 class="mt-0 mb-3 font-serif text-xl">{{ t('op_start_title') }}</h2>
                <p class="mb-6 text-muted">{{ t('op_start_desc') }}</p>
                <div class="flex flex-col gap-3 sm:mx-auto sm:max-w-sm sm:gap-4">
                  <button type="button" class="btn btn-primary" @click="setIssueCommentAction('commit')">
                    <span class="sm:hidden">{{ t('op_start_continue') }}</span>
                    <span class="hidden sm:inline">{{ t('op_start_commit') }}</span>
                  </button>
                  <button type="button" class="btn btn-wheat-yellow hidden sm:inline-flex" @click="setIssueCommentAction('ai_help')">{{ t('op_ai_help_title') }}</button>
                  <button type="button" class="btn btn-jade-green" @click="setIssueCommentAction('browse')">{{ t('op_start_browse', { count: opinions.length }) }}</button>
                  <button type="button" class="btn btn-ghost" @click="setIssueStep(null)">{{ t('op_back_to_issue') }}</button>
                </div>
              </div>
            </template>

            <template v-else-if="commentAction === 'commit' || commentAction === 'ai_help'">
              <h2 class="mt-0 mb-2 font-serif text-xl">{{ commentAction === 'commit' ? t('op_commit_title') : t('op_ai_help_title') }}</h2>
              <p v-if="commentAction === 'ai_help'" class="mb-6 text-muted">{{ t('op_ai_help_desc') }}</p>
              <div class="card mb-6">
                <div v-if="commentAction === 'ai_help'" class="mb-6 flex flex-col gap-3 sm:flex-row">
                  <button type="button" class="btn btn-secondary" @click="copyOpinionMd">{{ t('op_copy_btn') }}</button>
                  <button type="button" class="btn btn-secondary" @click="downloadOpinionMd">{{ t('op_download_btn') }}</button>
                </div>
                <template v-if="authState === 'loading'">
                  <p class="m-0 text-muted">{{ t('loading') }}</p>
                </template>
                <template v-else-if="authState === 'anonymous'">
                  <p class="mb-4 text-muted">{{ t('op_login_desc') }}</p>
                  <SignInButtons :callback-url="loginCallbackUrl" />
                  <p class="mt-4 mb-0 text-sm text-muted">{{ t('login_shared_account_hint') }}</p>
                </template>
                <template v-else>
                  <ModerationAppealNotice
                    v-if="opinionModerationNotice"
                    :appeal-type="opinionModerationNotice.appealType"
                    :report-id="opinionModerationNotice.reportId"
                    :policy-code="opinionModerationNotice.policyCode"
                    :rationale="opinionModerationNotice.rationale"
                  />
                  <div v-if="sessionExpired" class="alert alert-warn mb-4">
                    <p class="mt-0 mb-3">{{ t('login_expired_hint') }}</p>
                    <SignInButtons :callback-url="loginCallbackUrl" />
                  </div>
                  <div class="form-group">
                    <label for="opinion-content">
                      <span v-if="commentAction === 'ai_help'">{{ t('op_label_summary') }}</span>
                      <span class="label-hint">{{ t('op_hint_summary') }}</span>
                    </label>
                    <MarkdownEditor
                      id="opinion-content"
                      v-model="opinionInput"
                      :rows="5"
                      :placeholder="commentAction === 'ai_help' ? t('op_ph_summary') : t('op_ph_summary_direct')"
                      :label="commentAction === 'ai_help' ? t('op_label_summary') : t('op_commit_title')"
                    />
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
                  <div v-if="duplicateNameRequiresEmail" class="alert alert-info">
                    {{ t('duplicate_name_email_required', { email: session?.user.email || '' }) }}
                  </div>
                  <div v-else class="form-group">
                    <label class="flex items-start gap-2 font-normal">
                      <input v-model="opinionShowEmail" type="checkbox" class="mt-1 w-auto" />
                      <span
                        >{{ t('show_email_label', { email: session?.user.email || '' }) }} <span class="text-muted">{{ t('show_email_hint') }}</span></span
                      >
                    </label>
                  </div>
                  <div class="flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <button v-if="commentAction === 'commit'" type="button" class="btn btn-wheat-yellow" @click="setIssueCommentAction('ai_help')">
                      {{ t('op_ai_help_title') }}
                    </button>
                    <button type="button" class="btn btn-primary" :disabled="opinionSubmitting" @click="runOpinionSubmit(submitOpinion)">
                      {{ opinionSubmitting ? t('submitting_pending') : t('op_submit_btn') }}
                    </button>
                  </div>
                </template>
              </div>
            </template>

            <template v-else-if="commentAction === 'celebrate'">
              <div class="comment-action-panel text-center">
                <div class="comment-celebration-emoji mb-4" aria-hidden="true">🎉</div>
                <h2 class="mt-0 mb-3 font-serif text-2xl">{{ t('op_celebrate_title') }}</h2>
                <div class="flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <button type="button" class="btn btn-primary" @click="setIssueCommentAction('start')">{{ t('op_back_to_start') }}</button>
                  <button v-if="opinions.length > 0" type="button" class="btn btn-secondary" @click="setIssueCommentAction('browse')">{{ t('op_celebrate_browse') }}</button>
                </div>
              </div>
            </template>

            <template v-else-if="commentAction === 'browse'">
              <p class="mt-0 mb-2 text-sm text-muted">{{ issue.abuse_flagged === 3 ? t('moderation_hidden_placeholder') : issue.title }}</p>
              <h2 class="mt-0 mb-6 font-serif text-xl">{{ t('op_browse_title') }}</h2>
              <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <label class="flex w-full flex-col gap-1 text-sm text-muted sm:max-w-sm">
                  <span class="sr-only">{{ t('op_search_placeholder') }}</span>
                  <input v-model="commentSearch" type="search" :placeholder="t('op_search_placeholder')" :aria-label="t('op_search_placeholder')" @input="syncCommentSearch" />
                </label>
                <div class="flex flex-wrap items-center gap-3">
                  <label class="flex items-center gap-2 text-sm text-muted">
                    <span>{{ t('op_sort_label') }}</span>
                    <select v-model="opinionSort" class="rounded border border-border bg-transparent px-2 py-1 text-base sm:text-sm" @change="changeOpinionSort">
                      <option value="recent">{{ t('op_sort_recent') }}</option>
                      <option value="responses">{{ t('op_sort_responses') }}</option>
                    </select>
                  </label>
                  <a v-if="authState === 'signed-in'" :href="`/api/issues/${issueId}/opinions/comments.csv`" class="btn btn-secondary btn-sm" download>
                    {{ t('op_download_csv_btn') }}
                  </a>
                  <span v-else-if="authState === 'anonymous'" class="text-sm text-muted">{{ t('op_csv_login_required') }}</span>
                  <span v-if="opinionsLoading" class="text-sm text-muted">{{ t('loading') }}</span>
                </div>
              </div>
              <div v-if="!filteredOpinions.length" class="empty">
                <span v-if="opinionsLoading" class="text-sm text-muted">{{ t('loading') }}</span>
                <div v-else class="empty-icon">💬</div>
                {{ t('op_empty') }}
              </div>
              <template v-else>
                <h3 class="mb-4 font-medium">{{ t('op_count_prefix') }}{{ filteredOpinions.length }}{{ t('op_count_suffix') }}</h3>
                <div v-for="o in filteredOpinions" :id="`opinion-${o.id}`" :key="o.id" class="card mb-4">
                  <!-- 已確認違規（2）：完全隱藏，無展開選項 -->
                  <p v-if="o.abuse_flagged === 2" class="m-0 py-1 text-sm text-red">{{ t('flagged_confirmed') }}</p>
                  <!-- AI 審查違規（3）：只顯示不可展開的佔位，不洩漏內容 -->
                  <p v-else-if="o.abuse_flagged === 3" class="m-0 py-1 text-sm text-muted">{{ t('moderation_hidden_placeholder') }}</p>
                  <!-- 待審核（1）：折疊 + 可展開 -->
                  <div v-else-if="o.abuse_flagged === 1 && !expandedFlagged.has(`opinion-${o.id}`)" class="mb-2">
                    <div class="alert alert-warn flex items-center justify-between gap-2 py-2">
                      <span class="text-sm">{{ t('flagged_warning') }}</span>
                      <button type="button" class="btn btn-ghost btn-sm shrink-0" @click="toggleFlagged('opinion', o.id)">
                        {{ t('flagged_expand_btn') }}
                      </button>
                    </div>
                  </div>
                  <!-- 正常或待審核已展開：顯示內容 -->
                  <template v-if="o.abuse_flagged !== 2 && o.abuse_flagged !== 3 && (!o.abuse_flagged || expandedFlagged.has(`opinion-${o.id}`))">
                    <div v-if="o.abuse_flagged === 1" class="mb-1 flex items-center justify-between gap-2">
                      <span class="text-xs text-amber-600">{{ t('flagged_warning') }}</span>
                      <button type="button" class="btn btn-ghost btn-sm shrink-0 text-xs" @click="toggleFlagged('opinion', o.id)">
                        {{ t('flagged_collapse_btn') }}
                      </button>
                    </div>
                    <p class="mt-0 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                      <span>{{ formatDate(o.created_at, locale) }}</span>
                      <span>
                        {{ t('op_author_label') }}：{{ o.author_name || t('author_system') }}
                        <template v-if="o.author_email">
                          <AuthorEmailLink :email="o.author_email" :name="o.author_name" />
                        </template>
                      </span>
                      <a :href="`/issues/${issueId}/comment/${o.id}`" class="text-xs text-muted hover:underline"> 🔗 {{ t('card_permalink') }} </a>
                      <button v-if="authState === 'signed-in' && !o.abuse_flagged" type="button" class="ml-auto text-xs text-muted hover:text-red" @click="openReport('opinion', o.id)">
                        {{ t('report_btn') }}
                      </button>
                    </p>
                    <button
                      v-if="isLongOpinion(o.summary) && !expandedOpinions.has(o.id)"
                      type="button"
                      class="markdown-content mobile-readable w-full cursor-pointer text-left text-muted hover:text-teal"
                      aria-expanded="false"
                      @click="toggleOpinion(o.id)"
                    >
                      {{ opinionPreview(o.summary) }}
                    </button>
                    <div
                      v-else-if="isLongOpinion(o.summary)"
                      class="markdown-content mobile-readable cursor-pointer"
                      v-html="renderedOpinions.get(o.id) ?? ''"
                      aria-expanded="true"
                      role="button"
                      tabindex="0"
                      @click="toggleOpinion(o.id)"
                      @keydown.enter.prevent="toggleOpinion(o.id)"
                    />
                    <div v-else class="markdown-content mobile-readable" v-html="renderedOpinions.get(o.id) ?? ''" />
                    <OpinionVote
                      v-if="!isLongOpinion(o.summary) || expandedOpinions.has(o.id)"
                      :opinion="o"
                      :expanded="(o.abuse_flagged !== 1 || expandedFlagged.has(`opinion-${o.id}`)) && (expandedOpinions.has(o.id) || !isLongOpinion(o.summary))"
                      :callback-url="writeIssueOpinionAnchor(loginCallbackUrl, o.id)"
                      @update="updateOpinionVote(o.id, $event)"
                      @sign-in-required="rememberOpinionPosition(o.id)"
                    />
                  </template>
                </div>
              </template>
              <button type="button" class="btn btn-ghost" @click="setIssueCommentAction('start')">{{ t('op_back_to_start') }}</button>
            </template>
          </section>
        </template>
      </div>
    </main>

    <AppFooter :compact="!activeStep" />
    <Toast ref="toast" />

    <!-- 回報濫用 Modal -->
    <div v-if="reportTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="reportTarget = null">
      <div class="card w-full max-w-md">
        <h2 class="mt-0 mb-4 font-serif text-lg">{{ t('report_modal_title') }}</h2>
        <div class="form-group">
          <label>{{ t('report_reason_label') }}</label>
          <select v-model="reportReason">
            <option value="spam">{{ t('report_reason_spam') }}</option>
            <option value="hate_speech">{{ t('report_reason_hate_speech') }}</option>
            <option value="defamation">{{ t('report_reason_defamation') }}</option>
            <option value="misinformation">{{ t('report_reason_misinformation') }}</option>
            <option value="other">{{ t('report_reason_other') }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>{{ t('report_desc_label') }}</label>
          <textarea v-model="reportDesc" rows="3" :placeholder="t('report_desc_ph')" />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-primary" @click="submitReport">{{ t('report_submit_btn') }}</button>
          <button type="button" class="btn btn-secondary" @click="reportTarget = null">{{ t('report_cancel_btn') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
