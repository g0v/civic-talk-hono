<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import IssueCard from '../components/IssueCard.vue'
import Toast from '../components/Toast.vue'
import { useI18n } from '../l10n'
import type { IssueListItem } from '../db/queries'

const props = defineProps<{
  initialIssues?: IssueListItem[]
}>()

const { t } = useI18n()
const issues = ref<IssueListItem[]>(props.initialIssues ?? [])
const loading = ref(!props.initialIssues)
const showForm = ref(false)
const title = ref('')
const description = ref('')
const submitting = ref(false)
const toast = ref<{ show: (msg: string) => void } | null>(null)

async function loadIssues() {
  loading.value = true
  try {
    const res = await fetch('/api/issues')
    if (res.ok) issues.value = await res.json()
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!props.initialIssues) void loadIssues()
})

async function createIssue() {
  if (!title.value.trim()) {
    toast.value?.show(t('idx_toast_title_required'))
    return
  }
  submitting.value = true
  try {
    const res = await fetch('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.value.trim(), description: description.value }),
    })
    if (!res.ok) {
      toast.value?.show(t('idx_toast_create_fail'))
      return
    }
    const data = (await res.json()) as { id: number }
    toast.value?.show(t('idx_toast_create_ok'))
    showForm.value = false
    title.value = ''
    description.value = ''
    setTimeout(() => {
      window.location.href = `/issues/${data.id}`
    }, 800)
  } catch {
    toast.value?.show(t('idx_toast_create_fail'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <AppHeader current="home" show-new-issue @new-issue="showForm = true" />

    <div class="vt-hero">
      <div class="vt-hero-inner">
        <div class="hero-tag">{{ t('site_tagline') }}</div>
        <h1 class="hero-title">{{ t('idx_page_title') }}</h1>
        <p class="hero-desc">{{ t('idx_page_subtitle') }}</p>
        <div class="hero-btns">
          <a href="/about" class="btn btn-outline-white">{{ t('nav_about') }}</a>
        </div>
      </div>
    </div>

    <main class="pt-9 pb-8">
      <div class="container">
        <div v-if="showForm" class="card mb-6">
          <h2 class="mb-4 mt-0 font-bold">{{ t('idx_form_title') }}</h2>
          <div class="form-group">
            <label>
              <span>{{ t('idx_label_title') }}</span>
              <span class="label-hint">{{ t('idx_hint_title') }}</span>
            </label>
            <input v-model="title" type="text" :placeholder="t('idx_ph_title')" />
          </div>
          <div class="form-group">
            <label>
              <span>{{ t('idx_label_desc') }}</span>
              <span class="label-hint">{{ t('idx_hint_desc') }}</span>
            </label>
            <textarea
              v-model="description"
              rows="3"
              :placeholder="t('idx_ph_desc')"
            />
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn btn-primary" :disabled="submitting" @click="createIssue">
              {{ t('idx_submit') }}
            </button>
            <button type="button" class="btn btn-secondary" @click="showForm = false">
              {{ t('cancel') }}
            </button>
          </div>
        </div>

        <div class="mb-4">
          <div class="section-label">ISSUES</div>
        </div>

        <div v-if="loading" class="empty">
          <div class="empty-icon">⏳</div>
          {{ t('loading') }}
        </div>
        <div v-else-if="!issues.length" class="empty">
          <div class="empty-icon">🌱</div>
          {{ t('idx_empty') }}
        </div>
        <div v-else>
          <IssueCard v-for="issue in issues" :key="issue.id" :issue="issue" />
        </div>
      </div>
    </main>

    <AppFooter />
    <Toast ref="toast" />
  </div>
</template>
