# AGENTS.md

給 AI coding agent 的工作指引。本檔聚焦「**agent 該怎麼在這個 repo 工作**」；一般的技術說明與部署步驟請看 [`README.md`](./README.md)。

> ✅ Vue SSR 複刻計畫的六項 todo 已完成。下列「現況」反映移植後的真實結構；「目標架構」中尚未做的項目（例如切換到 `vue-router` 全站 hydration、[#5](https://github.com/g0v/civic-talk-hono/issues/5) 的 Better Auth 登入／權限）仍須先與使用者確認再動工。
>
> 🚧 **進行中的工作線：[#5「使用 Better-Auth 來實作登入和 Admin 功能」](https://github.com/g0v/civic-talk-hono/issues/5)**（分支 `feat/better-auth`）。**目前只有設定值與文件就緒，程式碼一行都還沒寫**——請把本檔「身分驗證與權限」一節當成規格，不要把它讀成現況。

## 專案目的

把舊的 [`../civic-talk`](../civic-talk)（靜態 HTML + Cloudflare Pages Functions + D1）**整站移植**到本專案，改用 **Hono + Vue 3 SSR/hydration + Tailwind + Cloudflare Workers**。

- **功能／內容來源**：`../civic-talk`（現行站，`public/*.html`、`functions/api/[[route]].js`、`schema.sql`、`public/i18n.js`）。
- **移植藍圖**：原 `.cursor/plans/vue_ssr_複刻_8a18e2ed.plan.md` 已在六項 todo 完成後刪除（commit `f880295`）；**現在的待辦來源是 GitHub issues**，本檔的「移植進度」是它的落地對照。與本檔衝突時**先問使用者**。
- **參考但不照抄**：`../vTaiwan-hono` 的 SSR 寫法與工程慣例可借鏡，但本專案**不**採用它的 Vite+（`vp`）／LemmaScript 工具鏈。**例外**：#5 的 Better Auth 是要「對齊」而非「借鏡」——見「身分驗證與權限」與「多 repo 工作區」。

## 不可妥協的不變量（Non-negotiable invariants）

違反任何一條就是破壞專案的根本契約。動手前先讀，改完後逐條自查。

1. **所有資料表一律 `ct_` 前綴。** 遠端 D1 `vtaiwan-civic-talks` 位於 vTaiwan 命名空間、可能與其他專案共用，未加前綴的 `issues`／`materials`／`briefings`／`opinions` 會撞名並造成不可逆的資料破壞。所有 DDL、SQL、型別一律只碰 `ct_*`；migration 套用後查 `sqlite_master` 確認只新增 `ct_` 開頭的業務表。
2. **伺服器端絕不呼叫 AI API。** 這是 Civic Talk 的產品層契約：素材彙整與說明頁生成全由志願者用自己的 AI token 完成，平台只負責產出 prompt 與收回結果。任何在 Worker 內接 OpenAI／Anthropic／Gemini 等 API 的作法都不允許——要改這個策略，先與使用者確認。
3. **SSR 路徑絕不碰瀏覽器 API。** 任何在 SSR 期間執行的程式碼（元件 `setup`、模組頂層、共用工廠）不得使用 `window`／`document`／`localStorage`／`navigator`——需要時用 `typeof window === 'undefined'` 守衛或放到 `onMounted`。每請求新建獨立的 app 實例，嚴禁跨請求共享可變狀態。
4. **舊網址永不失效。** 下列舊路徑必須以 301／302 導向新的乾淨路由，且此對應表只能新增、不能刪除：

   | 舊網址                  | 新路由            |
   | ----------------------- | ----------------- |
   | `/index.html`           | `/`               |
   | `/issue.html?id=<n>`    | `/issues/<n>`     |
   | `/contribute.html?id=<n>` | `/contribute/<n>` |
   | `/about.html`           | `/about`          |
   | `/admin.html`           | `/admin`          |

5. **API 相容契約不得片面變更。** 既有 endpoint 的路徑、方法與 JSON 形狀（見「API 契約」）只能擴充、不能改名或改語意。要破壞相容性，先問使用者。
   - **例外（已由 [#5](https://github.com/g0v/civic-talk-hono/issues/5) 授權）：管理端授權方式改為角色制。** 管理權限改看登入使用者的角色是不是 `admin`／`super-admin`（Better Auth session），**不再依賴 `ADMIN_PASSWORD` 環境變數與 `X-Admin-Token` 標頭**。這一項授權**只涵蓋授權機制**：業務 endpoint 的路徑、方法與成功回應形狀照舊，未經授權時回 `401`（未登入）／`403`（已登入但無權限）。
6. **機密不進 git。** `.dev.vars` 等憑證只留本地；不寫進任何 tracked 檔案、commit 訊息或 log 輸出。目前涵蓋 `ADMIN_PASSWORD`（將隨 #5 淘汰）、`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_SECRET`、`GITHUB_CLIENT_SECRET` 等。新增設定值時同步更新 `.dev.vars.example`，但只放假值。
7. **遠端 D1 需授權。** migration 預設只套用到本機（`--local`）。套用 `--remote`、建立或刪除資料庫、跑任何會寫入正式資料的指令前，**必須先問使用者**。本專案（導入 #5 後）會有兩個 D1 綁定：業務庫 `DB` → `vtaiwan-civic-talks`，共用認證庫 `DB_AUTH` → `vtaiwan-auth`。**本 repo 只對 `DB` 做 migration**；`DB_AUTH` 見不變量 11。
8. **生成物不手改。** `dist/`、`public/js/*.js`（client bundle）、`worker-configuration.d.ts` 皆為建置產物——改源頭重新生成。Tailwind 導入後 `public/styles.css` 也會變成生成物（見「樣式」）。
9. **完成 = 全部綠燈。** `npm run typecheck` 與 `npm run build` 都過才算改完。紅燈狀態不 commit。
10. **不擅自 commit／push／deploy。** 界線與長程任務例外見「Git / Commit 慣例」。
11. **共用認證資料庫只讀不改，角色由 vTaiwan-hono 管。** D1 `vtaiwan-auth`（Better Auth 的 `user`／`session`／`account`／`verification`）是 **`../vTaiwan-hono` 的正式資料庫**，本專案只是**消費端**。不變量 1 的 `ct_` 前綴保護的是業務庫，保護不到這裡——所以另立一條：
    - 🚫 **不在本 repo 建立 `migrations/auth/`，不對 auth 資料表下任何 DDL**（`CREATE`／`ALTER`／`DROP`／加欄位／加索引）。schema 的唯一來源是 `../vTaiwan-hono/migrations/auth/`。要動 schema，去那邊動並先問使用者。
    - 🚫 **不寫 `user.role`，不做權限管理後台。** 這是 #5 明確的要求（「不要做額外的權限管理後台，後台留給 vtaiwan-hono 實作即可」）——升降權、停權、成員列表、變更日誌全部留在 vTaiwan-hono。本專案只「讀 session → 判角色 → 放行或擋下」。
    - ✅ 允許的寫入只有 **Better Auth 自己在登入流程中做的那些**（建 session、建／連結 account）。除此之外不要用 `DB_AUTH` 執行自訂 SQL。

## 現況（今天 repo 裡真的有什麼）

Civic Talk 已以 **每頁 `renderPage` + 單一 client bundle hydration** 跑起來（尚未切到 `vue-router`）：

- `src/index.ts` — 乾淨路由 `/`、`/issues/:id`、`/contribute/:id`、`/about`、`/admin`；舊 `.html` 導向；掛上 `registerApiRoutes`；fallback `ASSETS`。
- `src/api/routes.ts` + `src/db/queries.ts` — 舊 Pages Functions API 的型別化移植，SQL 只碰 `ct_*`。
- `migrations/0001_init.sql` — `ct_issues`／`ct_materials`／`ct_briefings`／`ct_opinions`（含 FK、索引、約束、示範資料）。
- `src/ssr/render.ts` — SSR + 注入 `window.__PAGE__`／`__SSR_STATE__` + `/js/civic.js`（dev 走 `/src/client/civic-entry.ts`）。
- `src/views/` — `Home`／`Issue`／`Contribute`／`About`／`Admin`；共用 `AppHeader`／`AppFooter`／`StatusBadge`／`IssueCard`／`Toast`。
- `src/l10n/` — 自製 i18n composable（`zh-TW`／`en` 雙檔 key 同步）；SSR 固定 `zh-TW`，`localStorage.civic_lang` 只在 hydration 後讀寫。
- `src/styles/app.css` — Tailwind v4 `@theme static`（vTaiwan 色彩、字型、字級、間距、圓角、陰影與動效 token）；`npm run css` 產出 `public/styles.css`（**生成物，勿手改**）。
- `wrangler.jsonc` — `ASSETS` + D1 `DB` → `vtaiwan-civic-talks`。**不寫 `account_id`**（與 `../vTaiwan-hono` 一致，由 wrangler 登入的帳號決定）——不要為了「比較保險」把它加回來。

**登入／權限的真實現況（尚未動工的 #5 之前）：**

- 管理端仍是 `src/api/routes.ts` 的 `checkAdmin()`——比對 `X-Admin-Token` 標頭與 `ADMIN_PASSWORD`（**未設定時 fallback 成字面值 `'admin'`**），`POST /api/admin/login` 只是拿密碼換一個「就是密碼本身」的 token，`src/views/Admin.vue` 把它存在 client 端。**沒有使用者概念、沒有角色、沒有 session。**
- `.dev.vars.example` 已經備妥 Better Auth 需要的變數（`BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_ID/SECRET`、`GITHUB_CLIENT_ID/SECRET`），但**程式碼還沒有任何一處讀它們**。
- `src/l10n/*.ts` 的 `abt_tech_auth` 仍寫著「Admin token（X-Admin-Token）」——改授權機制時這兩個語言檔要一起改。

**尚不存在**：`better-auth` 套件、`DB_AUTH` 綁定、任何 auth／session／角色相關程式碼、`vue-router`、`vue-i18n` 套件、自動化測試／CI。

**待處理的身分問題**：

- `package.json` 與 `wrangler.jsonc` 的 `name` 為 `civic-talk`。⚠️ **首次 `wrangler deploy` 前要先確認**：Cloudflare 帳號內 Workers 與 Pages 共用同一份名稱清單，舊站若已有名為 `civic-talk` 的 Pages 專案就會撞名。撞到時**不要**逕自覆蓋舊站——先問使用者要改名還是要取代。
- 既然 `account_id` 不寫死，**部署與 D1 指令都吃 `wrangler` 當下登入的帳號**。動到遠端資源前先 `npx wrangler whoami` 確認帳號正確（civic-talk 與 vTaiwan 兩專案在同一個帳號下）。

## 目標架構（移植完成後長這樣）

### 渲染：vue-router 全站 hydration

**改用 `vue-router` + 全站 hydration**（而非現況的每頁 opt-in）。理由：Civic Talk 幾乎每頁都要互動——素材投稿表單、意見投稿、Admin CRUD、語言切換、Polis embed——每頁各自開一個 rollup input 會讓 `vite.client.config.mts` 無限膨脹，也拿不到 client-side 換頁。

- 共用工廠 `createVueApp(url)`：每請求新建 app／router（／i18n），SSR 用 `createMemoryHistory`、client 用 `createWebHistory`。
- **路由元件一律靜態 import**——lazy import 會造成 hydration mismatch，SSR 打包也需要靜態表。
- Client 進入點 `router.isReady()` 後 `app.mount('#app', true)`。
- 這是一次結構性改動：實作前先與使用者確認切換時機，不要在做別的功能時順手改掉。

### 資料：Cloudflare D1

- 遠端資料庫 `vtaiwan-civic-talks`，`wrangler.jsonc` 以 `DB` 綁定。
- `migrations/0001_init.sql` 建 `ct_issues`、`ct_materials`、`ct_briefings`、`ct_opinions`（含 FK、索引、`polis_id`、狀態／立場約束與示範資料）。**注意：舊 `schema.sql` 沒有任何 `CHECK` 約束**，這些約束是新增的——加之前先確認不會擋掉舊站允許的狀態轉換。
- `src/db/queries.ts` 集中所有 D1 查詢與資料型別；SQL 不散落在路由裡。
- 首屏由 Worker 查 D1 後 SSR，互動資料在 hydration 後由 client 打 `/api/*`。

### 身分驗證與權限：Better Auth（issue #5，尚未動工）

依 [#5](https://github.com/g0v/civic-talk-hono/issues/5)：登入改用 **Better Auth**，**與 `../vTaiwan-hono` 共用同一套認證資料庫與同一組 OAuth 應用程式**，Admin 權限改看角色。動工前先讀不變量 5、11 與本節，並到 `../vTaiwan-hono`（分支 `feat/better-auth`）讀真正的實作，**不要憑印象重寫**。

**權威參考檔（照著抄，不要自創形狀）：**

| 檔案                                                | 作用                                                  |
| --------------------------------------------------- | ----------------------------------------------------- |
| `../vTaiwan-hono/src/server/lib/createAuth.ts`      | `betterAuth()` 設定：D1 database、socialProviders、accountLinking、admin plugin 與角色表 |
| `../vTaiwan-hono/src/server/lib/authorization.ts`   | `AppRole`／`resolveRole()`／`isAdminRole()`／`getAuthContext()` |
| `../vTaiwan-hono/src/api/auth.ts`                   | `GET`／`POST` `/api/auth/*` 交給 `auth.handler()`、`GET /api/me` |
| `../vTaiwan-hono/src/client/authClient.ts`          | client 端 `createAuthClient()`，角色表須與 server 對齊 |
| `../vTaiwan-hono/src/client/auth-session.ts`        | `loadAuthSession()`／`isAdminSession()` 等前端判定     |
| `../vTaiwan-hono/migrations/auth/20260727_init_better_auth_tables.sql` | auth schema 的唯一來源（**本 repo 不複製、不套用**，見不變量 11） |

**要做的（對應 #5 的 checkbox）：**

- **共用 auth DB**：`wrangler.jsonc` 新增第二個 D1 綁定 `DB_AUTH` → `vtaiwan-auth`（`database_id: e26edd14-d163-427d-8630-9304f815e9fa`，與 vTaiwan-hono 同一顆），`betterAuth({ database: env.DB_AUTH })`。使用者表就是 vTaiwan 的 `user` 表，兩站帳號天然共通。
- **Google 登入**：沿用**同一組** `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`。
- **GitHub 登入**：沿用**同一組** `GITHUB_CLIENT_ID`／`GITHUB_CLIENT_SECRET`。
- **同 email 帳號整合**：照抄 vTaiwan-hono 的 `account.accountLinking.trustedProviders: ['google', 'github']`——同一個 email 用 Google 或 GitHub 登入都落到同一個 `user`。
- **角色制 Admin**：角色沿用 vTaiwan 的 `user`／`admin`／`super-admin`（欄位就是 `user.role`）。Admin 頁與管理 API 一律用 `isAdminRole()`（`admin` 或 `super-admin`）把關。**本站只讀角色、不寫角色**。
  - 🚫 **不開 `admin` plugin（使用者已裁示，不要自行改）。** vTaiwan-hono 開了 `admin({ adminRoles: ['super-admin'], roles: adminRoleAccess })`，因為它要做成員管理；**開了就會在 `/api/auth/admin/*` 長出 `set-role`／`list-users`／`remove-user` 等會寫入共用 auth DB 的端點**。vTaiwan-hono 用 `requiresStepUp()` 把它們擋在二次驗證之後，而本站**明確不做 step-up**——照抄等於在保護更弱的地方開一扇寫入正式 auth DB 的門，直接違反不變量 11 與 #5 的「不要做額外的權限管理後台」。
  - **改用唯讀方式取 `role`**：以 `user.additionalFields`（`input: false`）之類的設定把既有的 `role` 欄位讀出來，完全不長出任何管理端點。**注意 `role` 欄位是 vTaiwan-hono 的 admin plugin 建的、已經在 `user` 表裡**——本站只是讀它，不要因為「本站沒開 plugin」就去補欄位（違反不變量 11）。實作前先確認 better-auth 該版本讀既有欄位的正確寫法，並實測 `GET /api/me` 真的拿得到值。
  - 若日後有人開了 plugin：**必須在 `auth.handler()` 之前攔掉整段 `/api/auth/admin/*`**，這是「`/api/auth/*` 整段轉交」的唯一例外。
- **淘汰密碼制**：移除 `checkAdmin()`／`X-Admin-Token`／`ADMIN_PASSWORD`（含 `'admin'` fallback）與 `POST /api/admin/login`，`src/views/Admin.vue` 的密碼輸入改為登入入口。移除節奏見「API 契約」。

**明確不做的：**

- 🚫 **不做權限管理後台**（升降權、停權、成員列表、變更日誌）——留給 vTaiwan-hono。本站只讀角色。
- 🚫 **不做二次驗證（step-up）**。vTaiwan-hono 有 `step-up.ts`／`StepUpAuth.vue`／`admin_audit_log`，那是它管理成員資料的需求；#5 沒有要求，**不要順手移植**。要加先問使用者。
- 🚫 **不自建 email／密碼登入**——只做 Google 與 GitHub 兩個 social provider。

**已裁示的設定（使用者已決定，照做即可，不要再自行更動）：**

| 項目                  | 決定                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `admin` plugin        | 🚫 **不開**（見上一節）                                                                    |
| `account_id`          | **兩邊都不寫死**——本專案已移除 `wrangler.jsonc` 的 `account_id`，與 `../vTaiwan-hono` 一致，由 wrangler 登入的帳號決定 |
| Cloudflare 帳號       | 兩專案是**同一個帳號**（所以綁得到 `vtaiwan-auth`），但**不靠設定檔寫死來保證**——`wrangler whoami` 選錯帳號就會綁不到，遇到錯誤先查這個 |
| `nodejs_compat`       | **非必要就先不加**。實測 better-auth 在 Workers 上跑不起來、且確認是缺 Node API 所致時才補；補之前先跟使用者說一聲 |
| `BETTER_AUTH_SECRET`  | **與 vTaiwan-hono 共用同一個值**（仍只放 `.dev.vars`／Cloudflare secret，不進 git——不變量 6） |

**仍需先確認的前置條件（🚫 不要臆測）：**

1. **OAuth callback 網址**：共用的 Google／GitHub OAuth 應用程式必須把 civic-talk 的 callback（`<origin>/api/auth/callback/google`、`/api/auth/callback/github`）加進允許清單。這是**只有使用者能在 Google Cloud／GitHub 主控台做的動作**，做不了就登不進去——先確認已加，再開始寫。
2. **`BETTER_AUTH_URL` 逐環境不同**：本機是 `http://localhost:<port>`，正式是 civic-talk 自己的 origin，**不要從 vTaiwan-hono 複製**（跟 `BETTER_AUTH_SECRET` 不一樣，這個不共用）。

> ⚠️ **「共用帳號、共用 secret」不等於「共用登入狀態」**：兩站共用的是 `user`／`account` 資料（同一個 email 在兩站是同一個 `user.id`）與簽章密鑰，但 **session cookie 綁 origin**——不同網域各自要登入一次，除非刻意設定 cookie `domain` 且兩站在同一個父網域下（要做先問使用者）。**不要預設「在 vTaiwan 登入過就自動登入 civic-talk」**，也不要拿共用 secret 當作單一登入已經成立的證據。

**SSR 與 session**：session 由請求的 `Cookie` 標頭解析（`auth.api.getSession({ headers })`），這是**伺服器端行為，SSR 期間合法**，不違反不變量 3——不變量 3 禁的是 `localStorage`／`document`／`window`。前端的登入狀態一律走 `GET /api/me`，**不要**把使用者資料存進 `localStorage`。SSR 若要依登入狀態出不同內容，記得該頁不可被邊緣快取。

### 路由

`/`、`/issues/:id`、`/contribute/:id`、`/about`、`/admin`，加上不變量 4 的舊網址導向。

導入 #5 後另有 Better Auth 自己的端點 `/api/auth/*`（見「API 契約」）——**這段路徑整段交給 `auth.handler()`，不要在上面自己疊業務路由**。唯一例外是 `/api/auth/admin/*`（若啟用 `admin` plugin 才會存在）**必須擋掉**，理由見「身分驗證與權限」。`/admin` 未登入或角色不足時導向登入，不直接 404。

### 樣式：Tailwind v4 + design token

- vTaiwan token 的穩定來源是 `../vtaiwan-design-system/project/colors_and_type.css`。Tailwind utilities 使用 `vt-*` namespace（例如 `text-vt-democratic-red`、`font-vt-serif`）。
- 現有 Civic Talk 模板仍可使用 `red`／`teal`／`amber`、`font-serif` 等相容 alias；新樣式優先使用 `vt-*` token，逐步搬遷，不必在同一個 issue 重畫所有頁面。
- 模板一律用 token 或既有工具類別，**不硬寫顏色、字級、間距數值**。新增 token 時先在 `@theme` 定義再於模板使用。
- Tailwind 導入後 `public/styles.css` 變成建置產物——**不可手改**，改 source 後重新建置。
- View 的 SFC 樣式原則上用 `<style scoped>`，避免跨頁污染；真正全站共用的樣式才放進 CSS source。

### i18n：zh-TW / en 雙檔同步

- 介面文字**一律走翻譯 key**，模板與程式不寫死字串。
- **雙檔同步（硬性規定）**：`zh-TW` 與 `en` 的 key 集合必須完全一致，值各自翻譯。key 用點號分層（如 `header.home`、`issue.tabs.materials`）。舊站 `contribute` 頁缺的英文要補齊。
- **語言偵測／持久化只在瀏覽器端**：`localStorage.civic_lang` 只能在 hydration 後讀寫；SSR 一律用預設 `zh-TW`。別把偵測邏輯拉進 SSR 路徑（違反不變量 3）。
- **#5 會新增一批 key**（以 Google／GitHub 登入、登出、目前使用者、權限不足提示、Admin 登入入口等），一樣**兩個語言檔同步**。同時記得改既有的 `abt_tech_auth`——現在寫的是「Admin token（X-Admin-Token）」，改角色制後就不實了。

## API 契約（移植自舊站）

以型別化 Hono handlers 重寫 `../civic-talk/functions/api/[[route]].js`，**路徑與語意保持相容**：

| 方法     | 路徑                       | 說明                                             |
| -------- | -------------------------- | ------------------------------------------------ |
| `GET`    | `/api/issues`              | 議題列表                                         |
| `POST`   | `/api/issues`              | 新增議題                                         |
| `GET`    | `/api/issues/:id`          | 議題詳情                                         |
| `PUT`    | `/api/issues/:id`          | 編輯議題（admin）                                |
| `DELETE` | `/api/issues/:id`          | 刪除議題（admin，級聯刪 materials/briefings/opinions） |
| `GET`    | `/api/issues/:id/materials` | 素材列表                                         |
| `POST`   | `/api/issues/:id/materials` | 投稿素材（`collecting` → `summarizing` 狀態轉換） |
| `DELETE` | `/api/materials/:id`       | 刪除素材（admin）                                |
| `GET`    | `/api/issues/:id/briefing` | 取得說明頁                                       |
| `POST`   | `/api/issues/:id/briefing` | 新增說明頁（版本遞增；→ `published`）            |
| `PUT`    | `/api/issues/:id/briefing` | 編輯說明頁（admin）                              |
| `GET`    | `/api/issues/:id/opinions` | 意見列表                                         |
| `POST`   | `/api/issues/:id/opinions` | 投稿意見                                         |
| `DELETE` | `/api/opinions/:id`        | 刪除意見（admin）                                |
| `GET`    | `/api/issues/:id/prompt`   | 產生 prompt，`?type=summarize\|narrative\|synthesis`（預設 `summarize`） |
| `POST`   | `/api/admin/login`         | 以 `ADMIN_PASSWORD` 換 token（**#5 後廢除**，見下）|
| `GET`    | `/api/admin/stats`         | 管理統計                                         |

- 統一 JSON 錯誤形狀 `{ error: string }`，並補齊輸入驗證與 `400` / `401` / `404` 回應。
- 議題狀態機（**照舊站語意，不要收得更嚴**）：POST material 把 `collecting` 推到 `summarizing`；POST briefing 從 `collecting` **或** `summarizing` 直接推到 `published`——也就是說 `collecting` → `published` 是合法的，可跳過 `summarizing`。素材立場預設 `unknown`。

### 授權方式（#5 帶來的變更）

**現況**：管理端驗 `X-Admin-Token` 標頭（比對 `ADMIN_PASSWORD`）。

**#5 之後**：管理端改驗 **Better Auth session 的角色**，上表標示 `（admin）` 的 endpoint 與 `/api/admin/stats` 一律要求 `isAdminRole()`（`admin` 或 `super-admin`）。

| 方法          | 路徑              | 說明                                                       |
| ------------- | ----------------- | ---------------------------------------------------------- |
| `GET`／`POST` | `/api/auth/*`     | Better Auth 內建端點（登入、callback、登出、session）；整段交給 `auth.handler()` |
| `GET`         | `/api/me`         | 回傳目前登入者 `{ user, role }`；未登入回 `401`              |

- 回應碼語意：**未登入 `401`、已登入但角色不足 `403`**（現行程式碼只有 `401`，改的時候要補 `403`）。
- **`/api/me` 只回 `role`，不要複製 vTaiwan 的 `permissions`。** vTaiwan-hono 的 `Permission` 詞彙是 `meeting.join`／`meeting.moderate`／`transcription.update`／`topic.manage`——全是它的業務語彙，搬過來只會是四個永遠用不到的字串。Civic Talk 一律用 `isAdminRole()` 判角色；真的需要更細的權限模型，**先問使用者**再定義本站自己的詞彙。
- **`/api/auth/admin/*` 是 `/api/auth/*` 整段轉交的唯一例外**——見「身分驗證與權限」的角色制 Admin 條目。
- **`POST /api/admin/login` 廢除**：改角色制後這支沒有意義。**不要靜默移除**——同一批改動裡把 `src/views/Admin.vue` 的密碼登入 UI 一併換掉，確認前端不再呼叫後才刪路由；`ADMIN_PASSWORD` 與 `checkAdmin()` 同批清乾淨，別留半套（一半看 token、一半看角色）的授權路徑。
- **CORS 要跟著改**：現行 `src/api/routes.ts` 是 `Access-Control-Allow-Origin: '*'` + `Allow-Headers: 'Content-Type, X-Admin-Token'`。session 走 **cookie**，跨來源要帶 cookie 就必須 `Access-Control-Allow-Credentials: true`，而**帶 credentials 時 `Allow-Origin` 不得為 `*`**——必須回具體 origin。改法（先問使用者選哪一種）：
  1. **管理端不開放跨來源**（建議）：`/api/auth/*`、`/api/me` 與管理端點不掛 CORS，只有公開讀取端點維持 `*`；或
  2. 維持跨來源：改成 allowlist 回具體 origin + `Allow-Credentials: true`。
  無論哪種，`X-Admin-Token` 都要從 `Allow-Headers` 移除。

## 技術棧與工具鏈

**Hono + Vue 3 SSR + Cloudflare Workers**，套件管理與指令一律走 **npm**。

| 工具            | 版本   | 鎖定位置          |
| --------------- | ------ | ----------------- |
| Hono            | ^4.12  | `dependencies`    |
| Vue             | ^3.5   | `dependencies`    |
| TypeScript      | ^5.6   | `devDependencies` |
| Vite            | ^7.0   | `devDependencies` |
| Wrangler        | ^4.83  | `devDependencies` |
| @cloudflare/vite-plugin | ^1.32 | `devDependencies` |
| better-auth     | ^1.6.25（**尚未安裝**，#5 才裝） | 屆時進 `dependencies` |

> better-auth 的版本**刻意對齊 `../vTaiwan-hono/package.json`**——兩站共用同一顆 auth D1，版本落差可能導致 schema 或 session 格式不一致。要升級先確認兩邊一起升。

> **不要改用其他套件管理器**（pnpm／yarn／bun），也**不要**引入 `../vTaiwan-hono` 的 Vite+（`vp`）或 LemmaScript／Dafny——本專案明確選擇維持 npm + vite。日後若要遷移到 `vp`，先與使用者確認。

## 常用指令

```bash
npm install                 # 安裝依賴
npm run dev                 # vite dev：本機跑 Worker（含 HMR）
npm run build               # server build + client bundle build
npm run preview             # 預覽建置結果
npm run typecheck           # tsc --noEmit
npm run cf-typegen          # 由 wrangler 產生 Cloudflare 綁定型別
npm run deploy              # build + wrangler deploy（除非使用者要求，否則不要執行）
```

**CSS**：`npm run css`（Tailwind CLI：`src/styles/app.css` → `public/styles.css`）。`npm run build` 會先跑 css。

**尚未存在**的指令：測試（無 `npm test`、無測試框架）。要新增測試框架，**先說明並取得使用者同意**再動工。

D1 相關（導入後）：

```bash
npx wrangler d1 migrations apply vtaiwan-civic-talks --local    # 本機，預設做法
npx wrangler d1 migrations apply vtaiwan-civic-talks --remote   # 🚫 需先取得使用者授權
```

> **本 repo 沒有、也不該有 auth 資料庫的 migration 指令**（見不變量 11）。`vtaiwan-auth` 的 schema 由 `../vTaiwan-hono` 維護；本機開發若需要 auth 表，請直接跑 `DB_AUTH` 的 `--remote`（🚫 需授權）或請使用者提供本機 seed 方式，**不要**在這裡自己建表。

## 語言與溝通慣例

- **程式碼識別字、技術用語 → 英文**（變數、函式、型別名稱等）。
- **註解、commit 訊息、對使用者的回覆 → 繁體中文**。延續現有 repo 風格。

## 動工前的原則（重要）

- **禁止憑空臆測。** 遇到模糊、不完整或有歧義的指令，先與使用者核對清楚，確認後才動工——不要自行假設需求就開始改。
- 動大結構（切換到 vue-router、導入 Tailwind、建立 D1）或加新工具鏈（測試框架、i18n 套件）前先說明並確認。
- 需要知道舊站行為時，**直接讀 `../civic-talk` 的原始碼**，不要憑印象重寫。

## SSR 架構

現況請求流向（`src/index.ts` → `src/ssr/render.ts`）：

1. Hono 逐條路由比對；未命中的請求交給 `ASSETS` 綁定（對應 `public/`）。`/api/*` 這類純資料端點直接在 Hono 回傳，不走 SSR。
2. `renderPage(component, props, head, options?)`：`createSSRApp(元件, props)` → `renderToString()` → 套上含 `<head>` meta 與 `<div id="app">` 的 HTML 殼。
3. `options.hydrate` 有值時，在 `</body>` 前注入 `<script type="module">`：dev 載入 `devSrc`（Vite 轉譯 TS），prod 載入 `prodSrc`（`public/js/` 下的 bundle）。

切換到 vue-router 後，這條流程會收斂成單一 `createVueApp(url)` 工廠 + 單一 client entry（見「目標架構」）。

### 🚫 SSR 安全（硬性規定）

**任何在 SSR 期間執行的程式碼都不得碰瀏覽器專屬 API**（`window`、`document`、`localStorage`、`navigator`）。

- 需要瀏覽器 API 時，用 `if (typeof window === 'undefined') return` 守衛，或放到 `onMounted` / client-only 流程。
- 語言偏好（`localStorage.civic_lang`）、Polis embed、檔案下載等一律屬於 client-only。
- **登入 session 是例外中的正例**：session 從請求的 `Cookie` 標頭讀（`auth.api.getSession({ headers })`），屬伺服器端 API，**SSR 期間可以用、也應該用**，不要拿 `typeof window` 去「守衛」它。真正 client-only 的是「按下登入按鈕」這類互動（`authClient.signIn.social(...)`）。
- **每請求要用獨立實例**，避免 SSR 跨請求狀態污染。
- SSR 出去的 props 要做安全 escaping，避免使用者投稿內容（素材、意見）造成 XSS 或破壞 HTML 殼。

## 新增一個頁面（核心重複工作）

**現況（每頁 renderPage）：**

1. `src/views/Xxx.vue` — 新頁面元件（`<script setup lang="ts">`）。
2. `src/ssr/heads.ts` — 新增 `headForXxx(origin)`。
3. `src/index.ts` — 接上路由，呼叫 `renderPage(XxxView, props, headForXxx(origin))`。
4. 需要互動時：`src/client/xxx-entry.ts` + `vite.client.config.mts` 加 input，並在 `renderPage` 傳入 `hydrate` 選項。
5. 驗證：`npm run typecheck` + `npm run build`，`npm run dev` 目視。

**切換到 vue-router 之後：** 步驟 3、4 換成「在路由表加一筆（**靜態 import**）」，並同步 i18n 兩個語言檔的 key。

## 驗證流程（改完必做）

每完成一個邏輯完整的子步驟就跑對應檢查——不要等功能全部完成才驗證，累積改動後出錯難以定位。

| 改動類型                     | 必跑檢查                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| 文件（`.md`）                | 核對文中引用的指令／檔案／設定與現實一致                          |
| 元件／頁面（`.vue`）         | `npm run typecheck` + `npm run build`；互動 session 加 `npm run dev` 目視 |
| 新增／修改路由               | `npm run typecheck` + `npm run build`（靜態 import 驗證）+ 手動打一次新舊網址 |
| API / `src/db/`              | `npm run typecheck` + 對本機 D1 逐一 smoke test（CRUD、狀態轉換、admin 驗證、404/400/401） |
| 登入／權限（auth）           | `npm run typecheck` + `npm run build`；互動 session 實測：Google 登入、GitHub 登入、**同 email 兩種 provider 登入後是同一個 `user.id`**、登出、`GET /api/me`、非 admin 打管理端點得 `403`、未登入得 `401`、`/admin` 導向登入。**改完後查 `vtaiwan-auth` 的 `sqlite_master` 確認沒有多出任何表**（不變量 11） |
| migration                    | 先 `--local` 套用，查 `sqlite_master` 確認只新增 `ct_` 表；`--remote` 需授權 |
| 樣式／token                  | 重建 CSS + `npm run build`；互動 session 目視桌機／手機兩種寬度    |
| i18n 檔                      | 人工核對 `zh-TW` / `en` key 集合完全一致                          |
| 依賴／`package.json`         | `npm install` + `npm run typecheck` + `npm run build`             |
| Vite／wrangler 設定          | `npm run typecheck` + `npm run build`                             |

**改完後的完整驗收（依序）：**

1. `npm run typecheck` — 零錯誤。
2. `npm run build` — server + client 都能成功建置。
3. 本機 `npm run dev` 目視（**僅互動 session**）：
   - hydration **無 mismatch 警告**（開 devtools console 檢查）
   - 中英切換、桌機／手機排版、Polis 條件載入、`OPINION.md` 下載
   - 舊網址導向確實生效

> **尚未涵蓋**（需先與使用者確認再動工）：自動化測試（SSR 煙霧測試、連結完整性、i18n key 同步 gate、hydration 一致性）與 CI。目前這些全靠人工驗收——所以驗收步驟不能跳。

## Git / Commit 慣例

- **Conventional Commits + 繁體中文描述**，例如：
  - `feat: 移植議題詳情頁（SSR + hydration）`
  - `fix: 修正語言切換在 SSR 下讀取 localStorage`
  - `chore(deps): 升級 hono`
- 常見前綴：`feat`、`fix`、`chore`、`refactor`、`style`、`docs`。
- 除非使用者明確要求，否則**不要自行 commit / push / deploy**。
- **長程（無人看管）任務例外**：使用者明確授權跑長程任務時，允許在 **feature branch** 上以 Conventional Commits 做 **checkpoint commit**——每完成一個驗證通過（`typecheck` + `build`）的子步驟一筆，方便回溯。仍然 🚫 **禁止 push、禁止直接 commit 到 main、禁止 deploy**。

## 移植基本原則

### 接口整合

舊站分散在「靜態前端 + Pages Functions」的所有接口，全部整合進本專案的單一 Worker。**新專案不得再打舊專案的 Pages Functions 路由。**

### 漸進增強

先確保 SSR 靜態殼可用，再逐步加入動態功能。每次增強單一功能時，都要先盤點並驗證對相關區塊與共用基礎設施的副作用（登入／admin、資料存取、SSR／hydration、路由、共用元件、樣式）——不能只確認新功能可用，卻讓既有功能退化。

### 什麼不搬

- 舊站的 `setup.sh`、`DEPLOY.md`、Pages 專屬部署流程——本專案自行維護。
- 舊版大段手寫版面 CSS——只收斂色彩／字體／響應式規則成 token。
- 有疑問的功能，動工前先問使用者，不臆測。

## 多 repo 工作區

本專案在一個雙 repo 的 VS Code workspace（`civic-talk-hono.code-workspace`），目前掛的是：

- `.`（本專案，civic-talk-hono）
- `../vTaiwan-hono`（#5 的 Better Auth 參考來源）

另有 `../civic-talk`（功能／內容來源，靜態版 Civic Talk）在同一層目錄下，**只是沒掛進 workspace**——要讀舊站行為時直接用路徑開檔即可。

`../vTaiwan-hono` 的**兩種參考強度不同，別混為一談**：

- **工程慣例（SSR 寫法等）＝ 僅參考，不照抄工具鏈**（不引入 Vite+／`vp`／LemmaScript）。
- **Better Auth 登入／權限＝ 要對齊的實作**：#5 明確要求共用同一套 auth DB、user table 與 OAuth 憑證，所以 `createAuth.ts`／`authorization.ts`／auth schema 的形狀要照著來（見「身分驗證與權限」）。相關程式碼在該 repo 的 **`feat/better-auth`** 分支。

要了解舊站行為時，直接讀 `../civic-talk` 對應檔案。

## 移植進度

### 已完成：Vue SSR 複刻（原計畫的六個 todo，計畫檔已於 `f880295` 刪除）

| #   | 項目             | 狀態    | 內容                                                         |
| --- | ---------------- | ------- | ------------------------------------------------------------ |
| 1   | `d1-schema`      | ✅ 完成 | 建立 `vtaiwan-civic-talks`、設定 `DB` 綁定、`ct_` 前綴 migration（本機＋遠端） |
| 2   | `tailwind-shell` | ✅ 完成 | 導入 Tailwind、品牌資產、共用版型與中英 i18n                 |
| 3   | `api-port`       | ✅ 完成 | 把舊 Pages Functions API 移植為 Hono + D1 型別化路由         |
| 4   | `vue-pages`      | ✅ 完成 | 以 Vue SSR/hydration 重建五個頁面及全部互動功能              |
| 5   | `routes-compat`  | ✅ 完成 | 乾淨路由、舊網址導向與 SSR metadata                          |
| 6   | `verify`         | ✅ 完成 | 型別、建置、D1/API、hydration 與響應式驗證                   |

### 進行中：#5 Better Auth 登入與 Admin 權限

分支 **`feat/better-auth`**（issue 內文寫 `feat-better/auth`，但兩個 repo 實際用的都是 `feat/better-auth`，以實際分支為準）。狀態一律以「程式碼是否真的在 repo 裡」為準，**不要憑 commit 訊息或 issue 勾選臆測完成度**。

| #   | 項目               | 狀態      | 內容                                                          |
| --- | ------------------ | --------- | ------------------------------------------------------------- |
| 5-0 | `env-vars`         | ✅ 完成   | `.dev.vars.example` 已備妥 Better Auth／Google／GitHub 變數（commit `cfe56b4`） |
| 5-1 | `better-auth-init` | 📋 未開始 | 安裝 `better-auth`、`createAuth()`、`DB_AUTH` 綁定、`/api/auth/*` |
| 5-2 | `shared-auth-db`   | 📋 未開始 | 綁定 `vtaiwan-auth`、沿用 vTaiwan-hono 的 user table（**不建表**） |
| 5-3 | `google-login`     | 📋 未開始 | Google social provider（同一組 client id／secret）            |
| 5-4 | `github-login`     | 📋 未開始 | GitHub social provider（同一組 client id／secret）            |
| 5-5 | `account-linking`  | 📋 未開始 | 同 email 帳號整合（`trustedProviders: ['google', 'github']`） |
| 5-6 | `role-based-admin` | 📋 未開始 | Admin 改看 `admin`／`super-admin` 角色；移除 `ADMIN_PASSWORD`／`X-Admin-Token`／`POST /api/admin/login`；CORS 一併調整 |
| 5-7 | `verify`           | 📋 未開始 | 依「驗證流程」的「登入／權限」列逐項實測                       |

> 已裁示的設定（不開 `admin` plugin、`account_id` 不寫死、`nodejs_compat` 非必要不加、`BETTER_AUTH_SECRET` 與 vTaiwan-hono 共用）與**仍待確認的兩項**（OAuth callback 網址、`BETTER_AUTH_URL`）見「身分驗證與權限」一節——**callback 網址沒加就不要開始寫 5-3／5-4，會卡在登不進去**。

> 後續可選：切換到 `vue-router` 全站 hydration、自動化測試／CI——動工前先與使用者確認。
