# Civic Talk（Hono + Vue SSR）

公共議題審議平台，**受原始版 [Civic Talk](https://github.com/v-taiwan/civic-talk) 啟發**，由該版靜態站移植而來：**Hono + Vue 3 SSR/hydration + Tailwind v4 + Cloudflare Workers / D1**。

本站受[ronnywang](https://www.github.com/ronnywang)提出的[原始構想](https://ronnywang.github.io/civic-notes/civic-talk/)的啟發。

內容生成仍由志願者使用自己的 AI token 完成，平台只產生 prompt 並收回結果；例外是投稿安全審查會呼叫外部 moderation 服務，素材事實查核則由 Civic Talk Worker 透過 Cloudflare Service Binding 呼叫不公開的 `fact-check-core` Worker。#183 另授權管理員以 Workers AI Clairic 進行只讀抽取實驗，供人工審閱、不自動發布，不改變志願者自帶 token 的內容生成流程。

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
- **議題說明輪播（#143）**：桌機與手機都以 `100dvh` 分配標頭、議題資訊、tabs、輪播與精簡授權列的高度，只在說明卡內捲動長文，避免頁面外層再出現捲軸。輪播不顯示狀態標籤與完整 footer，底部仍保留該建置版本的原始碼、授權與 client／Worker notices 入口；未提交版本沿用原始碼尚未發佈提示。寬螢幕說明內文維持 16px，訂閱鈕與 tabs 間距縮短。意見、素材與志願者工具保留自然捲動及完整 footer。
  - 小於 640px 時，輪播底部與一般 footer 的軟體授權相關項目統一收進「軟體授權」按鈕；點擊後以原生 dialog 顯示著作權、軟體授權說明、原始碼下載及 client／Worker notices 連結。可用關閉鈕、Escape 或點擊外圍霧面關閉，焦點回到按鈕。一般 footer 仍保留平台介紹、投稿內容授權與一般導覽；桌機維持原有連結與說明。按鈕與彈框統一由 `AppFooter.vue` 管理，連結共用 `SourceLicenseLinks.vue`，沿用相同的建置版本與未發佈判斷。
- **議題標籤與搜尋（#95）**：建立議題時可輸入自訂標籤，以 `, ` 分隔；去除開頭 `#` 與首尾空白，忽略空值，並忽略大小寫去重、保留第一個字樣。管理員可在既有議題編輯視窗增刪標籤，清空欄位即可全部移除。首頁議題卡於手機底部另起一排、桌機右下角顯示標籤；搜尋同時比對標題、簡介與標籤（含 `#tag` 寫法），並以所有未隱藏議題的標籤提供原生 autocomplete 建議。`?search=...` 可還原搜尋，輸入時以 `replaceState` 更新網址；議題預覽、返回清單與上一頁／下一頁保留搜尋及其他 query／hash。角色過濾與排序規則不變。
  - 首頁議題卡片在 tags 右側顯示單色人頭圖示與意見數，沿用清單 API 的 `opinion_count`（不是不重複參與者人數）；0 則時不顯示整組圖示與數字。手機版位於卡片底排右側，桌機位於右下角；tags 可換行、計數不拆行，沒有 tags 時仍可顯示非零計數。無障礙名稱沿用三語意見數單位，點擊該區仍開啟原本的首頁預覽。
  - **首頁累計票數（#178）**：意見數右側以眼睛圖示顯示 `vote_count`，不是不重複參與人數。同意、不同意、略過各計一票，每則具名意見另加一張作者當然同意票；只計 `abuse_flagged IN (0, 1)` 的公開意見，無作者的舊資料不加虛擬票。0 票時隱藏圖示與數字，三語無障礙標籤明示累計票數。
    - 首頁 SSR 與 `GET /api/issues`（含管理員投影）共用依 origin 隔離的 Cloudflare Cache API 統計，TTL 為 5 分鐘；投票、收回、刪除及審查變動不主動清除快取，數字可能延遲更新。快取只保存議題 ID、總票數與到期時間，不包含身分、email 或個別意見的投票分布；議題內容與作者投影仍即時查詢，API 的 `private, no-store`／`Vary: Cookie` 不變。
    - 每個 Cloudflare 資料中心各自快取，不保證跨區共用或常駐；未命中／到期時以一個 SQL 彙總全部議題，使用既有的 `idx_ct_opinions_issue_id` 與 `idx_ct_opinion_votes_opinion` covering index，避免逐張首頁卡片額外查詢、JOIN 重複計入作者或新增計數寫入。Cache API 不可用時直接查 D1，不回假零值；無須新增表或 migration。
    - 「最多關注／最少關注」改以 `opinion_count + vote_count` 降冪／升冪排序，不計素材數；票數沿用上述快取，可能延遲更新。角色的狀態優先序仍先套用，只在同一狀態內依關注數排序；同分保留原清單順序，「最新」仍依最新活動時間排序。
    - 使用者切換「最新／最多關注／最少關注」時，將選擇存入瀏覽器的 `localStorage.civic_home_sort_order`；之後進入首頁會在 hydration 後恢復，不需登入，也不寫入帳號或 D1。SSR 與初始 hydration 固定為「最新」，缺少偏好、值無效或儲存被封鎖時也回到「最新」；若無法保存，仍可在目前頁面正常切換排序。
  - 首頁搜尋工具列在小於 640px 時維持直排，搜尋框佔滿容器寬度；640px 至 1023px 由外層容器保留至少 20rem 寬度並伸展使用剩餘空間，`lg`（1024px）以上則固定為工具列寬度的 50%，不再伸展或收縮。原生搜尋框固定填滿搜尋容器，不直接參與 flex 寬度分配；空間不足時工具列換行，避免 placeholder 被其他控制項擠窄。
- **使用者回報（#148）**：桌機以相同圖示＋「使用者回報」文字合成單一按鈕，手機頂列使用回報圖示，點擊開啟 modal、不換頁。手機 Navbar 維持單列，登入頭像位於角色切換左側，右端依序為「公民／志願者 → 回報圖示 → 漢堡選單」。三種分類與描述必填，免登入匿名送出，關閉後保留當頁回報草稿。回報只保存分類、描述、頁面路徑＋query、ID 與時間，僅管理員可瀏覽；不讀取或保存回報者帳號，也不額外收集 IP／瀏覽器資料。回報視窗與後台提供另開 GitHub issues 的連結，不自動傳送回報內容。
  - 回報按鈕在 `sm`（640px）起就顯示圖示＋文字，不必等到桌機導覽列展開；小於 640px 僅顯示圖示。所有寬度均維持同一列與同一個按鈕。
  - 點擊回報 modal 外圍霧面、按 Escape 或關閉鈕可收起視窗，分類與未送出描述仍保留；點擊框內內容或留白不會誤關閉。送出期間這些關閉操作皆暫停，請求結束（含失敗或 15 秒逾時）後恢復。
  - 手機回報視窗（#151）使用動態視窗高度；一般高度下由描述欄位填滿剩餘空間、長文在欄位內捲動。短螢幕、長網址或錯誤提示使內容放不下時，改由表單內層捲動，保留可用的輸入高度並讓操作按鈕可達；彈窗本身不捲動。桌機維持五列輸入框，兩種版面皆可垂直調整欄位尺寸。
  - 管理後台的「使用者回報」排在第一個分頁；`/admin` 未指定或帶無效 `tab` 時預設顯示回報。其他分頁使用明確的 `?tab=reports|moderation|issues|materials|opinions`，`?tab=feedback` 仍可直接開啟回報；切換回報時省略 `tab`，其他 query、hash 與上一頁／下一頁狀態照常保留。
- **三語介面（#136）**：桌機標頭與手機選單可直接選擇繁體中文、English、日本語。掛載後優先恢復 `localStorage.civic_lang` 的手動偏好（保留舊值 `zh`）；沒有有效偏好或儲存不可用時，依 `navigator.languages` 順序選第一個支援的語言，清單為空時改用 `navigator.language`。`en-*`／`ja-*` 分別使用英文／日文，`zh-*` 使用繁中，皆不支援時回繁中；自動偵測不寫入手動偏好。SSR 維持繁中，因此初次載入可能先短暫顯示中文，再於掛載後切換；停用 JavaScript 時維持繁中。日期與 `OPINION.md` 引導文件跟隨語言，使用者投稿的原始內容不自動翻譯。
  - 三語 navbar 統一在 1280px 起展開桌機導覽，以下使用漢堡選單；桌機容器同步加寬、長名稱截斷並可懸停查看全文，避免登入後的管理連結與使用者資訊擠版。下拉選單與桌機登入面板沿用相同斷點。手機透過較小 logo 與水平間距維持單列；日語桌機仍以 `isJapanese` 使用較小字級，志願者表單標籤在日語手機版也使用較小字級；中英版不縮字，footer 正常換行。首頁排序在所有寬度均使用帶「優先顯示：」三語標籤的下拉選單（#161），保留最新、最多關注與最少關注三種排序。

## 開發

```bash
cp .dev.vars.example .dev.vars   # 填入 Better Auth 與 Google／GitHub OAuth 憑證
npm install
npx wrangler d1 migrations apply vtaiwan-civic-talks --local
vp run dev
```

> 登入功能在 `vp run dev` 下**測不了**：Better Auth 的資料表在遠端的 `vtaiwan-auth`，本機模擬庫是空的。要實測登入請用 `vp run dev:remote`。

### Clairic 抽取實驗

`POST /api/issues/:id/extraction-preview` 僅供未停權的 `admin`／`super-admin` 測試，沒有 UI；只讀取允許的議題與素材，回傳人工審閱用原文摘錄候選及 Markdown，不寫入業務資料、不發布；既有 Better Auth session 生命週期仍可能寫入認證資料庫。建議以 `scope: "issue"` 將選取素材一次送入同一個 Clairic state、只呼叫一次模型，檢視跨素材候選和出處。候選不是已驗證的共識，也不是對來源文章的事實查核；不保證涵蓋全部意見。詳見 [抽取契約、限制與人工檢查方式](./docs/clairic-extraction.md)。

本機以 `vp run dev:remote` 啟動後，在同一個本機 origin 以管理員登入。AI 呼叫仍在 Cloudflare 遠端執行、使用真實帳號額度並可能產生費用；不要使用不願送出的素材。以下範例需將 `ORIGIN` 換成開發伺服器實際網址及登入 origin、`ISSUE_ID` 換成允許抽取的議題 ID。在同一個互動式終端貼上並執行整個括號區塊，等提示出現後，再從同源瀏覽器開發工具將該登入請求的 **Cookie 標頭值**貼入不回顯的提示；不要將 cookie 存入 repo、貼到 issue／訊息、放進 shell 歷史，或在共用終端及 shell trace 中操作。結果可能含投稿內容，也應妥善保護。

```bash
(
set +x
ORIGIN='http://localhost:5173'
ISSUE_ID=123
COOKIE_HEADER_FILE="$(mktemp "${TMPDIR:-/tmp}/civic-cookie.XXXXXX")"
chmod 600 "$COOKIE_HEADER_FILE"
trap 'rm -f "$COOKIE_HEADER_FILE"' EXIT
printf '貼上 Cookie 標頭值（不會回顯）： ' >&2
IFS= read -r -s COOKIE_VALUE
printf '\n' >&2
printf 'Cookie: %s\n' "$COOKIE_VALUE" > "$COOKIE_HEADER_FILE"
unset COOKIE_VALUE
curl --silent --show-error -X POST "$ORIGIN/api/issues/$ISSUE_ID/extraction-preview" \
  -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -H "@$COOKIE_HEADER_FILE" --data '{"scope":"issue"}'
rm -f "$COOKIE_HEADER_FILE"
trap - EXIT
)
```

若已安裝 `jq`，可將上述 curl 末尾改為 `--data '{"scope":"issue"}' | jq 'if .analysis then {scope, selection, material_ids, usage, analysis} else . end'`，閱讀全批候選、來源 ID 與本次呼叫的用量；或改用 `--data '{"scope":"issue"}' | jq -r 'if .markdown then .markdown else . end'` 閱讀 Markdown。遇到錯誤仍顯示 JSON 錯誤。輸出可能含素材原文，勿寫入公開日誌。

`{"scope":"issue"}` 選取所有符合條件的素材；可改用 `{"scope":"issue","material_ids":[12,15]}` 指定子集，仍按建立時間／ID 排序。每次至多 8 筆、每筆原文至多 4,000 UTF-8 bytes，整批 state（含素材 ID 標籤）至多 8,000 UTF-8 bytes；逾限整批報錯而非默默截取。這是本實驗上限，不是全站素材數量限制或 token 保證。

省略 `scope` 的 `{}` 或 `{"material_ids":[12,15]}` 維持原有逐素材抽取與 `extractions` 格式，每筆一次模型呼叫及其各自的 `usage`；新模式則以 `analysis` 表示全批候選，只有回應頂層的單次 `usage`，不分攤到各素材。其他 `scope` 值回 `400`。

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

寬度達 `lg`（1024px）時，說明輪播外層（含議題資訊與頁籤）置中、最大寬度為 `5xl`（1024px），左右各保留 48px padding，避免寬螢幕卡片橫向過滿（#164）。小於 1024px 的版面與意見、素材、志願者工具維持原有容器及留白；輪播高度與卡內長文捲動規則不變。

首頁點議題卡後的說明預覽（`?action=click_issue_card&issue=<id>`）由 `IssuePreviewCard.vue` 呈現，卡片同樣置中、最大寬度為 `5xl`（1024px）；窄螢幕沿用容器原有左右留白，不影響首頁議題清單或「進入議題」導覽。

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
- 認證資料庫：D1 `vtaiwan-auth`（binding：`DB_AUTH`），schema 由 `../vTaiwan-hono` 維護——本 repo **只讀不改**，🚫 不對它跑任何 migration
- 遠端 migration 需先取得授權：`npx wrangler d1 migrations apply vtaiwan-civic-talks --remote`

## 部署

```bash
vp run deploy    # = build + 建置產物／公開原始碼檢查 + wrangler deploy（需授權）
```

環境設定（機密、`BETTER_AUTH_URL`、OAuth callback 網址）、部署實際上傳的內容、煙霧測試清單與**絕對不能跑的 D1 指令**見 [`deploy_notes.md`](./deploy_notes.md)。

更完整的 agent／架構指引見 [`AGENTS.md`](./AGENTS.md)。
