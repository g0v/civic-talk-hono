# 部署須知

civic-talk-hono 的部署與環境設定參考。日常開發看 [`README.md`](./README.md)，agent 工作規範看 [`AGENTS.md`](./AGENTS.md)。

> 狀態：**已部署**於 <https://civic.vtaiwan.tw>（Worker 名稱 `civic-talk`，首次部署 2026-08-05）。第 1 節現在是**環境設定的參考**（換環境、換金鑰、新維護者接手時要看），不再是首次部署的待辦清單。

> **#183 現況（2026-11-08）：** PR #191 與遠端原始 0017 已完成。使用者已部署 source `73800643596b7114efd0c7623ea436023cd244b9`、`EVIDENCE_API_ENABLED=1`，既有確認為六匿名 401、CSRF 403、`/api/me` 200／super-admin／banned:false，不是完整六 API 驗收。本輪授權提前清理專用 profiles／CLI／fixtures、本機驗證及 commit，不 push／deploy、不付費或遠端寫入。原始 SQL、歷史報告及全部私人狀態保留；契約見 [API 手冊](./docs/evidence-api-review.md)。UI／一般 API 驗收見 [#166](https://github.com/g0v/civic-talk-hono/issues/166)，維護驗收見 [#201](https://github.com/g0v/civic-talk-hono/issues/201)，進度見 [`TODO_AFTER_MERGE.md`](./TODO_AFTER_MERGE.md)。

> **#210 發布前置：** 一鍵彙整按鈕與私有議題摘要端點需要 `0018_evidence_summaries.sql`（新增 `ct_issues.ai_summaries`／`ct_ai_summary_slots` 與同步 triggers）。維護者註記：**本 PR 可直接 merge 後套遠端 migration 後再實測，但流程尚未完整，先不 deploy。** migration 僅對 `vtaiwan-civic-talks`，依下述授權／ledger 流程執行；不改原始 0017、不操作 `vtaiwan-auth`。本機通過不代表遠端已套用；本輪僅 commit、push 與建立 PR，不代為 merge、套用遠端 migration、付費或部署。

---

## 原始碼與授權 notices 的提供

本專案整體軟體採 AGPL-3.0-only。維護者兼法務已核准切換；首個正式版以合併後建立的 `v0.2.0` tag 界定。來源限制與決策見 [`docs/licensing-review.md`](./docs/licensing-review.md)。本文件不聲稱新版本已合併、建立 tag 或部署。

footer 提供該次建置固定 Git commit 的 source archive 與 LICENSE；沒有可靠版本資訊時仍提供 GNU AGPL v3 條款，不提供可能錯誤的原始碼連結。client 與 Worker 的第三方 notices 位於 `/licenses/client.txt` 與 `/licenses/worker.txt`。來源 metadata 是建置時設定，不是 Worker secret 或執行時 `.dev.vars`。

`vp run dev`／`vp run dev:remote` 啟動前先完整 build，將兩份 notices 放到 dev 使用的 `public/licenses/`；它們是啟動前 production bundle 的快照，更動套件或 imports 後須重啟開發伺服器。`public/_headers` 指定部署／preview 的 `text/plain; charset=utf-8`，Vite dev 不套用 `_headers`，由 notices plugin 的 dev middleware 指定相同編碼。Build 在加入 Worker notices 後重新封存 public／部署副本的 client manifest，保持 hashes 一致。

部署前：

1. 提交並 push 所有來源變更到公開 repository。保留必要的建置、安裝、執行腳本、migrations、設定範本及授權 notices；不要公開機密、正式資料或個人資料。
2. 將 Git `origin` 指向該版本的公開 GitHub repository。fork 預設使用自己的 origin；必要時以公開 build 環境變數 `CIVIC_SOURCE_REPOSITORY` 指定，例如 `https://github.com/example/civic-talk-fork`。使用 `git remote get-url origin` 展開 `insteadOf`；無法辨識的 SSH host alias 請明確設定此 override，不能猜測為 GitHub。只接受不含 token、帳密或 query 的 GitHub HTTPS／Git SSH URL。發布分支預設 `main`；自架採其他發布分支時，在建置及部署一致設定 `CIVIC_SOURCE_BRANCH`。
   - `CIVIC_SOURCE_BRANCH` 必須是該 repository 的分支名稱（如 `main`、`release/v0.2.0`），不能填完整／縮短 SHA、其他 fork 的 `owner:ref`、tag 或完整 `refs/...` 路徑。7–40 位純十六進位名稱視為 SHA，不接受作為發布分支。
3. `vp run deploy` 先 build，再執行 `node scripts/check-published-source.mjs`：核對 Wrangler redirected config 指向的實際產物，並匿名解析目標 repository 的確切 `refs/heads/<branch>`，確認 ref 指向 commit，最後比較建置 SHA 與該 ref 的固定 SHA。compare 的 `base_commit.sha` 必須符合建置 SHA，且狀態為 `identical`／`ahead`；head 由請求 URL 的固定 SHA 鎖定，不讀取不存在的 `head_commit` 或以可能分頁的 `commits` 清單推斷。不存在的 heads ref、只存在於其他 fork、未 push、private repository、dirty 來源、建置中來源改動或無法查核時皆停止；不讓 compare 直接解讀使用者輸入的任意 ref。
   - 遇到 API 限流（403／429）時，腳本顯示重置時間或等待建議並停止部署；這不代表 commit 未公開，不需重做 commit／push。依提示等待後重跑查核，不用登入 token 繞過匿名查核。其他 403、404 與服務故障會分別提示拒絕查核、找不到版本或稍後重試。
