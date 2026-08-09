import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as vueCompiler from '@vue/compiler-sfc'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root,
  publicDir: false,
  plugins: [
    vue({
      compiler: vueCompiler,
      // publicDir 已關閉，client bundle 只負責 JS；/ 開頭的靜態資產由 Worker
      // ASSETS binding 提供。若交給 SFC compiler 轉換，Rollup 會產生
      // `import ... from "/vtaiwan-logo.svg"`，瀏覽器因 SVG MIME type 拒絕
      // 執行整個 module，導致 hydration 完全失效。
      template: { transformAssetUrls: false },
    }),
  ],
  build: {
    outDir: 'public',
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(root, 'src/client/civic-entry.ts'),
      output: {
        format: 'es',
        entryFileNames: 'js/civic.js',
      },
    },
  },
})
