# AGENTS.md

給 AI coding agent 的工作指引。本檔聚焦「**agent 該怎麼在這個 repo 工作**」；一般的技術說明與部署步驟請看 [`README.md`](./README.md)。

> ⚠️ 本專案處於**移植初期**：目前 repo 內容仍是 `hono-vue-ssr-template` 範本，Civic Talk 的功能尚未搬移。閱讀時請嚴格區分「**現況**」與「**目標架構**」兩節——不要把目標當成既成事實去 grep 找檔案。

## 專案目的

把舊的 [`../civic-talk`](../civic-talk)（靜態 HTML + Cloudflare Pages Functions + D1）**整站移植**到本專案，改用 **Hono + Vue 3 SSR/hydration + Tailwind + Cloudflare Workers**。

- **功能／內容來源**：`../civic-talk`（現行站，`public/*.html`、`functions/api/[[route]].js`、`schema.sql`、`public/i18n.js`）。
- **移植藍圖**：[`.cursor/plans/vue_ssr_複刻_8a18e2ed.plan.md`](./.cursor/plans/vue_ssr_複刻_8a18e2ed.plan.md)——待辦拆解與資料庫設計以此為準，與本檔衝突時**先問使用者**。
- **參考但不照抄**：`../vtaiwan-hono` 的 SSR 寫法與工程慣例可借鏡，但本專案**不**採用它的 Vite+（`vp`）／LemmaScript 工具鏈。

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

5. **API 相容契約不得片面變更。** 管理端沿用 `ADMIN_PASSWORD` 環境變數與 `X-Admin-Token` 標頭；既有 endpoint 的路徑、方法與 JSON 形狀（見「API 契約」）只能擴充、不能改名或改語意。要破壞相容性，先問使用者。
6. **機密不進 git。** `.dev.vars`（含 `ADMIN_PASSWORD`）等憑證只留本地；不寫進任何 tracked 檔案、commit 訊息或 log 輸出。新增設定值時同步更新 `.dev.vars.example`，但只放假值。
7. **遠端 D1 需授權。** migration 預設只套用到本機（`--local`）。套用 `--remote`、建立或刪除資料庫、跑任何會寫入正式資料的指令前，**必須先問使用者**。
8. **生成物不手改。** `dist/`、`public/js/*.js`（client bundle）、`worker-configuration.d.ts` 皆為建置產物——改源頭重新生成。Tailwind 導入後 `public/styles.css` 也會變成生成物（見「樣式」）。
9. **完成 = 全部綠燈。** `npm run typecheck` 與 `npm run build` 都過才算改完。紅燈狀態不 commit。
10. **不擅自 commit／push／deploy。** 界線與長程任務例外見「Git / Commit 慣例」。

## 現況（今天 repo 裡真的有什麼）

這是 `hono-vue-ssr-template` 的原始狀態，Civic Talk 的東西**一樣都還沒進來**：

- `src/index.ts` — Hono 進入點，每條路由各自呼叫 `renderPage()`；現有 `/`、`/about`、`/word/:w`、`/hundred`、`/api/hello`、`*`（fallback 到 `ASSETS`）。
- `src/ssr/render.ts` — `createSSRApp` + `renderToString`，組出完整 HTML 殼；`options.hydrate` 可為單一頁面注入 client bundle。
- `src/ssr/heads.ts` — `HeadConfig`／`buildOg`／各頁 `headForXxx()`。
- `src/views/`（`Home` / `About` / `Word` / `HundredChart`）、`src/components/NavBar.vue`、`src/client/hundred-chart-entry.ts`。
- `public/styles.css` — **手寫**的 CSS，目前不是生成物。
- `wrangler.jsonc` — 只有 `ASSETS` 綁定，**沒有 D1**。

**尚不存在**（別去找）：`vue-router`、`vue-i18n`、`src/l10n/`、Tailwind、`src/db/`、`src/api/`、`migrations/`、任何測試與測試框架。

**待處理的身分問題**：

- `package.json` 與 `wrangler.jsonc` 的 `name` 已改為 `civic-talk`。⚠️ **首次 `wrangler deploy` 前要先確認**：Cloudflare 帳號內 Workers 與 Pages 共用同一份名稱清單，舊站若已有名為 `civic-talk` 的 Pages 專案就會撞名。撞到時**不要**逕自覆蓋舊站——先問使用者要改名還是要取代。
- `README.md` 仍是範本文件，把 `/word`、`/hundred`、`/api/hello` 當成產品功能在介紹——移植時需重寫，在那之前**不要**把它當成 Civic Talk 的說明來引用。

**範本殘留**：`/word/:w`、`/hundred`、`/api/hello` 與對應的 view／client entry 依移植計畫會被移除。**不要**把 `/hundred` 當成要長期沿用的範例去擴充，但在真正移除前它仍是目前唯一可讀的 hydration 參考寫法。

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

