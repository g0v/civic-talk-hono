<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../l10n'

const props = defineProps<{
  appealType: 'rejected_submission' | 'automatic_ban'
  reportId?: number
  policyCode?: string
  rationale?: string
}>()

const { t } = useI18n()
const message = ref('')
const submitting = ref(false)
const submitted = ref(false)
const errorMessage = ref('')

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
      errorMessage.value = data.error || t('moderation_appeal_failed')
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
      {{ appealType === 'rejected_submission' ? t('moderation_rejected_title') : t('moderation_frozen_title') }}
    </h3>
    <p class="mb-2">{{ appealType === 'rejected_submission' ? t('moderation_rejected_body') : t('moderation_frozen_body') }}</p>
    <p v-if="policyCode" class="mb-1 text-sm"><strong>{{ t('moderation_policy_label') }}</strong>{{ policyCode }}</p>
    <p v-if="rationale" class="mb-3 whitespace-pre-wrap text-sm"><strong>{{ t('moderation_rationale_label') }}</strong>{{ rationale }}</p>
    <div v-if="submitted" class="font-semibold text-teal">{{ t('moderation_appeal_submitted') }}</div>
    <template v-else>
      <label class="block text-sm font-semibold" for="moderation-appeal-message">{{ t('moderation_appeal_message_label') }}</label>
      <textarea id="moderation-appeal-message" v-model="message" class="mt-1 w-full" rows="4" :placeholder="t('moderation_appeal_message_placeholder')" />
      <p v-if="errorMessage" class="mt-2 text-sm text-red">{{ errorMessage }}</p>
      <button type="button" class="btn btn-secondary mt-3" :disabled="submitting" @click="submitAppeal">
        {{ t('moderation_appeal_submit') }}
      </button>
    </template>
  </div>
</template>
