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
    vue({ compiler: vueCompiler }),
    {
      name: 'externalize-public-abs-urls',
      resolveId(id) {
        // 模板裡的 /vtaiwan-logo.svg 等 ASSETS 路徑，不要當模組打包
        if (id.startsWith('/') && !id.startsWith('/@') && !id.startsWith('/src')) {
          return { id, external: true }
        }
      },
    },
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
        inlineDynamicImports: true,
      },
    },
  },
})
