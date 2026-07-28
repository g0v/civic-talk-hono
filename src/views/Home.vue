<script setup lang="ts">
import NavBar from '../components/NavBar.vue'
</script>

<template>
  <NavBar current="home" />
  <main class="container">
    <h1>Hono + Vue SSR Template</h1>
    <p>
      A minimal Cloudflare Workers template using
      <strong>Hono</strong> for routing and
      <strong>Vue 3 SSR</strong> for rendering.
    </p>
    <ul>
      <li><a href="/about">About this template</a></li>
      <li><a href="/word/%E8%90%8C">/word/萌 — dynamic route demo</a></li>
      <li><a href="/hundred">/hundred — 百數表 hydration（v-model / v-for / :style）</a></li>
      <li><a href="/api/hello">/api/hello — JSON API demo</a></li>
    </ul>
  </main>
</template>
