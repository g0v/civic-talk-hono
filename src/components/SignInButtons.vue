<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../l10n'
import { signInWith } from '../client/auth-session'

/**
 * Google／GitHub 登入按鈕組——/admin 與 /contribute 共用。
 *
 * callbackUrl 是登入完成後導回的路徑（例：'/admin'、'/contribute/3'），
 * 由呼叫端決定，這個元件不猜。
 */
const props = defineProps<{ callbackUrl: string }>()

const { t } = useI18n()
const failed = ref(false)

async function login(provider: 'google' | 'github') {
  failed.value = false
  try {
    await signInWith(provider, props.callbackUrl)
  } catch {
    failed.value = true
  }
}
</script>

<template>
  <div>
    <!--
      兩顆都用 btn-secondary（白底）：品牌標誌有各自的使用規範，四色 Google G
      放在 btn-primary 的紅底上既不好看也不符合 Google 的品牌指引。兩個 provider
      本來也是平行選項，不該有主次之分。
      SVG 內嵌而非拉外部資源：Worker 不打外部請求，也不為兩個圖示加 icon 套件。
      下面的色碼是品牌資產的一部分（不是設計決策），所以刻意不走 vt-* token。
    -->
    <div class="flex flex-col gap-2">
      <button type="button" class="btn btn-secondary" @click="login('google')">
        <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"
          />
        </svg>
        {{ t('login_google') }}
      </button>
      <button type="button" class="btn btn-secondary" @click="login('github')">
        <svg class="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        {{ t('login_github') }}
      </button>
    </div>
    <p v-if="failed" class="mt-3 mb-0 text-sm text-red">{{ t('login_err') }}</p>
  </div>
</template>
