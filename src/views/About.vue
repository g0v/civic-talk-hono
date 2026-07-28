<script setup lang="ts">
import NavBar from '../components/NavBar.vue'
</script>

<template>
  <NavBar current="about" />
  <main class="container">
    <h1>About</h1>
    <p>
      This template demonstrates server-side rendering of Vue 3 components
      inside a Cloudflare Worker, with Hono handling routing.
    </p>
    <p>
      Each route injects its own &lt;title&gt; and Open Graph meta tags
      via <code>src/ssr/heads.ts</code>.
    </p>
    <p><a href="/">Back home</a></p>
  </main>
</template>