### 路由

`/`、`/issues/:id`、`/contribute/:id`、`/about`、`/admin`，加上不變量 4 的舊網址導向。

### 樣式：Tailwind v4 + design token

- 把舊站 `../civic-talk/public/style.css` 的**民主紅／青玉綠／麥穗黃**、字體與響應式規則收斂成 Tailwind `@theme` 的 design token；**不複製舊版大段手寫版面 CSS**。
- 模板一律用 token 或既有工具類別，**不硬寫顏色、字級、間距數值**。新增 token 時先在 `@theme` 定義再於模板使用。
- Tailwind 導入後 `public/styles.css` 變成建置產物——**不可手改**，改 source 後重新建置。
- View 的 SFC 樣式原則上用 `<style scoped>`，避免跨頁污染；真正全站共用的樣式才放進 CSS source。

### i18n：zh-TW / en 雙檔同步

- 介面文字**一律走翻譯 key**，模板與程式不寫死字串。
- **雙檔同步（硬性規定）**：`zh-TW` 與 `en` 的 key 集合必須完全一致，值各自翻譯。key 用點號分層（如 `header.home`、`issue.tabs.materials`）。舊站 `contribute` 頁缺的英文要補齊。
- **語言偵測／持久化只在瀏覽器端**：`localStorage.civic_lang` 只能在 hydration 後讀寫；SSR 一律用預設 `zh-TW`。別把偵測邏輯拉進 SSR 路徑（違反不變量 3）。

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
| `POST`   | `/api/admin/login`         | 以 `ADMIN_PASSWORD` 換 token                     |
| `GET`    | `/api/admin/stats`         | 管理統計                                         |

- 管理端一律驗 `X-Admin-Token`；CORS 允許標頭需含 `Content-Type, X-Admin-Token`。
- 統一 JSON 錯誤形狀 `{ error: string }`，並補齊輸入驗證與 `400` / `401` / `404` 回應。
- 議題狀態機（**照舊站語意，不要收得更嚴**）：POST material 把 `collecting` 推到 `summarizing`；POST briefing 從 `collecting` **或** `summarizing` 直接推到 `published`——也就是說 `collecting` → `published` 是合法的，可跳過 `summarizing`。素材立場預設 `unknown`。

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

> **不要改用其他套件管理器**（pnpm／yarn／bun），也**不要**引入 `../vtaiwan-hono` 的 Vite+（`vp`）或 LemmaScript／Dafny——本專案明確選擇維持 npm + vite。日後若要遷移到 `vp`，先與使用者確認。

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

**尚未存在**的指令：測試（無 `npm test`、無測試框架）、CSS 建置（Tailwind 尚未導入）。要新增測試框架或建置步驟，**先說明並取得使用者同意**再動工——不要自行決定用什麼框架。

D1 相關（導入後）：

```bash
npx wrangler d1 migrations apply vtaiwan-civic-talks --local    # 本機，預設做法
npx wrangler d1 migrations apply vtaiwan-civic-talks --remote   # 🚫 需先取得使用者授權
```

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

本專案在一個雙 repo 的 VS Code workspace（`civic-talk-hono.code-workspace`）：

- `.`（本專案，civic-talk-hono）
- `../civic-talk`（功能／內容來源，靜態版 Civic Talk）

另有 `../vtaiwan-hono` 可作為 Hono + Vue SSR 工程慣例的參考（**僅參考，不照抄工具鏈**）。要了解舊站行為時，直接讀 `../civic-talk` 對應檔案。

## 移植進度

依 [`.cursor/plans/vue_ssr_複刻_8a18e2ed.plan.md`](./.cursor/plans/vue_ssr_複刻_8a18e2ed.plan.md) 的六個 todo，全部**尚未開始**：

| #   | 項目           | 狀態      | 內容                                                     |
| --- | -------------- | --------- | -------------------------------------------------------- |
| 1   | `d1-schema`    | 📋 待開始 | 建立 `vtaiwan-civic-talks`、設定 `DB` 綁定、`ct_` 前綴 migration |
| 2   | `tailwind-shell` | 📋 待開始 | 導入 Tailwind、品牌資產、共用版型與中英 i18n            |
| 3   | `api-port`     | 📋 待開始 | 把舊 Pages Functions API 移植為 Hono + D1 型別化路由     |
| 4   | `vue-pages`    | 📋 待開始 | 以 Vue SSR/hydration 重建五個頁面及全部互動功能          |
| 5   | `routes-compat` | 📋 待開始 | 乾淨路由、舊網址導向與 SSR metadata                     |
| 6   | `verify`       | 📋 待開始 | 型別、建置、D1/API、hydration 與響應式驗證              |

> 這些項目有前後依賴（1 → 3、2 → 4 → 5 → 6）。完成任一項後請同步更新本表狀態。
