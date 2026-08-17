<script setup lang="ts">
import { computed } from 'vue'
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

const { t } = useI18n()
const appealHref = computed(() => (props.reportId ? `/appeals?report=${props.reportId}` : '/appeals'))
const policyLabel = computed(() => {
  if (!props.policyCode) return ''
  const key = POLICY_LABELS[props.policyCode]
  return key ? t(key) : props.policyCode
})
</script>

<template>
  <aside class="alert alert-warn mb-5" role="status">
    <h3 class="mt-0 mb-2 font-semibold">
      {{ appealType === 'rejected_submission' ? t('moderation_hidden_title') : t('moderation_account_ban_title') }}
    </h3>
    <p class="mb-2">
      {{ appealType === 'rejected_submission' ? t('moderation_hidden_notice_body') : t('moderation_account_ban_notice_body') }}
    </p>
    <p v-if="policyCode" class="mb-1 text-sm"><strong>{{ t('moderation_policy_label') }}</strong>{{ policyLabel }}</p>
    <p v-if="rationale" class="mb-3 whitespace-pre-wrap text-sm"><strong>{{ t('moderation_rationale_label') }}</strong>{{ rationale }}</p>
    <a :href="appealHref" class="btn btn-secondary mt-2">{{ t('moderation_appeal_link') }}</a>
  </aside>
</template>
