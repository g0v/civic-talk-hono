import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import * as vueCompiler from '@vue/compiler-sfc'

export default defineConfig(({ mode }) => ({
  publicDir: 'public',
  plugins: [
    // 只有明確使用 `--mode remote`（npm run dev:remote）時才連遠端綁定；
    // 一般 dev 使用本機模擬資源。Better Auth 的 user／session 表只存在遠端的
    // vtaiwan-auth，所以要實測登入必須用 dev:remote。
    cloudflare({ remoteBindings: mode === 'remote' }),
    vue({ compiler: vueCompiler }),
  ],
}))
