# AGENTS.md

給 AI coding agent 的操作指引。先讀不變量，再依任務讀相關來源；不要把歷史完成紀錄當成當前部署或驗收證據。

## 1. 專案地圖與權威來源

Civic Talk 使用 Hono、Vue 3 SSR/hydration、Tailwind 與 Cloudflare Workers，正式站為 <https://civic.vtaiwan.tw>，Worker 名稱 `civic-talk`。現況是每頁 `renderPage`、**單一 client entry**，沒有 `vue-router` 或 `vue-i18n`；全站 router 切換是另需確認的結構性改動。

| 來源                                                                              | 用途                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`、`src/worker.ts`                                                   | SSR／API／舊網址導向／ASSETS fallback；正式 wrapper 匯出 `EvidenceWorkflow`，讓可由 Node 匯入的 index 不直接依賴 `cloudflare:workers` |
| `src/ssr/render.ts`、`src/ssr/heads.ts`、`src/client/civic-entry.ts`              | HTML 殼、安全注入 `__PAGE__`／`__SSR_STATE__`、metadata、單一 hydration 註冊表                                                        |
| `src/views/`、`src/components/`、`src/composables/`                               | 頁面、共用 UI、登入與導覽狀態                                                                                                         |
| `src/api/routes.ts`、`src/db/queries.ts`、`migrations/`                           | 業務 API、集中 SQL／型別、`ct_*` schema                                                                                               |
| `src/auth/`、`src/api/auth.ts`、`src/api/requireUser.ts`                          | Better Auth、角色／停權守門、Auth HTTP 轉交與個人資料更新                                                                             |
| `src/moderation/`、`src/legal/terms.ts`                                           | 投稿審查／申訴與伺服器端條款版本                                                                                                      |
| `src/ai/`                                                                         | 私有證據工作、生成／引用驗證、來源生命週期、費用與 Workflow                                                                           |
| `src/l10n/`、`src/styles/app.css`                                                 | 三語 key／插值、Tailwind token 與共用樣式                                                                                             |
| `package.json`、lockfile、`wrangler.jsonc`、Vite configs                          | 實際工具版本、指令、bindings 與建置設定；不依本檔猜套件版本                                                                           |
| [README](./README.md)、[部署說明](./deploy_notes.md)                              | 人類使用／開發入口、環境與發布程序                                                                                                    |
| [證據 API 手冊](./docs/evidence-api-review.md)、`Insight.md`                      | 完整操作、資料／模型政策、品質實驗與歷史限制                                                                                          |
| [依賴安全](./docs/dependency-security.md)、[授權檢閱](./docs/licensing-review.md) | 升級、安全與 notices 盤點                                                                                                             |
| [目前交接](./TODO_AFTER_MERGE.md)、GitHub issues                                  | 未驗項目與後續需求；不是允許遠端操作的授權書                                                                                          |

- 舊站 `../civic-talk` 是功能／內容相容來源，需要時直接讀原始碼；所有接口已整合進本站 Worker，不再呼叫舊 Pages Functions，也不搬舊部署腳本或大段手寫 CSS。
- `../vTaiwan-hono` 的一般工程慣例僅供參考；**Better Auth 必須對齊其現行實作**，尤其 `src/server/lib/createAuth.ts`、`authorization.ts` 與 `migrations/auth/`。不引入其 LemmaScript／Dafny、會員管理或 step-up 工具鏈。
- 現行程式決定實作，使用者最新裁示決定需求與授權；文件矛盾或需破壞契約時先釐清，不憑 issue 勾選、分支名或 commit 訊息推定完成。

## 2. 不可破壞的不變量

1. **業務資料表皆為 `ct_*`。** `DB` → `vtaiwan-civic-talks` 位於共用命名空間；所有業務 DDL／SQL／型別守此前綴，migration 後核對 `sqlite_master`，不得建立會撞名的裸 `issues` 等表。
2. **內容生成與投稿審查分開。** 一般志願者生成仍是 BYO token／prompt，伺服器不代打生成模型。已授權例外：四種投稿使用 OpenRouter `openai/gpt-oss-safeguard-20b` 安全審查（基礎設施故障 fail-open，結構化記錄錯誤而不誤判濫用）；私有證據管線（明確同意、登入／停權守門、owner／admin 讀、不自動發布或改 briefing／議題狀態、缺 binding fail-closed）。素材事實查核由登入守門後的 `FACT_CHECK_CORE` Service Binding 轉送私有核心，不是內容生成；不加前端 key／HMAC，也不轉送 session cookie。
3. **SSR 不碰瀏覽器 API，不共享可變請求狀態。** `setup`、模組頂層、共用工廠皆適用；每請求新 app，瀏覽器 API 放 client-only／`onMounted` 或明確守衛。從請求 Cookie 解析 session 是合法伺服器行為。
4. **舊網址永不失效。** 下表只增不刪，維持 301／302 導向。
5. **API 路徑、方法、成功 JSON 與語意只能相容擴充。** 破壞變更先取得同意。既有授權例外只有：管理授權由密碼／token 改 Better Auth 角色；四種投稿及志願者 prompt 改需登入。不得恢復 `ADMIN_PASSWORD`、`X-Admin-Token`、`checkAdmin()` 或 `POST /api/admin/login`。
6. **機密不進 git／commit 訊息／log。** `.dev.vars` 留本機；新設定同步 `.dev.vars.example`，只放假值。憑證、cookie、私人正文不得外洩。
7. **遠端操作另需授權。** migration 預設 `--local`；遠端 migration、建刪庫與正式寫入先取得明確同意。本站 migration **只對 DB，不對 DB_AUTH**。`DB_AUTH` 未指定 `migrations_dir` 不代表安全：Wrangler 會補成本站 `./migrations`，禁止對 `vtaiwan-auth` 執行 migrations apply。
8. **生成物不手改。** `dist/`、`public/js/*.js`、`public/styles.css`、notices／manifest、`worker-configuration.d.ts` 改源頭再生成。
9. **程式完成須 typecheck、完整測試、build 全綠。** 對應行為／UI 驗收不可由編譯取代；文件任務只核對指令、引用與契約。未執行不得稱通過，紅燈不 commit；執行仍須遵守當次任務的驗證與遠端授權界線。
10. **不擅自 commit／push／deploy。** 使用者明確授權無人看管長程任務時，才可在 feature branch 對已驗證子步驟做 checkpoint commit；仍不得直接 commit main、push 或 deploy。
11. **DB_AUTH 只能由 Better Auth 寫。** 正常認證生命週期（含 OAuth 更新 image）之外，本站主動寫入僅限已授權 moderation ban/unban（admin plugin API，附管理員 session headers）與登入者 `update-user` handler。允許參數化 SELECT 供授權／同名／冷卻判斷；禁止原始 SQL INSERT／UPDATE／DELETE、auth DDL、本站 `migrations/auth/`。schema（含改名 triggers）唯一來源是 sibling repo；`user.role` 只讀，升降權／會員列表／日誌留在 vTaiwan-hono。
12. **同資料共用同 View。** 角色／分頁／步驟／操作用 query（`role`／`tab`／`step`／`action`）雙向同步 URL，重新整理與前進／返回可還原。首頁 `?action=click_issue_card&issue=<id>` 留在 Home 預覽，按「進入」才去議題頁。
13. **footer 原始碼必須對應實際建置 commit。** metadata 自動生成，不手填 SHA、不連移動中的分支、不沿用舊產物；commit／merge／squash／rebase 改 HEAD 後重建，文件 commit 也適用。發布前後查核見第 7 節。
14. **授權與 notices 不遺漏、不改寫。** 新本站軟體貢獻為 **AGPL-3.0-only**，非 or-later；第三方保留各自授權，保留 `LICENSE-MIT`、`NOTICE`、歷史 attribution，不補造許可。僅由 `vp run deploy` 發布，不能直接 Wrangler 上傳繞過公開來源查核；dry-run 只供預檢。已定義的 AGPL release `v0.2.0` 應指向合併後 merge commit，不推定 tag 已建立，MIT baseline tag／SHA 不移動。

| 舊網址                    | 新路由            |
| ------------------------- | ----------------- |
| `/index.html`             | `/`               |
| `/issue.html?id=<n>`      | `/issues/<n>`     |
| `/contribute.html?id=<n>` | `/contribute/<n>` |
| `/about.html`             | `/about`          |
| `/admin.html`             | `/admin`          |

## 3. Auth、作者隱私與 CSRF

### 認證與角色

- 與 vTaiwan-hono 共用 `DB_AUTH`、Google／GitHub OAuth 應用程式及 `BETTER_AUTH_SECRET`；Better Auth 版本需核對兩邊 package／lock。`BETTER_AUTH_URL` 是各環境自己的 origin，不能照抄 sibling。換網域／建環境需確認兩 provider callback allowlist。
- 同 email 的 trusted Google／GitHub account linking 已由使用者在正式站確認；**共用帳號／secret 不等於跨網域 SSO**，cookie 各 origin 登入，不擅改 cookie domain。
- `requireUser()`：未登入 401、停權 403，不限角色；`requireAdmin()`：只接受 `admin`／`super-admin`，無權限 403。停權者仍可提出申訴。
- admin plugin 只供 server 端 ban/unban，**`/api/auth/admin/*` HTTP 整段一律 404**，不可改成會漏新端點的黑名單。本站不自建 email／密碼登入或通用會員後台。
- `/api/auth/*` 交 Better Auth handler（admin 例外）；`POST /api/auth/update-user` 的本站 UI 目前只送 name，含 name 時做正規化、同名確認及 30 天冷卻。handler 仍可能接受其他 Better Auth 原生欄位，不能宣稱 API name-only。
- `GET /api/me` 回 `{user,role,banned,nameChangeCooldownDays,hasDuplicateDisplayName}`，不搬 sibling 的 permissions。前端用 `useAuth()` 共用查詢，不把使用者資料放 localStorage；SSR 固定 loading 骨架，Admin client 再分 anonymous／forbidden／admin。若日後 SSR 個人化，該頁不可邊緣快取。
- 一般 `vp run dev` 僅在 Vite `DEV && MODE==='development'` 停用 Auth：session 200/null、me 401、登入／callback／更新 503，受保護寫入仍 401。**不初始化本機 auth 表、不關 schema 檢查、不提供 fake user／匿名寫入**。`dev:remote` 與正式 build 保留真實 Auth。

### 投稿快照與公開投影

- 議題／素材／意見／briefing 保存投稿時 `author_id`、`author_name`、`author_email`、`show_email`；快照不隨帳號改名／刪除自動變更。舊資料 NULL 不回填；名稱缺漏不得退回 email。
- email 始終保存供管理追溯；公開只由該筆 `show_email=1` opt-in。建立議題、素材與意見要求嚴格 boolean `show_email`、`terms_accepted===true`；伺服器存 `TERMS_VERSION`／時間，不信 client 自報版本時間。修改條款同步 `src/legal/terms.ts`。
- 所有公開 SQL（含 `getIssueDetail()`、獨立詳情及 SSR state）列舉欄位，**禁 SELECT \***；email 用 `CASE WHEN show_email = 1 THEN author_email ELSE NULL END`，不得輸出 `author_id`／`show_email`。管理端 `*WithAuthor()` 才回完整快照，回應 `Vary: Cookie`。
- 公開 opt-in email 用 `AuthorEmailLink` 信封 mailto，不輸出明碼文字，無障礙名稱不放地址；地址仍存在 href／SSR state，**不是防爬措施**。卡片不可巢狀 `<a>`，避免 hydration mismatch。
- 投稿送出遇 401 用獨立 `sessionExpired` 顯示重新登入／先複製提示，**不把 authState 改 anonymous 而卸載表單吃掉草稿**。安全檢查皆由伺服器執行，UI／checkbox 不是防線。

### 跨站請求與快取

`src/index.ts` 的 `/api/*` 全域 `hono/csrf` 必須在所有 API 前註冊；不改逐端點 Origin 判斷。SameSite=Lax 仍可能讓 sibling origin 的簡單寫入帶 cookie，登入／角色守衛不能取代 CSRF。

管理／寫入端點不輸出 `Access-Control-Allow-*`，禁止 `Access-Control-Allow-Credentials`。公開唯讀可允許 `Access-Control-Allow-Origin: *`，但保留 `private, no-store`、`nosniff`、`Vary: Cookie`，避免公開／管理員投影混用；CORS 不是寫入防線。證據 API 私有且不開 CORS。

## 4. SSR、UI、i18n 與 Markdown

- `renderPage()` 每請求建立 SSR app，安全 escaping props 後注入狀態；首屏 Worker 查 D1，互動 hydration 後打本站 API。保持靜態殼可用並檢查共用元件、Auth、路由的副作用。
- 新頁面：建立 View、`src/ssr/heads.ts` head、`src/index.ts` 路由；需 hydration 時同步 `render.ts` 的 `PageName` 與 **`src/client/civic-entry.ts` 靜態 import／pages 註冊表**，沿既有 `renderPage` 選項。不要另建每頁 client entry／Rollup input。
- SSR／client 起始語言固定 `zh-TW`、Issue 角色 citizen、Markdown 編輯分頁；語言／志願者／主題偏好與瀏覽器 API 均 hydration 後處理。`zh-TW`／`en`／`ja` key 及插值集合一致；介面文字走 key，不以 fallback 代替翻譯。保留舊 `zh` 偏好，日期與 `OPINION.md` 跟介面語言，投稿不自動翻譯。
- Issue 無 step 顯示 briefing carousel；`?step=comments|materials|volunteer` 與內部切換、popstate 雙向同步並保留其他 query／登入 callback。citizen 四張，volunteer hydration 後有第五張導航。輪播維持視窗內、長文卡內捲動及 compact 授權 footer；其他分頁自然捲動／完整 footer，不刪原始碼與 notices 入口。
- Tailwind token 來源 `src/styles/app.css`，設計參考 `../vtaiwan-design-system/project/colors_and_type.css`。新樣式優先 `vt-*`／既有 utilities，不硬寫顏色字級間距；新 token 先定義，不順手重畫未受影響畫面。
- **SFC CSS 目前未被正式 HTML 載入**，dev 有效不代表 production 有效。維持無 `<style>` 區塊，使用 utilities 或 `app.css` 的共用 layer；接入抽出 CSS 是另需確認的結構改動。
- `LongTextContent` 超過門檻時完全不輸出原文，只顯示字數／展開鈕；**不得截短預覽或摘要 CC BY-NC-ND 素材**。素材詳情與管理審閱維持全文。
- `MarkdownEditor` 沿用 `renderSafeMarkdown()`，不另開 parser、raw HTML 或圖片；議題簡介純文字／換行，字數軟提示非 maxlength 或 API 限長。事實查核中／完成後保持 readonly。
- textarea 維持 writable computed 的原生 `v-model`，不用裸 `:value/@input` 破壞 IME；組字期間只留 textarea 暫存，不更新投稿 model／計數／預覽，compositionend 才提交。Markdown 預覽先 trim 再 render，與送出一致，但**不改草稿／計數／內文縮排**；純文字預覽不 trim。保留編輯／預覽切換、focus 與延後 aria-live 播報。

內容路由：`/`、`/issues/:id`、`/issues/:id/source/:materialId`、`/issues/:id/comment/:opinionId`、`/contribute/:id`、`/about`、`/profile`、`/appeals`、`/privacy`、`/terms`、`/admin`、`/rss.xml`。獨立素材／意見 URL 所屬議題不符回 404。

## 5. 主要業務 API 相容索引與狀態機

完整 JSON／驗證讀 `src/api/routes.ts` 與 `src/db/queries.ts`；一般錯誤 `{error:string}`。下表「登入」均含停權守門，「管理」為 admin／super-admin。

| 方法／路徑                                                                             | 相容行為／權限                                                                                                 |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET／POST `/api/issues`                                                                | 列表／登入建立議題                                                                                             |
| GET／PUT／DELETE `/api/issues/:id`                                                     | 公開詳情／管理編輯／管理級聯刪除素材、briefings、意見                                                          |
| PATCH `/api/issues/:id/closure`                                                        | 管理；`{closed:boolean,reason:string}`，trim 後理由 1–1000 code points，同狀態或併發衝突 409，成功 `{ok:true}` |
| GET／POST `/api/issues/:id/materials`                                                  | 列表／登入投稿；前端先完成同源 fact-check 且允許，server 仍做 moderation                                       |
| POST `/api/fact-check`                                                                 | 登入；Service Binding 串流轉送私有核心                                                                         |
| DELETE `/api/materials/:id`                                                            | 管理刪除                                                                                                       |
| GET／POST／PUT `/api/issues/:id/briefing`                                              | 最新說明頁／登入新增、版本遞增／管理編輯                                                                       |
| GET／POST `/api/issues/:id/opinions`                                                   | viewer-aware 列表，`sort=recent\|responses`（預設 recent）／登入投稿                                           |
| DELETE `/api/opinions/:id`                                                             | 管理刪除                                                                                                       |
| POST／DELETE `/api/opinions/:id/vote`                                                  | 登入投 `1/-1/0`（同意／不同意／略過）／撤回                                                                    |
| GET `/api/issues/:id/opinions/comments.csv`                                            | 登入匯出 pol.is 相容 CSV，private/no-store                                                                     |
| GET `/api/issues/:id/prompt`                                                           | 登入；`type=summarize\|narrative\|synthesis`，預設 summarize                                                   |
| POST `/api/appeals`                                                                    | 登入申訴 rejected_submission／account_ban，停權仍可用                                                          |
| GET `/api/admin/stats`、`/api/admin/users/:userId`                                     | 管理統計／投稿者目前帳號與停權狀態                                                                             |
| GET `/api/admin/moderation/preview`                                                    | 管理模型診斷，不寫 D1，但會呼叫模型                                                                            |
| GET `/api/admin/moderation/appeals`、PATCH `/api/admin/moderation/appeals/:id/resolve` | 管理申訴列表／維持或推翻；帳號處置經 Better Auth                                                               |

- 正常素材投稿 `collecting → summarizing`；正常 briefing 投稿 `collecting/summarizing → published`。安全審查違規仍保存／維持成功形狀，附 `moderation` 資訊，INSERT 時 `abuse_flagged=3` 並建 `source='ai'` 回報，公開只見 placeholder；素材／briefing 不推進狀態，解除誤報也不補推。無自動停權或自動隱藏門檻。
- **彙整至少兩份素材（#203 使用者授權）**：舊版 summarize／synthesis Prompt 與含非空 consensus／disputes／positions 的 briefing POST 只計同議題 abuse_flagged=0 素材；不足在審查／寫入前回 422 `{error:'insufficient_materials',minimum:2,count}`。UI 同步停用生成／複製／送出，三語提示且保留可編輯草稿；單獨 narrative／opinion_prompt 更新與管理員 PUT 不新增此限制。
- **closure 與 status 獨立**：只影響首頁進行中／已結案分類，不阻擋投稿、投票、匯出；公開理由／日期保留，一般編輯不得清除。
- 意見 API 提供 `vote_agree/disagree/pass`、`my_vote`、`can_view_vote_distribution`、`can_vote`、`is_author`。匿名／未投票時**伺服器以 null 遮蔽分布**，非前端藏起來；投票後或作者可見。作者是虛擬同意票，不寫 votes 表、不可自投；撤回後再隱藏。SSR 只注入不含投票欄位的公開 Opinion。
- `abuse_flagged=1` 展開內容後才提供控制，2/3 不可投。CSV 只匯公開意見／匿名作者序號，不輸出 Better Auth id、email、voter identity。
- 舊 polis.tw embed／後台開關已移除；保留 `polis_id` 舊值／API、本站投票與 CSV，不擅串 Pocket Polis。本站投票分群／跨群共識尚非既有功能；證據管線依素材抽取觀點產生立場分組，**不是公民意見投票的分群成果**。

## 6. 一鍵彙整：八 API 與品質／生命週期守門

私有草稿，來源為 `SOURCE_DB ?? DB`，保存到業務 DB，非 DB_AUTH。#210 的麥穗黃一鍵彙整按鈕、處理同意與進度／結果提示暫僅在 `import.meta.env.DEV` 掛載（含 dev:remote）；production 不掛載整個新元件，亦不啟動其狀態查詢／輪詢或 debug log。不得只用 CSS 隱藏，也不以 MODE 名稱判斷；此 UI 閘門不改後端 API 開關。新版報告排版仍屬 #166，不自動發布或改 briefing／status，舊 BYO 流程保留。正式設定保留 AI、EVIDENCE_WORKFLOW、`EVIDENCE_API_ENABLED=1`；只有明確 1 開啟，其他值／缺省 404（全域 CSRF 可能先回 403），缺必要 binding 503，匿名 401、停權 403。專用實驗／審閱 profiles、CLI、cookie 匯出工具與 fixtures 已退場，不提供舊命令。

**有效建立／GET／修訂可能啟動來源對帳、恢復 queued Workflow，對帳發現 deleted 會清 payload；不是純唯讀試打。** 正式登入後呼叫、新付費、queued 恢復及有效 maintenance 需核對來源、帳號／角色與個別授權，不因 API 已啟用或範例存在而執行。

| API                                        | 請求、回應與角色                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/issues/:id/evidence-jobs`       | 任一未停權登入者；JSON `{consent:true,language?,material_ids?}`，language 預設 zh-TW，可 en／ja。回 `{job_id,status,cache,input_coverage:{selection,material_ids,exclusions}}`；新建 202/miss、進行中 202/joined、完成快取 200/hit，保存的 failed 可 200/joined；200 不等於生成成功 |
| GET `/api/evidence-jobs/:jobId`            | owner／管理可讀，其他 404；回 status、usage、error_code、generation_progress、provenance 等，有可交付草稿才有 data／citation_map                                                                                                                                                    |
| GET `/api/evidence-jobs/:jobId/revisions`  | owner／管理可讀；需 ai_draft／partial_draft，否則 422；回 `{job_id,ai_base:{id:'ai',verification:'ai_unverified',data,citation_map},revisions}`                                                                                                                                     |
| POST `/api/evidence-jobs/:jobId/revisions` | **僅 owner**，管理員也不能代改他人工作（404）；JSON 精確 `{parent_revision_id:string,data}`；成功 201 `{revision_id,parent_revision_id,verification:'human_unverified'}`，舊 parent 409/revision_conflict                                                                           |
| POST `/api/evidence-maintenance/reconcile` | 管理；JSON 精確 `{}`，回 `{ok,checked,withdrawn,erased}`；對帳並可能恢復 queued                                                                                                                                                                                                     |
| POST `/api/evidence-maintenance/erase`     | 管理；JSON 精確 `{kind:'issue'\|'material',id:正安全整數}`，回 `{ok:true}`；按來源清跨依賴 execution／申請者私有內容，不刪業務來源                                                                                                                                                  |
| GET `/api/issues/:id/evidence-summary?language=zh-TW` | 語言必填，可 zh-TW／en／ja；登入者讀 `{version,has_summary,job,summary}`，job／summary 各限該次 owner／管理員，其他登入者回 null，不進公開 API／SSR |
| POST `/api/issues/:id/evidence-summary` | 登入者；精確 `{consent:true,language,expected_version}`，全選合格素材並沿用建立工作守門／回應，增加 version；舊版本回 409/summary_conflict，不自動重送 |

### 建立、輪詢與修訂

1. 建立只收上述欄位，不收正文／hash／作者。`consent` 必須 boolean true，缺／false／字串在啟動對帳與讀來源**之前**回 400/invalid_request。伺服器保存告知版本／時間；命中舊 job 不覆寫原同意，不代表已取得正文所有人的同意。
2. 省略 material_ids 代表所有合格素材並回排除清單；指定時須非空、同議題、可見、不重複的正安全整數 ID。**實際選入至少兩份合格素材才可開始彙整**，隱藏素材不計入；單份在 claim／費用預留前回 422/insufficient_materials（minimum:2、count:1、exclusions），零份維持 no_available_materials，明選空陣列仍為 400/invalid_material_ids。既有工作 GET／修訂與來源生命週期不套用此門檻。
3. 用 job_id 輪詢；`queued/extracting/comparing/generating` 是進行中，`ai_draft/partial_draft/failed/withdrawn/erased` 停止。partial 非完整報告，failed／no_findings 不混同；看分區 diagnostics 與 progress，不憑 HTTP 200 判斷。
4. 人改先 GET revisions；無人改時 parent=`'ai'`，否則用最新 revision.id。從 ai_base.data 或最新 revision.payload 複製**完整** data 再改，不只送片段；須有完整 consensus／disputes／positions、三段 Overview 與群 Core_concern，Sources 保持真實來源。revision 欄位用 `id/parentId/payload/diff`，不猜 snake_case。保留 AI 原稿／diff；human_unverified 不冒稱已驗證。
5. #210 議題摘要按語言分開保存，`0018_evidence_summaries.sql` 新增 `ct_issues.ai_summaries`／`ct_ai_summary_slots`；只有完整 `ai_draft` 可寫入。已有結果先確認替換，partial／failed 不覆蓋，舊工作晚完成不蓋新結果。伺服器完成時保存，不依賴前端輪詢；來源撤下時移除議題快取副本，原工作 payload 依既有政策保留，erase 清相依內容，副本不得繞過 fence。完整成功並確認已保存，或 `partial_draft` 回傳可交付 data 時，依 #210 在操作者瀏覽器暫用 `console.log` 輸出 data；部分草稿只供排查，不表示已保存，不送伺服器 log／公開驗收紀錄。新 migration 尚須另獲遠端授權，不能宣稱已部署。

### 模型與引用保護

精確模型、版本、參數、schema、usage 與費率讀 `src/ai/generation.ts`、`models.ts`、`runner.ts`、`pricing.ts`；操作與限制讀手冊／`Insight.md`，不要複製過時參數或付費重跑已成功實驗。

- 固定 Clairic／Clef／Gemma 4 26B A4B 管線；共識／爭點／立場三項各用相同已驗證證據與必要比較資料，不以摘要串接。每項獨立驗證、記帳／保存，**不自動重試、格式修復或模型／Responses fallback**。
- Gemma 原生 Chat Completions 僅接受字串 model、唯一 index 0／finish_reason stop 的 assistant 字串內容，完整 JSON（保留既有完整單一 plain/json fence 例外）；拒絕缺完成原因、截斷、refusal、tool、非字串等。忽略 reasoning，不切取思考文字或猜測修補。schema 支援不代表語義品質。
- 共識不設筆數目標：`shared_fact`／`shared_position` 需參與來源明示支持同一事實／立場；只有 `shared_challenge` 可依正面相關證據跨措辭或觀點綜整較窄具體共同挑戰。不能從沉默／共同話題推論，風險與建議須確實回應同一挑戰；保留條件／轉述歸屬，不能升格成共同贊同解法。
- 共識限跨素材 direct-agree 候選及有效子集、至少兩素材；每個候選完整交代採用或拒絕，每參與來源都有正文引用。canonical ID／candidate_map、動態 enum、空候選兩清單皆空；未知／舊 ID、漏交代、重複拒絕、同時採用拒絕皆拒收。不同命題可共用證據，但完全重複項目拒收。
- 爭點按問題整合佐證；question 引用留診斷，正規化後同問題拒收，不模糊刪除／自動合併。立場在同一輪中先生成 opinions，再根據其 Title／description 引用的精確聯集撰寫群名／Core_concern，輸出前自查引用子集；schema／範例採相同引導順序，不新增呼叫或自動修補。成員／Sources 仍只從 opinions 引用推導，同素材／同主題不能代替成員資格；保留 direct-disagree 互斥、完整覆蓋／排除守門，不推測動機。背景引用越界與語義近似重複仍需人工驗收，不能默許放寬。
- 三項後只有有內容必填仍 null 才最多一輪 Gemma **白名單補完**；不改已有值、來源、順序或舊引用，不新增第五輪。補完獨立預留／結算，無缺值不付費，必要補完失敗不交付缺值草稿。空／失敗／未啟動分區用三語狀態文字，不偽造來源結論或 citation；**空段不代表沒有爭點**。
- 來源 fence、停權、去重、最後快照／狀態再查不可移除；不覆寫歷史 raw、分項結果、unknown 或 tombstone。Clef 校準只對照已核可資料，不證明 labels／hash 來源，真實實驗不是獨立 gold labels。

### 費用、來源清除與隱私

- 平台 Workers AI；每帳號／UTC 日最多 20 新付費工作、議題五分鐘冷卻、環境模型 USD5／日**估算準入，非全帳單硬上限／整 job 報價**，不含 Workers／Workflows／D1。usage 缺失或異常保持 unknown，**unknown 預留不退款且跨日不自動釋放**，不保證次日恢復；不重建 quota 繞過。
- 無自動 TTL。hidden／changed 只撤下、保留 payload；來源失聯 fail-closed。deleted 被查核／對帳發現或管理員按來源 erase 才清跨依賴工作私有 payload／diff；不是單 job 自助刪除、不刪來源業務資料。保留帳號 ID、hash、同意版本／時間、usage、unknown、永久 tombstone，來源 ID 不得重新入場。
- 不保證即時發現刪除、撤回在途模型呼叫或即時清 D1 Time Travel 備份。保留原始 `0017` SQL／ledger、私有 `.wrangler` 狀態與已核准公開結果，不能以清理重設帳本。
- 業務 DB 含來源快照、完整模型 request／response、引用、人改／diff；模型不收作者快照欄，但正文、名稱、URL 仍可能含個資，未匿名化。Workers AI 一般推論政策不等於 D1 零留存；備份／營運／安全／法律例外、人工權利請求 `info@vtaiwan.tw` 見手冊及三語告知。

## 7. 工作、驗證與發布流程

### 本機工作與驗證

- 識別字／技術詞英文，註解／文件／commit／溝通用繁中。先讀來源與既有模式；大型架構／新工具鏈先確認，不順手加入無關功能。
- 套件管理用 npm，開發用 Vite+ `vp`，不換 pnpm／yarn／bun。依 `package.json` 的 devEngines 與 lockfile 安裝；lock 改動以 `node scripts/licensing-dependencies.mjs` 重產授權 TSV、加 `--check` 核對，同步授權檢閱統計與 notices。遵循依賴安全文件，不在 CI 重產盤點掩蓋 lock 不一致。

| 指令                                                     | 行為／注意                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `vp run dev`                                             | 完整 build 後 HMR；本機業務 DB、Auth 停用；不是純啟 server                       |
| `vp run dev:remote`                                      | 完整 build 後使用真實遠端 bindings／Auth／AI，**不是隔離 sandbox，可能寫入付費** |
| `vp run css:watch`                                       | 另終端監看 CSS；一般 dev 不自動 watch CSS                                        |
| `vp check --no-fmt --no-lint`、`vp test`、`vp run build` | 型別、完整測試、CSS→client→server 與 notices 建置                                |
| `vp preview`                                             | 預覽既有產物，不等於遠端驗收                                                     |
| `vp exec wrangler types`                                 | binding 變更後由源設定產生型別                                                   |
| `vp check`、`vp fmt`                                     | 全檢查／格式化，依任務授權執行，不無故重排他人改動                               |
| `vp run deploy`                                          | build＋實際產物／匿名公開來源查核＋部署；需另外授權                              |

- 一般程式交付跑 typecheck、完整測試、build；API／DB 補 CRUD、狀態、400/401/403/404、隱私／CSRF smoke；路由補新舊 URL；migration 先 local 並查表前綴。僅文件改動核對來源／連結／指令，不冒充程式驗證。
- 新 bug 補可重現回歸；安全／隱私、狀態／排序／限制／併發邏輯同改動補 `src/tests/` 測試，從 `vite-plus/test` import。i18n 由既有測試驗三語 key／插值，仍人工核對翻譯；純樣式／文案不鎖無關實作字串。
- UI 必須真實瀏覽器檢查三語、桌機／手機、淺／深色、受影響互動／hover／focus／disabled、hydration 無 mismatch，不能以讀 CSS 或 build 取代；交付只列實際檢查，未做明說。IME／trim／SSR 預設／URL 歷史等契約需對應回歸。
- Auth 變更在取得真人／遠端授權後驗 Google、GitHub、同 email account linking、登出、me、401/403、admin HTTP 404，並唯讀核對 auth sqlite_master 未新增表。不重跑已確認結果來冒充本輪證據。
- notices 是啟動前 production build 快照，套件／imports 改後重啟更新，不隨 HMR 重算；保持 UTF-8、client／Worker notices 與 manifest hashes 一致。Worker notices 須於所有 Cloudflare environments 建完後加入實際 ASSETS，避免 fallback 覆蓋。

### 遠端 D1 與發布

1. 操作遠端先取得範圍授權、`wrangler whoami` 核對帳號，明確使用 `--config wrangler.jsonc` 與業務庫 `vtaiwan-civic-talks`。`account_id` 不寫死、`nodejs_compat` 保留；網域未寫在 config，不憑猜測改綁定／Worker 名稱。
2. **`wrangler d1 migrations list --remote` 會初始化 ledger，不是嚴格唯讀。** 零 DDL 核對先 SELECT sqlite_master 確認 `d1_migrations` 存在，再 SELECT id/name/applied_at 與本機檔名比對；缺表停止，不自行初始化。migration 先於依賴新欄位的 Worker 部署，不憑本地檔案推定 remote 已套。禁止將本站 migration 套到 vtaiwan-auth。
3. 檢查完成且獲授權後 commit／push 到公開 repository；Conventional Commits＋繁中描述。**push 不等於 deploy**。從乾淨 checkout 重新 build，HEAD 任何變動後都重建。
4. 只用 `vp run deploy`：`scripts/source-metadata.mjs` 產生固定 commit metadata；`scripts/check-published-source.mjs` 核對 Wrangler redirected config 的實際 Worker／client／資產 metadata／hash，再匿名確認 commit 屬指定公開 repo 的發布分支歷史。dev/build 會影響 redirected 部署目標，不能直接 Wrangler 上傳。
5. fork 用自己的公開 origin，必要時 `CIVIC_SOURCE_REPOSITORY`／`CIVIC_SOURCE_BRANCH`。分支預設 main，必須是目標 repo 確切 `refs/heads/<branch>` 可解析的分支名稱；不接受 SHA／純十六進位名稱、tag、完整 ref、他人 fork owner:ref。匿名固定 SHA compare 驗 base 與 identical／ahead，不用分頁 commits 猜 head，也不以 fork-network 可讀當發布證據；限流／查核失敗停止，不用 token 繞過。
6. dirty／無 Git 產物顯示來源尚未發布，不能硬填舊 SHA；生成輸出可排除 dirty 判斷，實際 CSS source／補充授權／其他來源仍須提交。部署後匿名核對 footer archive／LICENSE 同 SHA、Worker/client 一致、兩份 notices 可讀。manifest artifactSha256 是目錄摘要，不是單一 JS hash；算法讀 `scripts/build-artifacts.mjs`。保留公開發布歷史／release tags，不修改已建置產物。

## 8. 當前未驗工作與授權界線

- 使用者已確認正式 Google／GitHub 登入、admin 後台、同 email account linking；尚未逐項實證四種投稿完整作者快照及管理端完整投影（#9）。不以登入成功替代隱私驗收。
- 意見投票／撤回／伺服器分布遮蔽／CSV 的正式部署與 smoke 仍依部署文件、當次使用者回報核對，不從舊 migration 紀錄推定已驗。
- 證據 API：已有真實品質實驗、正式六匿名 401／跨站簡單 POST 403、me super-admin／未停權的使用者回報。**尚未正式驗 `consent:false`（預期 400/invalid_request）、登入後建立／快取／輪詢／修訂／衝突、一般使用者與 non-owner／non-admin、有效 reconcile／erase**。預期不是通過；本機驗證／專用環境清理不等於正式驗收。
- UI／一般 API 與費用驗收由 [#166](https://github.com/g0v/civic-talk-hono/issues/166) 承接；維護、來源清除、unknown／tombstone 由 [#201](https://github.com/g0v/civic-talk-hono/issues/201) 承接，不再作已授權清理的前置條件。新的真人／付費／維護操作各自取得同意。
- 本輪使用者只回報已 push 上輪清理，未回報 deploy；最近已知正式啟用來源仍以前次回報為準，勿將新 HEAD 當正式版本。最新進度讀 `TODO_AFTER_MERGE.md`，不要自行恢復 queued、重跑成功實驗、遠端 migration、commit／push／deploy。
