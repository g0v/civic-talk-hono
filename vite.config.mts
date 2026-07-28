import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import * as vueCompiler from '@vue/compiler-sfc'

export default defineConfig({
  publicDir: 'public',
  plugins: [
    cloudflare(),
    vue({ compiler: vueCompiler }),
  ],
})
