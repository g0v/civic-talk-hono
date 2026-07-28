import { Hono } from 'hono'
import HomeView from './views/Home.vue'
import AboutView from './views/About.vue'
import WordView from './views/Word.vue'
import HundredChartView from './views/HundredChart.vue'
import { renderPage } from './ssr/render'
import { headForHome, headForAbout, headForWord, headForHundredChart } from './ssr/heads'

// Cloudflare Worker 綁定型別；ASSETS 在 wrangler.jsonc 對應到 ./public/
type Bindings = {
  ASSETS?: {
    fetch: (request: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }
}

const app = new Hono<{ Bindings: Bindings }>()

// 純 JSON / 文字 API：直接回傳，不走 SSR
app.get('/api/hello', (c) => c.text('Hello World!'))

// SSR 路由：每條路由把 props 與 head 交給 renderPage 產出完整 HTML
app.get('/', async (c) => {
  const origin = new URL(c.req.url).origin
  const html = await renderPage(HomeView, {}, headForHome(origin))
  return c.html(html)
})

app.get('/about', async (c) => {
  const origin = new URL(c.req.url).origin
  const html = await renderPage(AboutView, {}, headForAbout(origin))
  return c.html(html)
})

// 動態路由：:w 為網址中的字，會傳進 Vue 元件並用來組 og:image
app.get('/word/:w', async (c) => {
  const word = decodeURIComponent(c.req.param('w'))
  const origin = new URL(c.req.url).origin
  const html = await renderPage(WordView, { word }, headForWord(word, origin))
  return c.html(html)
})

// 百數表：SSR + client hydration（v-model / v-for / :style）
app.get('/hundred', async (c) => {
  const origin = new URL(c.req.url).origin
  const html = await renderPage(
    HundredChartView,
    {},
    headForHundredChart(origin),
    {
      hydrate: {
        devSrc: '/src/client/hundred-chart-entry.ts',
        prodSrc: '/js/hundred-chart.js',
      },
    },
  )
  return c.html(html)
})

// 其他未命中的請求 → 交給 ASSETS 處理（favicon、styles.css 等靜態檔）
app.get('*', async (c) => {
  if (!c.env.ASSETS) return c.notFound()
  return c.env.ASSETS.fetch(c.req.raw)
})

export default app
