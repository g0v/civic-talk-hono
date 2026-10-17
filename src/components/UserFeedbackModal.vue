<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from '../l10n'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const dialog = ref<HTMLDialogElement | null>(null)
const category = ref('')
const description = ref('')
const pagePath = ref('')
const submitting = ref(false)
const submitted = ref(false)
const failed = ref(false)
const invalid = ref(false)
const descriptionLength = computed(() => Array.from(description.value.trim()).length)

watch(
  () => props.open,
  open => {
    if (!dialog.value) return
    if (open) {
      pagePath.value = window.location.pathname + window.location.search
      failed.value = false
      invalid.value = false
      submitted.value = false
      dialog.value.showModal()
    } else {
      dialog.value.close()
    }
  }
)

function close() {
  if (!submitting.value) emit('close')
}

function closeOnBackdropClick(event: MouseEvent) {
  const element = dialog.value
  if (!element || event.target !== element) return
  // 原生 dialog 的霧面點擊也以 dialog 為 target，須排除框內留白。
  const bounds = element.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
}

async function submit() {
  if (submitting.value) return
  invalid.value = !category.value || descriptionLength.value === 0 || descriptionLength.value > 10_000
  if (invalid.value) return
  submitting.value = true
  failed.value = false
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 不傳送 session cookie，回報 API 也不讀取登入身分。
      credentials: 'omit',
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ category: category.value, description: description.value.trim(), page_path: pagePath.value }),
    })
    if (!response.ok) throw new Error('Feedback submission failed')
    submitted.value = true
    category.value = ''
    description.value = ''
  } catch {
    failed.value = true
  } finally {
    submitting.value = false
    if (submitted.value) {
      await nextTick()
      dialog.value?.querySelector('button')?.focus()
    }
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="feedback-modal modal m-auto max-w-[calc(100%-2rem)] border border-vt-border text-vt-fg-1 backdrop:bg-black/50"
    aria-labelledby="feedback-title"
    aria-describedby="feedback-privacy"
    @cancel.prevent="close"
    @close="emit('close')"
    @click="closeOnBackdropClick"
  >
    <div class="mb-4 flex items-start justify-between gap-4">
      <h2 id="feedback-title" class="m-0 font-vt-serif text-xl">{{ t('feedback_title') }}</h2>
      <button type="button" class="btn btn-ghost btn-sm shrink-0" :disabled="submitting" :aria-label="t('feedback_close')" @click="close">✕</button>
    </div>
    <p id="feedback-privacy" class="mb-4 text-sm text-vt-fg-2">{{ t('feedback_privacy') }}</p>
    <p v-if="submitted" role="status" class="alert alert-info mb-4">{{ t('feedback_success') }}</p>
    <form v-else :aria-busy="submitting" @submit.prevent="submit">
      <fieldset :disabled="submitting" class="m-0 min-w-0 border-0 p-0">
        <div class="form-group">
          <label for="feedback-category">{{ t('feedback_category') }}</label>
          <select id="feedback-category" v-model="category" required autofocus>
            <option disabled value="">{{ t('feedback_category_placeholder') }}</option>
            <option value="bug">{{ t('feedback_category_bug') }}</option>
            <option value="usability">{{ t('feedback_category_usability') }}</option>
            <option value="suggestion">{{ t('feedback_category_suggestion') }}</option>
          </select>
        </div>
        <div class="feedback-description-group form-group">
          <label for="feedback-description">{{ t('feedback_description') }}</label>
          <textarea id="feedback-description" v-model="description" class="feedback-description-input" required :placeholder="t('feedback_description_hint')" aria-describedby="feedback-limit" />
          <p id="feedback-limit" class="mt-2 text-sm text-vt-fg-2">{{ t('feedback_limit') }}</p>
        </div>
        <p class="mb-4 break-all text-sm text-vt-fg-2">{{ t('feedback_page') }}: {{ pagePath }}</p>
        <p v-if="invalid" role="alert" class="alert alert-warn mb-4">{{ t('feedback_invalid') }}</p>
        <p v-if="failed" role="alert" class="alert alert-warn mb-4">{{ t('feedback_submit_error') }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="btn btn-secondary" @click="close">{{ t('cancel') }}</button>
          <button type="submit" class="btn btn-primary">{{ submitting ? t('submitting_pending') : t('feedback_submit') }}</button>
        </div>
      </fieldset>
    </form>
    <button v-if="submitted" type="button" class="btn btn-secondary" @click="close">{{ t('feedback_close') }}</button>
    <a href="https://github.com/g0v/civic-talk-hono/issues" target="_blank" rel="noopener noreferrer" class="mt-4 block text-sm">{{ t('feedback_github') }} ↗</a>
  </dialog>
</template>
