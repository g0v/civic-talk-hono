import { defineConfig, lazyPlugins } from 'vite-plus'
import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import * as vueCompiler from '@vue/compiler-sfc'

export default defineConfig(({ mode }) => ({
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
    // SSR 煙霧測試與 l10n key 同步：`npm run test` 執行，不依賴瀏覽器
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
  },
  publicDir: 'public',
  plugins: lazyPlugins(() => [
    // Cloudflare plugin 與 Vitest 不相容；測試時略過，由 vue plugin 單獨處理 .vue
    // 只有明確使用 `--mode remote` 時才連遠端綁定；一般 dev 使用本機模擬資源。
    ...(process.env['VITEST'] ? [] : [cloudflare({ remoteBindings: mode === 'remote' })]),
    vue({ compiler: vueCompiler }),
  ]),
}))
