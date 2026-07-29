<script setup lang="ts">
import { onUnmounted, ref } from 'vue'

const message = ref('')
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function show(msg: string, ms = 2500) {
  message.value = msg
  visible.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    visible.value = false
  }, ms)
}

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})

defineExpose({ show })
</script>

<template>
  <div class="toast" :class="{ show: visible }" role="status" aria-live="polite">
    {{ message }}
  </div>
</template>
