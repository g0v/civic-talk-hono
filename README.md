# Civic Talk（Hono + Vue SSR）

公共議題審議平台，**受原始版 [Civic Talk](https://github.com/v-taiwan/civic-talk) 啟發**，由該版靜態站移植而來：**Hono + Vue 3 SSR/hydration + Tailwind v4 + Cloudflare Workers / D1**。

本站受[ronnywang](https://www.github.com/ronnywang)提出的[原始構想](https://ronnywang.github.io/civic-notes/civic-talk/)的啟發。

一般內容生成仍由志願者使用自己的 AI token 完成。Issue #183 另加入需明確啟用的本機證據實驗 API：每次工作須明確同意，選定素材送交 Cloudflare Workers AI，費用由平台帳號承擔；隔離本機資料庫保存實驗工件，正式入口不註冊此 API，也不會自動改寫 briefing。投稿安全審查仍使用 OpenRouter；素材事實查核則由 Civic Talk Worker 透過 Cloudflare Service Binding 呼叫不公開的 `fact-check-core` Worker。

## 軟體授權

本專案的軟體與建置／執行文件整體採 **GNU Affero General Public License version 3 only（AGPL-3.0-only）**，完整條款見 [`LICENSE`](./LICENSE)。既有 MIT 部分與其他元件保留各自授權及 notices，詳見 [`NOTICE`](./NOTICE) 與 [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)。

截至 [`v0.1.0-mit-final`](https://github.com/g0v/civic-talk-hono/tree/v0.1.0-mit-final)（含該版本，commit `0cb5f309fa373e69ff60563bdc3fb0201332ceba`）已依 MIT 發布的軟體，仍可依 MIT 使用；原文保留於 [`LICENSE-MIT`](./LICENSE-MIT)。後續整體軟體版本採 AGPL-3.0-only，這不撤銷既有 MIT 權利，也不將新 AGPL 貢獻提供為可任選 MIT 的版本。

首個 AGPL 正式版以 `v0.2.0` tag 界定；合併後由維護者將該 tag 指向實際 merge commit，不預填尚未存在的 SHA 或發布日期。2026-10-11 維護者兼法務已核准本次切換；來源盤點、限制與決策紀錄見 [`docs/licensing-review.md`](./docs/licensing-review.md)。核准不代表已合併、建立 tag 或部署。

**軟體與投稿內容分開**：公民意見摘要維持平台現有條款的 **CC-BY-SA 4.0**，素材依原來源授權；這是依現有條款澄清 footer 的內容範圍，不撤銷先前已合法授出的 CC 許可。本次不替其他內容、資料或外部服務輸出新增一體適用的授權。軟體授權切換不授予額外的商標使用權，未釐清的品牌圖像與設計來源也不因更換 `LICENSE` 就被視為已取得許可。

修改版透過網路提供服務時，需依 AGPL 向使用者提供該運行版本的 Corresponding Source。footer 的原始碼入口指向建置 commit 的 archive；部署前查核與 fork 設定見 [`deploy_notes.md`](./deploy_notes.md)。新增貢獻與舊分支的來源／授權處理見 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 目前狀態

已部署於 **<https://civic.vtaiwan.tw>**（Cloudflare Workers，Worker 名稱 `civic-talk`，首次部署 2026-08-05）。

已在正式站驗過（2026-08-11）：

- 首頁與 `/api/issues` 皆 200、未登入打 `/api/me` 與 `/api/admin/stats` 得 401、`/api/auth/admin/list-users` 得 404（本站刻意不開成員管理端點）、`/index.html` 301 導向 `/`。
- **Google 與 GitHub 登入都成功**、`admin` 角色進得了後台、登入後投稿成功。

**同一個 email 的 Google／GitHub 帳號整合也已在正式站實測成功**（使用者確認 2026-10-16，見 [#5 留言](https://github.com/g0v/civic-talk-hono/issues/5#issuecomment-6225088110)）。

⚠️ 尚未實證：四種寫入是否都落下完整作者快照（含管理端取得完整快照）。

功能面重點：

- **投稿與志願者工具需登入**：建立議題、投稿素材、投稿意見、送出說明頁與產生志願者 prompt 都要先登入（任何未停權的登入者皆可，不看角色）。
- **志願者連續操作（#171）**：議題頁 `?step=volunteer` 的 Step 1 保留原「送出彙整結果」，旁邊新增麥穗黃底黑字的「送出彙整結果 + 自動複製說明頁 Prompt」。只有彙整成功且未被安全審查隱藏時，才取得最新的 Step 2 prompt 並自動複製，完成後合併顯示提醒。兩個按鈕共用送出中狀態；若彙整已儲存但後續取得／複製失敗，提示不必重送，已取得的 prompt 可在 Step 2 手動複製。三語同步，內容生成仍由志願者自己的 AI 工具完成。
- **歡迎導覽（#163）**：首頁 Welcome 彈框的角色說明後提供「瞭解更多」行內文字連結，前往 `/about`；桌機與手機皆顯示，並同步繁中、英文與日文。
- **首頁親和點綴（#175）**：保留首頁深色漸層，以「發芽與共好」的原創靜態 SVG 點綴；640px 起在主視覺右側顯示小花園，手機改用標語旁的小芽。歡迎框的公民／志願者選項使用同系列的萌芽／照料幼苗插畫，文字與操作流程不變。共用元件為 `HomeGrowthIllustration.vue`，沿用設計 token，純裝飾、不攔截點擊、不進入鍵盤焦點，也不新增套件或動畫。
  - 歡迎框、議題清單與首頁議題預覽（`?action=click_issue_card&issue=<id>`）的留白由 `HomeNatureBackdrop.vue` 共用自然元素背景：淺色模式顯示淡雲朵，深色模式顯示稀疏星星，兩者保留小葉片。背景置於內容下方，手機縮小並減少點綴；清單與預覽底部利用 footer 原有的 `mt-16` 留白，不增加頁面高度。所有裝飾皆對輔助技術隱藏，且不接收點擊或鍵盤焦點；預覽的返回、進入議題與瀏覽器歷史操作不變。
  - 角色插畫以輪廓區分：公民維持單株小芽，志願者改為手托土堆與幼苗、旁置小鏟子，保留原有圖示尺寸。淺色白雲提高描邊不透明度與線寬，小雲同步提高不透明度；位置、大小與深色星星維持不變。
  - 首頁議題卡使用 `IssueCard.vue` 的 `issue-list-card` 樣式，在 `src/styles/app.css` 定義低彩度玉綠表面漸層、玉綠／麥穗黃細邊框與柔和陰影。支援懸停的裝置移入時加強邊框與陰影；鍵盤焦點由整張卡片的玉綠外框呈現，避免標題重複外框。沒有位移、掃光或循環動畫，並沿用全站的減少動態偏好；卡片排版及首頁預覽操作不變，其他 `.card` 不受影響。
- **素材投稿先做事實查核**：素材表單呼叫同源 `POST /api/fact-check`；Civic Talk 驗證登入與停權狀態後，以 Service Binding 轉送到沒有公開 route 的 `fact-check-core`，不需要前端 token 或跨站 CORS。查核完成且結果允許前不顯示張貼按鈕；送出時仍由 Civic Talk API 執行條款與投稿安全審查。
- **具名投稿與 email opt-in**：四種內容都保存投稿當下的作者快照；前台固定顯示 `author_name`，email 只在該筆內容明確同意公開時才顯示。
- **條款同意落庫**：三類具名投稿由伺服器端驗證同意並寫入條款版本與時間。
- **全站登入狀態**：`AppHeader` 顯示登入者與登出，未登入時提供 Google／GitHub 登入面板。
- **管理權限走角色**：Better Auth session 的 `admin`／`super-admin`；角色由 [`../vTaiwan-hono`](../vTaiwan-hono) 管理，本站只讀。
- **議題結案／重開（#159）**：只有 `admin`／`super-admin` 可於後台操作，兩者都必須填寫公開理由。結案狀態獨立於素材募集／彙整／發布狀態，不會停止投稿、討論、投票或匯出。首頁預設「進行中」，「已結案」使用 `?tab=closed`；頁籤、搜尋、預覽返回、重新整理及上一頁／下一頁同步保留。議題頁公開顯示最近一次結案或重開的理由與日期（不提供歷次紀錄）；繁中、英文、日文同步。`0016_issue_closure.sql` 已套用本機，尚未套用遠端，部署前須取得授權並先完成 migration。
- **移除舊版 polis.tw 整合**：管理後台不再提供啟用開關，議題頁不再載入外部 `embed.js`。本站意見的同意／不同意／略過投票與登入後下載 `comments.csv` 維持不變；既有 `polis_id` 資料庫欄位與 API 契約保留，後台編輯不清除舊值，不需 migration。根據本站投票產生分群與跨群共識屬於未來待辦，本次不實作。
- **公民意見引導（#172）**：三語 `OPINION.md` 除了釐清價值與立場，也引導討論可行解方、調和方式及其條件與取捨。產生摘要前回顧整段對話，保留參與者提出或明確認可的建設性結論；摘要後若繼續形成新方案，提示 AI 更新完整摘要。未獲認可的 AI 建議不得寫成參與者立場，沒有方案時保留未解問題，不強造共識。複製與下載共用同一份模板，仍由參與者使用自己的 AI 工具，不由平台代為生成。
- **瀏覽意見總數（#174）**：議題頁的「瀏覽意見」按鈕顯示已載入意見清單的總數，例如 `瀏覽意見(2)`；沒有意見時仍顯示 `瀏覽意見(0)`。數字不受意見搜尋條件影響，沿用既有清單資料與更新流程，不新增 API 或資料庫查詢；繁中、英文、日文同步。
- **意見分頁標頭（#197）**：議題標題在所有寬度保留；小於 640px 時字級由 20px 縮為 18px，隱藏建立資訊（建立日期、素材數、建立者）與 RSS 訂閱按鈕，640px 起維持完整標頭。僅套用於 `?step=comments`，說明輪播、素材與志願者分頁不變。
- **議題說明輪播（#143）**：桌機與手機都以 `100dvh` 分配標頭、議題資訊、tabs、輪播與精簡授權列的高度，只在說明卡內捲動長文，避免頁面外層再出現捲軸。輪播不顯示狀態標籤與完整 footer，底部仍保留該建置版本的原始碼、授權與 client／Worker notices 入口；未提交版本沿用原始碼尚未發佈提示。寬螢幕說明內文維持 16px，訂閱鈕與 tabs 間距縮短。意見、素材與志願者工具保留自然捲動及完整 footer。
  - 小於 640px 時，輪播底部與一般 footer 的軟體授權相關項目統一收進「軟體授權」按鈕；點擊後以原生 dialog 顯示著作權、軟體授權說明、原始碼下載及 client／Worker notices 連結。可用關閉鈕、Escape 或點擊外圍霧面關閉，焦點回到按鈕。一般 footer 仍保留平台介紹、投稿內容授權與一般導覽；桌機維持原有連結與說明。按鈕與彈框統一由 `AppFooter.vue` 管理，連結共用 `SourceLicenseLinks.vue`，沿用相同的建置版本與未發佈判斷。
- **議題標籤與搜尋（#95）**：建立議題時可輸入自訂標籤，以 `, ` 分隔；去除開頭 `#` 與首尾空白，忽略空值，並忽略大小寫去重、保留第一個字樣。管理員可在既有議題編輯視窗增刪標籤，清空欄位即可全部移除。首頁議題卡於手機底部另起一排、桌機右下角顯示標籤；搜尋同時比對標題、簡介與標籤（含 `#tag` 寫法），並以所有未隱藏議題的標籤提供原生 autocomplete 建議。`?search=...` 可還原搜尋，輸入時以 `replaceState` 更新網址；議題預覽、返回清單與上一頁／下一頁保留搜尋及其他 query／hash。角色過濾與排序規則不變。
  - 首頁議題卡片在 tags 右側顯示單色人頭圖示與意見數，沿用清單 API 的 `opinion_count`（不是不重複參與者人數）；0 則時不顯示整組圖示與數字。手機版位於卡片底排右側，桌機位於右下角；tags 可換行、計數不拆行，沒有 tags 時仍可顯示非零計數。無障礙名稱沿用三語意見數單位，點擊該區仍開啟原本的首頁預覽。
  - **首頁累計票數（#178）**：意見數右側以眼睛圖示顯示 `vote_count`，不是不重複參與人數。同意、不同意、略過各計一票，每則具名意見另加一張作者當然同意票；只計 `abuse_flagged IN (0, 1)` 的公開意見，無作者的舊資料不加虛擬票。0 票時隱藏圖示與數字，三語無障礙標籤明示累計票數。
    - 首頁議題預覽（#180）也顯示同一個 `vote_count`，即使為 0 也顯示；繁中以「0票」等精簡格式呈現，英文、日文亦有對應文案，沿用相同的計算口徑與快取。
    - 首頁 SSR 與 `GET /api/issues`（含管理員投影）共用依 origin 隔離的 Cloudflare Cache API 統計，TTL 為 5 分鐘；投票、收回、刪除及審查變動不主動清除快取，數字可能延遲更新。快取只保存議題 ID、總票數與到期時間，不包含身分、email 或個別意見的投票分布；議題內容與作者投影仍即時查詢，API 的 `private, no-store`／`Vary: Cookie` 不變。
    - 每個 Cloudflare 資料中心各自快取，不保證跨區共用或常駐；未命中／到期時以一個 SQL 彙總全部議題，使用既有的 `idx_ct_opinions_issue_id` 與 `idx_ct_opinion_votes_opinion` covering index，避免逐張首頁卡片額外查詢、JOIN 重複計入作者或新增計數寫入。Cache API 不可用時直接查 D1，不回假零值；無須新增表或 migration。
    - 「最多關注／最少關注」改以 `opinion_count + vote_count` 降冪／升冪排序，不計素材數；票數沿用上述快取，可能延遲更新。角色的狀態優先序仍先套用，只在同一狀態內依關注數排序；同分保留原清單順序。
  - **首頁日期排序（#186）**：原本的「最新」拆成「最新發布」與「最新活動」，預設「最新發布」。發布時間指議題原始建立時間（`created_at`），不是說明頁發布時間；最新活動沿用 `last_activity_at`，包含未隱藏素材／意見投稿及說明頁新增／更新，尚無活動時使用議題建立時間，不稱為「最新意見」。兩種日期排序都保留角色的狀態優先序，只在同一狀態內依日期降冪，同值保留原清單順序。
    - 四種排序（最新發布／最新活動／最多關注／最少關注）的手動選擇存入 `localStorage.civic_home_sort_order`，hydration 後恢復，不需登入，也不寫入帳號或 D1。SSR 與初始 hydration 固定為「最新發布」；缺少偏好、舊 `newest`、無效值或儲存被封鎖時也回到「最新發布」。既有最多／最少關注偏好保留；無法保存時仍可在目前頁面切換。
    - 首頁清單卡片與預覽都標示發布日期、最新活動日期，跟隨中英日語言切換；窄螢幕空間不足時自然換行，兩種日期各自完整呈現、不截斷，避免長文擠版。不更動 API、資料庫欄位或 migration。
  - 首頁搜尋工具列在小於 640px 時維持直排，搜尋框佔滿容器寬度；640px 至 1023px 由外層容器保留至少 20rem 寬度並伸展使用剩餘空間，`lg`（1024px）以上則固定為工具列寬度的 50%，不再伸展或收縮。原生搜尋框固定填滿搜尋容器，不直接參與 flex 寬度分配；空間不足時工具列換行，避免 placeholder 被其他控制項擠窄。
- **使用者回報（#148）**：桌機以相同圖示＋「使用者回報」文字合成單一按鈕，手機頂列使用回報圖示，點擊開啟 modal、不換頁。手機 Navbar 維持單列，登入頭像位於角色切換左側，右端依序為「公民／志願者 → 回報圖示 → 漢堡選單」。三種分類與描述必填，免登入匿名送出，關閉後保留當頁回報草稿。回報只保存分類、描述、頁面路徑＋query、ID 與時間，僅管理員可瀏覽；不讀取或保存回報者帳號，也不額外收集 IP／瀏覽器資料。回報視窗與後台提供另開 GitHub issues 的連結，不自動傳送回報內容。
  - 回報按鈕在 `sm`（640px）起就顯示圖示＋文字，不必等到桌機導覽列展開；小於 640px 僅顯示圖示。所有寬度均維持同一列與同一個按鈕。
  - 點擊回報 modal 外圍霧面、按 Escape 或關閉鈕可收起視窗，分類與未送出描述仍保留；點擊框內內容或留白不會誤關閉。送出期間這些關閉操作皆暫停，請求結束（含失敗或 15 秒逾時）後恢復。
  - 手機回報視窗（#151）使用動態視窗高度；一般高度下由描述欄位填滿剩餘空間、長文在欄位內捲動。短螢幕、長網址或錯誤提示使內容放不下時，改由表單內層捲動，保留可用的輸入高度並讓操作按鈕可達；彈窗本身不捲動。桌機維持五列輸入框，兩種版面皆可垂直調整欄位尺寸。
  - 管理後台的「使用者回報」排在第一個分頁；`/admin` 未指定或帶無效 `tab` 時預設顯示回報。其他分頁使用明確的 `?tab=reports|moderation|issues|materials|opinions`，`?tab=feedback` 仍可直接開啟回報；切換回報時省略 `tab`，其他 query、hash 與上一頁／下一頁狀態照常保留。
- **三語介面（#136）**：桌機標頭與手機選單可直接選擇繁體中文、English、日本語。掛載後優先恢復 `localStorage.civic_lang` 的手動偏好（保留舊值 `zh`）；沒有有效偏好或儲存不可用時，依 `navigator.languages` 順序選第一個支援的語言，清單為空時改用 `navigator.language`。`en-*`／`ja-*` 分別使用英文／日文，`zh-*` 使用繁中，皆不支援時回繁中；自動偵測不寫入手動偏好。SSR 維持繁中，因此初次載入可能先短暫顯示中文，再於掛載後切換；停用 JavaScript 時維持繁中。日期與 `OPINION.md` 引導文件跟隨語言，使用者投稿的原始內容不自動翻譯。
  - 三語 navbar 統一在 1280px 起展開桌機導覽，以下使用漢堡選單；桌機容器同步加寬、長名稱截斷並可懸停查看全文，避免登入後的管理連結與使用者資訊擠版。下拉選單與桌機登入面板沿用相同斷點。手機透過較小 logo 與水平間距維持單列；日語桌機仍以 `isJapanese` 使用較小字級，志願者表單標籤在日語手機版也使用較小字級；中英版不縮字，footer 正常換行。首頁排序在所有寬度均使用帶「優先顯示：」三語標籤的下拉選單（#161），提供最新發布、最新活動、最多關注與最少關注四種排序（#186）。

## 開發

> **#183 草稿分支的 migration 風險：** 此分支的 `migrations/0017_evidence_pipeline.sql` 位於一般 migration 目錄，以下一般開發流程刻意不執行 migration；不得用一般 `--local` 將它套入預設開發庫，更不得用 `--remote` 套入正式庫。需要實驗時只用[專用隔離本機指令](#1-帳號設定與隔離資料庫)；若一般本機庫尚未初始化，不要在本分支以一般指令初始化，先參閱[實驗後處置與合併門檻](#71-實驗後-migration-與私有狀態處置)。

```bash
cp -n .dev.vars.example .dev.vars   # 僅首次建立；私下填入 Better Auth 與 Google／GitHub OAuth 憑證
npm install
vp run dev
```

> 登入功能在 `vp run dev` 下**測不了**：Better Auth 的資料表在遠端的 `vtaiwan-auth`，本機模擬庫是空的。要實測登入請用 `vp run dev:remote`。

常用指令：

| 指令                          | 說明                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| `vp run dev`                  | 先完整 build（含 CSS 與 notices），再啟動本機 Worker + HMR |
| `vp run dev:remote`           | 先完整 build（含 notices），再連遠端 D1；實測登入用這個    |
| `vp run css`                  | 由 `src/styles/app.css` 建置 `public/styles.css`           |
| `vp run css:watch`            | 監看並自動重建 Tailwind CSS                                |
| `vp run build`                | 依序建置 CSS、client bundle、server bundle                 |
| `vp check --no-fmt --no-lint` | tsc 型別檢查                                               |
| `vp test`                     | 執行自動化測試（Vitest，`src/tests/`）                     |
| `vp exec wrangler types`      | 產生 Cloudflare 綁定型別                                   |

開發伺服器的 `/licenses/client.txt` 與 `/licenses/worker.txt` 使用啟動前 production build 產生的 notices 快照，兩份檔案都以 UTF-8 提供；更動套件或 imports 後請重啟 `dev`／`dev:remote` 更新。頁面仍由 Vite 原始碼提供 HMR，不會切成 production bundle 執行。

`vite.config.mts` 以 `optimizeDeps.include` 一起預載 `vue` 與 `vue3-carousel`，避免開發伺服器冷啟動時才發現輪播依賴、重建預載產物，讓同頁短暫混用不同 Vue runtime 而出現 `Missing ref owner context`。這只調整開發依賴預載，不改輪播模板、樣式或正式版的打包方式。驗收此設定須以 `vp dev --force` 搭配真實瀏覽器檢查首次載入及輪播切換，不能只靠 SSR 測試或檢查設定文字。

分享網址回歸可單獨執行 `vp test src/tests/detailShareSsr.test.ts`：使用既有 Vue compiler 與 Vitest，分別渲染素材／意見詳情的 SSR 模板和 client 模板，確認分享欄在掛載前同為空白、沒有 Vue 警告，且不提前讀取 `window.location`。此測試不提供 DOM，也不執行真正的 hydration；掛載後的網址與複製行為仍須在真實瀏覽器檢查兩種詳情頁，確認含 query／hash 的完整網址顯示與剪貼簿一致，且 console 沒有 hydration mismatch。

依賴安全修補與 `package.json` overrides 的原因、移除條件見 [`docs/dependency-security.md`](./docs/dependency-security.md)。更新套件或執行 `vp migrate` 後，只要 `package-lock.json` 有變動，就須執行 `node scripts/licensing-dependencies.mjs` 重產授權盤點，並將 `docs/licensing-dependencies.tsv` 一起提交；用 `node scripts/licensing-dependencies.mjs --check` 確認與 lockfile 一致（CI 也會檢查）。同步更新 [`docs/licensing-review.md`](./docs/licensing-review.md) 的依賴統計，再跑型別檢查、測試與完整 build，讓第三方 notices 對應實際產物。

樣式 token 以 `vtaiwan-design-system/project/colors_and_type.css` 為穩定來源，透過 Tailwind v4 的 `vt-*` utilities 使用，例如 `text-vt-democratic-red`、`bg-vt-bg-2`、`font-vt-serif`。

議題頁的「瀏覽意見」使用 `.btn-jade-green`（翠玉綠底），「AI 幫幫忙」使用 `.btn-wheat-yellow`（麥穗黃底），兩者皆為白字、懸停時加深；樣式定義於 `src/styles/app.css`，分別沿用 `--color-vt-jade-green` 與 `--color-vt-wheat-yellow` token。意見入口在 `sm`（640px）以上顯示放大、直排置中的「發表意見／AI 幫幫忙／瀏覽意見／返回議題」，AI 入口直接切換既有 `action=ai_help`；窄螢幕維持「繼續／瀏覽意見／返回議題」三個按鈕。發表意見表單下方的操作按鈕仍在 `sm` 以上寬度橫排置中，手機維持直向排列。

議題頁在寬度超過 600px 時提供「概覽／共識／爭點／立場地圖／意見（公民）或行動（志願者）」三語文字頁籤；前四項切換說明輪播，公民的第五項進入公民意見，志願者的「行動」切到手機第五張的同一張導航卡，提供公民意見、素材庫與志願者工具三個入口。桌機左右箭頭位於輪播高度的 30%，下方圓點為 16px；手機維持原有控制。輪播頁面以 `tab=consensus|disputes|positions|actions` 保存，省略 `tab` 為概覽；志願者的 `actions` 還原第五張導航卡，公民則停在最後一張立場地圖。`step=comments|materials|volunteer` 仍控制操作版面，重新整理與上一頁／下一頁會還原對應狀態。

**共用頁面寬度（#190）**：Nav、首頁／關於頁的 Hero、各頁主內容與 footer 共用 `.page-container`。`sm`（640px）起外框以 `max-w-6xl` 對應的 1152px 為上限，視窗左右至少保留 16px，讓議題資訊、頁籤、輪播卡片及其他頁面左右對齊；不使用 Tailwind 內建 `.container`，避免其響應式寬度覆蓋本站設定。手機保留原有的標頭、內文與 Hero 留白，登入卡片、彈框等局部元件仍保留各自的寬度限制。

議題輪播不再使用舊的 `5xl`／48px 外層留白限制；卡片內文靠左、不置中，另以 `--container-prose: 65ch`（`max-w-prose` 的行長）限制文字欄，避免寬螢幕單行過長。`sm` 起卡片左側內距採 `--spacing-vt-12`（48px），讓內文避開左箭頭；右側內距沿用卡片原設定。行長與左側內距調整從 `sm` 起生效，手機不變；輪播的 `100dvh` 高度、卡內長文捲動與 Markdown 複製行為不變。

首頁點議題卡後的說明預覽（`?action=click_issue_card&issue=<id>`）由 `IssuePreviewCard.vue` 呈現，卡片填滿共用主容器，不再另限 `5xl`；說明文字靠左，`sm` 起以 `sm:max-w-prose` 沿用輪播的同一個 65ch 行寬上限，保留原有高度上限與捲動。手機沿用原有左右留白，「進入議題」導覽與瀏覽器歷史操作不變。

暗黑模式的輪播左右箭頭使用白色，懸停時維持白色，停用時保留半透明；最後一張的「前往公民意見」箭頭也沿用此設定。淺色模式維持套件原有箭頭色彩。

議題頁的表單、意見投票與標頭登入入口共用目前的導覽網址；頁籤、步驟、意見操作、搜尋與上一頁／下一頁都會同步登入 `callbackURL`，保留目前 query 與 hash，不會回到首次開啟的舊版面。

匿名點擊某筆意見的投票按鈕，或投票時遇到 session 過期，會把登入回跳定位設為 `#opinion-<id>`。回到意見列表後，等待登入狀態與意見資料載入，展開該筆長文／待審核內容並捲到投票控制；已確認違規或暫時隱藏的內容不會被展開。回跳不會自動投票，使用者須再按一次確認；意見已移除或定位無效時不強制捲動。

## 路由

| 路徑                             | 說明                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| `/`                              | 議題列表／新增議題（新增需登入）                                |
| `/issues/:id`                    | 議題說明、素材、志願者工具、意見投票與 CSV 匯出                 |
| `/issues/:id/source/:materialId` | 素材詳情（獨立分享連結，含 OG meta）                            |
| `/issues/:id/comment/:opinionId` | 意見詳情（獨立分享連結，含 OG meta）                            |
| `/contribute/:id`                | 素材投稿（需登入）                                              |
| `/about`                         | 關於                                                            |
| `/privacy`                       | 隱私政策（作者快照、公開選擇與帳號刪除的說明）                  |
| `/terms`                         | 使用條款（投稿時同意的版本）                                    |
| `/admin`                         | 管理後台（Google／GitHub 登入，需 `admin`／`super-admin` 角色） |

舊網址 `/index.html`、`/issue.html?id=`、`/contribute.html?id=`、`/about.html`、`/admin.html` 會導向新路由。

### 議題標籤 API

- `POST /api/issues` 可帶 `tags: string[]`，省略時保存空陣列；標籤一併納入既有投稿安全審查。`PUT /api/issues/:id` 仍需 `admin`／`super-admin`，可帶 `tags: string[]` 更新，省略時保留原標籤、`[]` 明確清除；非字串陣列回 `400 { "error": "..." }`。其餘必填欄位、成功回應與授權規則不變。
- 議題列表與詳情的議題物件新增 `tags: string[]`。AI 暫時隱藏議題在公開回應中的標籤為 `[]`，管理端列表仍可讀取原值；首頁卡片及 autocomplete 不顯示暫時隱藏或確認違規的標籤。

### 議題結案 API

- `PATCH /api/issues/:id/closure`：需 `admin`／`super-admin`；JSON `{ closed: boolean, reason: string }`，理由先 `trim()`，須為 1–1,000 個 Unicode code points。成功回 `200 { "ok": true }`；無效輸入 `400`、未登入 `401`、權限不足 `403`、議題不存在 `404`、狀態已相同或併發衝突 `409`。更新採原子條件，不覆寫已由其他請求完成的相同轉換。
- 議題列表與詳情擴充 `is_closed: 0 | 1`、`closure_reason: string | null`、`closure_changed_at: string | null`。理由與時間表示最近一次結案／重開，不隨一般 `PUT /api/issues/:id` 編輯而清除，也不改變原本 `status` 或活動時間。AI 暫時隱藏議題的公開理由為 `null`，管理員仍可讀取。
- `GET /api/issues` 仍回傳進行中及已結案議題，避免破壞既有消費端；只有首頁依頁籤分類。公民／志願者既有角色篩選與排序規則不變。
- 後台遇到 `409` 時會重新讀取議題狀態。請取消視窗，再從同一議題的最新結案／重開按鈕開啟操作；理由草稿會保留，確認最新動作後才重新送出，不會自動反轉管理員原本的操作。草稿僅存在當前頁面記憶體，成功後清除，重新整理或離開頁面不保留。
- 結案／重開視窗使用原生 `dialog.showModal()` 隔離背景操作與鍵盤焦點；開啟時聚焦理由欄，關閉後回到原按鈕。Escape、取消鈕與外圍霧面可關閉，框內留白不會誤關；送出中禁止關閉，失敗時保留理由。

### 使用者回報 API

- `POST /api/feedback`：免登入；JSON `{ category, description, page_path }`，`category` 為 `bug`／`usability`／`suggestion`，描述去除首尾空白後須為 1–10,000 個 Unicode code points；`page_path` 為最多 4,096 個 code points 的同源相對路徑＋query，不含 origin 或 hash。成功 `201 { "ok": true }`，無效資料 `400 { "error": "..." }`。表單送出不帶 session cookie，仍沿用全域 CSRF 防護，不開放跨來源寫入。
- 回報表單的請求上限為 15 秒；逾時沿用失敗提示並解除送出鎖定，保留分類與完整描述，允許關閉／重開或手動重試，不自動重送。逾時僅中止瀏覽器等候，不保證伺服器尚未寫入。
- `GET /api/admin/feedback`：需未停權的 `admin`／`super-admin`，未登入 `401`、無權限 `403`；回傳 `{ id, category, description, page_path, created_at }[]`，依時間與 ID 由新到舊排列，回應為 `private, no-store` 並帶 `Vary: Cookie`，無公開查詢端點。
- `/admin?tab=feedback`：只供瀏覽，包含載入／錯誤重試／空清單狀態；分頁與 URL 雙向同步，保留其他 query 並支援上一頁／下一頁。描述以跳脫過的純文字呈現，保留換行，不執行 HTML。

## 資料

- 業務資料庫：D1 `vtaiwan-civic-talks`（binding：`DB`）；業務表一律 `ct_` 前綴：`ct_issues`、`ct_materials`、`ct_briefings`、`ct_opinions`
- `migrations/0001`–`0006`（初始 schema、作者快照、條款同意）**本機與遠端皆已套用**
- `migrations/0014_user_feedback.sql` 新增 `ct_feedback`；本機與遠端皆已套用。2026-10-16 經使用者授權套用遠端 0014，查核 pending 清單為空、schema 與索引符合預期，新增業務表僅 `ct_feedback`； Worker已部部，正式站功能已上線。
- `migrations/0015_issue_tags.sql` 為 `ct_issues` 新增 `tags` JSON 文字欄位，舊議題預設 `[]`、不新增資料表。本機與遠端皆已套用：2026-10-20 經使用者授權套用遠端 0015，查核 pending 清單為空、資料表清單未變，16 筆既有議題的 tags 皆為 `[]`。此次未部署 Worker。
- 認證資料庫：D1 `vtaiwan-auth`（binding：`DB_AUTH`），schema 由 `../vTaiwan-hono` 維護；本 repo 不改 schema、不對它跑 migration 或直接 SQL 寫入，Better Auth 正常登入／session 生命週期是既有寫入例外。
- 遠端 migration 一律需另行授權；**此 #183 草稿分支不得對一般業務庫執行 migration apply**，因為一般目錄含僅供隔離實驗的 `0017`，不論 `--local` 或 `--remote` 都會被一般 apply 選入。不得對 `DB_AUTH` 執行任何 migration。

## #183 隔離本機證據實驗：真實議題驗收手冊

本節是操作步驟，不代表未執行的 runtime／OAuth／模型／人工品質案例已通過。實驗 API 只會在明確 opt-in 的專用本機 remote-dev 入口註冊；`DB`、Workflow 與工件留在本機隔離目錄，`SOURCE_DB` 連遠端業務 D1、程式只用來源 SELECT，`DB_AUTH` 僅供 Better Auth 正常 OAuth／session 生命週期（此為唯一預期遠端 auth 寫入），`AI` 使用平台 Cloudflare Workers AI。遠端 D1 binding 並非資料庫唯讀 credential；不得對 `SOURCE_DB` 執行任何寫入或 migration，也不得對 `DB_AUTH` 建表、migration 或直接 SQL 寫入。

一般志願者內容生成維持 BYO AI token 與既有 synthesis prompt API；實驗不寫入既有 briefing、不改議題狀態、不自動發布。Cloudflare Workers AI 的費用由平台帳號承擔；US$5／日是應用程式估算預留，不是 Cloudflare 帳單硬上限。

**狀態：INITIAL DRAFT AWAITING REAL SMOKE/ACCEPTANCE；不可合併。** 真實 OAuth、付費三模型流程及獨立人工語義品質尚未驗收；自動測試與合成 smoke 不能替代它們。按下列編號手冊操作前，先由人工確認此分支、費用、來源與隱私風險；本草稿也尚未解決一般 migration 目錄的誤用風險。

執行本手冊需 `vp`、`curl`、`jq`，以及原生 Node.js `>=22.18`（建議 Node 24 LTS）：`scripts/evidence-maintenance.mjs` 直接匯入 `src/ai/store.ts` 並使用 `node:sqlite`，需要 Node 原生 TypeScript／SQLite 支援。此環境觀察到 `node --version` 為 `v26.13.0`、`vp --version` 為 `vp v1.4.0`、`jq --version` 輸出 `jaq 3.1.1`、`curl --version` 為 `8.7.1`；這是本機 CLI 版本紀錄，不代表曾以其他 Node 版本測試維護 CLI。

| Binding | 實驗入口連線目標 | 允許用途 |
|---|---|---|
| `DB` | 隔離本機 D1，`remote:false`，persist 至 `.wrangler/ai-experiment` | 新增 `ct_*` 實驗資料；只套本機 migration |
| `SOURCE_DB` | 遠端 `vtaiwan-civic-talks` D1 | 固定參數化 SELECT 來源；不要寫入或套 migration（binding 本身仍有寫入能力） |
| `DB_AUTH` | 遠端 `vtaiwan-auth` D1 | Better Auth 既有登入／session／OAuth 正常生命週期及授權查詢；不建 schema、不跑 migration、不直接 SQL 寫入 |
| `AI` | 遠端 Cloudflare Workers AI | 真實模型請求由平台帳號計費；不得以 mock 或假結果作 runtime fallback |
| `EVIDENCE_WORKFLOW` | 本機 Workflow `civic-talk-evidence-local` (`EvidenceWorkflow`) | 本機持久任務與 recovery smoke；不是遠端 Workflow |

以下 shell 指令請在同一個私有 Bash session 依序執行，讓 `BASE_URL`、`COOKIE_JAR`、`JOB_ID` 等變數延續；另開 terminal 時需重新設定並驗證 `BASE_URL`，不得從 `.dev.vars` 印出 secret。

### 1. 帳號、設定與隔離資料庫

在 repo root 使用乾淨 checkout 的 `feat/issue-183-evidence-pipeline`；先檢查分支及 tracked 變更，保護既有 ignored `.dev.vars` 與 `.wrangler` 狀態，不得因 checkout／安裝而覆寫或清空。`npm`／lockfile 管理依賴；`package.json` 指定 npm `^12.0.1`。

```bash
git status --short --branch
node --version
npm --version
vp --version
curl --version
jq --version
npm ci
```

若 `.wrangler/ai-experiment/` 已存在，先確認它是自己預期的實驗狀態及其中私有工件的留存需求；不可為重新驗收或繞過額度清空它。缺工具、帳號權限、canonical origin 或明確付費同意時停止。


先確認本機 Wrangler 已登入並具有 D1、Workers、Workers AI 所需權限：

```bash
vp exec wrangler whoami
```

此命令會顯示帳號識別資訊，僅在本機核對權限，不要複製完整輸出到 issue、PR、終端錄影或聊天；不要執行 deploy。專用設定為 [`wrangler.ai-experiment.jsonc`](./wrangler.ai-experiment.jsonc)，工作資料目錄為 `.wrangler/ai-experiment/`（已忽略、不提交）。typegen 寫入忽略目錄，不手改生成型別：

```bash
mkdir -p .wrangler/ai-experiment
vp exec wrangler types .wrangler/ai-experiment/worker-configuration.d.ts --config wrangler.ai-experiment.jsonc
```

`.dev.vars` 必須由維護者在本機私下設定專用設定要求的 OAuth／Better Auth 欄位：`BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`。不要 `cat`、`echo`、貼上或記錄 secret、token、cookie。`BETTER_AUTH_URL` 與本機瀏覽器 origin 固定為專案既有的 `http://localhost:5173`；本機驗收使用 Google，callback 為 `http://localhost:5173/api/auth/callback/google`。目前 GitHub OAuth 僅允許 `vtaiwan.tw` 子網域，不支援此 localhost callback，因此本機登入不得選用 GitHub；專用設定要求的 GitHub 欄位仍須保留。專用 Vite server 綁 canonical hostname `localhost`（只 loopback，不暴露 LAN），`strictPort` 固定 5173；若該埠已有 listener，參照下方 preflight，只停止確認屬於自己的舊服務，不可殺未知 listener或改用另一個 port 做 OAuth。仍需由維護者私下確認 Google OAuth app 已允許上述 callback；本文件不代表已完成實際登入驗收。設定缺失、origin 不一致或 `whoami` 權限不足時，在前置檢查停止，不建立假 session。

**Migration 硬性警告：** 一般 `wrangler.jsonc` 與實驗設定的 `DB` 都指向 `./migrations`；目錄中的 `0017` 沒有程式性的環境保護。一般 `wrangler d1 migrations apply vtaiwan-civic-talks --local` 會把它套進預設開發庫，`--remote` 則可能套進遠端業務庫；本草稿兩者皆不得執行。也不得以 `SOURCE_DB`／`DB_AUTH` 或其 database name 作 migration 目標；未修改既有 `0001`–`0016`。唯有下方同時指定 `DB`、`--local`、專用 config 與專用 persist 的命令是本次隔離實驗的 migration 路徑。

`remote:false` 只控制本機開發時的 binding，不是 Wrangler CLI migration 的硬鎖：即使用實驗 config 選取 `DB`，明寫 `--remote` 仍可能命中同一個正式 `database_id`。本輪只在隔離本機套用，沒有查詢遠端 schema 或 migration ledger，不能推斷遠端是否已有 `0017`。

若懷疑曾誤套遠端，立即停止 migration 與其他資料變更，保留命令、時間與錯誤／變更紀錄（勿公開機密或個資），聯繫維護者並取得明確核准後才決定修復；不得自行 DROP、改寫 `d1_migrations` 或重試。


只套用隔離本機 `DB` 的 migration；命令明列 `--local`、專用 config 與專用 persist 路徑：

```bash
vp exec wrangler d1 migrations apply DB --local --config wrangler.ai-experiment.jsonc --persist-to .wrangler/ai-experiment
vp exec wrangler d1 execute DB --local --config wrangler.ai-experiment.jsonc --persist-to .wrangler/ai-experiment --command "SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name;"
```

檢查應用程式業務表只使用 `ct_` 前綴；SQLite／Cloudflare／D1 的內部 metadata／migration 表不是業務表。實際已在隔離目錄套用 `0001`–`0017_evidence_pipeline.sql`，並檢視 `sqlite_master`：新增的 pipeline 表為 `ct_ai_*`，應用程式表皆為 `ct_*`。不可把 `DB` 換成 `SOURCE_DB` 或 `DB_AUTH`；不得用 `--remote` 套 migration。`DB` 是 `remote:false`，正式／一般配置仍使用原 `wrangler.jsonc`。

### 2. 唯讀來源預檢與啟動

先核對議題 13 與素材 25／26 是否仍存在、屬於該議題且未隱藏。以下固定 SQL 只回傳識別、狀態及長度，不讀正文、不建立或修改遠端資料：

```bash
vp exec wrangler d1 execute SOURCE_DB --remote --config wrangler.ai-experiment.jsonc --json --command "SELECT id, title, status, abuse_flagged FROM ct_issues WHERE id = 13; SELECT id, issue_id, length(source_name) AS source_name_chars, length(source_url) AS source_url_chars, length(CAST(content AS BLOB)) AS content_utf8_bytes, abuse_flagged FROM ct_materials WHERE issue_id = 13 AND id IN (25, 26) ORDER BY id;"
```

最近一次唯讀檢查回報：議題 13 為 `published`、素材 25／26 屬於該議題且 `abuse_flagged = 0`，UTF-8 正文長度分別 339／449 bytes；查詢未讀取正文，Wrangler 回報 `rows_written: 0`、`changed_db: false`。每次實驗前仍須重查；若議題或素材已變更／撤下，就記錄差異並停止，不修改正式來源、不悄悄替換素材。

專用命令會先跑 production prebuild；本次已在來源凍結後成功執行，證據見第 8 節。若後續再改動任何 source／untracked 檔，重跑前仍須確認全部變更已凍結：

啟動前先檢查 5173 的 IPv4／IPv6 loopback listener：

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

若有 listener，只能停止自己確認擁有的舊本機 dev service；未知 owner 的 listener 不要強制終止，先停止實驗，避免 `localhost` 解析到另一個 server。不要接受自動改 port。

```bash
CIVIC_AI_EXPERIMENT=1 vp run dev:remote
```

Vite 僅在此明確變數與 remote serve mode 同時成立時載入 `wrangler.ai-experiment.jsonc`，並持久化至 `.wrangler/ai-experiment/`；專用 server 綁定 canonical hostname `localhost`（loopback，不暴露 LAN）、`strictPort` 固定使用 5173。啟動前先執行 `lsof -nP -iTCP:5173 -sTCP:LISTEN`；若已占用，只能停止確認屬於自己的舊服務，不要殺未知 listener，也不要接受自動改 port。`BETTER_AUTH_URL`、瀏覽器與 `BASE_URL` 的唯一有效 OAuth origin 為 `http://localhost:5173`。另一個 port 只可用於明確標示的無登入煙霧測試，不能驗證 OAuth callback。

### 3. 登入與私有 Cookie jar

此 API-only 實驗入口沒有網站登入 UI；本機驗收一律使用 Google OAuth（目前 GitHub OAuth 不允許 localhost callback）。開啟 `http://localhost:5173/`（首頁 404 是預期），在該頁 DevTools Console 執行以下同源流程；它只導向 Google，不輸出 OAuth URL／token：

```js
(async () => {
  const response = await fetch('/api/auth/sign-in/social', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
  })
  const auth = await response.json()
  if (typeof auth.url !== 'string') throw new Error('OAuth start failed')
  location.assign(auth.url)
})()
```

在 provider 頁面完成人工登入，等瀏覽器回到本機 origin 後，在 DevTools Console 僅檢查 session 是否存在，不輸出 session JSON、姓名或 email：

```js
fetch('/api/auth/get-session', { credentials: 'include' })
  .then(response => response.json())
  .then(session => console.info(session?.user?.id ? '本機 session 已建立' : '沒有本機 session'))
```

從 DevTools Network 的 `GET /api/auth/get-session` **Request Headers** 取得 `Cookie` header 值（不是 response `Set-Cookie`）。請從 repository root 的私有本機 terminal 執行；此 header 只放在隱藏輸入與管線中，由本機 helper 轉成真正的 Netscape Cookie jar，之後驗證及所有 API 請求都只使用該 jar：

```bash
set +x
umask 077
mkdir -p .wrangler/ai-experiment
COOKIE_JAR='.wrangler/ai-experiment/session.cookies'
BASE_URL='http://localhost:5173'
: "${BASE_URL:?必須明確設定本機 origin}"
if [ "$BASE_URL" != 'http://localhost:5173' ]; then
  rm -f "$COOKIE_JAR" "$PWD/.wrangler/ai-experiment/session-check.json"
  printf '%s\n' 'BASE_URL 必須與 BETTER_AUTH_URL 完全一致' >&2
  exit 2
fi
if ! bash -c '
  set +x
  umask 077
  state_dir=$3
  jar=$2
  check=
  cleanup_on_exit() {
    status=$?
    trap - EXIT
    if [ "$status" -ne 0 ]; then
      rm -f "$jar" "$state_dir/session-check.json"
      if [ -n "$check" ]; then rm -f "$check"; fi
    fi
    exit "$status"
  }
  trap cleanup_on_exit EXIT
  rm -f "$state_dir/session-check.json" || exit 1
  IFS= read -r -s -p "貼上 Cookie request header 值（不含 Cookie: 前綴）：" cookie || exit 1
  printf "\n" >&2
  if ! printf "%s" "$cookie" | node scripts/session-cookie-jar.mjs "$1" "$jar"; then
    unset cookie
    exit 1
  fi
  unset cookie
  check=$(mktemp "$state_dir/session-check.XXXXXX") || exit 1
  if ! curl --disable --noproxy "*" --fail --silent --show-error --connect-timeout 5 --max-time 15 --output "$check" --cookie "$jar" "$1/api/auth/get-session"; then
    printf "%s\n" "OAuth session 未驗證；檢查 provider callback 與 session，不要繼續" >&2
    exit 1
  fi
  if ! jq -e "type == \"object\" and (.user.id | type == \"string\")" "$check" >/dev/null; then
    printf "%s\n" "OAuth session JSON 無效；不要繼續" >&2
    exit 1
  fi
  rm -f "$check" || exit 1
  check=
  exit 0
' _ "$BASE_URL" "$COOKIE_JAR" "$PWD/.wrangler/ai-experiment"; then
  printf '%s\n' 'Cookie jar 匯入或 session 驗證失敗；已清除本機 jar 與驗證回應' >&2
  exit 1
fi
```

helper 會寫入 host-only `localhost`、`/` 路徑、session expiry `0` 的 jar，並以原子替換建立權限 `0600` 的檔案；`Cookie` request header 不含原始 `Domain`、`Path`、`Secure` 或 `HttpOnly` 屬性，因此不宣稱保留這些原始屬性。`__Secure-`／`__Host-` 前綴會保留 Secure 要求。Netscape jar 不含 port scope；此 jar **只能**與完全相同的 canonical `BASE_URL`（`http://localhost:5173`）搭配，絕不可拿去請求其他 localhost 服務／port，也不可貼入或匯入正式站 Cookie。後續 `curl --cookie "$COOKIE_JAR"` 即使驗證回應沒有 `Set-Cookie` 仍會使用已匯入 cookie；只有確實需要保存伺服器合法 refresh 時，才在該請求另加 `--cookie-jar "$COOKIE_JAR"`。

若驗證失敗，script 會清除 jar 與暫存驗證回應；不要把假 `Cookie:` 樣本當登入成功。Cookie jar 與所有私有 API 回應均置於 `.wrangler/ai-experiment/`，權限為目前使用者讀寫；不提交、不備份到雲端、不貼報告，也不可開啟 shell tracing。操作完成後呼叫 sign-out 或刪除 Cookie jar。

以同一 jar 私下檢查帳號角色與停權狀態；`/api/me` 原始回應含身分資料，暫存於私有檔，以下只印角色與 `banned`，不印 session、姓名或 email：

```bash
ME_JSON="$PWD/.wrangler/ai-experiment/me-check.json"
if ! curl --disable --noproxy '*' --fail --silent --show-error --output "$ME_JSON" \
  --cookie "$COOKIE_JAR" "$BASE_URL/api/me"; then
  rm -f "$ME_JSON"
  printf '%s\n' '無法確認登入身分；停止驗收' >&2
  exit 1
fi
if ! jq -e '.banned == false and (.role == "user" or .role == "admin" or .role == "super-admin")' "$ME_JSON" >/dev/null; then
  rm -f "$ME_JSON"
  printf '%s\n' '帳號停權或角色不明；停止驗收' >&2
  exit 1
fi
jq '{role, banned}' "$ME_JSON"
rm -f "$ME_JSON"
```

一般未停權登入者即可建工作並修改自己的版本，admin／super-admin 才能使用 maintenance POST；不要為驗收修改帳號角色或停權狀態。


每次開新 terminal 都明確設定並驗證同一個 `BASE_URL`，不得留空或改用其他 origin：

```bash
BASE_URL='http://localhost:5173'
: "${BASE_URL:?必須設定 BASE_URL}"
test "$BASE_URL" = 'http://localhost:5173' || { printf '%s\n' 'origin mismatch' >&2; exit 2; }
```

### 4. 建立工作與有限輪詢

以下請求只讀固定遠端來源，新增的工作／快照／Workflow state 都寫進本機 `DB`；不帶 `--remote` 執行任何寫入。先以真實 session 呼叫：

實驗核心僅有以下六條業務／維護 API：`POST /api/issues/:id/evidence-jobs`、`GET /api/evidence-jobs/:jobId`、`GET /api/evidence-jobs/:jobId/revisions`、`POST /api/evidence-jobs/:jobId/revisions`、`POST /api/evidence-maintenance/reconcile`、`POST /api/evidence-maintenance/erase`。皆須有效使用者 session；兩條 maintenance POST 另外要求 admin／super-admin 角色，且受全域 CSRF 防護；revision 只供工作 owner 建立。

```bash
umask 077
POST_JSON="$PWD/.wrangler/ai-experiment/job-post.json"
JOB_JSON="$PWD/.wrangler/ai-experiment/job.json"
JOB_REQUEST='{"material_ids":[25,26],"language":"zh-TW","consent":true}'
POST_CODE=$(curl --disable --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 120 --output "$POST_JSON" --write-out '%{http_code}' \
  --cookie "$COOKIE_JAR" --header "Origin: $BASE_URL" --header 'Content-Type: application/json' \
  --request POST "$BASE_URL/api/issues/13/evidence-jobs" \
  --data-binary "$JOB_REQUEST")
printf 'POST HTTP %s\n' "$POST_CODE"
if [ "$POST_CODE" != '200' ] && [ "$POST_CODE" != '202' ]; then
  printf '%s\n' 'POST 未取得可輪詢工作；檢查錯誤碼，不要重送' >&2
  exit 1
fi
JOB_ID=$(jq -er '.job_id | select(type == "string" and length > 0)' "$POST_JSON") || {
  printf '%s\n' '回應缺少 job ID；停止，不要重送' >&2
  exit 1
}
jq '{job_id, status, cache, input_coverage}' "$POST_JSON"
```

`consent:true` 是每個工作的必要明確同意。新工作預期 `202`／`cache:"miss"`；同一進行中工作可能是 `202`／`cache:"joined"`；完成快取是 `200`／`cache:"hit"`。狀態欄要與 HTTP code 一起判讀，失敗工作不會被偽裝成 AI 草稿。若來源預檢或 POST 回應錯誤，先看 response 的機器錯誤碼，不要改寫遠端資料或重送空請求。

對實際 job ID 以兩秒間隔最多輪詢 30 次；GET 的進度以 JSON `status` 判斷，停止等待不會取消已送出的模型呼叫：

```bash
i=0
STATUS=missing
while [ "$i" -lt 30 ]; do
  if ! GET_CODE=$(curl --disable --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 15 --output "$JOB_JSON" --write-out '%{http_code}' \
    --cookie "$COOKIE_JAR" "$BASE_URL/api/evidence-jobs/$JOB_ID"); then
    STATUS=missing
    printf '%s\n' 'GET 失敗；停止輪詢，不重送 POST' >&2
    break
  fi
  if [ "$GET_CODE" != '200' ]; then
    STATUS=missing
    printf 'GET HTTP %s；停止輪詢，不重送 POST\n' "$GET_CODE" >&2
    break
  fi
  STATUS=$(jq -er '.status | select(type == "string")' "$JOB_JSON") || {
    STATUS=missing
    printf '%s\n' 'GET 回應沒有有效 status；停止輪詢' >&2
    break
  }
  printf 'GET HTTP %s status=%s\n' "$GET_CODE" "$STATUS"
  case "$STATUS" in
    ai_draft|partial_draft|failed|withdrawn|erased) break ;;
    queued|extracting|comparing|generating) sleep 2 ;;
    *) printf '%s\n' '未知回應；停止輪詢且不重送 POST' >&2; break ;;
  esac
  i=$((i + 1))
done
```

若 30 次後仍在執行，記下當下 status 並停止；不要快速重送 POST、不要假設在途 provider request 已取消。只有 `ai_draft`／`partial_draft` 才檢視草稿；`failed` 應連同 `error_code` 與 usage 記錄，`withdrawn`／`erased` 不可再展示內容。
快取驗證的精確重複 POST 與 GET usage ledger 前後比較見第 6 節；僅在第一工作已完成為 draft 且來源／設定未變時執行。
若輪詢因網路、HTTP 或 JSON 錯誤而停止，不要檢視可能留在磁碟上的舊 `JOB_JSON`，也不要重送 POST；先依本機錯誤與帳務狀態人工判斷。


### 5. 檢視來源、逐句引文、比較診斷與費用

所有正文、引文與生成文字都可能含個資；以下 jq 輸出只留在本機，不能貼到 issue、PR、console log 或公開報告。先看狀態、來源查核時間、來源識別、錯誤與用量，不印出 source snapshot payload：

```bash
case "${STATUS:-missing}" in
  queued|extracting|comparing|generating|ai_draft|partial_draft|failed|withdrawn|erased) ;;
  *) printf '%s\n' '沒有可用的本次 GET；停止，不顯示舊結果' >&2; exit 1 ;;
esac

 jq '{
   status, error_code, source_checked_at, input_key, generation_artifact,
   usage: {attempts: .usage.attempts, uncertain: .usage.uncertain,
     reservedMicroUsd: .usage.reservedMicroUsd, actualMicroUsd: .usage.actualMicroUsd},
   sources: [.sources[]? | {kind, id, hash}],
   provenance_artifacts: [.provenance.artifacts[]? | {
     id, kind, sha256, created_at,
     model: (if .model == null then null else {
       selector: .model.selector, provider_model: .model.provider_model,
       provider_revision: .model.provider_revision, request_id: .model.request_id,
       system_fingerprint: .model.system_fingerprint,
       request_sha256: .model.request_sha256, pricing_version: .model.pricing_version,
       usage_status: .model.usage_status
     } end),
     attempt: (if .attempt == null then null else {
       id: .attempt.id, state: .attempt.state,
       estimated_micro_usd: .attempt.estimated_micro_usd,
       actual_micro_usd: .attempt.actual_micro_usd
     } end)
   }],
   initial_input_diagnostics, current_issue_exclusions,
   diagnostics: (.diagnostics | if type == "object" then {
     coverage, partial, comparison_summary: .comparisons.diagnostics,
     candidate_paths: .comparisons.candidate_paths,
     incomplete_pairs: .comparisons.incomplete_pairs,
     unclassified_evidence_ids: .comparisons.unclassified_evidence_ids
   } else . end)
 }' "$JOB_JSON"
 jq '{attempts: .usage.attempts, uncertain: .usage.uncertain,
     reservedMicroUsd: .usage.reservedMicroUsd, actualMicroUsd: .usage.actualMicroUsd,
     reservedUsd: ((.usage.reservedMicroUsd // 0) / 1000000),
     actualUsd: ((.usage.actualMicroUsd // 0) / 1000000)}' "$JOB_JSON"
```

上方安全摘要的來源投影只顯示 `{kind,id,hash}`；**原始 `JOB_JSON` 的 `.sources` 包含完整來源 payload**，可能含個資，必須依私有資料保護，不能把整份 response 當成去識別摘要。`source_checked_at` 是整份 job 的查核時間，不存在 per-source `checked_at`。`input_key`、`generation_artifact` 與 `provenance.artifacts` 只摘要 artifact ID／hash／建立時間、model selector/provider metadata 與 attempt ledger；缺值如實為 `null`／`unknown`。此 safe summary 不含 raw request／response 或作者欄位；它不是 provider 權重 revision 或帳單證明。

只在 draft 狀態下檢視分區輸出及引用：

```bash
case "$STATUS" in
  ai_draft|partial_draft) ;;
  *) printf '%s\n' '尚無可檢視草稿；停止，不顯示舊結果' >&2; exit 1 ;;
esac

jq '.data' "$JOB_JSON"
jq '.evidence' "$JOB_JSON"
jq '.sources[] | select(.kind == "material") | {id, source_name: .payload.source_name, content: .payload.content}' "$JOB_JSON"
jq -r '.citation_map[]? | [.pointer, .start, .end, .unit, (.evidence_ids | join(","))] | @tsv' "$JOB_JSON"
jq '.citation_map[]? as $m | $m.sources[]? |
  {pointer: $m.pointer, material_id, source_title: .source.Title,
   raw_quote, quote, raw_span, expanded_span}' "$JOB_JSON"
jq '.diagnostics.comparisons | {
  diagnostics,
  pairs, consensus_groups, disputes,
  direct_comparisons: [.direct_comparisons[]? | {pair_key, evidence_ids, relation, cached}],
  candidate_paths, incomplete_pairs, unclassified_evidence_ids
}' "$JOB_JSON"
```

先有人逐句回查素材原文中的精確片段、條件、否定與轉述歸屬，再判斷其對應的共識、爭點或立場是否準確；`agree` 只是相容／支持判斷，不是等價或作者認可。候選路徑不算直接比較；漏比、未完成或不確定的 pair 不得當成已證實。`citation_map` 與 schema 通過只代表格式及出處錨定檢查，不證明語義正確。US$ 金額是應用估算／provider usage 結算欄位，不是 Cloudflare 帳單保證或硬上限。

上面的 `.sources[].payload.content` 是工作使用的**完整、未截斷素材快照**；僅在私有本機檢視並依 material ID 對照每筆 evidence／引文，再回查當下可讀的完整來源與 hash，記錄漏抽、少數反例和不一致，不得貼出原文。比對 `pairs`、直接判斷、`consensus_groups`、`disputes` 與候選路徑：只確認不同素材的直接邊；同素材不算獨立支持，支持鏈不自動補成已證實邊。

獨立人工品質驗收依 [`plan.md` 第 10.2 節](./plan.md#102-必做實際執行)：先由人建立標準答案，再看模型結果；四種關係各至少三個明確中文案例，並涵蓋少數反對、條件支持、轉述、prompt injection、中英日／emoji、A／B 對調及非遞移支持鏈。沒有真人標註時填「未驗證」，不可捏造 gold labels。偽造／跨素材錯錨／缺引用必須被拒絕；已知明確反例若仍列為共識，即品質不通過。

若 provider 用量欄位缺失或格式錯誤，`usage.uncertain`／用量狀態會保留未知結算，預留額度不當成零費用釋放；不因單獨用量缺漏抹除已通過其他 schema／來源驗證的答案。provider 回報的 `model` 名稱只是字串 metadata，不是不可變權重 revision。這些欄位不是 Cloudflare 帳單核對結果，每次真實驗收仍須另記證據。

Gemma 生成採與 `../pocket-polis/src/sensemaking.ts` 的 `runAiModel()` 相同的最小原生文字生成參數：`messages`、`max_tokens`、`temperature:0.2`、`chat_template_kwargs.enable_thinking:false`；本站保留 8,192 tokens 輸出上限與相應費用預留，不送 `response_format/json_schema` 或其他額外選項。輸出 JSON Schema 放入可信的 system prompt，不混入來源 user message，也不宣稱 provider 保證遵循。本站仍要求單一 chat completion、明確 `finish_reason:"stop"`、原始 JSON、合法候選與逐句出處；原生完成可省略 `refusal` 或回傳 null，任何明示非 null 的 refusal 仍拒絕。截斷、拒答、工具呼叫、Markdown 包裝或引用不符都會失敗，不自動修補、重試或產生 fallback。

送給 Gemma 的候選與輸出統一使用 `candidate_id`，必須逐字取自相同分區的輸入候選，不能拿 `evidence_ids` 中的證據 ID 代替。每個候選最多輸出一項；共識／爭點項目須引用至少兩份不同素材，爭點應在同一項呈現雙方，不能拆成只引用單一來源的兩項。Prompt 明示這些規則，但本站仍獨立驗證，模型不遵循時不會自動配對、改寫候選或放行。

`Overview` 採最佳努力生成：分區有項目時，prompt 要求用 1–2 句簡述該分區已輸出的項目，每句附上這些項目已引用的 evidence IDs；立場概述只中性整理不同主張，不宣稱共識。分區無項目時用 null；證據不足以支持可靠概述時也不得補造。這是 prompt 要求，不是新增的完整性守門：schema／解析器仍接受有項目但 Overview 為 null，不會只因缺概述把整份可讀草稿判為失敗，也不自動補寫或重試。`Core_concern` 證據不足時仍可為 null。

此次原生呼叫與候選契約修訂會自然改變 prompt／參數／設定指紋，因此新工作不沿用舊契約的失敗結果；舊工件、未知費用與 tombstone 保留，不能把新指紋當作舊呼叫退款或已驗收的證據。離線契約與回歸通過不能取代完整真實工作與人工品質驗收；再次送出仍是可能付費的新工作，需重新明確同意。

`Source.Title` 取自 `ct_materials.source_name`，缺值才用素材 ID；來源表沒有 material title 欄，不以原文預覽或 AI 衍生標題替代。`source_hash` 是固定順序 metadata+content JSON 的 UTF-8 SHA-256，`content_hash` 是原始 content UTF-8 bytes 的 SHA-256；原文不 trim、不正規化。空白正文不會被省略，會以 `422 empty_material` 拒絕。

### 6. 快取、人改版本與衝突

同一 owner、議題、明確選取的 `material_ids`、language、目前來源快照與 model/settings manifest 重送 POST，已完成工作應回 `200`／`cache:"hit"`，進行中的同一工作回 `202`／`cache:"joined"`；確認 `usage.attempts` 未因快取／join 增加。明確選取時，未選取素材的隱藏／刪除狀態不進入付費 cache key；`input_coverage` 只回報本次 selection 的材料 ID 與初始排除清單，`GET` 的 `initial_input_diagnostics` 保留建立工作時的排除快照，`current_issue_exclusions` 則是每次讀取時重新查到的隱藏素材。若省略 `material_ids`，selection 是當下所有可用素材，選取集合變化會改變 cache key。此步仍需真實 OAuth／API runtime 才能驗證；不同來源快照／語言／settings 會建立不同工作，可能付費。
#### 快取驗證


若前一工作已成功到達 `ai_draft`／`partial_draft`，且來源狀態、所選素材與 pipeline 設定未變，可用完全相同的 `JOB_REQUEST` 做一次 cache proof。這是會進入正式 admission 的真實 POST；cache miss 可能建立新工作並造成平台模型費用，因此只在條件全都成立時執行。此步只重用前面真實 POST 回應抽出的 `JOB_ID` 與本機 OAuth Cookie jar，不建立假 UUID／cookie；若未完成、來源已變更或回應不是預期 cache hit，停止且不再 POST。

```bash
case "$STATUS" in
  ai_draft|partial_draft) ;;
  *) printf '%s\n' '工作未完成為草稿；不做 cache proof POST' >&2; exit 1 ;;
esac

CACHE_BEFORE_JSON="$PWD/.wrangler/ai-experiment/cache-before.json"
CACHE_POST_JSON="$PWD/.wrangler/ai-experiment/cache-repeat-post.json"
CACHE_AFTER_JSON="$PWD/.wrangler/ai-experiment/cache-after.json"
CACHE_BEFORE_CODE=$(curl --disable --noproxy '*' --silent --show-error --output "$CACHE_BEFORE_JSON" --write-out '%{http_code}' \
  --cookie "$COOKIE_JAR" "$BASE_URL/api/evidence-jobs/$JOB_ID")
if [ "$CACHE_BEFORE_CODE" != "200" ] || [ "$(jq -er '.job_id' "$CACHE_BEFORE_JSON")" != "$JOB_ID" ]; then
  printf 'Before-cache GET failed or returned a different job (HTTP %s); stop\n' "$CACHE_BEFORE_CODE" >&2
  exit 1
fi
printf '%s\n' 'Usage before repeat POST:'
jq '{job_id, status, attempts: .usage.attempts, uncertain: .usage.uncertain,
     reservedMicroUsd: .usage.reservedMicroUsd, actualMicroUsd: .usage.actualMicroUsd}' "$CACHE_BEFORE_JSON"

CACHE_POST_CODE=$(curl --disable --noproxy '*' --silent --show-error --output "$CACHE_POST_JSON" --write-out '%{http_code}' \
  --cookie "$COOKIE_JAR" --header "Origin: $BASE_URL" --header 'Content-Type: application/json' \
  --request POST "$BASE_URL/api/issues/13/evidence-jobs" --data-binary "$JOB_REQUEST")
printf 'Repeat POST HTTP %s\n' "$CACHE_POST_CODE"
jq '{job_id, status, cache}' "$CACHE_POST_JSON"
CACHE_JOB_ID=$(jq -er '.job_id' "$CACHE_POST_JSON")
CACHE_MARK=$(jq -er '.cache' "$CACHE_POST_JSON")
if [ "$CACHE_POST_CODE" != "200" ] || [ "$CACHE_JOB_ID" != "$JOB_ID" ] || [ "$CACHE_MARK" != "hit" ]; then
  printf '%s\n' 'Expected the same job with cache:"hit"; stop and record the returned response, do not POST again' >&2
  exit 1
fi

CACHE_AFTER_CODE=$(curl --disable --noproxy '*' --silent --show-error --output "$CACHE_AFTER_JSON" --write-out '%{http_code}' \
  --cookie "$COOKIE_JAR" "$BASE_URL/api/evidence-jobs/$JOB_ID")
if [ "$CACHE_AFTER_CODE" != "200" ] || [ "$(jq -er '.job_id' "$CACHE_AFTER_JSON")" != "$JOB_ID" ]; then
  printf 'After-cache GET failed or returned a different job (HTTP %s)\n' "$CACHE_AFTER_CODE" >&2
  exit 1
fi
printf '%s\n' 'Usage after repeat POST:'
jq '{job_id, status, attempts: .usage.attempts, uncertain: .usage.uncertain,
     reservedMicroUsd: .usage.reservedMicroUsd, actualMicroUsd: .usage.actualMicroUsd}' "$CACHE_AFTER_JSON"
if ! jq -e -s 'length == 2 and (.[0].usage | {attempts, uncertain, reservedMicroUsd, actualMicroUsd}) == (.[1].usage | {attempts, uncertain, reservedMicroUsd, actualMicroUsd})' \
  "$CACHE_BEFORE_JSON" "$CACHE_AFTER_JSON" >/dev/null; then
  printf '%s\n' 'GET usage ledger changed across the cache request; record both responses' >&2
  exit 1
fi
printf '%s\n' 'Same job/cache hit; GET usage ledger unchanged'
```

此比較驗證的是實驗 DB 中的 usage ledger 前後相同，不是 Cloudflare invoice 或帳號總帳單，也不證明費用為零；若 usage metadata 為 unknown，依原未知／預留數據判讀，不推算退款。

快取命中不應扣新工作配額；此 HTTP 比較直接觀察的是同工作與 usage ledger，不能單憑它證明完整配額實作。配額／冷卻邊界另參照第 7 節的隔離自動測試，不為示範而燒滿額度或重建狀態。


先取得 AI 基底，再於本機複製並人工編輯 `data`，不要覆寫 AI 原稿：

```bash
REV_JSON="$PWD/.wrangler/ai-experiment/revisions.json"
EDIT_JSON="$PWD/.wrangler/ai-experiment/human-data.json"
REV_POST="$PWD/.wrangler/ai-experiment/revision-post.json"
curl --disable --noproxy '*' --silent --show-error --output "$REV_JSON" --cookie "$COOKIE_JAR" \
  "$BASE_URL/api/evidence-jobs/$JOB_ID/revisions"
jq '.ai_base.data' "$REV_JSON" > "$EDIT_JSON"
${EDITOR:-vi} "$EDIT_JSON"
jq -e 'type == "object"' "$EDIT_JSON" >/dev/null
jq -n --arg parent_revision_id 'ai' --slurpfile data "$EDIT_JSON" \
  '{parent_revision_id:$parent_revision_id,data:$data[0]}' > "$REV_POST"
REV_CODE=$(curl --disable --noproxy '*' --silent --show-error --output "$POST_JSON" --write-out '%{http_code}' \
  --cookie "$COOKIE_JAR" --header "Origin: $BASE_URL" --header 'Content-Type: application/json' \
  --request POST "$BASE_URL/api/evidence-jobs/$JOB_ID/revisions" --data-binary "@$REV_POST")
printf 'Revision POST HTTP %s\n' "$REV_CODE"
jq '{revision_id, parent_revision_id, verification}' "$POST_JSON"
if [ "$REV_CODE" != '201' ] || [ "$(jq -r '.verification // empty' "$POST_JSON")" != 'human_unverified' ]; then
  printf '%s\n' '修訂未成功；停止，不做 stale parent 測試' >&2
  exit 1
fi
curl --disable --noproxy '*' --silent --show-error --output "$REV_JSON" --cookie "$COOKIE_JAR" \
  "$BASE_URL/api/evidence-jobs/$JOB_ID/revisions"
jq '{ai_base: {id: .ai_base.id, verification: .ai_base.verification, data: .ai_base.data},
     revisions: [.revisions[] | {id, parentId, verification, diff}]}' "$REV_JSON"
```

新增修訂預期 `201` 並標為 `human_unverified`；原 `ai_base` 保持不變，diff 只描述修訂差異，不能沿用舊引用宣稱新文字已驗證。要驗證 stale parent，可在第一次成功後再次以 `parent_revision_id:"ai"` 提交，預期 `409 revision_conflict`；不要把第二次回應當作已保存。實驗不呼叫既有 briefing endpoint，不改既有 briefing 或 issue status。

第一次成功後，原封不動重送仍指向 `ai` 的本機 request，核對衝突而不是建立第二版：

```bash
STALE_JSON="$PWD/.wrangler/ai-experiment/revision-conflict.json"
STALE_CODE=$(curl --disable --noproxy '*' --silent --show-error --output "$STALE_JSON" --write-out '%{http_code}' \
  --cookie "$COOKIE_JAR" --header "Origin: $BASE_URL" --header 'Content-Type: application/json' \
  --request POST "$BASE_URL/api/evidence-jobs/$JOB_ID/revisions" --data-binary "@$REV_POST")
printf 'Stale revision POST HTTP %s\n' "$STALE_CODE"
jq '{error}' "$STALE_JSON"
```

預期 `409` 與 `revision_conflict`；若不是，停止並記錄觀察，不反覆重送。

### 7. 錯誤、對帳、清除與重啟

- 未登入 `401`、停權 `403`、輸入格式／language 錯誤 `400`、request body 過大 `413`、不存在／撤下／空內容／超過 64 份素材／單份 48 KiB 或總正文 512 KiB 上限 `422`、過時 revision `409`、帳號每日 20 次新工作名額或同議題 5 分鐘冷卻 `429`、每日 US$5 估算預留用盡 `503`。排隊／執行中的工作先占每日名額；已開始、結算或費用未知的 provider attempt 即使工作失敗仍計入名額與保留費用。若工作在付費 attempt 開始前終止，名額及同議題冷卻可釋放。64 份是單次實驗輸入上限，不是 #11.1 待辦的議題投稿上限；抽取後證據超過 64 段會以工作 `status:"failed"`／`error_code:"too_many_evidence"` 診斷，不會任意裁切。工作中非同步錯誤從 GET 的 `status`、`error_code`、`usage.uncertain` 與 diagnostics 查；來源失聯時 fail closed，不取回舊快照正文或自動重送付費呼叫。
- **Provider 失敗診斷：** 新版會在仍可寫入的隔離本機工件保存 `stage:"provider"`，包含 `step_key`、固定模型 selector、白名單 `error_name`、訊息開頭的數字 `provider_code`、例外本身明確提供的數字 `http_status`（400–599）及固定分類 `category`。分類只辨識 `json_mode_unmet`、`timeout`、`aborted`，其他為 `unknown`，不是供應商根因的保證；SDK 沒提供的 HTTP 狀態保持 `null`，不把 provider code 猜成 HTTP 狀態。不保存原始訊息、stack、cause、request、prompt、素材或 Cookie。診斷寫入失敗只輸出固定的 `evidence_provider_diagnostic_unavailable`，仍保留原 `provider_error` 與未知費用。舊工作無法補回已丟棄的例外；本次改動不變更模型設定或快取鍵，也不會自動重跑失敗工作。不要為取得診斷清空狀態、修改舊工作或任意變更語言／設定；新的最小重現工作仍需另外明確同意素材與平台費用。
- **生成內容驗證失敗：** `invalid_generation` 表示已有模型回應，但本站未接受為草稿。新版在 `stage:"generation"` 的 diagnostics 另保存白名單 `validation_code`，例如 `generation_invalid_candidate`、`generation_insufficient_group_citations`、`generation_invalid_json` 或 `generation_incomplete_completion`；非白名單例外為 null，不輸出原始錯誤訊息或模型內文。這與 `stage:"provider"` 的呼叫例外不同；內容不合格即使工作失敗，也不會退回已回報用量的費用。

失敗後可從已保存的 `JOB_JSON` 只讀取安全摘要，不再送 POST：

```bash
jq '{
  status, error_code,
  provider_errors: [
    (.diagnostics | if type == "array" then .[] else empty end)
    | select(.stage == "provider")
    | {step_key, model_selector, error_name, provider_code, http_status, category}
  ],
  generation_errors: [
    (.diagnostics | if type == "array" then .[] else empty end)
    | select(.stage == "generation")
    | {code, validation_code}
  ],
  usage: {
    attempts: .usage.attempts, uncertain: .usage.uncertain,
    reservedMicroUsd: .usage.reservedMicroUsd, actualMicroUsd: .usage.actualMicroUsd
  }
}' "$JOB_JSON"
```

空的 `provider_errors`／`generation_errors` 只表示這份回應沒有對應診斷，不代表模型未被呼叫或費用為零；舊工件也可能沒有 `validation_code`。完整 `JOB_JSON` 仍含來源快照，不能貼到聊天或 PR。

- 每個 DB binding 的第一個通過認證之 evidence API request 會先全量 reconcile 本機來源並修復 active Workflow；同一 isolate/binding 後續 request 不重複跑這次 startup bootstrap，失敗則下一個 request 可重試。正常 job GET 仍逐次查該 job 所依賴來源；管理員手動 reconcile 每次都全量查核並再要求 recovery。隱藏或變更只會在 startup reconcile 或下一次來源查核時發現，遠端 D1 沒有刪除通知，跨庫清除不是即時或原子同步。
- local Wrangler／Workflow kill 後，原生 Workflow instance 曾保持 `running` 而不會自行續跑；新 process 的 startup recovery 以明確 `restart()` 請求 safe replay，不代表 Cloudflare／本機 runtime 自動恢復。儲存層用來源 generation fence 保護快照、artifact、revision、狀態完成與讀取：來源被刪除或明確 erase 時會增加 tombstone generation、將本機來源／工件／修訂 payload 清空；較晚返回的在途回應不能重新保存或提供內容。來源僅隱藏或內容變更時標為 `withdrawn` 並停止提供舊內容，這與 hard erase 不同。已送出的 AI request 不能保證撤回。
- GET job 在載入 snapshot／artifact 後仍做最後一次狀態查核：若此時已 erase／withdrawn，只回最新狀態、時間與 usage 等 metadata，不回舊 `data`／引文／正文；正常回應亦採最新狀態，artifact ID 已變則 fail closed。核心以真正 SQLite barrier 交錯測試 erase 與 withdrawn，確認 snapshot 已讀取後才提交處置時，HTTP response 不含正文／引文／`data`；這是本機回歸測試，不是 OAuth 或 Workers AI 測試。
- admin／super-admin 可用 CSRF 保護的 `POST /api/evidence-maintenance/reconcile`，body 必須恰為 JSON `{}`；成功會回 `{ ok, checked, withdrawn, erased }` 並修復 active Workflow。`POST /api/evidence-maintenance/erase` body 必須恰為 `{ "kind": "material", "id": 25 }` 或 issue 版本，僅允許 `kind:"issue"|"material"` 與正整數 ID；它只在隔離本機 DB 建立永久 tombstone 並清除相關私有工件，不寫遠端來源。CLI `list` 僅回來源 ID／hash／查核時間；`reconcile` 可能發現已刪除來源而不可逆清除本機 payload，`erase` 則直接清除。**兩者均須先取得使用者對該次資料處置的明確授權；以下是手動決策的指令，不是驗收時自動執行的步驟。** material 25 與後面的 issue 13 都是永久 source opt-out，不是正常測試 reset：只應在相關測試／人工驗收完成且有清除理由後使用；同一隔離 DB 任何包含該 source ID 的新工作（即使 prompt/settings 改版）都會被拒絕。不得刪 tombstone、改 generation 或重建隔離 DB 來強迫重跑或繞過配額。

```bash
node scripts/evidence-maintenance.mjs list
# 以下兩項各自需要使用者事先明確授權；未授權時不要執行。
node scripts/evidence-maintenance.mjs reconcile --base "$BASE_URL" --cookie-jar "$COOKIE_JAR"
node scripts/evidence-maintenance.mjs erase --kind material --id 25
```


下列 issue 13 的 `erase` 命令同樣是永久資料清除範例，不是正常測試 reset：它會在此隔離 DB 對 issue 13 建立 per-source tombstone，之後任何包含該 issue 的工作都會被拒絕，即使 prompt/settings 更新。先列出本機來源；只有完成相關測試／人工驗收並另取得使用者對該次清除的明確授權後才可執行，否則不要執行。不要刪 tombstone、改 generation 或重建隔離 DB 來強迫重跑；未來是否允許明確 new-generation／new-consent re-import 留給人工決策。

```bash
node scripts/evidence-maintenance.mjs list
# 僅供使用者明確授權此筆 issue 清除後手動執行；未授權時不要執行。
node scripts/evidence-maintenance.mjs erase --kind issue --id 13
```

以上 `erase` 會清掉本機該議題相關快照／引文／模型輸出／人改 payload 並留下不含正文的稽核 tombstone。這個 per-source tombstone 永久阻止當前隔離 DB 中任何後續工作包含該 namespace／ID；來源僅隱藏／改動則撤下舊工作，但不等同明確清除全部本機 payload。操作後重新 `list` 核對。

若沒有安全可控的來源，隱藏／變更／刪除及晚到回應 fence 的可重做檢查只使用本機測試 fixture；不可修改、隱藏或刪除真實遠端來源來製造案例。以下測試使用 in-memory SQLite／合成 provider，另覆蓋一般 API router 的六條實驗／maintenance 路徑 `404`，以及 session、停權、角色、CSRF、來源失聯與清除競態；它們不是 live OAuth、正式入口 runtime 或真實模型的證據：

```bash
vp test src/tests/evidencePipeline.test.ts src/tests/evidenceStorage.test.ts src/tests/evidenceSource.test.ts
```

保留手動驗收尚未驗證的狀態；不要因為 fixture 全過而聲稱真人來源生命週期或模型品質已驗收。

需要檢查一般入口的 runtime 時，先確認 5174 無 listener；占用時不要終止未知程序。另開 terminal 以一般本機 mode 啟動（不套 migration、不帶實驗 Cookie），只對自己確認啟動的 server 作匿名 status-only 檢查：

```bash
lsof -nP -iTCP:5174 -sTCP:LISTEN
CIVIC_AI_EXPERIMENT=0 vp dev --host 127.0.0.1 --port 5174 --strictPort
```

在另一個 terminal：

```bash
curl --disable --noproxy '*' --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' \
  --header 'Origin: http://127.0.0.1:5174' --header 'Content-Type: application/json' \
  --request POST 'http://127.0.0.1:5174/api/issues/1/evidence-jobs' --data-binary '{}'
```

一般入口預期 `404`；這不是 OAuth 或 live model 驗收。完成後只在自己啟動的一般 dev terminal 按 Ctrl-C。若要重啟實驗 Worker，先在自己啟動的實驗 terminal 按 Ctrl-C，重新確認 canonical 5173 沒有其他 listener，再在 repo root 執行第 2 節的 `CIVIC_AI_EXPERIMENT=1 vp run dev:remote`；登入後以第 4 節的有限 GET 查看原 job，不重送 paid POST。重啟後的首個認證請求會對帳並可能清除已刪除來源的本機 payload；不代表已送出的模型請求被取消。

結束人工驗收時在實驗 server 仍運作且 canonical origin 經確認後結束自己的登入 session 並移除本機 Cookie jar：

```bash
curl --disable --noproxy '*' --silent --show-error --output /dev/null --cookie "$COOKIE_JAR" --header "Origin: $BASE_URL" \
  --request POST "$BASE_URL/api/auth/sign-out"
rm -f "$COOKIE_JAR"
```

#### 7.1 實驗後 migration 與私有狀態處置

以下為人工決策順序，不是自動清理命令；任何不可逆的資料處置都要另取得使用者明確授權：

1. **區分三種東西。** `migrations/0017_evidence_pipeline.sql` 是版控的程式來源／供 review，新增八個本機 `ct_ai_*` 表及索引，外鍵只互相指向 `ct_ai_*`，沒有指向來源／auth 表，也沒有修改 `0001`–`0016`；`.wrangler/ai-experiment/` 內的隔離 D1 有實驗資料與 `d1_migrations` 已套用紀錄；遠端業務來源與 auth DB 不是清理目標。本次只在專用本機 D1 套用 `0017`，沒有對遠端業務或認證庫套 migration；Better Auth 的正常登入／session 寫入仍是計畫明列的例外，不能把它說成永無遠端 auth 寫入。`wrangler deploy` 本身不會自動 apply migration；風險在於另行執行一般 migration apply。
2. **維持草稿／尚未合併：** 為重現與審查保留 `0017` 原始檔、隔離本機 migration／usage ledger 及必要實驗狀態，包括 tombstone 與未知費用預留。任何保留的 DB／ledger 都要能對回相符且不可變的原 SQL，可使用固定 Git commit 或可取得的封存副本；不必為了保留資料庫而永遠將檔案留在一般 `migrations` 目錄。不得覆寫或重用同一 migration 歷史中已套用的版本；刪除來源檔不會回滾資料庫 schema。未來 `main`／catalog 的編號由維護者依實際歷史另行核准，不是全域永久保留 `0017`。
3. **打算保留或將來合併：** 目前一般與實驗 config 共用 `./migrations`，單靠本文件不能防止誤套。合併前維護者必須先決定並審查具體方案：讓實驗 migration 有獨立、可重現的隔離 catalog，或先明確決定 production 需求、核准並審查永久 migration 的完整編排與既有資料庫歷史，再實作及檢查該方案；不可把暫態 `0017` 直接視為正式 migration。方案未定、必要處理與驗證未完成前此 PR 保持 draft，不可合併或執行一般 migration。此處不移動檔案、不暗改 schema。
4. **決定放棄整個未合併實驗：** 以關閉 PR 而不合併的決策確保 `0017` 不進 `main`；由使用者先決定私有工件與稽核資料的留存，再決定是否處置本機隔離狀態。後續若要從分支移除 active `0017`，必須一併移除或 revert 依賴的程式、測試及設定，不可單刪 schema；保留的 DB／ledger 仍須能對回相符的不可變原 SQL，但不必先刪除所有封存 DB。移除檔案不會回滾 DB，也不是對遠端業務／auth DB 下 DROP SQL 的授權；不可刪除全域 `.wrangler`。
5. **若使用者授權處置隔離狀態：** 先停止自己擁有的實驗 dev process，確認在途工作及費用狀態，並按使用者核准的留存政策處理。`.wrangler/ai-experiment/` 可能含 Cookie jar、來源快照／引文／原始模型回應、人改內容、Workflow checkpoints、traces、usage 與本機 D1；不得將憑證、原文或私有 payload 提交或公開。僅把人工確需且經檢查不含個資的 prompt 版本／hash／診斷摘要留到核准的私有位置；Cookie、OAuth token、secret 不備份或公開。按第 7 節以既有 `list` 盤點、按已授權的權利請求使用 `erase`，保留計畫要求的不含正文稽核 tombstone；不要為強迫付費重跑而刪 tombstone、重設 generation 或重建狀態，也不要重置以繞過配額。只有完成上述留存決策並取得對**整個隔離狀態**的明確處置授權後，才由擁有人手動處理該專用目錄，不提供或執行全域刪除指令。丟棄本機狀態無法撤回已送出的模型請求或費用。

### 8. 已觀察證據與未知真相

以下是本次環境檢查的去識別紀錄，不是模型品質報告：

| 項目 | 狀態 | 證據／限制 |
|---|---|---|
| 日期／分支／source metadata | 歷史紀錄 | 2026-10-29；`feat/issue-183-evidence-pipeline`；初始工作目錄乾淨；先前 build 的 source metadata commit `bb111b6442b856d054bfee4d137d08877f2a4edf`，`dirty=true`；不是後續 commit 或發布版本的 SHA |
| CLI／遠端唯讀來源 | 已執行 | `vp exec wrangler whoami` 可用，具 Workers／D1／Workers AI 權限；缺 `k2.read`／`k2.write`。固定 SELECT 只回 issue 13 與 materials 25／26 的狀態、ID、metadata 長度及 UTF-8 bytes（339／449），來源狀態符合查核條件，`rows_written:0`、`changed_db:false`，沒有讀正文 |
| 隔離本機 DB migration | 已執行 | `0001`–`0017` migration 已套用；`sqlite_master` 顯示 app table 皆為 `ct_*`；實驗 D1 路徑 `.wrangler/ai-experiment/v3/d1` |
| 混合 D1 binding target | 已執行，只讀 | Wrangler `getPlatformProxy` 明確使用 `remoteBindings:true`；D1-only 暫存設定精確複製正式實驗設定的 DB／SOURCE_DB 名稱、同 database ID 與 `DB.remote:false`／`SOURCE_DB.remote:true`，但省略 secrets 和其他 bindings。指定 `.wrangler/ai-experiment/v3` persist 後，本機 `DB` 的 `sqlite_master` 計得 8 個 `ct_ai_*` 表；遠端 `SOURCE_DB` 僅回安全計數：issue 13 published 且未標記 `1` 筆，materials 25／26 屬 issue 13 且未標記 `2` 筆。`writes:0`；未碰 `DB_AUTH`、未讀正文／作者欄。結果 `.wrangler/ai-experiment/verification/binding-target-proof.json` |
| Privacy UI | Chromium 12 組 DOM/computed 檢查、真實頁面 PNG 與可讀 disclosure crops | 一般本機 `/privacy`：1440×1000／390×844、桌機／手機、light/dark、zh-TW/en/ja 共 12 組均確認正確 locale/theme、作者快照欄位排除／原文不脫敏揭露與無水平溢出。12 張實際瀏覽器頁面 PNG：`.wrangler/ai-experiment/verification/privacy-{zh-TW,en,ja}-{desktop,mobile}-{light,dark}.png`；摘要 `privacy-captures.json`。首次截圖嘗試 timeout，改用 `DOMContentLoaded` 後 `page.screenshot({waitForFonts:false})` 成功；已目視檢閱代表圖 zh-TW desktop light、zh-TW mobile dark、en mobile light、ja desktop dark。另以 `sips` 從既有 PNG 裁出可讀的 zh-TW mobile dark／English mobile light disclosure 檢視，檔案 `.wrangler/ai-experiment/verification/privacy-zh-TW-mobile-dark-disclosure.png`、`.wrangler/ai-experiment/verification/privacy-en-mobile-light-disclosure.png`；未重繪或擷取 OS desktop。其餘 8 張有 PNG／DOM 記錄但未逐張人工目視。外部網域被瀏覽器 allowlist 擋下，畫面使用本機 fallback 字型，不宣稱 Google Fonts 已驗。一般 `vp dev` 嘗試因 5173 listener 退出；截圖連到既有一般本機網站，不是專用 Worker |
| 冷啟／Workflow replay | 合成情境已驗證；無 live AI | in-flight attempt 終止 `provider_uncertain`、reserved 604 microUSD、不重複呼叫；已保存 Clef raw／checkpoint gap replay 重用 3 個 raw IDs、不重複 Clairic/Clef、只新增 Gemma 一次而到達 `ai_draft`。原生 local Workflow 在 kill/restart 後先顯示 `running`，不會自行恢復；需應用程式 startup 明確呼叫 safe `restart()`。皆為合成估算／呼叫，不是帳單或 live model evidence |
| host 修正後的早期 check／tests | 已執行；歷史階段 | `vp check --no-fmt --no-lint`：148 files；`vp test`：48 files、435 tests。stdout／status：`.wrangler/ai-experiment/verification/host-fix-typecheck.log`、`host-fix-typecheck-status.json`、`host-fix-test.log`、`host-fix-test-status.json` |
| Cookie jar 修正後 check／tests／build | 已執行；後續 README 清理 trap 及本次文件修改前 | `vp check --no-fmt --no-lint`：150 files；`vp test`：49 files、436 tests；`vp run build` exit 0，source metadata 仍為上述 dirty build，且有既有 JS chunk >500 kB warning。log／status：`.wrangler/ai-experiment/verification/cookie-jar-{typecheck,full-test,build}.*`；不代表本次文件修改後的檢查已執行或發布 |
| Cookie jar 清理 failure branches | 已執行；合成 loopback，不是 OAuth | 修正版 README §3 的真實 curl 401 與 stdin EOF 分支均確認只清理隔離 state 內目標，未碰 canonical listener；詳見 [`Insight.md`](./Insight.md) 的實際紀錄 |
| canonical localhost port guard | 已安全拒絕，不殺既有 listener | config 使用 `host: 'localhost'`、`strictPort:true` 後，因既有 node PID 55197 正在 `[::1]:5173`，直接 `CIVIC_AI_EXPERIMENT=1 vp dev --mode remote` exit 1 並回 `Port 5173 is already in use`；未啟動服務，未停止該 listener。log／status：`.wrangler/ai-experiment/verification/localhost-port-conflict.log`、`localhost-port-conflict-status.json` |
| config 修正後 temporary-port entry smoke | 已執行；不是 OAuth／callback 驗證 | 為避免碰既有 5173 listener，直接 `CIVIC_AI_EXPERIMENT=1 vp dev --mode remote --port 5174`（無 prebuild）於 `http://localhost:5174` ready。匿名 status-only 結果：`GET /` 404、job GET／POST 與 maintenance POST 均 401；無 cookie、body discarded、沒有登入／來源操作／建 job／模型呼叫。此 port 與 `BETTER_AUTH_URL` 不同，不驗證 OAuth callback。自有 PID 84596 已停止。log／status／HTTP：`.wrangler/ai-experiment/verification/entry-load-5174.log`、`entry-load-5174-status.json`、`entry-load-5174-smoke.json` |
| host 修正前的 IPv4 entry／官方 smoke 與 HEAD | 保留為舊配置的 no-login 證據，不代表 canonical origin | 本次環境整合檢查依 `lsof` 與 loopback 結果發現既有 `[::1]:5173` listener 與舊 IPv4 bind 的 origin mismatch；先前 remote Worker 綁 `127.0.0.1:5173` 並用 `curl --resolve` 強制 IPv4，root 404、匿名 job／maintenance 401，dotenv HEAD 路徑均 403。這些 forced-IPv4 smoke **不能證明**瀏覽器 canonical `localhost` 命中實驗 Worker，也不驗 OAuth callback。舊 log／status／HTTP：`.wrangler/ai-experiment/verification/experimental-dev.log`、`experimental-no-login-smoke.json`、`experimental-dev-head-final.log`、`experimental-dotenv-head-final.json`；沒有 response body 或登入 session |
| `.dev.vars` 靜態路徑／權限檢查 | 只查 public ASSETS 路徑與檔名／mode；未讀內容 | `dist/civic_talk/wrangler.json` 的 `assets.directory` 解析為 `dist/client`；`dist/civic_talk/.dev.vars` 位於 ASSETS 之外，mode 644 且由 `.gitignore:2 dist` 忽略；`dist/client/.dev.vars` 不存在。這不證明 Worker bundle／deploy package 是否包含它；未刪除／改權限／部署 |
| 真實 OAuth／Workers AI 呼叫與費用 | 尚未執行 | 沒有登入或 consented job，沒有本次真實模型 request／usage／費用；OAuth callback 是否可用仍未知。帳號總帳單不在此紀錄範圍 |
| 人工語義品質 | 尚無獨立真人 gold labels | 本功能尚無真人手動功能驗收；程式測試或開發者設計的預期關係案例不能當人工標準答案。`clairic_test_result/` 為空，沒有可引用的舊模型 fixture |
| Gemma／Clef 能力 | 尚未驗證 | Gemma 4 未列入 Cloudflare JSON Mode 支援清單；Clef 文件提到 context state 會截斷且沒有回傳截斷旗標。provider `model` metadata 是任意字串而不是不可變權重 revision；usage 缺漏／格式錯誤會保持費用未知與原 reservation，不把格式正確答案因此作廢。沒有真實 provider 證據，不宣稱 JSON schema、未截斷或引用語義品質通過 |

人工驗收者須另填實際 source／model／prompt／schema／algorithm 版本、工作 ID、hash、來源覆蓋、逐句引用查核、漏失與反例、人工修正、usage／預留／結算及未知項目。沒有真實模型呼叫或真人標註時，對應欄位留作未知，不填預期值；不得把 HTTP 200、JSON parse、unit test、隔離測試 provider 或 fixture 寫成「真實議題人工驗收完成」。Privacy 已依新增揭露更新，`TERMS_VERSION` 未改；一般 BYO prompt 與 synthesis API 保留。


## 部署

```bash
vp run deploy    # = build + 建置產物／公開原始碼檢查 + wrangler deploy（需授權）
```

環境設定（機密、`BETTER_AUTH_URL`、OAuth callback 網址）、部署實際上傳的內容、煙霧測試清單與**絕對不能跑的 D1 指令**見 [`deploy_notes.md`](./deploy_notes.md)。

更完整的 agent／架構指引見 [`AGENTS.md`](./AGENTS.md)。