4. 本機 dirty／無 Git build 仍可供開發及測試，但 footer 標示該版本原始碼尚未發佈，不連到不同版本。來源判斷排除建置輸出的 `public/styles.css`、`public/licenses/{client,worker}.txt`、`public/civic-source-manifest.json`；實際 CSS source、補充授權全文與其他來源仍須提交。runner 在 Cloudflare 所有 environments 完成後，才把 Worker notices 放入實際 ASSETS，再計算最終 hashes，避免 client fallback 清掉或覆蓋副本。
5. 部署後人工確認各相關頁面的 footer 入口顯著可見、中英文正確，archive 可匿名下載，且 SHA 與實際 Worker／client 建置相符；兩份 bundle notices 均可公開取得。確認 archive 足以建置、安裝與執行對應版本；此技術查核不取代來源許可判斷。

只透過 `vp run deploy` 部署，不直接使用 `wrangler deploy`／`wrangler versions upload` 繞過查核。重新 commit、merge 或切換發布環境後都要重建；不要手改產物。公開來源長期保存仍需維護者維持發布分支歷史與 release tags，本次未修改遠端保護規則。

---

## 1. 環境設定（換環境／輪替金鑰時要重做）

### 1.1 Worker 名稱與正式網域

`package.json` 與 `wrangler.jsonc` 的 `name` 都是 **`civic-talk`**，已實際部署成功——當初擔心的「與舊 Pages 專案撞名」沒有發生（Cloudflare 帳號內 Workers 與 Pages 共用同一份名稱清單，改名前要先確認這點）。

⚠️ **正式網域 `civic.vtaiwan.tw` 沒有寫在 `wrangler.jsonc` 裡**（設定檔沒有 `routes`／`custom_domain` 設定），所以：

- 只讀設定檔的人找不到正式網址——需要時到 Cloudflare 儀表板的 Worker 設定看綁定方式。
- 要改動網域綁定前先確認它現在是怎麼綁的，不要憑猜測改設定檔。

### 1.2 OAuth 應用程式的 callback 網址

Google 與 GitHub 的 OAuth 應用程式與 vTaiwan-hono 共用。正式站 callback 為：

```
https://civic.vtaiwan.tw/api/auth/callback/google
https://civic.vtaiwan.tw/api/auth/callback/github
```

一般 `vp run dev` 刻意停用 Auth；`vp run dev:remote` 保留既有遠端 Auth／DB／AI 語意，登入或有效證據請求可能遠端寫入及付費，須另獲各別授權。專用 #183 remote-dev profiles 已移除。未來另獲本機真人登入授權時，須由維護者確認 Google app 允許 `http://localhost:5173/api/auth/callback/google`；GitHub 目前只允許 `vtaiwan.tw` 子網域，不能用 localhost GitHub 登入。本輪不安排登入測試。

- callback 清單只能在 Google Cloud Console／GitHub Developer settings 手動設定；缺少時會回 `redirect_uri_mismatch`。
- 共用應用程式的 vTaiwan 既有 callback 不得移除；更換正式網域時應同步核對。
- 換正式網域時記得同步這裡，否則新網域一樣登不進去。

### 1.3 正式環境的機密

`.dev.vars` **只有本機吃得到**，不會隨 deploy 上傳。下列設定必須另外設進 Worker（正式站已設好，這裡是輪替金鑰或建新環境時的清單）：

| 名稱                   | 說明                                                                                   | 建議設法              |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------- |
| `BETTER_AUTH_SECRET`   | 簽章密鑰，**與 vTaiwan-hono 用同一個值**                                               | `wrangler secret put` |
| `GOOGLE_CLIENT_ID`     | 與 vTaiwan-hono 共用                                                                   | `wrangler secret put` |
| `GOOGLE_CLIENT_SECRET` | 與 vTaiwan-hono 共用                                                                   | `wrangler secret put` |
| `GITHUB_CLIENT_ID`     | 與 vTaiwan-hono 共用                                                                   | `wrangler secret put` |
| `GITHUB_CLIENT_SECRET` | 與 vTaiwan-hono 共用                                                                   | `wrangler secret put` |
| `BETTER_AUTH_URL`      | **本站自己的 origin**（正式站是 `https://civic.vtaiwan.tw`），不要從 vTaiwan-hono 複製 | 見下方說明            |
| `OPEN_ROUTER_API_KEY`  | 四個投稿入口的安全審查；缺值時會 fail-open，雖不阻擋投稿，但正式環境應設定             | `wrangler secret put` |

```bash
npx wrangler secret put BETTER_AUTH_SECRET     # 逐一設定，值用貼的、不要放進指令歷史
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put OPEN_ROUTER_API_KEY
```

**`BETTER_AUTH_URL` 不是機密**，可以改放進 `wrangler.jsonc` 的 `vars`（進版控、部署時自動帶上、不會有人忘了設）：

```jsonc
"vars": { "EVIDENCE_API_ENABLED": "1", "BETTER_AUTH_URL": "https://civic.vtaiwan.tw" }
```

