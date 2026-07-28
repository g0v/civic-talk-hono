# hono-vue-ssr-template

**EN:** Minimal Cloudflare Workers template using **Hono** for routing and **Vue 3 SSR** for rendering. No D1 / R2 / KV / AI bindings — just a worker that server-renders Vue components and serves a few static assets.

**中文：**極簡的 Cloudflare Workers 範本：路由用 **Hono**、畫面用 **Vue 3 SSR**。不含 D1 / R2 / KV / AI 等綁定，僅以 Worker 做 Vue 元件伺服端渲染，並提供少數靜態資源。

## Routes / 路由

| Route | EN | 中文 |
| ----- | -- | ---- |
| `/` | Home page (SSR) | 首頁（SSR） |
| `/about` | About page (SSR) | 關於頁（SSR） |
| `/word/:w` | Dynamic page; `og:image` is `https://www.moedict.tw/{w}.png` | 動態頁；`og:image` 為 `https://www.moedict.tw/{w}.png` |
| `/hundred` | **Hydration demo:** 10×10 grid (1–100), multiples highlighted via `v-model` / `v-for` / `:style`; SSR HTML plus optional client bundle | **Hydration 範例：**百數表（10×10，1～100）、倍數著色；SSR 產出 HTML，並可載入 client bundle 在瀏覽器接管互動 |
| `/api/hello` | Returns `Hello World!` | 回傳 `Hello World!` |
| `*` | Falls back to the `ASSETS` binding (`./public/`) | 其餘路徑交給 `ASSETS` 綁定（`./public/`） |

## Stack / 技術棧

**EN**

- [Hono](https://hono.dev) — the worker / router
- [Vue 3](https://vuejs.org) + `@vue/server-renderer` — SSR
- [Vite](https://vite.dev) + `@vitejs/plugin-vue` + `@cloudflare/vite-plugin` — build / dev
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — deploy

**中文**

- [Hono](https://hono.dev) — Worker 與路由
- [Vue 3](https://vuejs.org) + `@vue/server-renderer` — 伺服端渲染
- [Vite](https://vite.dev) + `@vitejs/plugin-vue` + `@cloudflare/vite-plugin` — 建置與本機開發
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — 部署

## Layout / 目錄結構

```
src/
├── index.ts             # Hono worker entry — defines all routes / Worker 入口，定義所有路由
├── ssr/
│   ├── render.ts        # createSSRApp + renderToString → full HTML page / 產出完整 HTML
│   └── heads.ts         # per-route <title> / OG meta builders / 各路由的 <title> 與 OG meta
├── views/
│   ├── Home.vue
│   ├── About.vue
│   ├── Word.vue
│   └── HundredChart.vue   # optional hydration demo page / 選用 hydration 範例頁
├── client/
│   └── hundred-chart-entry.ts  # browser entry — createSSRApp + mount(..., true) / 瀏覽器 hydration 入口
└── components/
    └── NavBar.vue
vite.client.config.mts   # second Vite build: emits client bundle only / 第二段建置：僅輸出 hydration bundle
public/                  # static assets, served via ASSETS binding / 靜態資源，經 ASSETS 提供
├── styles.css
├── js/hundred-chart.js  # created by `npm run build` (vite.client.config.mts) / 由建置產生
└── favicon.svg
```

## Develop / 開發

```bash
npm install
npm run dev          # vite dev — runs the worker locally with HMR
                   # Vite 開發模式：本機跑 Worker，含 HMR
```

## Deploy / 部署

```bash
npm run deploy       # vite build (+ client bundle) + wrangler deploy
                   # Vite 建置（含 hydration bundle）+ wrangler deploy
```

## Adding a route / 新增路由

**EN**

1. Create a `.vue` file in `src/views/`.
2. Add a `headForX(...)` function in `src/ssr/heads.ts`.
3. Wire a route in `src/index.ts`:

   ```ts
   app.get('/foo', async (c) => {
     const origin = new URL(c.req.url).origin
     const html = await renderPage(FooView, {}, headForFoo(origin))
     return c.html(html)
   })
   ```

4. *(Optional)* To ship **client hydration** for that route, pass a fourth argument to `renderPage` and add a small browser entry under `src/client/` (see `/hundred` in `src/index.ts`, `src/client/hundred-chart-entry.ts`, and `vite.client.config.mts`). `npm run build` runs the Worker build then the client bundle build.

**中文**

1. 在 `src/views/` 新增 `.vue` 檔。
2. 在 `src/ssr/heads.ts` 新增 `headForX(...)` 函式。
3. 在 `src/index.ts` 接上路由（見上方程式片段）。
4. **（選用）**若該頁要在瀏覽器 **hydration**，可傳入 `renderPage` 第四個參數，並在 `src/client/` 新增對應入口（見 `/hundred`、`src/client/hundred-chart-entry.ts`、`vite.client.config.mts`）。`npm run build` 會先建 Worker，再建 client bundle。

## Optional hydration / 選用 hydration

**EN:** By default, routes only return SSR HTML (no Vue runtime in the browser). `/hundred` opts in: `renderPage` injects `<script type="module">` — in dev it loads `/src/client/hundred-chart-entry.ts` (Vite transforms it); in production it loads `/js/hundred-chart.js` from `public/` (produced by `vite build -c vite.client.config.mts`, included in `npm run build`).

**中文：**預設各路由僅回傳 SSR 的靜態 HTML（瀏覽器不載入 Vue）。`/hundred` 為選用模式：`renderPage` 會插入 `<script type="module">` — 開發時載入 `/src/client/hundred-chart-entry.ts`（由 Vite 轉譯）；正式環境載入 `public/js/hundred-chart.js`（由 `vite.client.config.mts` 建置，`npm run build` 已包含）。

## Dynamic HEAD / 動態 `<head>`

**EN:** Each route builds a `HeadConfig` (title + meta) before rendering. `/word/:w` sets `og:image` to `https://www.moedict.tw/{w}.png` — see `headForWord` in `src/ssr/heads.ts` for the pattern. Add more `og:` / `twitter:` tags or extend `HeadConfig` as needed.

**中文：**每個路由在渲染前會組出 `HeadConfig`（標題與 meta）。`/word/:w` 會把 `og:image` 設成 `https://www.moedict.tw/{w}.png`，可參考 `src/ssr/heads.ts` 的 `headForWord`。可依需求擴充 `og:` / `twitter:` 標籤或延伸 `HeadConfig`。

## License / 授權

**EN:** MIT — see [LICENSE](./LICENSE).

**中文：**MIT — 詳見 [LICENSE](./LICENSE)。
