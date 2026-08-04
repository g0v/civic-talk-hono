<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import SignInButtons from '../components/SignInButtons.vue'
import Toast from '../components/Toast.vue'
import { useI18n } from '../l10n'
import { useAuth } from '../composables/useAuth'

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

/**
 * 登入狀態走全站共用的 useAuth（與 AppHeader 共用同一次 /api/me）。'loading' 是 SSR 與
 * hydration 首幀共用的狀態——伺服器端不猜登入狀態，兩邊先畫同一個骨架，避免 mismatch。
 */
const { authState, session, authFailed, ensureAuthSession } = useAuth()
/**
 * 「填表填到一半 session 過期」專用的旗標，**刻意不重用 authState**——
 * authState 切回 'anonymous' 會把表單整個換成登入卡片，使用者剛打完的素材就沒了。
 * 這裡改成表單留在原地，只在上方多出一列重新登入的提示。
 */
const sessionExpired = ref(false)

const charLabel = computed(() => `${content.value.length}${t('contrib_chars_suffix')}`)
const backHref = computed(() => `/issues/${props.issueId}`)
// 登入後導回這一頁，使用者可以接著把剛才想投的素材貼上
const loginCallbackUrl = computed(() => `/contribute/${props.issueId}`)

onMounted(() => {
  void loadTitle()
  void ensureAuthSession()
})

async function loadTitle() {
  if (title.value) return
  try {
    const res = await fetch(`/api/issues/${props.issueId}`)
    if (!res.ok) return
    const data = (await res.json()) as { issue?: { title?: string } }
    title.value = data.issue?.title ?? ''
  } catch {
    /* ignore */
  }
}


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
    // session 可能在填表期間過期——真正的守門在伺服器端，前端要能接住 401。
    // 注意：不要把 authState 切回 'anonymous'，那會連同表單一起消失、吃掉使用者打的內容。
    if (res.status === 401) {
      sessionExpired.value = true
      toast.value?.show(t('login_expired_toast'))
      return
    }
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

        <!-- 讀取 session 中：SSR 與 hydration 首幀共用這個骨架 -->
        <div v-if="authState === 'loading'" class="card">
          <p class="m-0 text-muted">{{ t('loading') }}</p>
        </div>

        <!-- 未登入：#9 起素材必須登入才能提交，表單一律不出現（守門在伺服器端） -->
        <div v-else-if="authState === 'anonymous'" class="card">
          <h2 class="mt-0 mb-2 font-serif text-xl">{{ t('contrib_login_title') }}</h2>
          <p class="mb-4 text-muted">{{ t('contrib_login_desc') }}</p>
          <SignInButtons :callback-url="loginCallbackUrl" />
          <p v-if="authFailed" class="mt-3 mb-0 text-sm text-red">{{ t('login_err') }}</p>
          <p class="mt-4 mb-0 text-sm text-muted">{{ t('contrib_login_hint') }}</p>
          <div class="mt-4">
            <a :href="backHref" class="btn btn-secondary">{{ t('contrib_back') }}</a>
          </div>
        </div>

        <div v-else class="card">
          <!-- 填表期間 session 過期：表單留著（內容不能丟），只在上面補一列重新登入 -->
          <div v-if="sessionExpired" class="alert alert-warn mb-5">
            <p class="mt-0 mb-3">{{ t('login_expired_hint') }}</p>
            <SignInButtons :callback-url="loginCallbackUrl" />
          </div>
          <!-- 登出鈕在 AppHeader，這裡只交代「你會以誰的身分投稿」 -->
          <p class="mb-5 border-b border-border pb-3 text-sm text-muted">
            {{ t('contrib_signed_in_as', { name: session?.user.name || session?.user.email || '' }) }}
          </p>
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
