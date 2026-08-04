<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n, useLocaleLabel, type Locale } from '../l10n'
import { useAuth } from '../composables/useAuth'
import SignInButtons from './SignInButtons.vue'

const props = withDefaults(
  defineProps<{
    current?: 'home' | 'about' | 'admin' | 'issue' | 'contribute'
    showNewIssue?: boolean
    backHref?: string
    backLabel?: string
  }>(),
  {
    current: 'home',
    showNewIssue: false,
  },
)

const emit = defineEmits<{
  'new-issue': []
}>()

const { t, toggleLocale, setLocale, locale } = useI18n()
const langLabel = useLocaleLabel()
const ready = ref(false)

const { authState, session, ensureAuthSession, signOutAndReload } = useAuth()
const showLoginPanel = ref(false)

const displayName = computed(
  () => session.value?.user.name || session.value?.user.email || '',
)
/** 登入後導回當前頁面。SSR 期間不會用到（未登入的 UI 只在瀏覽器端出現），仍加守衛 */
const loginCallbackUrl = computed(() =>
  typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search,
)

onMounted(() => {
  // hydration 後才讀 localStorage，避免 SSR mismatch
  const stored =
    typeof window !== 'undefined'
      ? (() => {
          try {
            return window.localStorage.getItem('civic_lang')
          } catch {
            return null
          }
        })()
      : null
  if (stored === 'en' || stored === 'zh' || stored === 'zh-TW') {
    const next: Locale = stored === 'en' ? 'en' : 'zh-TW'
    if (next !== locale.value) setLocale(next)
  }
  ready.value = true
  // 登入狀態同樣是 hydration 後才知道；useAuth 會跟頁面上的表單共用同一次 /api/me
  void ensureAuthSession()
})

const backText = computed(() => props.backLabel ?? t('back_to_issues'))
</script>

<template>
  <header class="sticky top-0 z-[100] px-4 pt-3 bg-transparent">
    <div
      class="mx-auto flex h-16 max-w-[980px] items-center justify-between rounded-xl border border-white/75 bg-white/88 px-4 pl-6 shadow-md backdrop-blur-[20px]"
    >
      <a href="/" class="flex shrink-0 items-center no-underline" aria-label="vTaiwan Civic Talk">
        <img src="/vtaiwan-logo.svg" alt="vTaiwan" class="h-7 w-auto" />
      </a>
      <nav class="flex items-center gap-0.5">
        <a
          v-if="backHref"
          :href="backHref"
          class="rounded-pill px-3 py-1.5 text-[13px] text-[#2a2a30] no-underline hover:bg-black/5"
        >
          {{ backText }}
        </a>
        <a
          v-else
          href="/"
          class="rounded-pill px-3 py-1.5 text-[13px] text-[#2a2a30] no-underline hover:bg-black/5"
          :class="{ 'font-semibold text-red': current === 'home' }"
        >
          {{ t('nav_issues') }}
        </a>
        <a
          href="/about"
          class="rounded-pill px-3 py-1.5 text-[13px] text-[#2a2a30] no-underline hover:bg-black/5"
          :class="{ 'font-semibold text-red': current === 'about' }"
        >
          {{ t('nav_about') }}
        </a>
        <span class="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
        <button type="button" class="btn btn-ghost btn-sm" @click="toggleLocale">
          {{ ready ? langLabel : 'EN' }}
        </button>
        <button
          v-if="showNewIssue"
          type="button"
          class="btn btn-primary btn-sm"
          @click="emit('new-issue')"
        >
          {{ t('idx_new_issue_btn') }}
        </button>

        <!--
          登入狀態：SSR 與 hydration 首幀（authState === 'loading'）什麼都不畫，
          伺服器端不猜登入狀態，所以不會有 mismatch。
        -->
        <template v-if="authState === 'signed-in'">
          <span class="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
          <!--
            窄螢幕也要看得到是誰（需求就是「顯示登入為某某人」），所以不用 hidden sm:inline，
            改成一律顯示但收緊寬度＋truncate；完整 email 放 title。
          -->
          <span
            class="max-w-[5rem] truncate text-[13px] text-muted sm:max-w-[12rem]"
            :title="session?.user.email ?? ''"
          >
            {{ t('signed_in_as', { name: displayName }) }}
          </span>
          <button type="button" class="btn btn-ghost btn-sm" @click="signOutAndReload">
            {{ t('logout') }}
          </button>
        </template>
        <template v-else-if="authState === 'anonymous'">
          <span class="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :aria-expanded="showLoginPanel"
            @click="showLoginPanel = !showLoginPanel"
          >
            {{ t('login') }}
          </button>
        </template>
      </nav>
    </div>

    <!-- 未登入時按「登入」展開的小面板；登入完導回目前這一頁 -->
    <div
      v-if="authState === 'anonymous' && showLoginPanel"
      class="mx-auto mt-2 max-w-[980px] rounded-xl border border-white/75 bg-white/95 p-4 shadow-md backdrop-blur-[20px]"
    >
      <p class="mt-0 mb-3 text-sm text-muted">{{ t('login_panel_desc') }}</p>
      <SignInButtons :callback-url="loginCallbackUrl" />
    </div>
  </header>
</template>
