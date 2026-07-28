import { createSSRApp, type Component } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { renderHeadTags, type HeadConfig } from './heads'

/** 可選：在 </body> 前注入 hydration 用的 ES module（開發 / 正式路徑分開） */
export interface RenderPageOptions {
  hydrate?: {
    devSrc: string
    prodSrc: string
  }
}

// 把 Vue 元件 + props + head 組成完整 HTML 字串
// 流程：createSSRApp(元件, props) → renderToString(產出 body) → 套上 head 模板
export async function renderPage(
  component: Component,
  props: Record<string, unknown>,
  head: HeadConfig,
  options?: RenderPageOptions,
): Promise<string> {
  const app = createSSRApp(component, props)
  const bodyHtml = await renderToString(app)
  const headTags = renderHeadTags(head)
  const hydrateSrc =
    options?.hydrate &&
    (import.meta.env.PROD ? options.hydrate.prodSrc : options.hydrate.devSrc)
  const hydrateScript = hydrateSrc
    ? `\n    <script type="module" src="${hydrateSrc}"></script>`
    : ''
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    ${headTags}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app">${bodyHtml}</div>${hydrateScript}
  </body>
</html>`
}
