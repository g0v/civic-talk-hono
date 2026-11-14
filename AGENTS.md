# 專案知識庫

**更新時間：** 2026-11-14（本輪依 reducer 摘要更新）
**Commit：** `8fb2ebb`
**Branch：** `feat/positions-disagreement-guard`

## 概覽
Civic Talk 使用 Hono、Vue 3 SSR/hydration、Tailwind 與 Cloudflare Workers；正式站 civic.vtaiwan.tw，Worker `civic-talk`。每頁 `renderPage`、單一 client entry，無 vue-router／vue-i18n；全站 router 改動須另確認。
先讀本檔不變量；程式任務必讀唯一子指引 [程式領域指引](./src/AGENTS.md)，承接 Auth／隱私、UI、業務狀態與證據領域驗收；`src/` 評分 13，屬獨立程式領域。歷史完成紀錄不是當前部署或驗收證據。

## 結構
- `src/index.ts`：SSR／API／舊網址／ASSETS fallback；`src/worker.ts` 匯出 EvidenceWorkflow，使可由 Node 匯入的 index 不直接依賴 cloudflare:workers。
- `src/ssr/`、`src/client/`：HTML 殼、安全狀態注入、唯一 hydration 註冊表。
- `src/views/`、`src/components/`、`src/composables/`：頁面、共用 UI、登入／導覽。
- `src/api/`、`src/db/`、`migrations/`：業務契約、集中 SQL／型別、ct_* schema。
- `src/auth/`、`src/moderation/`、`src/ai/`：認證、審查申訴、私有證據生命週期。
- `src/l10n/`、`src/styles/app.css`：三語 key／插值、共用 Tailwind token。

## 導覽
| 任務 | 來源 | 注意 |
| --- | --- | --- |
| 程式領域契約 | [src/AGENTS.md](./src/AGENTS.md) | Auth／隱私／CSRF、UI、業務狀態、八個證據 API |
| SSR／head／hydration | `src/ssr/render.ts`、`src/ssr/heads.ts`、`src/client/civic-entry.ts` | PageName／pages 同步，不另開 entry |
| API／授權／SQL | `src/api/routes.ts`、`src/api/auth.ts`、`src/api/requireUser.ts`、`src/db/queries.ts` | 成功契約只相容擴充 |
| 條款／模型／費率 | `src/legal/terms.ts`、`src/ai/` | 精確版本讀來源 |
| 工具／binding | `package.json`、lockfile、`wrangler.jsonc`、Vite configs | 不猜版本或指令 |
| 開發／發布 | [README](./README.md)、[部署說明](./deploy_notes.md) | push 非 deploy |
| 證據操作／品質 | [證據 API 手冊](./docs/evidence-api-review.md)、`Insight.md` | 範例不構成付費／維護授權 |
| 依賴／授權 | [依賴安全](./docs/dependency-security.md)、[授權檢閱](./docs/licensing-review.md) | 保留 attribution |
| 待驗／交接 | [目前交接](./TODO_AFTER_MERGE.md)、GitHub issues | 不構成遠端授權 |

## 程式地圖
摘要盤點 `src/` 工作樹（含未追蹤檔，排除生成／依賴目錄及非一般檔）：155 檔、154 程式檔、17 後代目錄，程式比例 99.3548%，非 tracked-only。
TypeScript AST 僅解析 120 個 `.ts`，未解析 SFC：4306 個具名宣告節點（含區域變數）、411 個帶 export 修飾的宣告（非匯出名稱數）。下表符號已由摘要核實；引用中心性與引用數未測，不填推估值。
| 符號 | 類型 | 位置 | 引用數 | 角色 |
| --- | --- | --- | --- | --- |
| renderPage | 函式 | `src/ssr/render.ts` | 未測 | 每請求安全 SSR |
| pages | 區域常數／註冊表 | `src/client/civic-entry.ts` | 未測 | 唯一 hydration 入口，非匯出 |
| registerAuthRoutes | 函式 | `src/api/auth.ts` | 未測 | Auth 轉交與 admin HTTP 封鎖 |
| withEvidenceSource | 函式 | `src/ai/env.ts` | 未測 | 證據來源範圍 |
| WORKFLOW_CONTROL_POLICY | 常數 | `src/ai/workflowPolicy.ts` | 未測 | 禁付費自動重試 |

