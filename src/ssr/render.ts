import { createSSRApp, type Component } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { provideI18n } from '../l10n'
import { renderHeadTags, type HeadConfig } from './heads'
import { serializeState } from './serialize'

export type PageName = 'home' | 'about' | 'issue' | 'contribute' | 'admin'

export interface RenderPageOptions {
  hydrate?: {
    page: PageName
    state?: Record<string, unknown>
  }
}

export async function renderPage(
  component: Component,
  props: Record<string, unknown>,
  head: HeadConfig,
  options?: RenderPageOptions,
): Promise<string> {
  const app = createSSRApp(component, props)
  provideI18n(app, 'zh-TW')
  const bodyHtml = await renderToString(app)
  const headTags = renderHeadTags(head)

  const hydrateBits: string[] = []
  if (options?.hydrate) {
    const state = options.hydrate.state ?? props
    hydrateBits.push(
      `<script>window.__PAGE__=${JSON.stringify(options.hydrate.page)};window.__SSR_STATE__=${serializeState(state)}</script>`,
    )
    const src = import.meta.env.PROD ? '/js/civic.js' : '/src/client/civic-entry.ts'
    hydrateBits.push(`<script type="module" src="${src}"></script>`)
  }

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    ${headTags}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@400;700;900&display=swap" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app">${bodyHtml}</div>
    ${hydrateBits.join('\n    ')}
  </body>
</html>`
}
