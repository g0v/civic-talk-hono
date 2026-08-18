<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../l10n'
import type { MessageKey } from '../l10n/zh-TW'

const props = defineProps<{
  appealType: 'rejected_submission' | 'account_ban'
  reportId?: number
  policyCode?: string
  rationale?: string
}>()

const POLICY_LABELS: Record<string, MessageKey> = {
  spam: 'moderation_policy_spam',
  sexual_content: 'moderation_policy_sexual_content',
  hate_speech: 'moderation_policy_hate_speech',
  defamation: 'moderation_policy_defamation',
  misinformation: 'moderation_policy_misinformation',
  illegal: 'moderation_policy_illegal',
}
const APPEAL_ERROR_KEYS: Record<string, MessageKey> = {
  Unauthorized: 'login_expired_toast',
  'An appeal is already pending': 'moderation_appeal_already_pending',
  'Moderation report not found': 'moderation_appeal_report_not_found',
  'Moderation report already resolved': 'moderation_appeal_report_resolved',
  'No active account ban to appeal': 'moderation_appeal_no_active_ban',
}

const { t } = useI18n()
const message = ref('')
const submitting = ref(false)
const submitted = ref(false)
const errorMessage = ref('')
const messageId = computed(() => `moderation-appeal-message-${props.appealType}-${props.reportId ?? 'account'}`)
const policyLabel = computed(() => {
  const code = props.policyCode
  if (!code) return ''
  const key = POLICY_LABELS[code]
  return key ? t(key) : code
})

function translateAppealError(error: unknown): string {
  if (typeof error !== 'string') return t('moderation_appeal_failed')
  const key = APPEAL_ERROR_KEYS[error]
  return key ? t(key) : t('moderation_appeal_failed')
}

async function submitAppeal() {
  if (!message.value.trim()) {
    errorMessage.value = t('moderation_appeal_required')
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const res = await fetch('/api/appeals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        abuse_report_id: props.reportId,
        appeal_type: props.appealType,
        message: message.value.trim(),
      }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      errorMessage.value = translateAppealError(data.error)
      return
    }
    submitted.value = true
  } catch {
    errorMessage.value = t('moderation_appeal_failed')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="alert alert-warn mt-4">
    <h3 class="mt-0 mb-2 font-semibold">
      {{ appealType === 'rejected_submission' ? t('moderation_hidden_title') : t('moderation_account_ban_title') }}
    </h3>
    <p class="mb-2">{{ appealType === 'rejected_submission' ? t('moderation_hidden_body') : t('moderation_account_ban_body') }}</p>
    <p v-if="policyCode" class="mb-1 text-sm"><strong>{{ t('moderation_policy_label') }}</strong>{{ policyLabel }}</p>
    <p v-if="rationale" class="mb-3 whitespace-pre-wrap text-sm"><strong>{{ t('moderation_rationale_label') }}</strong>{{ rationale }}</p>
    <div v-if="submitted" class="font-semibold text-teal">{{ t('moderation_appeal_submitted') }}</div>
    <template v-else>
      <label class="block text-sm font-semibold" :for="messageId">{{ t('moderation_appeal_message_label') }}</label>
      <textarea :id="messageId" v-model="message" class="mt-1 w-full" rows="4" :placeholder="t('moderation_appeal_message_placeholder')" />
      <p v-if="errorMessage" class="mt-2 text-sm text-red">{{ errorMessage }}</p>
      <button type="button" class="btn btn-secondary mt-3" :disabled="submitting" @click="submitAppeal">
        {{ t('moderation_appeal_submit') }}
      </button>
    </template>
  </div>
</template>