## 專案慣例與全域不變量
- 現行程式決定實作，使用者最新裁示決定需求／授權；文件衝突或破壞契約先釐清，不憑 issue 勾選、分支名、commit 訊息推定完成。
- 識別字／技術詞英文，註解／文件／commit／溝通繁中；先讀模式，大型架構／新工具鏈先確認，不加入無關功能。
- 業務 DDL／SQL／型別一律 `ct_*`；DB → vtaiwan-civic-talks 屬共用命名空間，migration 後查 sqlite_master，禁裸 issues 等撞名表。
- migration 預設 --local，僅 DB；遠端 migration／建刪庫／正式寫入先明確授權。DB_AUTH 缺 migrations_dir 仍會套本站 ./migrations，禁止對 vtaiwan-auth migrations apply。
- DB_AUTH 只能由 Better Auth 寫；正常認證生命週期（含 OAuth image）外僅已授權 ban/unban（admin plugin API＋管理員 session headers）與登入者 update-user handler。可參數化 SELECT 作授權／同名／冷卻判斷；禁原始 SQL 寫入、auth DDL、本站 migrations/auth/。schema／改名 triggers 唯一來源 sibling；user.role 只讀，升降權／會員列表／日誌留 sibling。
- API 路徑／方法／成功 JSON／語意只相容擴充，破壞先同意；既有例外僅管理密碼／token 改角色、四種投稿與志願者 prompt 改需登入。禁恢復 ADMIN_PASSWORD、X-Admin-Token、checkAdmin()、POST /api/admin/login。
- 生成與審查分離：一般生成維持 BYO token／prompt，伺服器不代打。四種投稿 OpenRouter openai/gpt-oss-safeguard-20b 審查僅基礎設施故障 fail-open，結構化記錯不誤判濫用；私有證據須明確同意、登入／停權守門、owner／admin 讀，缺 binding fail-closed，不自動發布或改 briefing／status。
- FACT_CHECK_CORE 經登入守門後 Service Binding 轉送私有核心，不是生成；禁前端 key／HMAC、轉送 session cookie。證據來源 SOURCE_DB ?? DB 僅讀，保存至業務 DB。
- SSR setup／模組／工廠不得碰未守衛瀏覽器 API 或共享可變請求狀態；每請求新 app，瀏覽器操作 client-only／onMounted。從 Cookie 解析 session 合法。
- 同資料同 View；role／tab／step／action query 雙向同步，重整／前進／返回還原。首頁 ?action=click_issue_card&issue=<id> 留 Home 預覽，按「進入」才去議題頁。
- 憑證／機密／cookie／私人正文禁進 git／commit 訊息／log；.dev.vars 留本機，新設定同步 .dev.vars.example 假值。#210 授權瀏覽器 data 排查例外依子指引，不送伺服器 log／公開紀錄。
- 不手改 dist/、public/js/*.js、public/styles.css、notices／manifest、worker-configuration.d.ts；改來源再生成。
- 不擅自 commit／push／deploy；明確授權無人看管長程任務才可 feature branch 對已驗子步驟 checkpoint commit，仍不可直接 commit main／push／deploy。
- 新貢獻 AGPL-3.0-only，非 or-later；保留 LICENSE-MIT、NOTICE、歷史 attribution、第三方各自授權，不造許可。v0.2.0 指合併後 merge commit，不推定 tag 已建，MIT baseline tag／SHA 不移。

## 禁止模式與相容網址
- ../civic-talk 僅作功能／內容相容來源；接口已在本站 Worker，不呼叫舊 Pages Functions，不搬舊部署腳本或大段 CSS。
- Better Auth 必須對齊 ../vTaiwan-hono 現行 src/server/lib/createAuth.ts、authorization.ts、migrations/auth/；一般慣例僅參考，不引入 LemmaScript／Dafny、會員管理、step-up 工具鏈。
- 舊網址只增不刪，維持 301／302：/index.html → /；/issue.html?id=<n> → /issues/<n>；/contribute.html?id=<n> → /contribute/<n>；/about.html → /about；/admin.html → /admin。
- 子指引的 Auth HTTP 整段封鎖、公開 SQL 投影、全域 CSRF／私有快取、禁止 SFC style、IME／ND 素材、投票遮蔽、模型引用／費用／清除守門均須遵守，不能從 UI／文件／測試推定解除。

## 特有行為
- SSR／client 初始 zh-TW、citizen、Markdown 編輯分頁；偏好 hydration 後載入，三語 key／插值一致；URL／輪播／無障礙／Markdown 細節見子指引。
- #210 整個一鍵彙整元件僅 import.meta.env.DEV 掛載（含 dev:remote）；production 不查狀態／輪詢／debug，不只 CSS 隱藏、不按 MODE 判斷；後端開關不變，舊 BYO 保留，報告排版屬 #166。
- 有效證據建立／GET／修訂可對帳、恢復 queued，deleted 可清 payload；非純唯讀。正式登入呼叫、新付費、queued 恢復、有效 maintenance 須核對來源／帳號角色與個別授權；退場 profiles／CLI／cookie 匯出工具／fixtures 不恢復。
- 不付費重跑成功實驗、不自動重試／修格式／fallback；無 TTL，unknown 預留不退款且跨日不釋放，不重建 quota。保留原始 0017 SQL／ledger、私有 .wrangler、核准公開結果；來源 fence／停權／去重／tombstone 不繞過，細節見子指引。

## 本機指令與驗證
套件管理 npm、開發 Vite+ vp，不換 pnpm／yarn／bun；依 package.json devEngines／lockfile 安裝。
| 指令 | 行為與界線 |
| --- | --- |
| vp run dev | 完整 build 後 HMR；本機業務 DB、Auth 停用，保護寫入仍需登入；不建 auth 表／假使用者 |
| vp run dev:remote | 完整 build 後真實遠端 bindings／Auth／AI，可寫入付費，非 sandbox |
| vp run css:watch | 另終端；一般 dev 不自動 watch CSS |
| vp check --no-fmt --no-lint；vp test；vp run build | 型別、完整測試、CSS→client→server＋notices；程式交付須全綠 |
| vp preview；vp exec wrangler types | 前者只預覽既有產物；binding 變更由後者生成型別 |
| vp check；vp fmt | 依任務授權全檢查／格式化，不重排他人改動 |
| vp run deploy | build＋實際產物／匿名公開來源查核＋部署，須另授權 |
- lock 改動以 node scripts/licensing-dependencies.mjs 重產授權 TSV、加 --check 核對，同步檢閱統計／notices；遵循依賴安全文件，CI 不重產掩蓋差異。
- 文件僅核指令／引用／契約；程式須 typecheck、完整測試、build 與行為驗收，未跑不稱通過、紅燈不 commit，驗證不越過當次遠端界線。
- 新 bug 補可重現回歸；安全／隱私／狀態／排序／限制／併發補 src/tests/、import vite-plus/test；純樣式文案不鎖無關實作字串，三語翻譯仍人工核對。
- API／DB 驗 CRUD、狀態、400/401/403/404、隱私／CSRF；路由驗新舊 URL；migration 先 local 查前綴。UI 真實瀏覽器驗三語、桌機／手機、淺／深色、互動／hover／focus／disabled、hydration、IME／trim／SSR／URL 回歸；未驗明說，不以編譯取代。
- Auth 真人／遠端驗收先授權，再驗兩 OAuth、linking、登出、me、401/403、admin HTTP 404，唯讀查 auth sqlite_master 無新增表；不重跑已確認結果冒充本輪證據。

## 發布與產物注意事項
- footer 固定實際建置 commit；metadata 自動生成，不手填 SHA／連移動分支／沿用產物。commit／merge／squash／rebase 或文件 commit 改 HEAD 後皆從乾淨 checkout 重建。
- 遠端先範圍授權、wrangler whoami 核帳號，明確 --config wrangler.jsonc 與 vtaiwan-civic-talks；不寫死 account_id、保留 nodejs_compat，不猜網域綁定或改 Worker 名稱。
- wrangler d1 migrations list --remote 會初始化 ledger，非嚴格唯讀；先 SELECT sqlite_master 確認 d1_migrations，再 SELECT id/name/applied_at 比本機檔名；缺表停、不初始化。migration 先於依賴欄位部署，不從本機推定遠端已套。
- 檢查完成且獲授權才 commit／push 公開 repo，Conventional Commits＋繁中；只用 vp run deploy，不直接 Wrangler 上傳，dry-run 僅預檢。dev/build 會改 redirected 目標，push 非 deploy。
- scripts/source-metadata.mjs 產生固定 metadata；scripts/check-published-source.mjs 核 redirected config 實際 Worker／client／資產 metadata／hash，再匿名確認 SHA 屬指定公開 repo 發布分支歷史。
- fork 用自有公開 origin，必要時 CIVIC_SOURCE_REPOSITORY／CIVIC_SOURCE_BRANCH；預設 main，必須精確 refs/heads/<branch> 可解析，禁 SHA／純十六進位名／tag／完整 ref／owner:ref。
- 匿名固定 SHA compare 驗 base 與 identical／ahead，不用分頁 commits 猜 head／fork-network 可讀替代；限流／失敗停，不用 token 繞過。
- dirty／無 Git 顯示未發布，不填舊 SHA；僅生成輸出可排除 dirty，實際 CSS／補充授權／來源仍須提交。保留公開發布歷史／release tags，不改建置產物。
- notices 為啟動前 production build 快照，不隨 HMR 重算；imports／套件改後重啟，UTF-8／client／Worker／manifest hashes 一致；所有 Cloudflare environments 建完後才加 Worker notices 至實際 ASSETS，避免 fallback 蓋掉。
- 部署後匿名查 footer archive／LICENSE 同 SHA、Worker/client 一致、兩份 notices 可讀；artifactSha256 是目錄摘要，算法見 scripts/build-artifacts.mjs，非單一 JS hash。

## 待驗與授權界線
- 已回報正式 Google／GitHub 登入、admin、同 email linking；#9 四種投稿作者快照／管理完整投影未逐項實證，登入成功不替代隱私驗收。
- 投票／撤回／伺服器分布遮蔽／CSV 正式部署與 smoke 依部署文件及當次回報核對，舊 migration 紀錄非驗收。
- 證據已有真實品質實驗、正式六匿名 401／跨站簡單 POST 403、me super-admin／未停權回報；consent:false 預期 400/invalid_request、登入建立／快取／輪詢／修訂／衝突、一般使用者／non-owner／non-admin、有效 reconcile／erase 均尚未正式驗。本機／專用環境清理不等於正式驗收。
- #166 承接 UI／一般 API／費用，#201 承接維護／來源清除／unknown／tombstone，不再當已授權清理前置；新的真人／付費／維護操作各自同意。
- 最近僅回報 push 上輪清理，未回報 deploy，HEAD 非正式版本證據；0018 migration 仍須遠端授權，不推定已套。最新看 TODO_AFTER_MERGE.md，不自行恢復 queued／重跑成功實驗／遠端 migration／commit／push／deploy。
