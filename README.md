# Civic Talk（Hono + Vue SSR）

公共議題審議平台，受 [Civic Talk 原始版](https://github.com/v-taiwan/civic-talk) 與 [ronnywang 的構想](https://ronnywang.github.io/civic-notes/civic-talk/)啟發，由靜態站移植為 **Hono + Vue 3 SSR/hydration + Tailwind v4 + Cloudflare Workers / D1**。正式站：<https://civic.vtaiwan.tw>。

## 用途與現況

- 公民建立議題、提供素材、發表意見並投票；志願者使用自己的 AI 工具與 token 彙整素材、製作議題說明。
- 平台另提供「一鍵彙整」證據 API；建構中的麥穗黃操作按鈕**暫僅在 dev 顯示**，production 不掛載新元件或啟動其狀態查詢。Workers AI 產生共識／爭點／立場地圖草稿，平台支付費用。**只保存私有、AI 未驗證結果，不自動發布、不改 briefing 或議題 status**；完整排版及後續驗收仍見 [#166](https://github.com/g0v/civic-talk-hono/issues/166)，維護驗收見 [#201](https://github.com/g0v/civic-talk-hono/issues/201)。
- 正式站 Google／GitHub 登入、投稿與管理角色已驗；**同 email 帳號整合成功**，見 [#5 確認](https://github.com/g0v/civic-talk-hono/issues/5#issuecomment-6225088110)。這不代表跨網域 SSO；四種寫入與管理端的完整作者快照仍未逐項正式驗證。
- 證據 API 已有品質實驗及正式匿名 401／跨站 403、管理員身分確認；登入後建立、快取、修訂、權限、費用與有效維護操作尚未完整正式驗收，`consent:false` 拒絕測試也未執行。進度以 [`TODO_AFTER_MERGE.md`](./TODO_AFTER_MERGE.md) 為準，不把本機通過視為正式全驗。
- 一般設定保留 `EVIDENCE_API_ENABLED=1`；上輪清理已由使用者 push，未回報部署。原始碼推送不等於正式站更新；專用實驗／審閱 profiles、CLI 與 fixtures 已移除。

## 架構與重要檔案

| 位置                                                       | 用途                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/worker.ts`、`src/index.ts`                            | Worker 入口與 Hono 應用                                                                               |
| `src/views/`、`src/components/`、`src/client/`、`src/ssr/` | Vue 頁面、共用元件、hydration 與 SSR                                                                  |
| `src/api/`、`src/auth/`、`src/moderation/`                 | 一般 API、Better Auth、投稿安全審查                                                                   |
| `src/ai/`                                                  | 證據 API、來源快照、Workflow、模型生成、費用與生命週期                                                |
| `src/l10n/`、`src/styles/app.css`                          | 繁中／英文／日文與 Tailwind；設計 token 來源為 `../vtaiwan-design-system/project/colors_and_type.css` |
| `migrations/`、`wrangler.jsonc`                            | 業務 D1 schema 與 Workers bindings                                                                    |
| `scripts/`、`src/tests/`                                   | 建置、來源／授權產物檢查與自動化測試                                                                  |

業務庫為 `vtaiwan-civic-talks`（`DB`，表名 `ct_` 前綴）；證據來源預設讀 `SOURCE_DB ?? DB`。共享認證庫 `vtaiwan-auth`（`DB_AUTH`）由 [`../vTaiwan-hono`](../vTaiwan-hono) 維護，本站只讀角色，**不可對它套本站 migration、修改 schema 或直接 SQL 寫入**；正常 Auth 登入／session 生命週期是既有寫入例外。原始 `0017_evidence_pipeline.sql` 已套業務庫，保留原 SQL 與 ledger，不重跑或改寫；#210 新增 `0018_evidence_summaries.sql`（`ct_issues.ai_summaries` 與 `ct_ai_summary_slots`），遠端套用須另獲授權，見[部署紀錄](./deploy_notes.md)。

## npm + vp 開發

使用專案要求的 npm（`^12.0.1`）與 Vite+ `vp`：

```bash
cp -n .dev.vars.example .dev.vars  # 僅首次建立；機密私下填寫，不提交
npm install
vp run dev
```

| 指令                          | 用途                                                  |
| ----------------------------- | ----------------------------------------------------- |
| `vp run dev`                  | 先 build，再啟動本機 Worker + HMR；本機 DB、Auth 停用 |
| `vp run dev:remote`           | 先 build，再使用真實遠端 bindings 與 Auth             |
| `vp run build`                | 建置 CSS、client、Worker 與 notices／來源 metadata    |
| `vp run css:watch`            | 監看 Tailwind CSS                                     |
| `vp check --no-fmt --no-lint` | 型別檢查                                              |
| `vp test`                     | 自動化測試                                            |
| `vp exec wrangler types`      | 產生 bindings 型別                                    |

日常 `dev` 刻意不初始化本機空認證庫：session 為 `200/null`、`/api/me` 與需登入操作為 401，登入／OAuth callback／個人資料更新為 503；既有 cookie 也視為匿名，沒有假使用者或匿名寫入。停用只限 Vite `DEV && mode === 'development'`，**remote 開發與正式建置不受影響**。

**`dev:remote` 不是隔離 sandbox**：真實 Auth／D1／AI 可能寫入遠端、恢復工作及付費，不能拿來未授權試打。開發 notices 使用啟動前 build 快照，更動依賴或 imports 後須重啟。依賴／lockfile 變更須同步授權盤點與 notices，流程見[依賴安全](./docs/dependency-security.md)與[授權盤點](./docs/licensing-review.md)。

## 主要流程

1. **投稿**：建立議題、素材、意見、說明頁與志願者 prompt 需未停權的登入者。素材先呼叫同源 `/api/fact-check`，由 Service Binding 轉送非公開 `fact-check-core`；投稿仍須通過條款與 OpenRouter 安全審查。
   議題簡介最多 300 字（Unicode code points）；超過時停用送出按鈕，縮短至 300 字內即恢復。編輯器保留全文、不截斷；`POST /api/issues` 同樣在模型審查與寫入前攔截超長簡介，回 `400 {error:"description must be at most 300 code points"}`，省略或空白簡介仍可建立。
2. **志願者彙整**：取 prompt → 自己的 AI 工具生成 → 送回彙整／說明頁。彙整與再彙整至少須有兩份同議題、`abuse_flagged=0` 的可用素材；不足時 UI 停用生成／複製／送出並提示數量，仍保留可編輯草稿。`GET /api/issues/:id/prompt?type=summarize|synthesis` 與含非空共識／爭點／立場欄位的 `POST /api/issues/:id/briefing` 都會在審查與寫入前回 `422 {error:"insufficient_materials",minimum:2,count}`。待審、隱藏及其他議題素材不計入；單獨更新說明頁與管理員編輯既有內容不新增此限制。公民意見引導不得把未獲認可的 AI 建議當成參與者立場，也不強造共識。
3. **身分與隱私**：四種內容保存投稿當下作者快照，前台顯示姓名，email 僅於該筆明確同意公開時顯示；三類具名投稿保存條款版本與時間。完整快照不能直接投影到公開 API。
4. **討論與管理**：意見提供同意／不同意／略過與登入後 CSV 匯出；不再載入 polis.tw。管理員可審查內容、編輯議題、附公開理由結案／重開；結案獨立於 status，不停止投稿、投票或匯出。
5. **瀏覽**：三語介面不翻譯投稿原文，SSR 初始為繁中；首頁支援搜尋／標籤與排序。議題預覽卡簡介在 640px 以上比標題向右縮排 8px，手機維持原對齊。累計票數不是人數，含具名意見作者當然同意票，統計可能有五分鐘快取延遲。

## 重要頁面與一般 API

| 頁面                                                               | 用途                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `/`                                                                | 議題列表、搜尋、預覽與新增議題                                              |
| `/issues/:id`                                                      | 說明輪播；`?step=comments\|materials\|volunteer` 切換意見、素材、志願者工具 |
| `/issues/:id/source/:materialId`、`/issues/:id/comment/:opinionId` | 可分享的素材／意見詳情                                                      |
| `/contribute/:id`                                                  | 素材投稿                                                                    |
| `/about`、`/privacy`、`/terms`                                     | 平台介紹、隱私政策、使用條款                                                |
| `/admin`                                                           | `admin`／`super-admin` 後台；預設使用者回報                                 |

一般 API 入口為 `src/api/`，完整相容守則見 [`AGENTS.md`](./AGENTS.md)：

- `/api/auth/*`、`GET /api/me`：登入與身分；本站不開 Auth 成員管理端點。
- `GET/POST /api/issues`、`PUT /api/issues/:id`：列表／新增／管理員編輯。`tags: string[]` 在新增時省略為空；編輯時省略保留、`[]` 清除。列表仍包含進行中及已結案議題。
- `PATCH /api/issues/:id/closure`：管理員送 `{ "closed": true, "reason": "公開理由" }`；trim 後理由 1–1,000 code points，衝突 409，不自動反轉或重送。
- `POST /api/fact-check`：登入後素材查核，不向瀏覽器提供服務 token。
- `POST /api/feedback`：免登入，送 `{ "category": "bug", "description": "問題說明", "page_path": "/about" }`，分類可為 `bug|usability|suggestion`。只保存內容／頁面路徑／時間，不收回報者帳號或額外 IP／瀏覽器資料；`GET /api/admin/feedback` 僅管理員可讀，沒有公開查詢端點。

## 一鍵彙整：八個證據端點

Clairic 逐素材抽取 → Clef 比較 → Gemma 生成草稿；歷史[品質結果](./results/ai-experiment_result.json)與[費用報告](./results/ai-experiment_cost.json)不是本次範例的執行結果或獨立 gold labels。完整契約見 [API 手冊](./docs/evidence-api-review.md)。

**執行前先各別確認來源、帳號／角色與授權；新付費工作、恢復 queued 及維護操作須各別同意。以下 ID 都是佔位示意，不是可直接執行的正式測試。使用同源登入 session，不輸出或匯出 Cookie。**

| 方法與路徑                                 | 權限／用途與 JSON                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `POST /api/issues/:id/evidence-jobs`       | 登入者建立／加入／取快取；`{consent:true, language?, material_ids?}`              |
| `GET /api/evidence-jobs/:jobId`            | owner 或管理員讀狀態、草稿、引用及來源紀錄                                        |
| `GET /api/evidence-jobs/:jobId/revisions`  | owner 或管理員讀 AI 基底與人工修訂；須有可交付草稿                                |
| `POST /api/evidence-jobs/:jobId/revisions` | **僅 owner** 修訂；`{parent_revision_id, data}`，管理員不可代改他人工作           |
| `POST /api/evidence-maintenance/reconcile` | 管理員對帳；精確 JSON `{}`，回 `{ok,checked,withdrawn,erased}`，也可能恢復 queued |
| `POST /api/evidence-maintenance/erase`     | 管理員按來源清除；`{kind:"issue"或"material",id:正安全整數}`，回 `{ok:true}`      |
| `GET /api/issues/:id/evidence-summary?language=zh-TW` | 登入者讀指定語言的版本／有無結果；工作與結果正文僅各自 owner／管理員可讀 |
| `POST /api/issues/:id/evidence-summary` | 登入者一鍵彙整所有合格素材；精確 JSON `{consent:true,language,expected_version}` |

### 志願者工具的一鍵彙整（#210）

建構中的新 UI 以 `import.meta.env.DEV` 控制整個元件的掛載：`dev`／`dev:remote` 可見，production build 不輸出新按鈕、同意視窗或狀態提示，也不會由此元件發出摘要查詢／輪詢或 debug log；即使 build 的 mode 名稱為 `development` 也不例外。這不是 CSS 隱藏，也不是 API 開關：後端證據 API、migration 與既有 Prompt 流程維持原契約。`dev:remote` 仍連真實 bindings，登入／付費實測須另行授權。

在「生成彙整 Prompt」旁按「一鍵彙整」，閱讀處理、平台費用與留存告知後明確同意；已有該語言結果時，另須確認替換。語言跟隨操作時介面，繁中／英文／日文分開保存。舊 Prompt／手動貼回流程保留。

新端點以 `version`／`expected_version` 防止未確認的併發替換，衝突回 `409 summary_conflict`，須重新讀取並確認，不自動重送。只有完整 `ai_draft` 才寫入議題新欄位；部分完成、失敗或較舊工作晚完成都不覆蓋較新的結果。工作即使在離開頁面後完成，也由伺服器保存；舊工作仍保留原紀錄。來源失效時停止交付，來源清除時也清除議題欄位中的相依資料。

完成保存本身也會遞增 `version`；前端以最新工作與已保存結果的工作身分判斷成功，不把同一工作正常保存造成的版本增加誤判為被取代。

本階段只顯示進度及成功／部分完成／失敗提示，尚不排版報告；完整成功且確認保存後，或 `partial_draft` 回傳可交付 `data` 時，會在操作者瀏覽器 `console.log` 暫用輸出 `data`。部分草稿只供排查，不代表已存為目前彙整，也不覆蓋先前結果；同一語言／工作／版本在元件生命週期內不重複輸出，重新整理會重新輸出。這是私有內容，不應將 Console 截圖或紀錄公開；伺服器不記錄正文。新欄位不加入公開 API／SSR，讀取仍受 owner／管理員限制，並不因位於議題上就成為共享或公開內容。

需先在業務 DB 套用 `0018_evidence_summaries.sql` 才能使用；本機驗證與 UI 瀏覽不代表已套正式 migration、部署或完成正式付費驗收。

### 建立與取結果

經授權後，在同源登入環境送出以下 HTTP 請求（議題及兩份素材 ID 須替換為獲准來源）：

```http
POST /api/issues/<ISSUE_ID>/evidence-jobs
Content-Type: application/json

{"consent":true,"language":"zh-TW","material_ids":[<MATERIAL_ID_1>,<MATERIAL_ID_2>]}
```

- `consent` 必須為 boolean `true`；缺少／false／字串皆拒絕。伺服器保存告知版本與時間，舊工作命中不覆寫原同意。
- `language` 可省略（預設 `zh-TW`），另支援 `en`、`ja`。省略 `material_ids` 代表所有合格素材；指定時須非空、不重複、同議題且可見的正安全整數。**實際選入至少兩份合格素材才可開始彙整**，隱藏素材不計入；只有一份回 `422 insufficient_materials`（`minimum:2`、`count:1`、`exclusions`），零份維持 `422 no_available_materials`。拒絕時不為該輸入建立工作或預留費用；既有工作的讀取與修訂不受此門檻影響。不接受正文、hash、作者或未知欄位。
- 回應含 `job_id`、`status`、`cache` 與 `input_coverage`（選材及 exclusions）：新建為 **202/miss**，加入進行中為 **202/joined**，完成快取為 **200/hit**；既存 failed 也可為 **200/joined**，HTTP 200 不代表生成成功。

使用回傳 `job_id`，經確認後單次查詢：

```http
GET /api/evidence-jobs/<JOB_ID>
```

回應含 `status`、可交付時的 `data`、`citation_map`、`provenance`，以及進度、usage、error_code 等。進行中為 `queued|extracting|comparing|generating`；`ai_draft|partial_draft|failed|withdrawn|erased` 應停止輪詢。部分草稿不是完整結果，失敗也不等於沒有發現。

**GET 也可能啟動對帳、恢復 queued Workflow 並付費，或因來源已刪除而清 payload；不是純唯讀檢查。不要自動無限輪詢、重送或重試。** 開關非明確 `1` 時 404、缺必要 binding 時 503；匿名 401、停權 403，跨站簡單寫入可能先被 CSRF 以 403 擋下。非 owner／非管理員讀取回 404；私有回應 no-store，不開 CORS。

### 人工修訂：完整 data，不是 patch

先 `GET /api/evidence-jobs/<JOB_ID>/revisions`，得到 `{job_id, ai_base, revisions}`。尚無人工版本時，以 `ai_base.data` 為基底、parent 為 `"ai"`；否則用最新 revision 的 `payload` 與 `id`。以下為同源用法示意，僅在取得授權且已有可交付草稿後使用：

```js
const url = '/api/evidence-jobs/<JOB_ID>/revisions'
const response = await fetch(url, { credentials: 'same-origin' })
if (!response.ok) throw new Error(`讀取失敗：${response.status}`)
const { ai_base, revisions } = await response.json()
const latest = revisions.at(-1)
const data = structuredClone(latest ? latest.payload : ai_base.data)
// 人工核對完整內容與真實引用，再修改所需欄位，例如：
data.consensus.Overview = '人工核對後的共識概述'
const saved = await fetch(url, {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ parent_revision_id: latest ? latest.id : 'ai', data }),
})
if (!saved.ok) throw new Error(`修訂未成功：${saved.status}`)
```

須送完整 `consensus`、`disputes`、`positions`，各 `Overview` 與立場群 `Core_concern` 不可空白，`Sources` 必須維持真實來源。成功 201 回 `revision_id`、`parent_revision_id`、`verification:"human_unverified"`；過時 parent 回 409 `revision_conflict`，須重讀並人工合併，不自動重送。AI 原稿不覆寫，人改也不代表已驗證。

### 費用、私有快照與清除

- 平台 Workers AI 付費；每帳號每 UTC 日最多 20 個新付費工作、議題冷卻五分鐘、環境模型 US$5／日**估算準入，不是全帳單硬上限**，不含 Workers／Workflows／D1。unknown 預留跨日不自動退；不自動重試。
- 私有業務庫保留來源快照、完整模型 request／response、引用、人改與 diff。模型不收作者快照欄位，但正文／名稱／網址仍可能含個資，**不是匿名化，也不代表已取得所有正文權利人的同意**。
- **無自動 TTL**。來源 hidden／changed 只撤下交付、不刪 payload；對帳發現 deleted 或管理員按來源 erase 才清相依 execution 私有 payload／diff，跨工作與申請者，不刪來源業務資料，也不是單 job 自助刪除。
- 帳號 ID、hash、同意、usage、unknown 與永久 tombstone 保留，來源 ID 不可重新入場；不保證即時發現刪除或清除 D1 備份，也不能撤回已送模型的請求。供應商留存例外、權利請求與維護競態見[手冊](./docs/evidence-api-review.md)及[隱私頁](https://civic.vtaiwan.tw/privacy)。

## 授權、部署與進階文件

軟體與建置／執行文件整體採 **AGPL-3.0-only**（[`LICENSE`](./LICENSE)）。歷史 MIT 發布版本仍可依 MIT 使用，既有權利不撤銷；新 AGPL 貢獻不是可任選 MIT。既有元件授權與 notices 保留於 [`LICENSE-MIT`](./LICENSE-MIT)、[`NOTICE`](./NOTICE)、[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)，版本界線／首 AGPL tag 與來源限制見[授權盤點](./docs/licensing-review.md)。

**投稿內容與軟體分開**：公民意見摘要依既有條款採 CC-BY-SA 4.0，素材依原來源授權，不替其他資料／外部輸出新增一體授權，也不撤銷先前合法 CC 許可；軟體授權不額外授予商標或未釐清圖像權利。

修改版經網路提供服務時，須向使用者提供該運行版本的 **Corresponding Source**。footer 連到建置 commit 的原始碼 archive 與 client／Worker notices；部署須確認來源可匿名下載，fork 也須正確設定，不可用未發布的來源冒充。

```bash
vp run deploy  # 需部署授權：build → 產物／公開原始碼檢查 → wrangler deploy
```

只用正式部署流程；`dev` 會建置並可能改變 Wrangler 部署目標，不可直接沿用其產物手動 deploy。commit 後須重建來源 metadata。部署、遠端 migration、付費與維護是各別授權，不因修改文件或 push 自動取得。

- [`deploy_notes.md`](./deploy_notes.md)：設定、OAuth callbacks、D1 禁令、來源檢查與發布流程。
- [`AGENTS.md`](./AGENTS.md)：工程不變量、API 相容與開發守則。
- [`docs/evidence-api-review.md`](./docs/evidence-api-review.md)、[`Insight.md`](./Insight.md)：證據 API 完整操作／風險與模型品質限制。
- [`TODO_AFTER_MERGE.md`](./TODO_AFTER_MERGE.md)：當前驗收進度與未完成項目。
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)、[授權盤點](./docs/licensing-review.md)、[依賴安全](./docs/dependency-security.md)：貢獻來源、授權與依賴更新。
