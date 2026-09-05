<script setup lang="ts">
// 關於頁「平台導覽流程」五個步驟的插圖（issue #83）。
// 採 inline SVG 而非圖檔：線條走 currentColor、重點色走 Tailwind 的 fill-*／stroke-* utilities
// （token 來自 src/styles/app.css 的 @theme），所以暗黑模式（#56）會自動跟著切換，
// 也不需要維護額外的圖片資產。不用 SFC 的 scoped style 區塊：目前 HTML 殼只載入 /styles.css，
// SFC 抽出的 CSS 不會被送到瀏覽器。
// 內容為純裝飾，標題與說明文字另由 About.vue 輸出。
defineProps<{
  step: 1 | 2 | 3 | 4 | 5
}>()
</script>

<template>
  <svg
    class="block h-auto w-full text-ink"
    viewBox="0 0 200 140"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 1. 關注議題（創建議題）：議題卡片＋書籤＋建立按鈕 -->
    <template v-if="step === 1">
      <rect x="28" y="24" width="112" height="86" rx="10" class="fill-vt-bg-1" />
      <line x1="44" y1="44" x2="96" y2="44" stroke-width="4" />
      <line x1="44" y1="60" x2="122" y2="60" class="stroke-gray-300" />
      <line x1="44" y1="74" x2="110" y2="74" class="stroke-gray-300" />
      <line x1="44" y1="88" x2="118" y2="88" class="stroke-gray-300" />
      <path d="M126 24v26l-8-6-8 6V24" class="fill-red stroke-red" />
      <circle cx="152" cy="100" r="22" class="fill-red stroke-red" />
      <path d="M152 89v22M141 100h22" class="stroke-vt-white" stroke-width="3.5" />
      <path d="M170 34l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" class="fill-amber" stroke="none" />
      <circle cx="18" cy="118" r="3" class="fill-teal" stroke="none" />
    </template>

    <!-- 2. 建立客觀討論基礎：素材堆 → AI → 說明頁（共識／爭點／立場地圖） -->
    <template v-else-if="step === 2">
      <rect x="14" y="44" width="40" height="52" rx="5" class="fill-vt-bg-1" />
      <rect x="22" y="36" width="40" height="52" rx="5" class="fill-vt-bg-1" />
      <rect x="30" y="28" width="40" height="52" rx="5" class="fill-vt-bg-1" />
      <line x1="38" y1="42" x2="62" y2="42" class="stroke-gray-300" />
      <line x1="38" y1="52" x2="60" y2="52" class="stroke-gray-300" />
      <line x1="38" y1="62" x2="58" y2="62" class="stroke-gray-300" />
      <path d="M82 70h22M97 63l7 7-7 7" />
      <path d="M94 30l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" class="fill-amber" stroke="none" />
      <rect x="118" y="20" width="68" height="100" rx="8" class="fill-vt-bg-1" />
      <circle cx="132" cy="40" r="6" class="fill-vt-green-tint stroke-teal" />
      <path d="M129 40l2.5 2.5 4-5" class="stroke-teal" stroke-width="2" />
      <line x1="144" y1="40" x2="174" y2="40" class="stroke-gray-300" />
      <circle cx="132" cy="68" r="6" class="fill-vt-red-tint stroke-red" />
      <path d="M133.5 62.5l-3 5h3l-2 4.5" class="stroke-red" stroke-width="2" />
      <line x1="144" y1="68" x2="170" y2="68" class="stroke-gray-300" />
      <rect x="126" y="86" width="52" height="26" rx="4" class="stroke-gray-300" />
      <circle cx="136" cy="94" r="2.5" class="fill-red" stroke="none" />
      <circle cx="146" cy="100" r="2.5" class="fill-red" stroke="none" />
      <circle cx="154" cy="106" r="2.5" class="fill-teal" stroke="none" />
      <circle cx="166" cy="92" r="2.5" class="fill-amber" stroke="none" />
      <circle cx="170" cy="104" r="2.5" class="fill-teal" stroke="none" />
    </template>

    <!-- 3. 參與討論：個人 ↔ AI 對話形成意見；投票（研發中）以虛線表示 -->
    <template v-else-if="step === 3">
      <circle cx="40" cy="52" r="13" class="fill-vt-red-tint" />
      <path d="M16 100c0-14 11-24 24-24s24 10 24 24" class="fill-vt-red-tint" />
      <path d="M78 26h94a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H98l-14 12V82h-6a8 8 0 0 1-8-8V34a8 8 0 0 1 8-8z" class="fill-vt-bg-1" />
      <path d="M96 40l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" class="fill-amber" stroke="none" />
      <line x1="112" y1="44" x2="166" y2="44" class="stroke-gray-300" />
      <line x1="112" y1="56" x2="158" y2="56" class="stroke-gray-300" />
      <line x1="90" y1="68" x2="150" y2="68" class="stroke-gray-300" />
      <circle cx="120" cy="112" r="13" class="stroke-teal [stroke-dasharray:5_4]" />
      <path d="M120 118v-12M114 112l6-6 6 6" class="stroke-teal" />
      <circle cx="156" cy="112" r="13" class="stroke-red [stroke-dasharray:5_4]" />
      <path d="M156 106v12M150 112l6 6 6-6" class="stroke-red" />
    </template>

    <!-- 4. 分享觀點：意見卡片＋專屬連結，分享給更多人 -->
    <template v-else-if="step === 4">
      <rect x="14" y="34" width="84" height="72" rx="10" class="fill-vt-bg-1" />
      <line x1="30" y1="52" x2="72" y2="52" stroke-width="4" />
      <line x1="30" y1="68" x2="84" y2="68" class="stroke-gray-300" />
      <line x1="30" y1="82" x2="76" y2="82" class="stroke-gray-300" />
      <path d="M118 70l40-30M118 70h52M118 70l40 30" class="stroke-gray-300" />
      <circle cx="168" cy="36" r="10" class="fill-vt-green-tint stroke-teal" />
      <circle cx="180" cy="70" r="10" class="fill-vt-yellow-tint stroke-amber" />
      <circle cx="168" cy="104" r="10" class="fill-vt-red-tint stroke-red" />
      <circle cx="118" cy="70" r="4" class="fill-ink" stroke="none" />
      <g class="stroke-red" transform="rotate(-45 92 104)">
        <rect x="70" y="97" width="24" height="14" rx="7" class="fill-vt-bg-1" />
        <rect x="90" y="97" width="24" height="14" rx="7" class="fill-vt-bg-1" />
      </g>
    </template>

    <!-- 5. 意見綜整（研發中）：多則意見匯流進漏斗，產出以虛線表示 -->
    <template v-else>
      <path d="M16 22h34a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H30l-8 7v-7h-6a5 5 0 0 1-5-5V27a5 5 0 0 1 5-5z" class="fill-vt-green-tint stroke-teal" />
      <path d="M20 68h34a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H34l-8 7v-7h-6a5 5 0 0 1-5-5V73a5 5 0 0 1 5-5z" class="fill-vt-yellow-tint stroke-amber" />
      <path d="M62 44h34a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H76l-8 7v-7h-6a5 5 0 0 1-5-5V49a5 5 0 0 1 5-5z" class="fill-vt-red-tint stroke-red" />
      <path d="M58 32c24 0 36 12 56 14M62 86c22 0 34-16 52-24M104 52h10" class="stroke-gray-300" />
      <path d="M110 36h44l-16 24v22l-12 6V60z" class="fill-vt-bg-1" />
      <path d="M142 72h12M150 68l4 4-4 4" />
      <rect x="160" y="46" width="34" height="56" rx="6" class="[stroke-dasharray:5_4]" />
      <line x1="168" y1="60" x2="186" y2="60" class="stroke-gray-300" />
      <line x1="168" y1="72" x2="184" y2="72" class="stroke-gray-300" />
      <line x1="168" y1="84" x2="180" y2="84" class="stroke-gray-300" />
      <path d="M176 110l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" class="fill-amber" stroke="none" />
    </template>
  </svg>
</template>
