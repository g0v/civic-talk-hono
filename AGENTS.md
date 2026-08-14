# AGENTS.md

給 AI coding agent 的工作指引。本檔聚焦「**agent 該怎麼在這個 repo 工作**」；一般的技術說明與部署步驟請看 [`README.md`](./README.md)。

> ✅ Vue SSR 複刻計畫的六項 todo 已完成。下列「現況」反映移植後的真實結構；「目標架構」中尚未做的項目（例如切換到 `vue-router` 全站 hydration、[#5](https://github.com/g0v/civic-talk-hono/issues/5) 的 Better Auth 登入／權限）仍須先與使用者確認再動工。
>
> 🚀 **已部署於 <https://civic.vtaiwan.tw>**（Worker `civic-talk`，首次部署 2026-08-05）。**Google／GitHub 登入、`admin` 角色進後台、登入後投稿都已在正式站實測成功**（使用者確認 2026-08-11）；需要真人瀏覽器的驗證直接在正式站做，不必只靠 `dev:remote`。部署與環境設定見 [`deploy_notes.md`](./deploy_notes.md)。
>
> 🚧 **仍未實證的兩項**（不要因為「登入可用」就一起勾掉）：同一個 email 用 Google 與 GitHub 登入是否落到同一個 `user.id`（#5 的 5-5）、四種寫入是否都落下完整作者快照且管理端取得完整快照（#9 的 9-8）。逐項完成度一律以「移植進度」的表為準。
>
> [#9「讓使用者必須先登入才能張貼素材」](https://github.com/g0v/civic-talk-hono/issues/9)（分支 `feat/require-login-for-materials`）的程式碼與 D1 migration（本機＋遠端）都已完成——規格見「API 契約 → 投稿與志願者工具需登入」。[#5「使用 Better-Auth 來實作登入和 Admin 功能」](https://github.com/g0v/civic-talk-hono/issues/5)（分支 `feat/better-auth`，已併回 `main`）的程式碼也都在了——「身分驗證與權限」一節是規格。

## 專案目的

把舊的 [`../civic-talk`](../civic-talk)（靜態 HTML + Cloudflare Pages Functions + D1）**整站移植**到本專案，改用 **Hono + Vue 3 SSR/hydration + Tailwind + Cloudflare Workers**。

- **功能／內容來源**：`../civic-talk`（現行站，`public/*.html`、`functions/api/[[route]].js`、`schema.sql`、`public/i18n.js`）。
- **移植藍圖**：原 `.cursor/plans/vue_ssr_複刻_8a18e2ed.plan.md` 已在六項 todo 完成後刪除（commit `f880295`）；**現在的待辦來源是 GitHub issues**，本檔的「移植進度」是它的落地對照。與本檔衝突時**先問使用者**。
- **參考但不照抄**：`../vTaiwan-hono` 的 SSR 寫法與工程慣例可借鏡，但本專案**不**採用它的 LemmaScript／Dafny 工具鏈。**例外**：#5 的 Better Auth 是要「對齊」而非「借鏡」——見「身分驗證與權限」與「多 repo 工作區」。本專案已採用 Vite+（`vp`，issue #24），但**不含** LemmaScript。

## 不可妥協的不變量（Non-negotiable invariants）

違反任何一條就是破壞專案的根本契約。動手前先讀，改完後逐條自查。

1. **所有資料表一律 `ct_` 前綴。** 遠端 D1 `vtaiwan-civic-talks` 位於 vTaiwan 命名空間、可能與其他專案共用，未加前綴的 `issues`／`materials`／`briefings`／`opinions` 會撞名並造成不可逆的資料破壞。所有 DDL、SQL、型別一律只碰 `ct_*`；migration 套用後查 `sqlite_master` 確認只新增 `ct_` 開頭的業務表。
2. **伺服器端絕不呼叫 AI API。** 這是 Civic Talk 的產品層契約：素材彙整與說明頁生成全由志願者用自己的 AI token 完成，平台只負責產出 prompt 與收回結果。任何在 Worker 內接 OpenAI／Anthropic／Gemini 等 API 的作法都不允許——要改這個策略，先與使用者確認。
3. **SSR 路徑絕不碰瀏覽器 API。** 任何在 SSR 期間執行的程式碼（元件 `setup`、模組頂層、共用工廠）不得使用 `window`／`document`／`localStorage`／`navigator`——需要時用 `typeof window === 'undefined'` 守衛或放到 `onMounted`。每請求新建獨立的 app 實例，嚴禁跨請求共享可變狀態。
4. **舊網址永不失效。** 下列舊路徑必須以 301／302 導向新的乾淨路由，且此對應表只能新增、不能刪除：

   | 舊網址                    | 新路由            |
   | ------------------------- | ----------------- |
   | `/index.html`             | `/`               |
   | `/issue.html?id=<n>`      | `/issues/<n>`     |
   | `/contribute.html?id=<n>` | `/contribute/<n>` |
   | `/about.html`             | `/about`          |
   | `/admin.html`             | `/admin`          |

5. **API 相容契約不得片面變更。** 既有 endpoint 的路徑、方法與 JSON 形狀（見「API 契約」）只能擴充、不能改名或改語意。要破壞相容性，先問使用者。
   - **例外（已由 [#5](https://github.com/g0v/civic-talk-hono/issues/5) 授權）：管理端授權方式改為角色制。** 管理權限改看登入使用者的角色是不是 `admin`／`super-admin`（Better Auth session），**不再依賴 `ADMIN_PASSWORD` 環境變數與 `X-Admin-Token` 標頭**。這一項授權**只涵蓋授權機制**：業務 endpoint 的路徑、方法與成功回應形狀照舊，未經授權時回 `401`（未登入）／`403`（已登入但無權限）。
   - **例外（已由 [#9](https://github.com/g0v/civic-talk-hono/issues/9) 與使用者裁示授權）：投稿與志願者工具需要登入。** `POST /api/issues`（建立議題）、`POST /api/issues/:id/materials`（投稿素材）、`POST /api/issues/:id/opinions`（投稿意見）、`POST /api/issues/:id/briefing`（志願者送出彙整／說明頁）及 `GET /api/issues/:id/prompt`（產生志願者 prompt）未登入一律回 `401`——這是既有 endpoint 的語意變更，目的為內容品質與濫用可追溯。**角色一律不看**，任何未停權的登入者都能使用。
6. **機密不進 git。** `.dev.vars` 等憑證只留本地；不寫進任何 tracked 檔案、commit 訊息或 log 輸出。目前涵蓋 `ADMIN_PASSWORD`（將隨 #5 淘汰）、`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_SECRET`、`GITHUB_CLIENT_SECRET` 等。新增設定值時同步更新 `.dev.vars.example`，但只放假值。
7. **遠端 D1 需授權。** migration 預設只套用到本機（`--local`）。套用 `--remote`、建立或刪除資料庫、跑任何會寫入正式資料的指令前，**必須先問使用者**。本專案有兩個 D1 綁定：業務庫 `DB` → `vtaiwan-civic-talks`，共用認證庫 `DB_AUTH` → `vtaiwan-auth`。**本 repo 只對 `DB` 做 migration**；`DB_AUTH` 見不變量 11。
   - ⚠️ **`wrangler d1 migrations apply vtaiwan-auth` 是活陷阱**：`DB_AUTH` 沒寫 `migrations_dir`，但 wrangler 會自動填入預設的 `./migrations`，等於把本專案的 `ct_*` 建表 SQL 套進 vTaiwan 的正式認證庫。🚫 不要跑，詳見 [`deploy_notes.md`](./deploy_notes.md)。
8. **生成物不手改。** `dist/`、`public/js/*.js`（client bundle）、`worker-configuration.d.ts` 皆為建置產物——改源頭重新生成。Tailwind 導入後 `public/styles.css` 也會變成生成物（見「樣式」）。
9. **完成 = 全部綠燈。** `vp check --no-fmt --no-lint` 與 `vp run build` 都過、`vp test` 全部通過，才算改完。紅燈狀態不 commit。
10. **不擅自 commit／push／deploy。** 界線與長程任務例外見「Git / Commit 慣例」。
11. **共用認證資料庫的寫入限於 Better Auth admin plugin 的 ban/unban。** D1 `vtaiwan-auth` 是 `../vTaiwan-hono` 的正式資料庫，本專案是消費端。以下規則更新如下（#21 使用者授權）：
    - 🚫 **不在本 repo 建立 `migrations/auth/`，不對 auth 資料表下任何 DDL**——schema 唯一來源是 `../vTaiwan-hono/migrations/auth/`。
    - ✅ **允許透過 Better Auth admin plugin API（`auth.api.banUser` / `auth.api.unbanUser`）寫入 DB_AUTH**，用於濫用回報審核。**不走原始 SQL**——所有寫入必須經過 Better Auth 的授權檢查（呼叫端必須帶管理員 session headers）。
    - 🚫 **不寫 `user.role`**——升降權、成員列表、變更日誌仍全部留在 vTaiwan-hono。
    - 🚫 **不執行其他自訂 SQL 操作 DB_AUTH**（INSERT、UPDATE、DELETE 以外 ban/unban 的一切都不行）。

## 現況（今天 repo 裡真的有什麼）

Civic Talk 已以 **每頁 `renderPage` + 單一 client bundle hydration** 跑起來（尚未切到 `vue-router`）：

- `src/index.ts` — 乾淨路由 `/`、`/issues/:id`、`/issues/:id/source/:materialId`、`/issues/:id/comment/:opinionId`、`/contribute/:id`、`/about`、`/admin`；舊 `.html` 導向；掛上 `registerApiRoutes`；fallback `ASSETS`。
- `src/api/routes.ts` + `src/db/queries.ts` — 舊 Pages Functions API 的型別化移植，SQL 只碰 `ct_*`。
- `migrations/0001_init.sql` — `ct_issues`／`ct_materials`／`ct_briefings`／`ct_opinions`（含 FK、索引、約束、示範資料）。
- `migrations/0002_material_author.sql` — `ct_materials` 加上 `author_id`／`author_name`（#9 的投稿者記錄）。本機與遠端皆已套用；#27 起 name 公開、ID 仍只給管理端。
- `migrations/0003_issue_opinion_author.sql` — `ct_issues` 與 `ct_opinions` 也加上 `author_id`／`author_name`。本機與遠端皆已套用；公開規則同上。
- `migrations/0004_briefing_author.sql` — `ct_briefings` 加上 `author_id`（志願者送出 briefing 的帳號）。本機與遠端皆已套用；公開顯示規則同其他內容。
- `migrations/0005_author_email.sql` — 四種內容補齊投稿當下的作者快照；`author_email` 一律保存，`show_email`（0／1）只控制前台是否公開。本機與遠端皆已套用。遠端先前另有舊檔名 `0004_author_email.sql`（只加三表 `author_email`），因此遠端是補齊 `show_email` 與 briefing 快照後再標記 0005 已套用。
- `migrations/0006_submission_consent.sql` — 議題、素材與意見保存伺服器端確認的 `terms_version`／`terms_accepted_at`。本機與遠端皆已套用。
- `src/ssr/render.ts` — SSR + 注入 `window.__PAGE__`／`__SSR_STATE__` + `/js/civic.js`（dev 走 `/src/client/civic-entry.ts`）。
- `src/views/` — `Home`／`Issue`／`Contribute`／`About`／`Admin`／`MaterialDetail`／`OpinionDetail`；共用 `AppHeader`／`AppFooter`／`StatusBadge`／`IssueCard`／`Toast`。
- `src/composables/useAuth.ts` — 全站共用的登入狀態（`authState`／`session`／`ensureAuthSession`／`signOutAndReload`）。模組層級的 ref，同一頁的 `AppHeader` 與表單共用同一次 `/api/me`；**只在瀏覽器端寫入**（`ensureAuthSession()` 開頭擋掉 SSR），所以 SSR 永遠是 `'loading'`。
- `src/components/SignInButtons.vue` — Google／GitHub 登入鈕（`/`、`/issues/:id`、`/contribute/:id`、`/admin` 與 `AppHeader` 共用）。
- `src/l10n/` — 自製 i18n composable（`zh-TW`／`en` 雙檔 key 同步）；SSR 固定 `zh-TW`，`localStorage.civic_lang` 只在 hydration 後讀寫。
- `src/styles/app.css` — Tailwind v4 `@theme static`（vTaiwan 色彩、字型、字級、間距、圓角、陰影與動效 token）；`vp run css` 產出 `public/styles.css`（**生成物，勿手改**）。
- `wrangler.jsonc` — `ASSETS` + D1 `DB` → `vtaiwan-civic-talks` + D1 `DB_AUTH` → `vtaiwan-auth`（兩者都標 `remote: true`，只影響本機開發模式）；`compatibility_flags: ["nodejs_compat"]`。**不寫 `account_id`**（與 `../vTaiwan-hono` 一致，由 wrangler 登入的帳號決定）——不要為了「比較保險」把它加回來。
- `src/auth/` — `createAuth.ts`（Better Auth 實例：Google／GitHub provider、同 email accountLinking、**不開 admin plugin**、以 `additionalFields` 唯讀取 `role`）與 `authorization.ts`（`AppRole`／`resolveRole`／`isAdminRole`／`getAuthContext`／`tryGetAuthContext`）。
- `src/api/auth.ts` — `/api/auth/*` 轉交 `auth.handler()`、`/api/me` 回登入者；`/api/auth/admin/*` 一律 404。
- `src/api/types.ts` — `AppBindings`／`App` 型別（原本在 `routes.ts`，抽出來避免 auth 與 routes 互相 import）。

**登入／權限的真實現況（#5 做到哪）：**

- ✅ **Better Auth 骨架已可運作**：`/api/auth/get-session` 回 200、`/api/me` 未登入回 401、`/api/auth/admin/list-users` 回 404。
- ✅ **管理端已是角色制**：`src/api/routes.ts` 的 `requireAdmin()` 讀 session 判 `isAdminRole()`，未登入 401、非管理員 403。**`ADMIN_PASSWORD`、`X-Admin-Token`、`checkAdmin()`、`POST /api/admin/login` 都已移除**（連同 `'admin'` 這個危險的 fallback）。
- ✅ **`/admin` 是登入入口**：`src/views/Admin.vue` 依 `/api/me` 分成 `loading`／`anonymous`（Google／GitHub 登入鈕）／`forbidden`（登入了但沒權限）／`admin` 四態。SSR 一律只出 `loading` 骨架，所以不會有 hydration mismatch，也不需要為登入狀態關快取。
- ⚠️ **本機 `vp run dev` 測不了登入**：auth 表只存在遠端，本機模擬庫是空的，打登入端點會得到 `no such table: verification`。要實測登入必須 `vp run dev:remote`。
- ✅ **三個投稿入口都是登入牆（#9）**：`/contribute/:id` 的素材表單、`/` 的建立議題表單、`/issues/:id` 意見分頁的投稿框，都依 `useAuth()` 分成 `loading`／`anonymous`（`SignInButtons`）／`signed-in` 三態，SSR 一律只出 `loading` 骨架。
- ✅ **全站標頭顯示登入狀態**：`AppHeader` 已登入時出「已登入：{name}」＋登出，未登入時出「登入」鈕（展開內嵌的 provider 面板，登入後導回當前頁）。`authState === 'loading'` 時什麼都不畫——伺服器端不猜登入狀態，所以不會 mismatch。

**尚不存在**：`vue-router`、`vue-i18n` 套件、CI。已有自動化測試（`src/tests/`，`vp test` 執行）。

**部署身分（已部署，別再當成未知）**：

- **已部署於 <https://civic.vtaiwan.tw>**（Worker 名稱 `civic-talk`，首次部署 2026-08-05）。`package.json` 與 `wrangler.jsonc` 的 `name` 就是 `civic-talk`，撞名疑慮已由實際部署解消——**不要**再把「首次部署前要確認撞名」當成待辦。要改名或改網域綁定前先問使用者（Cloudflare 帳號內 Workers 與 Pages 共用同一份名稱清單）。
- **正式網域不在 `wrangler.jsonc` 裡**（沒有 `routes`／`custom_domain`），所以讀設定檔看不出正式網址；要動網域綁定先確認它現在是怎麼綁的，不要憑猜測改設定檔。詳見 [`deploy_notes.md`](./deploy_notes.md)。
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

| 檔案                                                                   | 作用                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `../vTaiwan-hono/src/server/lib/createAuth.ts`                         | `betterAuth()` 設定：D1 database、socialProviders、accountLinking、admin plugin 與角色表 |
| `../vTaiwan-hono/src/server/lib/authorization.ts`                      | `AppRole`／`resolveRole()`／`isAdminRole()`／`getAuthContext()`                          |
| `../vTaiwan-hono/src/api/auth.ts`                                      | `GET`／`POST` `/api/auth/*` 交給 `auth.handler()`、`GET /api/me`                         |
| `../vTaiwan-hono/src/client/authClient.ts`                             | client 端 `createAuthClient()`，角色表須與 server 對齊                                   |
| `../vTaiwan-hono/src/client/auth-session.ts`                           | `loadAuthSession()`／`isAdminSession()` 等前端判定                                       |
| `../vTaiwan-hono/migrations/auth/20260727_init_better_auth_tables.sql` | auth schema 的唯一來源（**本 repo 不複製、不套用**，見不變量 11）                        |

**要做的（對應 #5 的 checkbox）：**

- **共用 auth DB**：`wrangler.jsonc` 新增第二個 D1 綁定 `DB_AUTH` → `vtaiwan-auth`（`database_id: e26edd14-d163-427d-8630-9304f815e9fa`，與 vTaiwan-hono 同一顆），`betterAuth({ database: env.DB_AUTH })`。使用者表就是 vTaiwan 的 `user` 表，兩站帳號天然共通。
- **Google 登入**：沿用**同一組** `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`。
- **GitHub 登入**：沿用**同一組** `GITHUB_CLIENT_ID`／`GITHUB_CLIENT_SECRET`。
- **同 email 帳號整合**：照抄 vTaiwan-hono 的 `account.accountLinking.trustedProviders: ['google', 'github']`——同一個 email 用 Google 或 GitHub 登入都落到同一個 `user`。
- **角色制 Admin**：角色沿用 vTaiwan 的 `user`／`admin`／`super-admin`（欄位就是 `user.role`）。Admin 頁與管理 API 一律用 `isAdminRole()`（`admin` 或 `super-admin`）把關。**本站只讀角色、不寫角色**。
  - ✅ **開 `admin` plugin 用於濫用審核（#21，使用者裁示）。** `createAuth.ts` 以 `adminRoles: ['super-admin', 'admin']` 與 vTaiwan-hono 一致的 `adminRoleAccess` 啟用 plugin。停權操作走 **server 端 `createAuth(env).api.banUser()`**（程式呼叫），**不經 HTTP 路由**。
  - ⚠️ **`/api/auth/admin/*` HTTP 端點整段封鎖（不維護黑名單）。** `auth.ts` 以一條 `app.all('/api/auth/admin/*', 404)` 擋掉全部——包含 `create-user`、`set-user-password`、`update-user`、`list-users`、`list-user-sessions` 等現有及未來新增的端點。server 端程式呼叫不走 Hono 路由，照常運作。**不得改為選擇性黑名單**——better-auth 每次改版都可能新增端點，黑名單必然落後。日後若要開放任何 HTTP 端點，必須先問使用者。
  - **改用唯讀方式取 `role`** 這段仍有效：`additionalFields` 讀 `role`、`banned`、`banReason`、`banExpires`，本站只讀不直接寫這些欄位——寫入走 admin plugin API，不走自訂 SQL。
- ✅ **淘汰密碼制（已完成）**：`checkAdmin()`／`X-Admin-Token`／`ADMIN_PASSWORD`（含 `'admin'` fallback）與 `POST /api/admin/login` 都已移除，`src/views/Admin.vue` 的密碼輸入換成 Google／GitHub 登入。

**明確不做的：**

- 🚫 **不做權限管理後台**（升降權、停權、成員列表、變更日誌）——留給 vTaiwan-hono。本站只讀角色。
- 🚫 **不做二次驗證（step-up）**。vTaiwan-hono 有 `step-up.ts`／`StepUpAuth.vue`／`admin_audit_log`，那是它管理成員資料的需求；#5 沒有要求，**不要順手移植**。要加先問使用者。
- 🚫 **不自建 email／密碼登入**——只做 Google 與 GitHub 兩個 social provider。

**已裁示的設定（使用者已決定，照做即可，不要再自行更動）：**

| 項目                 | 決定                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin` plugin       | 🚫 **不開**（見上一節）                                                                                                                                                         |
| `account_id`         | **兩邊都不寫死**——本專案已移除 `wrangler.jsonc` 的 `account_id`，與 `../vTaiwan-hono` 一致，由 wrangler 登入的帳號決定                                                          |
| Cloudflare 帳號      | 兩專案是**同一個帳號**（所以綁得到 `vtaiwan-auth`），但**不靠設定檔寫死來保證**——`wrangler whoami` 選錯帳號就會綁不到，遇到錯誤先查這個                                         |
| `nodejs_compat`      | ✅ **已加（實測必要）**——better-auth 直接 import `node:crypto` 與 `node:async_hooks`，沒有這個 flag 連 dev server 都起不來。改 `wrangler.jsonc` 後記得 `vp exec wrangler types` |
| `BETTER_AUTH_SECRET` | **與 vTaiwan-hono 共用同一個值**（仍只放 `.dev.vars`／Cloudflare secret，不進 git——不變量 6）                                                                                   |

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

| 方法     | 路徑                        | 說明                                                                                   |
| -------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `GET`    | `/api/issues`               | 議題列表                                                                               |
| `POST`   | `/api/issues`               | 新增議題（**需登入**，#9 延伸）                                                        |
| `GET`    | `/api/issues/:id`           | 議題詳情                                                                               |
| `PUT`    | `/api/issues/:id`           | 編輯議題（admin）                                                                      |
| `DELETE` | `/api/issues/:id`           | 刪除議題（admin，級聯刪 materials/briefings/opinions）                                 |
| `GET`    | `/api/issues/:id/materials` | 素材列表（公開顯示 `author_name`，email 僅依 opt-in 顯示；管理員另拿完整作者快照）     |
| `POST`   | `/api/issues/:id/materials` | 投稿素材（**需登入**，#9；`collecting` → `summarizing` 狀態轉換）                      |
| `DELETE` | `/api/materials/:id`        | 刪除素材（admin）                                                                      |
| `GET`    | `/api/issues/:id/briefing`  | 取得說明頁（公開顯示 `author_name`，email 僅依 opt-in；管理員另拿完整作者快照） |
| `POST`   | `/api/issues/:id/briefing`  | 新增說明頁（**需登入**；版本遞增；→ `published`）                                      |
| `PUT`    | `/api/issues/:id/briefing`  | 編輯說明頁（admin）                                                                    |
| `GET`    | `/api/issues/:id/opinions`  | 意見列表                                                                               |
| `POST`   | `/api/issues/:id/opinions`  | 投稿意見（**需登入**，#9 延伸）                                                        |
| `DELETE` | `/api/opinions/:id`         | 刪除意見（admin）                                                                      |
| `GET`    | `/api/issues/:id/prompt`    | 產生 prompt（**需登入**），`?type=summarize\|narrative\|synthesis`（預設 `summarize`） |
| `GET`    | `/api/admin/stats`          | 管理統計                                                                               |

> `POST /api/admin/login`（以 `ADMIN_PASSWORD` 換 token）**已於 #5 移除**——這是不變量 5 明列的授權例外。舊網址不必保留：它從來只是管理員自己用的登入端點，不是公開契約。

- 統一 JSON 錯誤形狀 `{ error: string }`，並補齊輸入驗證與 `400` / `401` / `404` 回應。
- 議題狀態機（**照舊站語意，不要收得更嚴**）：POST material 把 `collecting` 推到 `summarizing`；POST briefing 從 `collecting` **或** `summarizing` 直接推到 `published`——也就是說 `collecting` → `published` 是合法的，可跳過 `summarizing`。素材立場預設 `unknown`。

### 授權方式（#5 帶來的變更）

✅ **已完成。** 管理端驗 **Better Auth session 的角色**：上表標示 `（admin）` 的 endpoint 與 `/api/admin/stats` 一律走 `src/api/routes.ts` 的 `requireAdmin()`，要求 `isAdminRole()`（`admin` 或 `super-admin`）。舊的 `X-Admin-Token`／`ADMIN_PASSWORD` 已完全移除。

### 投稿與志願者工具需登入（#9 與使用者裁示帶來的變更）

✅ **已完成。** `POST /api/issues`、`POST /api/issues/:id/materials`、`POST /api/issues/:id/opinions`、`POST /api/issues/:id/briefing` 與 `GET /api/issues/:id/prompt` 都走 `src/api/routes.ts` 的 `requireUser()`：**只看有沒有登入，不看角色**（一般 `user` 就能使用）。未登入回 `401`；停權帳號回 `403`。四種寫入都保存投稿當下的完整作者快照。

- **完整作者快照**：`ct_issues`、`ct_materials`、`ct_opinions`、`ct_briefings` 最終都有 `author_id`、`author_name`、`author_email`、`show_email`。`author_id` 是 Better Auth `user.id`；name／email 是投稿當下快照，不隨帳號日後更新。`author_name` 缺漏時一律為 `NULL`，**禁止退回 email**，否則會繞過 email opt-in。
- **儲存與公開分離**：`author_email` 無論使用者是否 opt-in 都保存，供管理端追溯；`show_email INTEGER NOT NULL DEFAULT 0 CHECK (show_email IN (0, 1))` 才是公開同意。建立議題、投稿素材與意見的 API 只接受 boolean `show_email`，並要求 `terms_accepted === true`；兩者都由伺服器端驗證，不能只靠 checkbox。驗證通過後由伺服器寫入 `TERMS_VERSION` 與 `CURRENT_TIMESTAMP`，不採信 client 自報的版本或時間。

- **公開投影（#27 使用者已裁示）**：議題、素材、意見與說明頁公開顯示 `author_name`；公開 SQL 只能用 `CASE WHEN show_email = 1 THEN author_email ELSE NULL END AS author_email`，且不得回傳 `author_id`／`show_email`。`getIssueDetail()` 與獨立詳情頁都會進 SSR state，因此一律列舉公開欄位、禁止 `SELECT *`。管理端 `list*WithAuthor()`／`getLatestBriefingWithAuthor()` 才可取得完整快照；管理員版本標示 `Vary: Cookie`。
- **需登入之前的舊資料** `author_*` 是 `NULL`，不回填；管理端顯示為「需登入之前的舊資料」。
- 前端三處都是同一套三態（`loading`／`anonymous`／`signed-in`）：`/contribute/:id` 的素材表單、`/` 的建立議題表單、`/issues/:id` 意見分頁的投稿框。SSR 一律只出 `loading` 骨架，避免 hydration mismatch。
- **送出時遇 `401` 不要把 `authState` 切回 `anonymous`**——那會把表單換成登入卡片、吃掉使用者剛打的內容。三處都改用獨立的 `sessionExpired` 旗標：表單留在原地，只在上方補一列重新登入與「先複製你打的內容」提示（共用 key `login_expired_toast`／`login_expired_hint`）。
- **守門在伺服器端**——登入、停權、條款同意與 `show_email` 型別都由 API 驗證；前端隱藏表單與 checkbox 只是體驗，不是防線。

| 方法          | 路徑          | 說明                                                                             |
| ------------- | ------------- | -------------------------------------------------------------------------------- |
| `GET`／`POST` | `/api/auth/*` | Better Auth 內建端點（登入、callback、登出、session）；整段交給 `auth.handler()` |
| `GET`         | `/api/me`     | 回傳目前登入者 `{ user, role }`；未登入回 `401`                                  |

- 回應碼語意：**未登入 `401`、已登入但角色不足 `403`**（現行程式碼只有 `401`，改的時候要補 `403`）。
- **`/api/me` 只回 `role`，不要複製 vTaiwan 的 `permissions`。** vTaiwan-hono 的 `Permission` 詞彙是 `meeting.join`／`meeting.moderate`／`transcription.update`／`topic.manage`——全是它的業務語彙，搬過來只會是四個永遠用不到的字串。Civic Talk 一律用 `isAdminRole()` 判角色；真的需要更細的權限模型，**先問使用者**再定義本站自己的詞彙。
- **`/api/auth/admin/*` 是 `/api/auth/*` 整段轉交的唯一例外**——見「身分驗證與權限」的角色制 Admin 條目。
- **`POST /api/admin/login` 廢除**：改角色制後這支沒有意義。**不要靜默移除**——同一批改動裡把 `src/views/Admin.vue` 的密碼登入 UI 一併換掉，確認前端不再呼叫後才刪路由；`ADMIN_PASSWORD` 與 `checkAdmin()` 同批清乾淨，別留半套（一半看 token、一半看角色）的授權路徑。
- **CORS 要跟著改**：現行 `src/api/routes.ts` 是 `Access-Control-Allow-Origin: '*'` + `Allow-Headers: 'Content-Type, X-Admin-Token'`。session 走 **cookie**，跨來源要帶 cookie 就必須 `Access-Control-Allow-Credentials: true`，而**帶 credentials 時 `Allow-Origin` 不得為 `*`**——必須回具體 origin。改法（先問使用者選哪一種）：
  1. **管理端不開放跨來源**（建議）：`/api/auth/*`、`/api/me` 與管理端點不掛 CORS，只有公開讀取端點維持 `*`；或
  2. 維持跨來源：改成 allowlist 回具體 origin + `Allow-Credentials: true`。
     無論哪種，`X-Admin-Token` 都要從 `Allow-Headers` 移除。

## 技術棧與工具鏈

**Hono + Vue 3 SSR + Cloudflare Workers**，套件安裝走 **npm**，開發指令走 **vp**（Vite Plus CLI）。

| 工具                    | 版本                         | 鎖定位置                        |
| ----------------------- | ---------------------------- | ------------------------------- |
| Hono                    | ^4.12                        | `dependencies`                  |
| Vue                     | ^3.5                         | `dependencies`                  |
| TypeScript              | ^5.6                         | `devDependencies`               |
| Vite Plus (`vp`)        | 0.2.4                        | `devDependencies`               |
| vite-plus-core          | 0.2.4（`vite` 的 npm alias） | `devDependencies` + `overrides` |
| Wrangler                | ^4.83                        | `devDependencies`               |
| @cloudflare/vite-plugin | ^1.32                        | `devDependencies`               |
| better-auth             | ^1.6.25                      | `dependencies`                  |

> better-auth 的版本**刻意對齊 `../vTaiwan-hono/package.json`**——兩站共用同一顆 auth D1，版本落差可能導致 schema 或 session 格式不一致。要升級先確認兩邊一起升。

> **不要改用其他套件管理器**（pnpm／yarn／bun），也**不要**引入 LemmaScript／Dafny——本專案採用 Vite+（`vp`）但**不含** LemmaScript。

## 常用指令

```bash
npm install                         # 安裝依賴（套件管理仍走 npm）
vp run dev                          # 先建置 CSS 再啟動開發伺服器，D1 用本機模擬
vp run dev:remote                   # 先建置 CSS 再連遠端 D1；實測登入只能用這個
vp run css:watch                    # 只監看 Tailwind CSS（dev 期間需另開終端機）
vp run build                        # CSS + client bundle + server bundle
vp preview                          # 預覽建置結果
vp check --no-fmt --no-lint         # tsc 型別檢查
vp test                             # Vitest（src/tests/**/*.test.ts）
vp check                            # fmt + lint + typecheck 全開
vp fmt                              # oxfmt 格式化
vp exec wrangler types              # 產生 Cloudflare 綁定型別
vp run deploy                       # build + wrangler deploy（除非使用者要求，否則不要執行）
```

**CSS**：`vp run css`（Tailwind CLI：`src/styles/app.css` → `public/styles.css`）。`vp run dev` 在啟動伺服器前先跑一次 CSS 建置，**不**自動 watch；需要邊改 CSS 邊看效果時，另開終端機跑 `vp run css:watch`。`vp run build` 依序產出 CSS、client bundle，再建 server，避免 server build 收到舊的 `public/js/civic.js`。

**測試**：`vp test` 跑 `src/tests/**/*.test.ts`，目前涵蓋 i18n key 同步（`l10n.test.ts`）。新測試放進 `src/tests/`，從 `vite-plus/test` import `describe`／`it`／`expect`。

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
- 動大結構（切換到 vue-router、導入 Tailwind、建立 D1）或加新工具鏈（i18n 套件等）前先說明並確認。
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
5. 驗證：`vp check --no-fmt --no-lint` + `vp test` + `vp run build`，`vp run dev` 目視。

**切換到 vue-router 之後：** 步驟 3、4 換成「在路由表加一筆（**靜態 import**）」，並同步 i18n 兩個語言檔的 key。

## 驗證流程（改完必做）

每完成一個邏輯完整的子步驟就跑對應檢查——不要等功能全部完成才驗證，累積改動後出錯難以定位。

| 改動類型             | 必跑檢查                                                                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件（`.md`）        | 核對文中引用的指令／檔案／設定與現實一致                                                                                                                                                                                                                                                                              |
| 元件／頁面（`.vue`） | `vp check --no-fmt --no-lint` + `vp run build`；互動 session 加 `vp run dev` 目視                                                                                                                                                                                                                                     |
| 新增／修改路由       | `vp check --no-fmt --no-lint` + `vp run build`（靜態 import 驗證）+ 手動打一次新舊網址                                                                                                                                                                                                                                |
| API / `src/db/`      | `vp check --no-fmt --no-lint` + 對本機 D1 逐一 smoke test（CRUD、狀態轉換、admin 驗證、404/400/401）                                                                                                                                                                                                                  |
| 登入／權限（auth）   | `vp check --no-fmt --no-lint` + `vp run build`；互動 session 實測：Google 登入、GitHub 登入、**同 email 兩種 provider 登入後是同一個 `user.id`**、登出、`GET /api/me`、非 admin 打管理端點得 `403`、未登入得 `401`、`/admin` 導向登入。**改完後查 `vtaiwan-auth` 的 `sqlite_master` 確認沒有多出任何表**（不變量 11） |
| migration            | 先 `--local` 套用，查 `sqlite_master` 確認只新增 `ct_` 表；`--remote` 需授權                                                                                                                                                                                                                                          |
| 樣式／token          | `vp run css` + `vp run build`；互動 session 目視桌機／手機兩種寬度                                                                                                                                                                                                                                                    |
| i18n 檔              | `vp test`（l10n.test.ts 自動驗 key 同步）+ 人工核對值翻譯正確                                                                                                                                                                                                                                                         |
| 依賴／`package.json` | `npm install` + `vp check --no-fmt --no-lint` + `vp run build`                                                                                                                                                                                                                                                        |
| Vite／wrangler 設定  | `vp check --no-fmt --no-lint` + `vp run build`                                                                                                                                                                                                                                                                        |

**改完後的完整驗收（依序）：**

1. `vp check --no-fmt --no-lint` — 零錯誤。
2. `vp test` — 全部通過。
3. `vp run build` — server + client 都能成功建置。
4. 本機 `vp run dev` 目視（**僅互動 session**）：
   - hydration **無 mismatch 警告**（開 devtools console 檢查）
   - 中英切換、桌機／手機排版、Polis 條件載入、`OPINION.md` 下載
   - 舊網址導向確實生效

> **尚未涵蓋**（需先與使用者確認再動工）：SSR 煙霧測試、連結完整性、hydration 一致性。i18n key 同步已由 `l10n.test.ts` 自動化。CI 仍未建立——驗收步驟不能跳。

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

- **工程慣例（SSR 寫法等）＝ 僅參考**；Vite+（`vp`）工具鏈本專案已採用（issue #24），**不含** LemmaScript。
- **Better Auth 登入／權限＝ 要對齊的實作**：#5 明確要求共用同一套 auth DB、user table 與 OAuth 憑證，所以 `createAuth.ts`／`authorization.ts`／auth schema 的形狀要照著來（見「身分驗證與權限」）。相關程式碼在該 repo 的 **`feat/better-auth`** 分支。

要了解舊站行為時，直接讀 `../civic-talk` 對應檔案。

## 移植進度

### 已完成：Vue SSR 複刻（原計畫的六個 todo，計畫檔已於 `f880295` 刪除）

| #   | 項目             | 狀態    | 內容                                                                           |
| --- | ---------------- | ------- | ------------------------------------------------------------------------------ |
| 1   | `d1-schema`      | ✅ 完成 | 建立 `vtaiwan-civic-talks`、設定 `DB` 綁定、`ct_` 前綴 migration（本機＋遠端） |
| 2   | `tailwind-shell` | ✅ 完成 | 導入 Tailwind、品牌資產、共用版型與中英 i18n                                   |
| 3   | `api-port`       | ✅ 完成 | 把舊 Pages Functions API 移植為 Hono + D1 型別化路由                           |
| 4   | `vue-pages`      | ✅ 完成 | 以 Vue SSR/hydration 重建五個頁面及全部互動功能                                |
| 5   | `routes-compat`  | ✅ 完成 | 乾淨路由、舊網址導向與 SSR metadata                                            |
| 6   | `verify`         | ✅ 完成 | 型別、建置、D1/API、hydration 與響應式驗證                                     |

### 進行中：#5 Better Auth 登入與 Admin 權限

分支 **`feat/better-auth`**（issue 內文寫 `feat-better/auth`，但兩個 repo 實際用的都是 `feat/better-auth`，以實際分支為準）。狀態一律以「程式碼是否真的在 repo 裡」為準，**不要憑 commit 訊息或 issue 勾選臆測完成度**。

| #   | 項目               | 狀態               | 內容                                                                                                                                                                                                          |
| --- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5-0 | `env-vars`         | ✅ 完成            | `.dev.vars.example` 已備妥 Better Auth／Google／GitHub 變數（commit `cfe56b4`）                                                                                                                               |
| 5-1 | `better-auth-init` | ✅ 完成            | `better-auth` ^1.6.25、`src/auth/`、`/api/auth/*`＋`/api/me`、`nodejs_compat`、`dev:remote`。dev server 起得來，路由煙霧測試過                                                                                |
| 5-2 | `shared-auth-db`   | ✅ 完成            | `DB_AUTH` → `vtaiwan-auth`（`remote: true`，無 `migrations_dir`）；**沿用既有 user table，本 repo 不建表**                                                                                                    |
| 5-3 | `google-login`     | ✅ 完成            | provider 已設定；**正式站端到端登入已實測成功**（使用者確認 2026-08-11）                                                                                                                                      |
| 5-4 | `github-login`     | ✅ 完成            | 同上，正式站已實測成功                                                                                                                                                                                        |
| 5-5 | `account-linking`  | 🚧 code 進、待實測 | `trustedProviders: ['google', 'github']` 已設；兩個 provider 各自都能登入，但**「同一個 email 落到同一個 `user.id`」仍未實證**（要在正式站用同 email 兩種方式登入並比對帳號）                                 |
| 5-6 | `role-based-admin` | ✅ 完成            | `requireAdmin()` 判角色（401／403）；`ADMIN_PASSWORD`／`X-Admin-Token`／`POST /api/admin/login` 全數移除；CORS 拿掉 `X-Admin-Token` 且不給 `Allow-Credentials`；Admin 頁改 Google／GitHub 登入；i18n 雙檔同步 |
| 5-7 | `verify`           | 🚧 幾乎完成        | 已驗：未登入打管理端點 401、`/api/admin/login` 404、公開端點不受影響、`/admin` SSR 無 mismatch；**正式站 Google／GitHub 登入成功、`admin` 角色進得了後台**（2026-08-11）。**尚未驗**：同 email 帳號整合（見 5-5） |

> 已裁示的設定（不開 `admin` plugin、`account_id` 不寫死、`nodejs_compat` 實測必要、`BETTER_AUTH_SECRET` 與 vTaiwan-hono 共用）見「身分驗證與權限」一節。OAuth callback 網址與 `BETTER_AUTH_URL` 在本機與正式站都已設好（登入實測通過即為證明）；**換網域或建新環境時這兩項要重設**，做法見 [`deploy_notes.md`](./deploy_notes.md)。

### 進行中：#9 素材投稿需登入

分支 **`feat/require-login-for-materials`**。規格見「API 契約 → 素材投稿需登入（#9 帶來的變更）」。

| #   | 項目                   | 狀態          | 內容                                                                                                                                                                                                                                                                                               |
| --- | ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9-1 | `migration`            | ✅ 完成       | `migrations/0002_material_author.sql`（`ct_materials` 加 `author_id`／`author_name` 與索引）。本機＋遠端皆已套用（遠端已取得使用者授權），套用後查過 `sqlite_master`：沒有新增任何表                                                                                                               |
| 9-2 | `api-gate`             | ✅ 完成       | `requireUser()`；`POST /api/issues/:id/materials` 未登入 401；投稿寫入 `author_id`／`author_name`                                                                                                                                                                                                  |
| 9-3 | `author-privacy`       | ✅ 完成       | `listMaterials()` 改列舉公開欄位（不再 `SELECT *`）；`listMaterialsWithAuthor()` 只給管理員；管理端素材卡顯示投稿者                                                                                                                                                                                |
| 9-4 | `contribute-ui`        | ✅ 完成       | `Contribute.vue` 三態登入牆；抽出共用 `SignInButtons.vue`；i18n 雙檔同步（新增 `login_*`／`logout`／`contrib_login_*`／`adm_mat_author*`，移除被取代的 `adm_login_google`／`adm_login_github`／`adm_login_err`／`adm_logout`）                                                                     |
| 9-5 | `issues-opinions-gate` | ✅ 完成       | 使用者裁示的延伸：`POST /api/issues` 與 `POST /api/issues/:id/opinions` 也走 `requireUser()`；`Home.vue` 建立議題表單與 `Issue.vue` 意見投稿框同樣三態登入牆；過期提示改用共用 key                                                                                                                 |
| 9-6 | `author-everywhere`    | ✅ 完成       | `migrations/0003_issue_opinion_author.sql`：`ct_issues`／`ct_opinions` 也記錄作者；`listIssuesWithAuthor()`／`listOpinionsWithAuthor()` 只給管理員；`getIssue()` 一併改成列舉欄位（原本 `SELECT *` 會漏進 SSR state）；Admin 議題表格加「建立者」欄、意見卡顯示投稿者                              |
| 9-7 | `header-auth-ui`       | ✅ 完成       | `src/composables/useAuth.ts` 全站共用登入狀態（一頁只打一次 `/api/me`）；`AppHeader` 顯示「已登入：{name}」／登出／登入面板；`Home`／`Issue`／`Contribute`／`Admin` 四頁改用同一個 composable，Admin 的 `forbidden` 從共用 session 推導                                                            |
| 9-8 | `verify`               | 🚧 幾乎完成   | 遠端 migration `0002`–`0006` 皆已套用。已驗未登入守門；#27 後公開回應改為顯示 `author_name` 與 opt-in email，但仍不得含 `author_id`／`show_email` 或未同意公開的 email。**正式站已實測：登入後投稿成功且顯示投稿者**（2026-08-11）。**尚未逐項驗**：四種寫入（含說明頁）都落下完整快照、管理端取得完整快照。 |

> **migration 與程式碼是綁在一起的**：`createMaterial()`／`createIssue()`／`createOpinion()` 都會寫 `author_id`，所以遠端 migration 必須先於部署，否則每次寫入都會 runtime error（`no such column: author_id`）。`0002` 與 `0003` 都已於 2026-08-04 套用到遠端（經使用者授權，套用後查過 `sqlite_master` 沒有新增任何表）。日後若有人重建遠端資料庫，記得這條順序仍然成立。

### 進行中：#27 具名提交與 email opt-in

- `migrations/0005_author_email.sql` 讓四種內容都有完整作者快照；0004／0005／0006 本機與遠端皆已套用。
- `migrations/0006_submission_consent.sql` 保存三類具名投稿接受的條款版本與時間；版本常數在 `src/legal/terms.ts`，修改條款時必須同步更新。
- 公開頁面固定顯示投稿當下的 `author_name`，email 只有該筆內容的 `show_email = 1` 才顯示；名稱缺漏時不以 email 代替。
- 公開 SQL 直接遮蔽未 opt-in email，並排除 `author_id`／`show_email`；管理端才取得完整快照。
- 三個投稿 API 要求 `terms_accepted === true` 且嚴格驗證 `show_email` 為 boolean；版本與同意時間由伺服器寫入。
- `/privacy`、`/terms` 已說明快照、公開選擇及帳號刪除不會自動清除跨資料庫內容快照。

> 後續可選：切換到 `vue-router` 全站 hydration、自動化測試／CI——動工前先與使用者確認。

### 已完成：#25 素材與意見的獨立連結（專屬路由）

分支 **`feat/issue-25-dedicated-routes`**。

| #    | 項目          | 狀態    | 內容                                                                                                                                               |
| ---- | ------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25-1 | `routes`      | ✅ 完成 | `GET /issues/:id/source/:materialId`（素材詳情）與 `GET /issues/:id/comment/:opinionId`（意見詳情）；URL 中的 `issueId` 與資料實際所屬不符時回 404 |
| 25-2 | `views`       | ✅ 完成 | `src/views/MaterialDetail.vue`、`src/views/OpinionDetail.vue`；SSR + hydration；麵包屑連回議題頁；分享區塊顯示永久連結＋複製按鈕                   |
| 25-3 | `og-meta`     | ✅ 完成 | `headForMaterial()`／`headForOpinion()` 以素材標題或意見摘要前 80 字產生 OG title + description，適合分享到社群                                    |
| 25-4 | `issue-links` | ✅ 完成 | `Issue.vue` 素材卡與意見卡各加「🔗 專屬連結」，讓使用者可從議題頁直接複製個別連結                                                                  |
| 25-5 | `i18n`        | ✅ 完成 | 新增 `src_*`／`op_detail_*`／`card_permalink` 等 key；zh-TW 與 en 雙檔同步（`vp test` 通過）                                                       |
| 25-6 | `verify`      | ✅ 完成 | `vp check --no-fmt --no-lint` 零錯誤；`vp test` 全部通過；`vp run build` 成功；DB 查詢只用公開欄位，無 author_* 洩漏風險                           |
