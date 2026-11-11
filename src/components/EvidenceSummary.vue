<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createEvidenceSummary, type SummaryPhase } from '../client/evidenceSummary'
import { useI18n } from '../l10n'
import type { MessageKey } from '../l10n/zh-TW'

const props = defineProps<{ issueId: number; active: boolean; canSummarize: boolean; banned: boolean; sessionExpired: boolean }>()
const emit = defineEmits<{ notify: [message: string]; sessionExpired: []; banned: [] }>()
const { t, locale } = useI18n()
const dialog = ref<HTMLDialogElement | null>(null)
const dialogTitle = ref<HTMLHeadingElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const consent = ref(false)
const replaceConsent = ref(false)
const blocked = ref(false)
let mounted = false

const phaseKeys: Partial<Record<SummaryPhase, MessageKey>> = {
  loading: 'vol_ai_loading',
  submitting: 'vol_ai_submitting',
  saved: 'vol_ai_saved',
  superseded: 'vol_ai_superseded',
  unsaved: 'vol_ai_unsaved',
  partial: 'vol_ai_partial',
  failed: 'vol_ai_failed',
  withdrawn: 'vol_ai_withdrawn',
  erased: 'vol_ai_erased',
  unknown: 'vol_ai_unknown',
}
const progressKeys: Record<string, MessageKey> = {
  queued: 'vol_ai_queued',
  extracting: 'vol_ai_extracting',
  comparing: 'vol_ai_comparing',
  generating: 'vol_ai_generating',
}
const errorKeys: Record<string, MessageKey> = {
  session_expired: 'login_expired_toast',
  banned: 'banned_toast',
  network_error: 'vol_ai_error_network',
  post_unknown: 'vol_ai_error_post_unknown',
  summary_conflict: 'vol_ai_error_conflict',
  input_conflict: 'vol_ai_error_conflict',
  insufficient_materials: 'vol_ai_error_materials',
  no_available_materials: 'vol_ai_error_materials',
  too_many_materials: 'vol_ai_error_limits',
  material_too_large: 'vol_ai_error_limits',
  input_too_large: 'vol_ai_error_limits',
  empty_material: 'vol_ai_error_limits',
  material_unavailable: 'vol_ai_error_limits',
  account_daily_quota: 'vol_ai_error_quota',
  issue_cooldown: 'vol_ai_error_quota',
  daily_budget_exhausted: 'vol_ai_error_budget',
  source_withdrawn: 'vol_ai_error_source',
  source_erased: 'vol_ai_error_source',
  source_unavailable: 'vol_ai_error_source',
  issue_unavailable: 'vol_ai_error_source',
}

function messageFor(phase: SummaryPhase, error: string | null, status: string | null): string {
  if (phase === 'error') return t(error && Object.hasOwn(errorKeys, error) ? errorKeys[error] : 'vol_ai_error_unavailable')
  if (phase === 'progress') return t(status && Object.hasOwn(progressKeys, status) ? progressKeys[status] : 'vol_ai_loading')
  const key = phaseKeys[phase]
  return key ? t(key) : ''
}

const controller = createEvidenceSummary(props.issueId, {
  onOutcome: (phase, error) => emit('notify', messageFor(phase, error, null)),
  onSessionExpired: () => emit('sessionExpired'),
  onBanned: () => {
    blocked.value = true
    emit('banned')
  },
  // 使用者要求暫時輸出；只在伺服器確認本工作已存為目前結果時執行。
  onSaved: data => console.log('一鍵彙整結果（私人、未經人工驗證）', data),
})
const state = controller.state
const message = computed(() => messageFor(state.phase, state.error, state.status))
const disabled = computed(() => !props.canSummarize || props.banned || blocked.value || props.sessionExpired || ['idle', 'loading', 'submitting', 'progress', 'error', 'unknown', 'unsaved'].includes(state.phase))
const costMessage = computed(() => {
  if (!state.jobId && state.error !== 'post_unknown') return ''
  if (!state.usage || state.usage.uncertain > 0) return t('vol_ai_cost_unknown')
  return t('vol_ai_cost_known', { actual: (state.usage.actualMicroUsd / 1_000_000).toFixed(6), reserved: (state.usage.reservedMicroUsd / 1_000_000).toFixed(6) })
})
const languageLabel = computed(() => t(locale.value === 'zh-TW' ? 'language_zh_tw' : locale.value === 'en' ? 'language_en' : 'language_ja'))

function closeDialog() {
  if (dialog.value?.open) dialog.value.close()
}

function syncScope() {
  closeDialog()
  void controller.setScope(props.active && !props.banned && !blocked.value && !props.sessionExpired ? locale.value : null)
}

onMounted(() => {
  mounted = true
  syncScope()
})
watch(() => [props.active, props.banned, props.sessionExpired, locale.value] as const, () => {
  if (mounted) syncScope()
})
onBeforeUnmount(() => {
  mounted = false
  closeDialog()
  controller.dispose()
})

