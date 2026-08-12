# Civic Talk（Hono + Vue SSR）

公共議題審議平台，**受原始版 [Civic Talk](https://github.com/vTaiwan/civic-talk) 啟發**，由該版靜態站移植而來：**Hono + Vue 3 SSR/hydration + Tailwind v4 + Cloudflare Workers / D1**。

平台**不呼叫任何 AI API**——志願者用自己的 AI token 跑彙整，平台只產生 prompt 並收回結果。

## 目前狀態

已部署於 **<https://civic.vtaiwan.tw>**（Cloudflare Workers，Worker 名稱 `civic-talk`，首次部署 2026-08-05）。

已在正式站驗過（2026-08-11）：

- 首頁與 `/api/issues` 皆 200、未登入打 `/api/me` 與 `/api/admin/stats` 得 401、`/api/auth/admin/list-users` 得 404（本站刻意不開成員管理端點）、`/index.html` 301 導向 `/`。
- **Google 與 GitHub 登入都成功**、`admin` 角色進得了後台、登入後投稿成功。

⚠️ 尚未實證的兩項：**同一個 email 用兩種 provider 登入是否落到同一個帳號**、四種寫入是否都落下完整作者快照（含管理端取得完整快照）。

功能面重點：

- **投稿與志願者工具需登入**：建立議題、投稿素材、投稿意見、送出說明頁與產生志願者 prompt 都要先登入（任何未停權的登入者皆可，不看角色）。
- **具名投稿與 email opt-in**：四種內容都保存投稿當下的作者快照；前台固定顯示 `author_name`，email 只在該筆內容明確同意公開時才顯示。
- **條款同意落庫**：三類具名投稿由伺服器端驗證同意並寫入條款版本與時間。
- **全站登入狀態**：`AppHeader` 顯示登入者與登出，未登入時提供 Google／GitHub 登入面板。
- **管理權限走角色**：Better Auth session 的 `admin`／`super-admin`；角色由 [`../vTaiwan-hono`](../vTaiwan-hono) 管理，本站只讀。

## 開發

```bash
cp .dev.vars.example .dev.vars   # 填入 Better Auth 與 Google／GitHub OAuth 憑證
npm install
npx wrangler d1 migrations apply vtaiwan-civic-talks --local
vp run dev
```

> 登入功能在 `vp run dev` 下**測不了**：Better Auth 的資料表在遠端的 `vtaiwan-auth`，本機模擬庫是空的。要實測登入請用 `vp run dev:remote`。

常用指令：

| 指令                          | 說明                                              |
| ----------------------------- | ------------------------------------------------- |
| `vp run dev`                  | 先建置 CSS 再啟動本機 Worker + HMR（D1 本機模擬） |
| `vp run dev:remote`           | 先建置 CSS 再連遠端 D1；實測登入用這個            |
| `vp run css`                  | 由 `src/styles/app.css` 建置 `public/styles.css`  |
| `vp run css:watch`            | 監看並自動重建 Tailwind CSS                       |
| `vp run build`                | 依序建置 CSS、client bundle、server bundle        |
| `vp check --no-fmt --no-lint` | tsc 型別檢查                                      |
| `vp test`                     | 執行自動化測試（Vitest，`src/tests/`）            |
| `vp exec wrangler types`      | 產生 Cloudflare 綁定型別                          |

樣式 token 以 `vtaiwan-design-system/project/colors_and_type.css` 為穩定來源，透過 Tailwind v4 的 `vt-*` utilities 使用，例如 `text-vt-democratic-red`、`bg-vt-bg-2`、`font-vt-serif`。

## 路由

| 路徑                             | 說明                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| `/`                              | 議題列表／新增議題（新增需登入）                                |
| `/issues/:id`                    | 議題說明、素材、志願者工具、意見、Polis                         |
| `/issues/:id/source/:materialId` | 素材詳情（獨立分享連結，含 OG meta）                            |
| `/issues/:id/comment/:opinionId` | 意見詳情（獨立分享連結，含 OG meta）                            |
| `/contribute/:id`                | 素材投稿（需登入）                                              |
| `/about`                         | 關於                                                            |
| `/privacy`                       | 隱私政策（作者快照、公開選擇與帳號刪除的說明）                  |
| `/terms`                         | 使用條款（投稿時同意的版本）                                    |
| `/admin`                         | 管理後台（Google／GitHub 登入，需 `admin`／`super-admin` 角色） |

舊網址 `/index.html`、`/issue.html?id=`、`/contribute.html?id=`、`/about.html`、`/admin.html` 會導向新路由。

## 資料

- 業務資料庫：D1 `vtaiwan-civic-talks`（binding：`DB`）；業務表一律 `ct_` 前綴：`ct_issues`、`ct_materials`、`ct_briefings`、`ct_opinions`
- `migrations/0001`–`0006`（初始 schema、作者快照、條款同意）**本機與遠端皆已套用**
- 認證資料庫：D1 `vtaiwan-auth`（binding：`DB_AUTH`），schema 由 `../vTaiwan-hono` 維護——本 repo **只讀不改**，🚫 不對它跑任何 migration
- 遠端 migration 需先取得授權：`npx wrangler d1 migrations apply vtaiwan-civic-talks --remote`

## 部署

```bash
vp run deploy    # = vp run build + wrangler deploy
```

環境設定（機密、`BETTER_AUTH_URL`、OAuth callback 網址）、部署實際上傳的內容、煙霧測試清單與**絕對不能跑的 D1 指令**見 [`deploy_notes.md`](./deploy_notes.md)。

更完整的 agent／架構指引見 [`AGENTS.md`](./AGENTS.md)。
