# Civic Talk（Hono + Vue SSR）

公共議題審議平台。由舊版靜態站 [`civic-talk`](../civic-talk) 移植而來：**Hono + Vue 3 SSR/hydration + Tailwind v4 + Cloudflare Workers / D1**。

平台**不呼叫任何 AI API**——志願者用自己的 AI token 跑彙整，平台只產生 prompt 並收回結果。


## 目前進展狀態

先複刻了原本civic talk的頁面與功能，可在近端執行，尚未部署

## 開發

```bash
cp .dev.vars.example .dev.vars   # 填入 Better Auth 與 Google／GitHub OAuth 憑證
npm install
npx wrangler d1 migrations apply vtaiwan-civic-talks --local
npm run dev
```

> 登入功能在 `npm run dev` 下**測不了**：Better Auth 的資料表在遠端的 `vtaiwan-auth`，本機模擬庫是空的。要實測登入請用 `npm run dev:remote`。

常用指令：

| 指令 | 說明 |
| ---- | ---- |
| `npm run dev` | 同時監看 Tailwind CSS 與啟動本機 Vite + Worker（含 HMR） |
| `npm run dev:remote` | 同時監看 Tailwind CSS 並以遠端 D1 啟動 Vite；實測登入用這個 |
| `npm run css` | 由 `src/styles/app.css` 建置 `public/styles.css` |
| `npm run css:watch` | 只監看並重建 Tailwind CSS |
| `npm run build` | 依序建置 CSS、client bundle、server bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run cf-typegen` | 產生 Cloudflare 綁定型別 |

樣式 token 以 `vtaiwan-design-system/project/colors_and_type.css` 為穩定來源，透過 Tailwind v4 的 `vt-*` utilities 使用，例如 `text-vt-democratic-red`、`bg-vt-bg-2`、`font-vt-serif`。

## 路由

| 路徑 | 說明 |
| ---- | ---- |
| `/` | 議題列表／新增議題 |
| `/issues/:id` | 議題說明、素材、志願者工具、意見、Polis |
| `/contribute/:id` | 素材投稿 |
| `/about` | 關於 |
| `/admin` | 管理後台（Google／GitHub 登入，需 `admin`／`super-admin` 角色） |

舊網址 `/index.html`、`/issue.html?id=`、`/contribute.html?id=`、`/about.html`、`/admin.html` 會導向新路由。

## 資料

- D1 資料庫：`vtaiwan-civic-talks`（binding：`DB`）
- 業務表一律 `ct_` 前綴：`ct_issues`、`ct_materials`、`ct_briefings`、`ct_opinions`
- 遠端 migration 需先取得授權：`npx wrangler d1 migrations apply vtaiwan-civic-talks --remote`

## 部署

📋 **首次部署前請先讀 [`deploy_notes.md`](./deploy_notes.md)**——裡面有三項會讓部署直接失敗或造成災難的前置條件（Worker 名稱撞名、OAuth callback 網址、正式環境機密），以及一個絕對不能跑的 D1 指令。

更完整的 agent／架構指引見 [`AGENTS.md`](./AGENTS.md)。
