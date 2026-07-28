<script setup lang="ts">
defineProps<{ current?: string }>()
</script>

<template>
  <nav class="navbar">
    <a href="/" :class="{ active: current === 'home' }">Home</a>
    <a href="/about" :class="{ active: current === 'about' }">About</a>
    <a href="/word/萌" :class="{ active: current === 'word' }">Word: 萌</a>
    <a href="/hundred" :class="{ active: current === 'hundred' }">百數表 Hydrate</a>
  </nav>
</template>
