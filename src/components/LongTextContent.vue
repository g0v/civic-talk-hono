<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../l10n'

const props = withDefaults(
  defineProps<{
    text: string
    /** 超過此字數才折疊（#65：長篇素材只顯示字數，不截短） */
    threshold?: number
    /** 內容區塊的樣式（由呼叫端決定字級與行高） */
    contentClass?: string
    /** aria-controls 用的穩定 id；SSR 與 client 必須一致，所以由呼叫端給 */
    contentId?: string
  }>(),
  { threshold: 1000, contentClass: '', contentId: undefined }
)

const { t } = useI18n()
const expanded = ref(false)

// 以 code point 計數，CJK 與 emoji 才不會被算成多個字
const charCount = computed(() => Array.from(props.text ?? '').length)
const collapsible = computed(() => charCount.value > props.threshold)
// 折疊時完全不輸出內容（不截短，避免違反 CC BY-NC-ND 的「禁止改作」）
const showText = computed(() => !collapsible.value || expanded.value)
// 內容被 v-if 拿掉時不能留下指向不存在節點的 IDREF
const controls = computed(() => (showText.value ? props.contentId : undefined))
</script>

<template>
  <div>
    <!-- 切換鈕放在內容之前：展開後不必捲過全文才找得到「收合」 -->
    <div v-if="collapsible" class="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted">
      <span>{{ t('long_text_char_count', { count: charCount }) }}</span>
      <button type="button" class="btn btn-ghost btn-sm shrink-0" :aria-expanded="expanded" :aria-controls="controls" @click="expanded = !expanded">
        {{ expanded ? t('long_text_collapse_btn') : t('long_text_expand_btn') }}
      </button>
    </div>
    <div v-if="showText" :id="contentId" :class="contentClass">{{ text }}</div>
    <!-- 全文很長，讀完後在末尾也給一個收合鈕 -->
    <div v-if="collapsible && expanded" class="mt-2">
      <button type="button" class="btn btn-ghost btn-sm" :aria-expanded="expanded" :aria-controls="controls" @click="expanded = false">
        {{ t('long_text_collapse_btn') }}
      </button>
    </div>
  </div>
</template>