async function openDialog() {
  if (disabled.value || !(await controller.prepare())) return
  if (!props.active || props.banned || blocked.value || props.sessionExpired || state.language !== locale.value) return
  consent.value = false
  replaceConsent.value = false
  await nextTick()
  if (!props.active || state.language !== locale.value || !dialog.value) return
  dialog.value.showModal()
  await nextTick()
  dialogTitle.value?.focus({ preventScroll: true })
  if (dialog.value) dialog.value.scrollTop = 0
}

function closeOnBackdropClick(event: MouseEvent) {
  const element = dialog.value
  if (!element || event.target !== element) return
  const bounds = element.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog()
}

function confirm() {
  if (!consent.value || (state.hasSummary && !replaceConsent.value) || state.language !== locale.value || !props.active || !props.canSummarize || props.banned || blocked.value || props.sessionExpired) return
  closeDialog()
  void controller.start()
}
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="btn btn-wheat-yellow btn-sm text-vt-black"
    data-testid="evidence-summary-start"
    :disabled="disabled"
    :aria-describedby="!canSummarize ? 'summary-material-minimum' : undefined"
    aria-haspopup="dialog"
    @click="openDialog"
  >
    {{ t('vol_ai_button') }}
  </button>
  <div v-if="message || banned || blocked || costMessage" class="basis-full" role="status" aria-live="polite" data-testid="evidence-summary-status">
    <div class="alert mb-0 text-sm" :class="['error', 'failed', 'partial', 'withdrawn', 'erased', 'unknown', 'unsaved', 'superseded'].includes(state.phase) || banned || blocked ? 'alert-warn' : 'alert-info'">
      <p v-if="banned || blocked" class="m-0">{{ t('banned_toast') }}</p>
      <p v-else-if="message" class="m-0">{{ message }}</p>
      <p v-if="costMessage" class="mt-2 mb-0">{{ costMessage }}</p>
      <button v-if="state.canResume && !banned && !blocked && !sessionExpired" type="button" class="btn btn-secondary btn-sm mt-3" data-testid="evidence-summary-resume" @click="controller.resume()">
        {{ t('vol_ai_resume') }}
      </button>
    </div>
  </div>
  <dialog
    ref="dialog"
    class="modal m-auto max-h-[90dvh] max-w-[calc(100%-2rem)] border border-vt-border p-4 text-left text-vt-fg-1 backdrop:bg-black/50 sm:p-5"
    aria-labelledby="evidence-summary-title"
    aria-describedby="evidence-summary-processing"
    data-testid="evidence-summary-dialog"
    @cancel.prevent="closeDialog"
    @close="trigger?.focus()"
    @click="closeOnBackdropClick"
  >
    <div class="mb-3 flex items-start justify-between gap-4">
      <h2 id="evidence-summary-title" ref="dialogTitle" tabindex="-1" class="m-0 font-vt-serif text-xl">{{ t('vol_ai_dialog_title') }}</h2>
      <button type="button" class="btn btn-ghost btn-sm shrink-0" :aria-label="t('cancel')" @click="closeDialog">✕</button>
    </div>
    <p id="evidence-summary-processing" class="mb-3 text-sm">{{ t('vol_ai_processing') }}</p>
    <p class="mb-3 text-sm">{{ t('vol_ai_private') }}</p>
    <p class="mb-3 text-sm">{{ t('vol_ai_cost_notice') }}</p>
    <p class="mb-3 text-sm">{{ t('vol_ai_retention') }}</p>
    <p class="mb-3 text-sm"><a href="/privacy" target="_blank" rel="noopener noreferrer" class="underline">{{ t('vol_ai_privacy_link') }} ↗</a></p>
    <p class="mb-3 text-sm font-medium">{{ t('vol_ai_language', { language: languageLabel }) }}</p>
    <p v-if="state.hasSummary" class="alert alert-warn mb-3 text-sm" data-testid="evidence-summary-replace-notice">{{ t('vol_ai_replace') }}</p>
    <form @submit.prevent="confirm">
      <label class="mb-3 flex items-start gap-2 text-sm font-normal">
        <input v-model="consent" type="checkbox" class="mt-1 w-auto" required data-testid="evidence-summary-consent" />
        <span>{{ t('vol_ai_consent') }}</span>
      </label>
      <label v-if="state.hasSummary" class="mb-3 flex items-start gap-2 text-sm font-normal">
        <input v-model="replaceConsent" type="checkbox" class="mt-1 w-auto" required data-testid="evidence-summary-replace" />
        <span>{{ t('vol_ai_replace_consent') }}</span>
      </label>
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="btn btn-secondary" @click="closeDialog">{{ t('cancel') }}</button>
        <button type="submit" class="btn btn-primary" data-testid="evidence-summary-confirm" :disabled="!consent || (state.hasSummary && !replaceConsent) || !canSummarize || banned || blocked || sessionExpired">{{ t('vol_ai_confirm') }}</button>
      </div>
    </form>
  </dialog>
</template>
