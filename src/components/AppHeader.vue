<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n, useLocaleLabel, type Locale } from '../l10n'
import { isAdminSession } from '../client/auth-session'
import { useAuth } from '../composables/useAuth'
import { useDarkMode } from '../composables/useDarkMode'
import SignInButtons from './SignInButtons.vue'
const darkMode = useDarkMode()

const props = withDefaults(
  defineProps<{
    current?: 'home' | 'about' | 'admin' | 'issue' | 'contribute' | 'profile' | 'appeals' | 'other'
    showNewIssue?: boolean
    backHref?: string
    backLabel?: string
  }>(),
  {
    current: 'home',
    showNewIssue: false,
  }
)

const emit = defineEmits<{
  'new-issue': []
}>()

const { t, toggleLocale, setLocale, locale } = useI18n()
const langLabel = useLocaleLabel()
const ready = ref(false)

const { authState, session, ensureAuthSession, signOutAndReload } = useAuth()
/** 桌面版：按「登入」展開的 provider 小面板 */
const showLoginPanel = ref(false)
/** 手機版漢堡選單 */
const showMenu = ref(false)

const displayName = computed(() => session.value?.user.name || session.value?.user.email || '')
const hasAdminAccess = computed(() => isAdminSession(session.value))
/** 登入後導回當前頁面。SSR 期間不會用到（未登入的 UI 只在瀏覽器端出現），仍加守衛 */
const loginCallbackUrl = computed(() => (typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search))

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
  darkMode.init()
  // 登入狀態同樣是 hydration 後才知道；useAuth 會跟頁面上的表單共用同一次 /api/me
  void ensureAuthSession()
})

const backText = computed(() => props.backLabel ?? t('back_to_issues'))

/** avatar fallback：取名字或 email 的第一個字元。image 由 session 直接拿。 */
const avatarInitial = computed(() => {
  const name = session.value?.user.name || session.value?.user.email || '?'
  return name.charAt(0).toUpperCase()
})
const avatarImage = computed(() => session.value?.user.image ?? null)

function closeMenu() {
  showMenu.value = false
}
function handleNewIssue() {
  emit('new-issue')
  closeMenu()
}
</script>

