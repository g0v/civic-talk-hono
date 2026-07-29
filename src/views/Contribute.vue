<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import Toast from '../components/Toast.vue'
import { useI18n } from '../l10n'

const props = defineProps<{
  issueId: number
  issueTitle?: string
}>()

const { t } = useI18n()
const title = ref(props.issueTitle ?? '')
const sourceName = ref('')
const sourceUrl = ref('')
const stance = ref('unknown')
const content = ref('')
const licenseOk = ref(false)
const submitting = ref(false)
const toast = ref<{ show: (msg: string) => void } | null>(null)

const charLabel = computed(() => `${content.value.length}${t('contrib_chars_suffix')}`)
const backHref = computed(() => `/issues/${props.issueId}`)

onMounted(async () => {
  if (title.value) return
  try {
    const res = await fetch(`/api/issues/${props.issueId}`)
    if (!res.ok) return
    const data = await res.json()
    title.value = data.issue?.title ?? ''
  } catch {
    /* ignore */
  }
})

async function submitMaterial() {
  const text = content.value.trim()
  if (!text) {
    toast.value?.show(t('contrib_toast_required'))
    return
  }
  if (text.length < 30) {
    toast.value?.show(t('contrib_toast_too_short'))
    return
  }
  if (!licenseOk.value) {
    toast.value?.show(t('contrib_toast_license'))
    return
  }
  submitting.value = true
  try {
    const res = await fetch(`/api/issues/${props.issueId}/materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_name: sourceName.value.trim(),
        source_url: sourceUrl.value.trim(),
        stance: stance.value,
        content: text,
      }),
    })
    if (!res.ok) {
      toast.value?.show(t('contrib_toast_fail'))
      return
    }
    toast.value?.show(t('contrib_toast_ok'))
    setTimeout(() => {
      window.location.href = `/issues/${props.issueId}`
    }, 1200)
  } catch {
    toast.value?.show(t('contrib_toast_fail'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <AppHeader current="contribute" :back-href="backHref" :back-label="t('contrib_back')" />

    <main class="py-9">
      <div class="container">
        <h1 class="page-title">{{ t('contrib_title') }}</h1>
        <p class="page-subtitle">
          {{ t('contrib_issue_prefix') }}{{ title || t('loading') }}
        </p>

        <div class="alert alert-info mb-7">
          <strong>{{ t('contrib_alert_strong') }}</strong>
          {{ t('contrib_alert') }}
        </div>

        <div class="card">
          <div class="form-group">
            <label>
              <span>{{ t('contrib_label_source') }}</span>
              <span class="label-hint">{{ t('contrib_hint_source') }}</span>
            </label>
            <input v-model="sourceName" type="text" :placeholder="t('contrib_ph_source')" />
          </div>
          <div class="form-group">
            <label>
              <span>{{ t('contrib_label_url') }}</span>
              <span class="label-hint">{{ t('contrib_hint_url') }}</span>
            </label>
            <input v-model="sourceUrl" type="url" :placeholder="t('contrib_ph_url')" />
          </div>
          <div class="form-group">
            <label>
              <span>{{ t('contrib_label_stance') }}</span>
              <span class="label-hint">{{ t('contrib_hint_stance') }}</span>
            </label>
            <select v-model="stance">
              <option value="unknown">{{ t('contrib_stance_unknown') }}</option>
              <option value="pro">{{ t('contrib_stance_pro') }}</option>
              <option value="con">{{ t('contrib_stance_con') }}</option>
              <option value="neutral">{{ t('contrib_stance_neutral') }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>
              <span>{{ t('contrib_label_content') }}</span>
              <span class="label-hint">{{ t('contrib_hint_content') }}</span>
            </label>
            <textarea v-model="content" rows="12" :placeholder="t('contrib_ph_content')" />
            <p class="mt-1 mb-0 text-sm text-muted">{{ charLabel }}</p>
          </div>
          <div class="form-group">
            <label class="flex items-start gap-2 font-normal">
              <input v-model="licenseOk" type="checkbox" class="mt-1 w-auto" />
              <span>{{ t('contrib_license') }}</span>
            </label>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="submitting"
              @click="submitMaterial"
            >
              {{ t('contrib_submit') }}
            </button>
            <a :href="backHref" class="btn btn-secondary">{{ t('cancel') }}</a>
          </div>
        </div>

        <div class="card mt-6 bg-gray-50">
          <h3 class="mt-0 mb-2 font-medium">{{ t('contrib_tips_title') }}</h3>
          <p class="m-0 whitespace-pre-line text-sm text-muted">{{ t('contrib_tips_body') }}</p>
        </div>
      </div>
    </main>

    <AppFooter />
    <Toast ref="toast" />
  </div>
</template>
