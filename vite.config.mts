import { defineConfig, lazyPlugins } from 'vite-plus'
import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import * as vueCompiler from '@vue/compiler-sfc'
import { sourceDefines, projectRoot } from './scripts/source-metadata.mjs'
import { bundleNotices } from './scripts/bundle-notices.mjs'

export default defineConfig(({ mode }) => ({
  define: sourceDefines(),
  server: {
    // 不讓 dev server 代替 Worker 回 CORS，確保本機與正式路由行為一致。
    cors: false,
    // 實驗入口綁定 canonical localhost:5173（不暴露 LAN）；占用時直接失敗，避免 OAuth callback 漂移。
    ...(mode === 'remote' && process.env['CIVIC_AI_EXPERIMENT'] === '1' ? { host: 'localhost', port: 5173, strictPort: true } : {}),
  },
  optimizeDeps: {
    // 一起預載 Vue 與輪播，避免首次發現輪播時重建依賴，短暫混用不同 Vue runtime。
    include: ['vue', 'vue3-carousel'],
  },
  fmt: {
    semi: false,
    singleQuote: true,
    trailingComma: 'es5',
    printWidth: 200,
    bracketSpacing: true,
    arrowParens: 'avoid',
    ignorePatterns: ['public/**', 'dist/**', '.claude/**', '.vscode/**', '.wrangler/**'],
  },
  lint: {
    // typeCheck: true 讓 `vp check --no-fmt --no-lint`（即 npm run typecheck）
    // 仍然執行 tsc 型別檢查，不受 --no-lint 停用 oxlint 的影響。
    // ignorePatterns 讓 oxlint 跳過建置產物（minified bundle 無法分析）。
    ignorePatterns: ['public/**', 'dist/**', '.wrangler/**'],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    // SSR 煙霧測試與 l10n key 同步：`npm run test` 執行，不依賴瀏覽器
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
  },
  publicDir: 'public',
  plugins: lazyPlugins(() => [
    // Cloudflare plugin 與 Vitest 不相容；測試時略過，由 vue plugin 單獨處理 .vue
    // 一般遠端開發仍用既有設定；只有明確 opt-in 的 remote mode 才載入實驗 Worker 與隔離 persist。
    ...(process.env['VITEST']
      ? []
      : [
          cloudflare({
            remoteBindings: mode === 'remote',
            ...(mode === 'remote' && process.env['CIVIC_AI_EXPERIMENT'] === '1'
              ? {
                  configPath: 'wrangler.ai-experiment.jsonc',
                  persistState: { path: '.wrangler/ai-experiment' },
                }
              : {}),
          }),
        ]),
    vue({
      compiler: vueCompiler,
      template: { transformAssetUrls: false },
    }),
    bundleNotices({ target: 'worker', root: projectRoot }),
  ]),
}))