<template>
  <header class="sticky top-0 z-[100] px-4 pt-3 bg-transparent">
    <!-- ── 主列：logo ＋ 桌面 nav ＋ 手機漢堡按鈕 ── -->
    <div class="mx-auto flex h-16 max-w-[980px] items-center justify-between rounded-xl border border-vt-border/75 bg-vt-bg-1/88 px-4 pl-6 shadow-md backdrop-blur-[20px]">
      <!-- Logo -->
      <a href="/" class="flex shrink-0 items-center no-underline" aria-label="vTaiwan Civic Talk">
        <img src="/vtaiwan-logo.svg" alt="vTaiwan" class="h-7 w-auto dark:hidden" />
        <img src="/vtaiwan-logo-dark.svg" alt="vTaiwan" class="hidden h-7 w-auto dark:block" />
      </a>

      <!-- ── 桌面 nav（md 以上才顯示）── -->
      <nav class="hidden items-center gap-0.5 md:flex">
        <a v-if="backHref" :href="backHref" class="rounded-pill px-3 py-1.5 text-[15px] text-vt-fg-2 no-underline hover:bg-black/5 dark:hover:bg-white/10">
          {{ backText }}
        </a>
        <a
          v-else
          href="/"
          class="rounded-pill px-3 py-1.5 text-[15px] text-vt-fg-2 no-underline hover:bg-black/5 dark:hover:bg-white/10"
          :class="{ 'font-semibold text-vt-democratic-red': current === 'home' }"
        >
          {{ t('nav_issues') }}
        </a>
        <a
          href="/about"
          class="rounded-pill px-3 py-1.5 text-[15px] text-vt-fg-2 no-underline hover:bg-black/5 dark:hover:bg-white/10"
          :class="{ 'font-semibold text-vt-democratic-red': current === 'about' }"
        >
          {{ t('nav_about') }}
        </a>
        <a
          href="/appeals"
          class="rounded-pill px-3 py-1.5 text-[15px] text-vt-fg-2 no-underline hover:bg-black/5 dark:hover:bg-white/10"
          :class="{ 'font-semibold text-vt-democratic-red': current === 'appeals' }"
        >
          {{ t('nav_appeals') }}
        </a>
        <a
          v-if="hasAdminAccess"
          href="/admin"
          class="rounded-pill px-3 py-1.5 text-[15px] text-vt-fg-2 no-underline hover:bg-black/5 dark:hover:bg-white/10"
          :class="{ 'font-semibold text-vt-democratic-red': current === 'admin' }"
        >
          {{ t('nav_admin') }}
        </a>
        <span class="mx-1 h-4 w-px bg-vt-border" aria-hidden="true" />
        <button type="button" class="btn btn-ghost btn-sm" @click="toggleLocale">
          {{ ready ? langLabel : 'EN' }}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" :aria-label="t('dark_mode_toggle')" @click="darkMode.toggle()">
          <!-- 月亮（亮色模式時顯示） -->
          <svg
            v-if="!darkMode.isDark.value"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <!-- 太陽（暗色模式時顯示） -->
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        </button>
        <button v-if="showNewIssue" type="button" class="btn btn-primary btn-sm" @click="emit('new-issue')">
          {{ t('idx_new_issue_btn') }}
        </button>

        <!--
          登入狀態：SSR 與 hydration 首幀（authState === 'loading'）什麼都不畫，
          伺服器端不猜登入狀態，所以不會有 mismatch。
        -->
        <template v-if="authState === 'signed-in'">
          <span class="mx-1 h-4 w-px bg-vt-border" aria-hidden="true" />
          <a href="/profile" class="flex min-w-0 items-center gap-2 rounded-pill no-underline hover:bg-black/5 dark:hover:bg-white/10" :title="t('profile_title')">
            <div class="avatar" aria-hidden="true">
              <img v-if="avatarImage" :src="avatarImage" :alt="displayName" referrerpolicy="no-referrer" />
              <span v-else>{{ avatarInitial }}</span>
            </div>
            <span class="max-w-[10rem] truncate text-[14px] text-vt-fg-2">{{ displayName }}</span>
          </a>
          <button type="button" class="btn btn-ghost btn-sm" @click="signOutAndReload">
            {{ t('logout') }}
          </button>
        </template>
        <template v-else-if="authState === 'anonymous'">
          <span class="mx-1 h-4 w-px bg-vt-border" aria-hidden="true" />
          <button type="button" class="btn btn-ghost btn-sm" :aria-expanded="showLoginPanel" @click="showLoginPanel = !showLoginPanel">
            {{ t('login') }}
          </button>
        </template>
      </nav>

      <!-- ── 手機右側：avatar（已登入時）＋ 漢堡按鈕 ── -->
      <div class="flex items-center gap-2 md:hidden">
        <!-- 已登入時在 bar 右側露出小 avatar，讓使用者知道自己有登入 -->
        <a v-if="authState === 'signed-in'" href="/profile" class="rounded-full" :title="t('profile_title')">
          <div class="avatar" aria-hidden="true">
            <img v-if="avatarImage" :src="avatarImage" :alt="displayName" referrerpolicy="no-referrer" />
            <span v-else>{{ avatarInitial }}</span>
          </div>
        </a>

        <!-- 漢堡按鈕 -->
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
          :aria-expanded="showMenu"
          aria-label="選單"
          @click="showMenu = !showMenu"
        >
          <!-- 關閉（X）圖示 -->
          <svg
            v-if="showMenu"
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <!-- 漢堡圖示 -->
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <!-- ── 手機下拉選單 ── -->
    <div v-if="showMenu" class="mx-auto mt-2 max-w-[980px] rounded-xl border border-vt-border/75 bg-vt-bg-1/95 px-5 py-4 shadow-md backdrop-blur-[20px] md:hidden">
      <!-- 導航連結 -->
      <nav class="mb-4 flex flex-col gap-1">
        <a v-if="backHref" :href="backHref" class="rounded-lg px-3 py-2.5 text-[15px] text-vt-fg-1 no-underline hover:bg-black/5 dark:hover:bg-white/10" @click="closeMenu"> ← {{ backText }} </a>
        <template v-else>
          <a
            href="/"
            class="rounded-lg px-3 py-2.5 text-[15px] no-underline hover:bg-black/5 dark:hover:bg-white/10"
            :class="current === 'home' ? 'font-semibold text-vt-democratic-red' : 'text-vt-fg-1'"
            @click="closeMenu"
          >
            {{ t('nav_issues') }}
          </a>
        </template>
        <a
          href="/about"
          class="rounded-lg px-3 py-2.5 text-[15px] no-underline hover:bg-black/5 dark:hover:bg-white/10"
          :class="current === 'about' ? 'font-semibold text-vt-democratic-red' : 'text-vt-fg-1'"
          @click="closeMenu"
        >
          {{ t('nav_about') }}
        </a>
        <a
          href="/appeals"
          class="rounded-lg px-3 py-2.5 text-[15px] no-underline hover:bg-black/5 dark:hover:bg-white/10"
          :class="current === 'appeals' ? 'font-semibold text-vt-democratic-red' : 'text-vt-fg-1'"
          @click="closeMenu"
        >
          {{ t('nav_appeals') }}
        </a>
        <a
          v-if="hasAdminAccess"
          href="/admin"
          class="rounded-lg px-3 py-2.5 text-[15px] no-underline hover:bg-black/5 dark:hover:bg-white/10"
          :class="current === 'admin' ? 'font-semibold text-vt-democratic-red' : 'text-vt-fg-1'"
          @click="closeMenu"
        >
          {{ t('nav_admin') }}
        </a>
      </nav>

      <div class="mb-4 h-px bg-border" />

      <!-- 工具列：語言切換 ＋ 建立議題（若適用） -->
      <div class="mb-4 flex flex-wrap gap-2">
        <button type="button" class="btn btn-secondary btn-sm" @click="toggleLocale">
          {{ ready ? langLabel : 'EN' }}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" :aria-label="t('dark_mode_toggle')" @click="darkMode.toggle()">
          <svg
            v-if="!darkMode.isDark.value"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        </button>
        <button v-if="showNewIssue" type="button" class="btn btn-primary btn-sm" @click="handleNewIssue">
          {{ t('idx_new_issue_btn') }}
        </button>
      </div>

      <div class="mb-4 h-px bg-border" />

      <!-- 登入狀態：SSR 與 hydration 首幀不畫（authState === 'loading'），避免 mismatch -->
      <template v-if="authState === 'signed-in'">
        <a href="/profile" class="mb-3 flex items-center gap-3 rounded-lg p-1 text-inherit no-underline hover:bg-black/5 dark:hover:bg-white/10" :title="t('profile_title')">
          <div class="avatar avatar-lg shrink-0" aria-hidden="true">
            <img v-if="avatarImage" :src="avatarImage" :alt="displayName" referrerpolicy="no-referrer" />
            <span v-else>{{ avatarInitial }}</span>
          </div>
          <div class="min-w-0">
            <div class="truncate text-[14px] font-medium text-vt-fg-1">{{ displayName }}</div>
            <div class="truncate text-[13px] text-vt-fg-3">{{ session?.user.email }}</div>
          </div>
        </a>
        <button type="button" class="btn btn-secondary btn-sm" @click="signOutAndReload">
          {{ t('logout') }}
        </button>
      </template>
      <template v-else-if="authState === 'anonymous'">
        <p class="mt-0 mb-3 text-sm text-muted">{{ t('login_panel_desc') }}</p>
        <SignInButtons :callback-url="loginCallbackUrl" />
      </template>
    </div>

    <!-- ── 桌面版登入面板（僅 md 以上顯示，未登入且按了「登入」才出現）── -->
    <div v-if="authState === 'anonymous' && showLoginPanel" class="mx-auto mt-2 hidden max-w-[980px] rounded-xl border border-vt-border/75 bg-vt-bg-1/95 p-4 shadow-md backdrop-blur-[20px] md:block">
      <p class="mt-0 mb-3 text-sm text-muted">{{ t('login_panel_desc') }}</p>
      <SignInButtons :callback-url="loginCallbackUrl" />
    </div>
  </header>
</template>