正式站的 `BETTER_AUTH_URL` 必須是本站 origin；`src/auth/createAuth.ts` 直接把它當 `baseURL`，值不對會在登入時導到錯的網域。設定位置與下列 `keep_vars` 規則須一併核對；本機 `.dev.vars` 仍可能覆蓋設定。

⚠️ **若你打算在 Cloudflare 儀表板上手動設定 vars**：wrangler 預設把設定檔當成唯一真相，**deploy 會覆蓋或刪除儀表板上的 vars**。要保留儀表板設定得在 `wrangler.jsonc` 加 `"keep_vars": true`（vTaiwan-hono 就有這一行，本專案沒有）。用 `wrangler secret put` 設的機密不寫在設定檔裡，不受這條規則影響——這也是建議走 secret 的原因之一。

### 1.4 事實查核 Service Binding

`FACT_CHECK_CORE` 綁到同一個 Cloudflare 帳號內的 Worker `fact-check-core`。核心 Worker 必須先部署，並維持 `workers_dev: false`、不配置公開 route；Civic Talk 透過 Service Binding 呼叫其 `POST /fact-check`。

- 不需要設定 `CIVIC_TALK_API_KEY` 或其他 shared secret；Service Binding 本身就是呼叫核心 Worker 的 capability。
- 瀏覽器只呼叫同源 `POST /api/fact-check`，登入與停權檢查留在 Civic Talk，session cookie 不會轉送給核心。
- 本機要連已部署的核心 Worker，使用 `vp run dev:remote`；一般 `vp run dev` 關閉 remote bindings。

---

## 2. 絕對不要做的事

### 2.1 🚫 不要對 `vtaiwan-auth` 跑 migration

`vtaiwan-auth` 是 **vTaiwan-hono 的正式認證資料庫**（`user`／`session`／`account`／`verification`），本專案只是消費端（AGENTS.md 不變量 11）。

⚠️ **這裡有一個真實的陷阱**：`wrangler.jsonc` 的 `DB_AUTH` 雖然沒寫 `migrations_dir`，但 **wrangler 會自動填入預設值 `./migrations`**（可在 `dist/civic_talk/wrangler.json` 看到實際值）。也就是說：

```bash
# 🚫 千萬不要跑這個指令
npx wrangler d1 migrations apply vtaiwan-auth --remote
```

它會把 **civic-talk 的 `0001_init.sql`（建立 `ct_*` 業務表）套用到 vTaiwan 的認證資料庫**，在別人的正式庫裡憑空長出四張 `ct_` 表。這不會刪掉 auth 資料，但屬於明確違反不變量 11 的污染，且要清掉得再手動下 DDL。

auth schema 的唯一來源是 `../vTaiwan-hono/migrations/auth/`；要改 schema 就去那邊改。

### 2.2 🚫 不要覆蓋別人的 Worker／Pages 專案

`civic-talk` 這個名字現在屬於本專案（見 1.1）。要改名或改網域綁定前先確認新名字目前屬於誰，不要用 `--force` 之類的方式硬推。

### 2.3 🚫 不要以為部署後 vTaiwan 的登入狀態會自動延續

