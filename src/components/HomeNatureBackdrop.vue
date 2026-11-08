<script setup lang="ts">
// 純裝飾背景放在父層的隔離堆疊內，不增加高度，也不覆蓋內容或接收操作。
// 日夜切換只用 dark utilities，SSR 不讀取瀏覽器的主題偏好。
// 首頁清單與預覽的背景延伸至一般 AppFooter 既有的 mt-16 留白，不另外撐高頁面。
defineProps<{
  placement: 'welcome' | 'issues'
}>()
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 top-0 -z-10 overflow-hidden select-none" :class="placement === 'issues' ? '-bottom-16' : 'bottom-0'" aria-hidden="true">
    <svg
      class="absolute h-auto"
      :class="placement === 'welcome' ? 'right-14 top-3 w-24 sm:right-20 sm:top-4 sm:w-36' : 'right-3 top-0 w-28 sm:right-8 sm:w-44'"
      viewBox="0 0 180 100"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
    >
      <g class="fill-vt-white stroke-vt-jade-green/25 dark:hidden" stroke-width="1.75">
        <path d="M37 61a15 15 0 0 1 1-30 24 24 0 0 1 46-5 18 18 0 0 1 24 17 10 10 0 0 1-1 20H37Z" />
        <path d="M120 83a10 10 0 0 1 0-20 16 16 0 0 1 30-4 12 12 0 0 1 16 12 6 6 0 0 1-1 12h-45Z" class="opacity-80" />
      </g>
      <g class="hidden stroke-vt-wheat-yellow/35 dark:block" stroke-width="1.5">
        <path d="m60 17 3 10 10 3-10 3-3 10-3-10-10-3 10-3Zm67 39 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z" />
        <path d="M146 21v6m-3-3h6M30 71v5m-2.5-2.5h5" />
        <circle cx="99" cy="41" r="1.5" class="fill-vt-fg-2/35" stroke="none" />
        <circle cx="85" cy="82" r="1" class="fill-vt-fg-2/35" stroke="none" />
      </g>
    </svg>

    <svg
      class="absolute h-auto fill-vt-green-tint stroke-vt-jade-green/25 dark:stroke-vt-jade-green/35"
      :class="placement === 'welcome' ? 'bottom-3 left-2 w-16 sm:bottom-4 sm:left-5 sm:w-20' : 'bottom-2 left-1 w-20 sm:bottom-3 sm:left-6 sm:w-28'"
      viewBox="0 0 112 96"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
    >
      <path d="M13 84c21-9 39-26 52-51" fill="none" />
      <path d="M32 73C15 70 9 58 12 44c17 3 25 14 20 29Zm16-15c-3-17 6-29 22-33 3 17-5 29-22 33Zm-2 3c17-5 31 0 39 13-16 6-31 2-39-13Z" />
      <path d="m19 54 13 19m16-15 13-22M46 61l28 10" fill="none" />
      <path d="M84 15c5-5 12-5 18-2-3 7-9 11-17 9" class="fill-vt-yellow-tint stroke-vt-wheat-yellow/25 dark:stroke-vt-wheat-yellow/35" />
    </svg>

    <svg
      class="absolute h-auto"
      :class="placement === 'welcome' ? 'right-4 top-1/3 hidden w-12 sm:block' : 'bottom-5 right-3 w-16 sm:bottom-8 sm:right-8 sm:w-24'"
      viewBox="0 0 100 76"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
    >
      <g class="stroke-vt-jade-green/25 dark:hidden" stroke-width="1.75">
        <path d="M15 42a10 10 0 0 1 1-20 18 18 0 0 1 34-5 13 13 0 0 1 18 12 7 7 0 0 1-1 14H15Z" class="fill-vt-white" />
        <path d="M52 61h23m-13 7h22" />
      </g>
      <g class="hidden stroke-vt-wheat-yellow/30 dark:block" stroke-width="1.5">
        <path d="m37 17 3 9 9 3-9 3-3 9-3-9-9-3 9-3ZM74 51v7m-3.5-3.5h7" />
        <circle cx="18" cy="61" r="1.5" class="fill-vt-fg-2/30" stroke="none" />
      </g>
    </svg>
  </div>
</template>