兩站共用 `user`／`account` 資料，並設定 Google／GitHub trusted provider account linking；**同一個 email 的 Google／GitHub 帳號整合已在 Civic Talk 正式站實測成功**（使用者確認 2026-10-16，見 [#5 留言](https://github.com/g0v/civic-talk-hono/issues/5#issuecomment-6225088110)）。session cookie 綁 origin，所以**兩個網域仍要各自登入一次**。除非兩站在同一個父網域下並刻意設定 cookie `domain`（要做先討論），否則不要對外宣稱「單一登入」。

---

## 3. 部署指令與實際上傳的內容

```bash
vp run deploy    # = build + 建置產物／公開原始碼檢查 + wrangler deploy（需授權）
```

實際部署的東西：

| 項目                      | 來源                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| Worker 程式               | `dist/civic_talk/`（`vite build` 產物）                                   |
| 靜態資產（`ASSETS` 綁定） | **`dist/client/`**——build 時由 `public/` 複製而來，不是直接上傳 `public/` |
| 部署設定                  | `dist/civic_talk/wrangler.json`（由 `wrangler.jsonc` 產生）               |

幾個容易誤解的點：

- **`public/styles.css`、client bundle 與 bundle notices 都是建置產物**。改 source 後由 `vp run deploy` 重新 build，再查核版本、hashes 與公開發布分支；不要手改或直接上傳舊產物。
- **`wrangler.jsonc` 裡 D1 綁定的 `"remote": true` 只影響本機開發**（`vp run dev` 用本機模擬、`vp run dev:remote` 連遠端）。正式環境本來就是真的資料庫，這個欄位不改變部署行為。
- **正式網域不在設定檔裡**（見 1.1）——`vp run deploy` 不會重建網域綁定，也不會因為設定檔沒寫就把它拆掉。
- **`compatibility_flags: ["nodejs_compat"]` 不能拿掉**。better-auth 直接 import `node:crypto` 與 `node:async_hooks`，少了這個 flag 連本機 dev 都起不來。
- 未授權寫入時，勿用 `d1 migrations list --remote` 作唯讀檢查：它會 `CREATE TABLE IF NOT EXISTS` 初始化 ledger。先核對帳號、明確 config／業務 DB，再查詢 ledger 是否存在：
  ```bash
  npx wrangler whoami
  npx wrangler d1 execute vtaiwan-civic-talks --remote --config wrangler.jsonc --command "SELECT name, sql FROM sqlite_master WHERE type='table' AND name='d1_migrations';"
  ```
  表存在才查下列 ledger，與本機 `migrations/*.sql` 檔名比 pending；缺表即停止，不自行初始化：
  ```bash
  npx wrangler d1 execute vtaiwan-civic-talks --remote --config wrangler.jsonc --command "SELECT id,name,applied_at FROM d1_migrations ORDER BY id;"
  ```
- 若仍有 pending migration，先核對檔案內容、相依順序與部署程式；`0009`–`0013` 不得跳號。取得使用者明確授權後才能套用，而且 migration 必須在依賴新 schema 的 Worker 部署前成功：
  ```bash
  npx wrangler d1 migrations apply vtaiwan-civic-talks --remote --config wrangler.jsonc
  ```
- 套用後要再確認 pending 清單為空，並檢查 `sqlite_master`：本 repo 新增的業務表只能是 `ct_*`。不能只因 repo 裡已有 `0013` 就推定遠端也已套用。
- #148 的 `0014_user_feedback.sql` 新增 `ct_feedback`，匿名回報寫入及管理端回報列表皆依賴此表。本機與遠端皆已套用：2026-10-16 經使用者授權、確認 vTaiwan.tw 帳號後，遠端 pending 僅 0014，套用後清單為空，`sqlite_master`／欄位／分類約束與排序索引查核符合 migration；只新增 `ct_feedback` 業務表，未操作 `vtaiwan-auth`。部署 Worker已，正式站功能已上線。
- #95 的 `0015_issue_tags.sql` 為 `ct_issues` 新增 `tags TEXT NOT NULL DEFAULT '[]'`。2026-10-20 經使用者授權，確認 Cloudflare 帳號為 vTaiwan.tw，且檔案與已合併的 `main` 一致後，執行 `npx wrangler d1 migrations apply vtaiwan-civic-talks --remote --config wrangler.jsonc`；套用前 pending 僅 0015，套用後清單為空。已核對 `sqlite_master` 資料表清單未變、欄位型別／NOT NULL／預設值正確，既有議題仍為 16 筆，tags 全為 `[]` 且無 NULL／無效 JSON；未操作 `vtaiwan-auth`，未部署 Worker。
- `0016_issue_closure.sql` 已有遠端 ledger，`applied_at=2026-10-23 21:26:16`；早期「僅套本機」不是現況。
- **0017 已完成：** 使用者手動套遠端原始 SQL，ledger id 18、`applied_at=2026-11-06 19:29:04`，八張 `ct_ai_*` 表／七個顯式索引已核對。原 SQL byte-for-byte 與 ledger 保留，不重跑、DROP 或改 ledger；`remote:false` 不是 CLI `--remote` 安全鎖。
- **歷史正式關閉版：** source commit `a2ff8ae526aee59a37234562bad1001c65e8c8b5`、Worker version `e398bed0-1a14-46d2-8f73-5222fd05b71d`、`EVIDENCE_API_ENABLED=0`，當時 52 項匿名 smoke 通過；不是現行版本或啟用後六 API 驗收。
- **歷史 v5 告知發布：** 使用者手動推送並部署 source `e11d6b912d5a3e60c47a074e95b7a09b33df9f11`，當時旗標 `0`。20 項匿名檢查確認 v5、來源 metadata、JS／notices 原件一致性、六端點關閉、CSRF 及基本既有 API；沒有建立 AI 工作或執行維護處置。

  **現行啟用與後續驗收：**
  1. 使用者已部署 source `73800643596b7114efd0c7623ea436023cd244b9`、旗標 `1`，確認六匿名 401、CSRF 403、`/api/me` 200／super-admin／banned:false；現行 Worker version ID 未知，不沿用歷史值。v5 告知仍生效；舊同意、raw／results／Insight 不回寫。
  2. 2026-11-08 使用者核准提前清理專用設定與操作鏈，不以完整六 API 正式實測為前置。本輪只做本機驗證與 commit，不 push／deploy、不付費或遠端寫入；原始 0017、正式 AI／Workflow／開關 `1`、私有 `.wrangler` 與帳本保留。
  3. 關閉 #183 表示 API 交付與專用環境退場，不代表 UI 或 live 驗收完成。UI／一般 API 移交 [#166](https://github.com/g0v/civic-talk-hono/issues/166)，reconcile／erase 移交 [#201](https://github.com/g0v/civic-talk-hono/issues/201)。所有正式登入後／付費／維護實測延後，仍須各別授權帳號、來源、費用與不可逆處置範圍。

  **政策核對：** 每帳號每 UTC 日最多 20 個新付費工作、議題五分鐘、環境模型 US$5／日估算準入；Clairic input／Clef 每百萬 tokens US$0.10／0.24、Gemma input／output US$0.10／0.30。非整 job 報價或全帳單硬上限，不含 Workers／Workflows／D1；unknown 跨日不自動退，不保證次日恢復。每個建立請求須 `consent:true`，伺服器存版本／時間，同帳號命中既有 job 不新增事件，也不代表正文所有人已同意。

  無自動 TTL／固定刪除期限；hidden／changed 只撤下且保留 payload。deleted 被對帳／查核發現或管理員按來源 erase 才清跨工作／申請者相關 execution 私有 payload／diff，保留帳號 ID、hash、同意版本／時間、usage、unknown 與永久 tombstone，來源 ID 不可重新入場。權利請求寄 `info@vtaiwan.tw` 人工受理，不保證即時發現刪除、不能撤回在途請求。D1 Time Travel 依方案 7／30 天，erase 不保證即時清備份；Workers AI 一般推論 ZDR／不訓練有營運 metadata、安全及法律例外，不代表 D1 零留存。完整資料／權限及官方連結見[手冊第 3 節](./docs/evidence-api-review.md#3-模式前置與保護範圍)。

---

## 4. 部署後的煙霧測試

正式站 origin 是 `https://civic.vtaiwan.tw`。「已驗」欄記的是最近一次確認的日期；每次 deploy 後至少重跑前段那幾條。

| 檢查                                              | 預期                                                                                                    | 已驗                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /`                                           | 200，議題列表正常渲染                                                                                   | 2026-08-11                                                                                          |
| `GET /api/issues`                                 | 200                                                                                                     | 2026-08-11                                                                                          |
| `GET /api/me`（未登入）                           | 401                                                                                                     | 2026-08-11                                                                                          |
| `GET /api/auth/get-session`                       | 200                                                                                                     | 2026-08-11                                                                                          |
| `GET /api/auth/admin/list-users`                  | **404**（本站刻意不開成員管理端點）                                                                     | 2026-08-11                                                                                          |
| `GET /api/admin/stats`（未登入）                  | 401                                                                                                     | 2026-08-11                                                                                          |
| `GET /index.html`                                 | 301 → `/`                                                                                               | 2026-08-11                                                                                          |
| `GET /privacy`、`GET /terms`                      | 200                                                                                                     | 2026-08-11                                                                                          |
| `POST /api/fact-check`（未登入）                  | 401，且不呼叫 `fact-check-core`                                                                         | —                                                                                                   |
| 登入後執行素材事實查核                            | 200；回應保留 `X-Request-Id`、`X-Fact-Check-Cache` 與 `Cache-Control: no-store`                         | —                                                                                                   |
| `GET /issue.html?id=1`                            | 302 → `/issues/1`                                                                                       | —                                                                                                   |
| 瀏覽器開 `/admin`                                 | 顯示 Google／GitHub 登入卡片                                                                            | 2026-08-11                                                                                          |
| 用 Google 登入                                    | 導回 `/admin`；角色是 `admin`／`super-admin` 就進後台，否則顯示「沒有管理權限」                         | 2026-08-11                                                                                          |
| 用 GitHub 登入                                    | 同樣能登入並導回原頁                                                                                    | 2026-08-11                                                                                          |
| 用同一個 email 換 provider 登入                   | 同一個帳號、同樣權限，**不會變成新帳號**                                                                | [2026-10-16（使用者確認）](https://github.com/g0v/civic-talk-hono/issues/5#issuecomment-6225088110) |
| 登入後投稿素材／意見／議題                        | 寫入成功，且該筆內容顯示投稿者名稱（email 只在勾選公開時才出現）                                        | 2026-08-11                                                                                          |
| 登入後送出說明頁                                  | 寫入成功且記錄 `author_id`；管理端看得到完整作者快照                                                    | —                                                                                                   |
| 登出後 `GET /api/me`                              | 401                                                                                                     | —                                                                                                   |
| `POST`／`DELETE /api/opinions/:id/vote`（未登入） | 401                                                                                                     | —                                                                                                   |
| 登入後投票、改票、收回                            | 成功；投票後可見分布，收回後再次遮蔽；作者及 `abuse_flagged = 2/3` 不可投                               | —                                                                                                   |
| `GET /api/issues/:id/opinions?sort=responses`     | 200；按回應數排序，未投票者仍看不到分布                                                                 | —                                                                                                   |
| `GET /api/issues/:id/opinions/comments.csv`       | 未登入 401；登入後回 pol.is 相容 CSV，且不含 Better Auth id、email 或 voter identity                    | —                                                                                                   |
| 導覽列開啟使用者回報                              | 桌機文字／手機圖示可用，modal 不換頁；淺深色、三語與已登入長名稱不擠版                                  | —                                                                                                   |
| 匿名 `POST /api/feedback`                         | 有效分類、描述及相對頁面路徑得到 `201 { "ok": true }`，`ct_feedback` 不含帳號或環境資料                 | —                                                                                                   |
| `GET /api/admin/feedback`                         | 未登入 401、一般使用者 403、管理員 200；回應 private/no-store，回報依新到舊排列                         | —                                                                                                   |
| `/admin?tab=feedback`                             | 管理員可瀏覽；描述保留換行但不執行 HTML，原頁面與 GitHub 連結另開分頁                                   | —                                                                                                   |
| 議題結案／重開（#159）                            | 未登入 401、一般使用者 403；admin／super-admin 填理由後可操作，理由與日期公開；空理由 400、重複操作 409 | —                                                                                                   |
| 首頁 `?tab=closed`                                | 預設僅進行中；已結案頁籤與搜尋、預覽、返回、重新整理及歷史同步，三語及淺深色正常                        | —                                                                                                   |
| 已結案議題參與                                    | 可讀取、投稿、投票與匯出；重開不重設素材募集／彙整／發布狀態                                            | —                                                                                                   |

> ⚠️ **`/api/auth/get-session` 回 200 不代表登入設定正確**——沒有 cookie 時它跟 callback 網址設錯或 `BETTER_AUTH_URL` 設錯的情況長得一樣。登入相關的列只能靠人工在瀏覽器實測；改網域或換金鑰後要重跑。

登入失敗時的判讀：

- `/api/auth/sign-in/social` 回 **403** → 先看 Network 的 JSON `code`，不能只憑狀態碼判定第三方 OAuth callback 設錯。`INVALID_ORIGIN` 要核對瀏覽器 origin 與 `BETTER_AUTH_URL`（`localhost` 與 `127.0.0.1` 不同）；`INVALID_CALLBACK_URL` 要核對登入後的回跳網址。共用 `signInWith()` 會把回跳路徑轉成完整同源 URL，保留 query 與 `#opinion-<id>`；Better Auth 不接受帶 hash 的相對回跳網址，但仍會驗證完整 URL 的 origin。不要關閉 origin／CSRF 檢查來繞過錯誤。
- 登入 API 的 HTTP 錯誤不得無聲失敗：Better Auth client 預設回傳 `{ error }` 而不是 throw，`signInWith()` 會將錯誤轉為例外，讓共用登入按鈕顯示雙語「登入失敗，請再試一次」提示；403 仍維持拒絕，不會繞過安全檢查。
- `redirect_uri_mismatch` → 1.2 的 callback 網址沒設好（正式站要有 `https://civic.vtaiwan.tw/api/auth/callback/{google,github}`）。
- `/api/me` 回 **500**（而不是 401）→ `DB_AUTH` 綁定或 auth 表有問題，看 Worker log。
- 停在「沒有管理權限」→ 該帳號在 `vtaiwan-auth` 的 `role` 不是 `admin`／`super-admin`。**要調角色請到 vTaiwan-hono 的後台**，本站依不變量 11 不寫 `user.role`。

---

## 5. 已知限制

- **登入主流程已實測**（Google／GitHub 登入、admin 進後台、登入後投稿，2026-08-11）；**同 email 帳號整合亦已在正式站實測成功**（使用者確認 2026-10-16，見 [#5 留言](https://github.com/g0v/civic-talk-hono/issues/5#issuecomment-6225088110)）。**尚未實證**：四種寫入是否都落下完整作者快照（含說明頁與管理端取得完整快照）。
- **已有自動化測試與 CI**：`src/tests/` 的 Vitest 測試涵蓋 i18n、SSR、API 安全邊界、作者隱私、moderation、投稿併發、首頁排序與意見投票等；`.github/workflows/ci.yml` 會在 push 到 `main` 與 pull request 執行 binding type generation、typecheck、`vp test` 及 build。正式站 OAuth、遠端 D1、Service Binding 與本節煙霧測試仍需人工驗證。
- **公開唯讀 API 支援跨來源讀取**：`GET /api/issues`、`GET /api/issues/:id` 及其 `materials`／`briefing`／`opinions` 子資源維持 `Access-Control-Allow-Origin: *`，但不提供 `Access-Control-Allow-Credentials`。這些回應一律帶 `Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff` 與 `Vary: Cookie`，避免公開／管理員投影被快取混用。管理端、需登入資料與所有寫入端點都不輸出 CORS 放行標頭。
- **跨站寫入由 csrf 防護，不靠 CORS 或登入守衛**：缺少 `Access-Control-Allow-Credentials` 只會阻止瀏覽器把 credentialed response 交給跨來源程式碼，不代表 cookie 不會隨請求送出。`src/index.ts` 在所有 `/api/*` 路由之前掛上 `hono/csrf`，阻擋跨站與同站 sibling origin 的簡單寫入請求；登入、停權與角色守衛回答「是哪位使用者」，csrf 則回答「請求是不是本站頁面發起」。

---

## 6. 貢獻者自架測試環境（issue #112）

`vp run dev` 的 D1 是本機模擬，**登入相關功能測不了**（auth 表只存在遠端）。有權使用既有 vTaiwan 遠端資源時，可用 `vp run dev:remote` 驗證登入、角色與已部署的 Service Binding；沒有該權限或需要隔離環境的貢獻者，才需要依本節部署到**自己的 Cloudflare 帳號**。本節流程不修改任何 tracked 檔案。

### 6.1 原理：設定檔在「建置時」就被烘焙進產物

`vite.config.mts` 呼叫的 `cloudflare()` plugin 會在建置時讀 wrangler 設定，把解析結果寫成 `dist/<worker 名>/wrangler.json`，再用 `.wrangler/deploy/config.json` 把 `wrangler deploy` 轉向到那一份：

```
Using redirected Wrangler configuration.
 - Configuration being used: "dist/civic_talk/wrangler.json"
 - Original user's configuration: "wrangler.jsonc"
 - Deploy configuration file: ".wrangler/deploy/config.json"
```

因此**在部署那一步下 `-c my.jsonc` 沒有用**，設定必須在建置時就換掉。`@cloudflare/vite-plugin` 內建環境變數 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 正是做這件事（v1.52.1 實測：`pluginConfig.configPath ?? prefixedEnv.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`），**不需要修改 `vite.config.mts`**。

### 6.2 建立個人環境

```bash
# 0. 確認登入的是自己的帳號
npx wrangler login
npx wrangler whoami

# 1. 在自己帳號建立兩個 D1（名稱可自訂，記下回傳的 database_id）
npx wrangler d1 create my-civic-talks
npx wrangler d1 create my-civic-auth

# 2. 複製設定檔（已列入 .gitignore，不會進版控）
cp wrangler.jsonc wrangler.personal.jsonc
```

> ⚠️ `wrangler d1 create` 完成後會問 **“Would you like Wrangler to add it on your behalf?”**。一律回答 **no**——回答 yes 會把綁定寫進 tracked 的 `wrangler.jsonc`，正是本節要避免的事。請自行把 `database_id` 填進 `wrangler.personal.jsonc`。

編輯 `wrangler.personal.jsonc`，**六處都要改**：

| 欄位                        | 改成什麼                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                      | 自己的 Worker 名稱（**不可**沿用 `civic-talk`，否則會覆蓋正式環境）                                                                   |
| `d1_databases[DB]`          | 步驟 1 建立的業務庫名稱與 `database_id`                                                                                               |
| `d1_databases[DB_AUTH]`     | 步驟 1 建立的認證庫名稱與 `database_id`                                                                                               |
| `services`                  | **整段刪除**——`fact-check-core` 只存在於 vTaiwan 帳號，帶著它會部署失敗                                                               |
| `workflows[].name`          | 改為自己專用的 Workflow 名稱；不得沿用 `civic-talk-evidence`，避免與同帳號的其他 Worker 共用資源名稱。                                |
| `vars.EVIDENCE_API_ENABLED` | 從複製的 `1` 改為 `0`；這只關閉個人環境，不能修改一般 `wrangler.jsonc` 的正式啟用值。開放前另外確認 migration、認證及費用／留存設定。 |

### 6.3 套用 migration

```bash
# 業務庫：本 repo 的 migrations 就是給它用的
npx wrangler d1 migrations apply <你的業務庫名稱> --remote --config wrangler.personal.jsonc
```

> 🚫 **不要對自己的認證庫跑 `migrations apply`。** 本 repo 的 `migrations/` 全是 `ct_*` 業務表，套進認證庫只會建錯東西。auth schema 的唯一來源是 `vTaiwan-hono` 的 `migrations/auth/`，用 `d1 execute --file` 匯入。
>
> 沒有 clone vTaiwan-hono 時，必須從已核對的 commit 下載，**不要抓會持續變動的預設分支**。目前固定在 [`a53ba918af5eeaeb0f3aac00c69ffdfb9775e357`](https://github.com/g0v/vTaiwan-hono/commit/a53ba918af5eeaeb0f3aac00c69ffdfb9775e357)，包含初始四表與名稱修改冷卻 migration；更新此 ref 前要先核對 Better Auth 版本與全部 auth migration：
>
> ```bash
> set -euo pipefail
> AUTH_SCHEMA_REF=a53ba918af5eeaeb0f3aac00c69ffdfb9775e357
> AUTH_SCHEMA_DIR=/tmp/civic-talk-auth-schema
>
> rm -rf "$AUTH_SCHEMA_DIR"
> mkdir -p "$AUTH_SCHEMA_DIR"
>
> gh api "repos/g0v/vTaiwan-hono/contents/migrations/auth?ref=$AUTH_SCHEMA_REF" \
>   --jq '.[].download_url' |
>   while IFS= read -r url; do
>     filename="$(basename "${url%%\?*}")"
>     curl --fail --location --silent --show-error \
>       --output "$AUTH_SCHEMA_DIR/$filename" "$url"
>   done
>
> for f in "$AUTH_SCHEMA_DIR"/*.sql; do
>   npx wrangler d1 execute <你的認證庫> --remote --file "$f" --config wrangler.personal.jsonc
> done
> ```
>
> 匯入後要核對四張表、`user.nameChangedAt` 與兩個冷卻 trigger，不可只看到四張表就算完成：
>
> ```bash
> npx wrangler d1 execute <你的認證庫> --remote \
>   --command "SELECT type, name FROM sqlite_master WHERE (type = 'table' AND name IN ('user', 'session', 'account', 'verification')) OR (type = 'trigger' AND name IN ('user_name_change_cooldown', 'user_record_name_change')) ORDER BY type, name" \
>   --config wrangler.personal.jsonc
>
> npx wrangler d1 execute <你的認證庫> --remote \
>   --command "SELECT name FROM pragma_table_info('user') WHERE name = 'nameChangedAt'" \
>   --config wrangler.personal.jsonc
> ```
>
> 預期第一個查詢列出四張表與 `user_name_change_cooldown`、`user_record_name_change`；第二個查詢列出 `nameChangedAt`。
>
> 這個陷阱在個人環境同樣存在：`DB_AUTH` 即使沒寫 `migrations_dir`，wrangler 仍會自動填入預設的 `./migrations`（實測烘焙結果為 `"migrations_dir": "../../migrations"`）。詳見 2.1。

### 6.4 建置、預檢、部署

```bash
# 先提交並 push 來源到自己的公開 repository／發布分支
# 用個人設定建置
CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.personal.jsonc vp run build

# 建置後來源／產物查核（非 main 分支需一致設定 CIVIC_SOURCE_BRANCH）
node scripts/check-published-source.mjs

# 預檢：確認讀到的是個人設定，不是正式環境；不會上傳
npx wrangler deploy --dry-run
#   → Configuration being used: "dist/<你的 worker 名>/wrangler.json"

# 確認無誤並取得部署授權後，重新建置、查核再上傳
CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.personal.jsonc vp run deploy
```

> 首次在帳號內建立 `*.workers.dev` 子網域時，**TLS 憑證要幾分鐘才簽發**。這段期間連線會失敗並顯示 `SSL/TLS_ALERT_HANDSHAKE_FAILURE`，那**不是部署失敗**——`wrangler deploy` 已回報成功即代表 Worker 上線，等憑證就緒即可連上。

部署成功後 wrangler 會印出網址（例如 `https://<worker>.<你的子網域>.workers.dev`）。**拿到網址才能設定登入相關密鑰**，因為 `BETTER_AUTH_URL` 必須等於該 origin：

```bash
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET --config wrangler.personal.jsonc
echo "https://<你的網址>" | npx wrangler secret put BETTER_AUTH_URL --config wrangler.personal.jsonc
```

Google／GitHub 的 OAuth 憑證要自行申請（見 6.7），callback 網址填 `https://<你的網址>/api/auth/callback/{google,github}`。取得憑證後還要逐一寫入個人 Worker；若要測投稿安全審查，再設定可選的 OpenRouter key：

```bash
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.personal.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.personal.jsonc
npx wrangler secret put GITHUB_CLIENT_ID --config wrangler.personal.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.personal.jsonc
npx wrangler secret put OPEN_ROUTER_API_KEY --config wrangler.personal.jsonc
```

未設定 OAuth 憑證前公開頁面照常運作，只有登入與所有需登入功能不可用。

### 6.5 ⚠️ 環境變數的作用範圍只有「Vite 建置」

`CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 只被 Vite plugin 讀取。**例外是緊接在 build 後的 `wrangler deploy`／`wrangler deploy --dry-run`**：它們依 `.wrangler/deploy/config.json` 轉向建置產物，所以 6.4 刻意不帶 `--config`。secret、D1、tail 等其他 wrangler 指令不走這個 redirected deploy config，預設會讀根目錄的 `wrangler.jsonc`；操作個人資源時必須自己帶 `--config`：

```bash
npx wrangler secret put BETTER_AUTH_SECRET --config wrangler.personal.jsonc
npx wrangler d1 execute <你的庫> --remote --command "SELECT 1" --config wrangler.personal.jsonc
npx wrangler tail --config wrangler.personal.jsonc
```

上述非 deploy 指令漏掉 `--config`，可能寫到**正式環境**的 secret 或資料庫；deploy 則必須依 6.4／6.6 檢查最後一次 build 產生的 redirected config。

### 6.6 ⚠️ 決定部署目標的是「最後一次建置」

`dist/civic_talk/` 與 `dist/<個人 worker 名>/` 會同時存在，真正決定 `wrangler deploy` 上傳哪一個的是 `.wrangler/deploy/config.json`，而它**只反映最後一次 build**。切換環境時務必重新建置，並用 `--dry-run` 確認後再部署。

`vp run dev`／`vp run dev:remote` 啟動前也會先跑 `vp run build`（分別為 `vp run build && vp dev`、`vp run build && vp dev --mode remote`）。**未指定 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 時**，這次建置會使用預設的 `wrangler.jsonc`，把轉向檔切回 `dist/civic_talk/wrangler.json`；若已透過環境變數指定個人設定，建置仍會沿用它。`dev:remote` 的 `--mode remote` 只傳給 dev server，不會替前面的 build 選擇個人部署設定。

跑過 dev 之後要部署個人環境，先停掉 dev server，再依 6.4 以個人設定重新建置、查核及預檢。**最後執行 `vp run deploy` 時也必須帶上 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.personal.jsonc`**，因為 deploy 指令會再次建置；只在前一次 build 指定個人設定仍可能切回正式目標。

### 6.7 自架環境必須自備的外部相依

| 項目                  | 說明                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 認證資料庫            | `vtaiwan-auth` 在 vTaiwan 帳號，D1 綁定只能綁同帳號資源，必須自備（schema 來源見 6.3）                                                                                 |
| Google／GitHub OAuth  | 正式環境的 OAuth 應用程式與 vTaiwan 共用，callback 白名單只有該主控台管理者能加；自架環境要**自行申請一組**                                                            |
| `BETTER_AUTH_URL`     | 設成自己 Worker 的 origin（例如 `https://<worker>.<subdomain>.workers.dev`），**不要**複製正式環境的值                                                                 |
| `BETTER_AUTH_SECRET`  | 自行產生（`openssl rand -base64 32`），不要沿用正式環境的值                                                                                                            |
| `FACT_CHECK_CORE`     | `fact-check-core` Worker 不存在於其他帳號；移除綁定後不只 `POST /api/fact-check` 失效，`Contribute.vue` 也拿不到「查核成功且允許」的結果，因此整條素材投稿流程無法完成 |
| `OPEN_ROUTER_API_KEY` | 未設定時投稿安全審查採 fail-open（放行並記錄錯誤）；正式或要驗證 moderation 的自架環境應設定，不能把 fail-open 當成審查已通過                                          |
