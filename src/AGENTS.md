# 程式來源指引

## OVERVIEW
評分 10（子目錄 2、程式比例 2、index 2、符號 2、匯出 2；引用未量測給 0）；跨 API、Auth、SSR 與 UI 的共同契約集中於此，低分領域由本檔涵蓋。

## STRUCTURE
- `index.ts` 組裝 Hono；`worker.ts` 才重匯出 Workers 專用 Workflow。
- `api/` 業務與 Auth HTTP；`auth/` Better Auth 工廠及授權。
- `db/` 業務 SQL；`ai/` 私有證據工作與帳本。
- `ssr/` HTML、head、安全序列化；`client/` 單一 hydration entry。
- `views/` 頁面；`components/` 共用 UI；`composables/` client 狀態。
- `lib/` 資料／URL 規則；`l10n/` 三語；`styles/` 共用 token。
- `moderation/` 投稿安全審查；`legal/` 條款版本；`opinions/` CSV；`tests/` 回歸。

## WHERE TO LOOK
| 工作 | 來源 | 核對點 |
|---|---|---|
| 路由與防護順序 | `index.ts`、`api/csrf.ts` | CSRF、功能開關、bindings、Auth、一般 API |
| SSR／新頁面 | `ssr/render.ts`、`ssr/heads.ts`、`client/civic-entry.ts` | `PageName`、靜態 import、pages 註冊表同步 |
| 認證／角色 | `auth/createAuth.ts`、`auth/authorization.ts`、`api/requireUser.ts` | sibling 現行 Better Auth 契約 |
| 改名／me | `api/auth.ts`、`lib/profile-name.ts`、`composables/useAuth.ts` | 正規化、同名確認、30 天冷卻 |
| 投稿／審查／申訴 | `api/routes.ts`、`moderation/service.ts`、`legal/terms.ts` | 伺服器同意、作者快照、狀態 |
| 安全 Markdown | `markdown/renderSafeMarkdown.ts` | 無 raw HTML、無圖片 |
| 回歸入口 | `tests/`、`../vite.config.mts` | `vite-plus/test`、完整測試集合 |

## CONVENTIONS
- `renderPage()` 每請求新 app，安全 escaping props／state；首屏讀 D1，hydration 後打本站 API。
- 起始語言固定 zh-TW、Issue 角色 citizen、Markdown 編輯分頁；偏好與瀏覽器 API hydration 後處理。
- 新頁同步 View、head、index 路由、`PageName` 與 civic-entry 靜態註冊；沿用 renderPage 選項。
- Auth 工廠、版本／lock 與 `../../vTaiwan-hono` 的 createAuth、authorization、auth migrations 對齊；不搬會員／step-up／LemmaScript／Dafny。
- 共用 DB_AUTH、OAuth 應用程式與 secret，但 BETTER_AUTH_URL 用各環境 origin；換域核對兩 provider callback allowlist。
- trusted Google／GitHub linking 不等於跨域 SSO；cookie 各 origin，不擅改 domain。OAuth 正常同步 image，保留自訂 name／email。
- `requireUser()` 匿名 401、停權 403，不限角色；管理守門限 admin／super-admin，無權限 403；停權仍可申訴。
- `/api/auth/*` 交 Better Auth；`/api/auth/admin/*` 整段 404；server ban/unban 依 plugin 權限及管理員 session headers。
- update-user UI 目前送 name；handler 仍可能接受其他原生欄位，不宣稱 API name-only。
- `/api/me` 回 user、role、banned、nameChangeCooldownDays、hasDuplicateDisplayName；不搬 sibling permissions。
- `useAuth()` 共用 client 查詢；SSR 固定 loading，Admin client 再分 anonymous／forbidden／admin；個人化 SSR 不可邊緣快取。
- 僅 `DEV && MODE==='development'` 停用 Auth：session 200/null、me 401、登入／callback／更新 503、受保護寫入 401。
- dev:remote 與 production 真實 Auth；不建本機 auth 表、不停 schema 檢查、不提供 fake user 或匿名寫入。
- `index.ts` 的全域 `/api/*` CSRF 必須先於所有 API；SameSite=Lax 與登入／角色檢查不能代替 CSRF。
- 管理／寫入端點不輸出 CORS allow headers，禁止 Allow-Credentials；公開唯讀可 `*`，仍保留 private/no-store、nosniff、Vary: Cookie；證據 API 不開 CORS。
- 四種投稿使用 OpenRouter safeguard 審查；基礎設施故障 fail-open 並結構化記錯，不誤判濫用；不混同 BYO 生成。
- FACT_CHECK_CORE 只在登入守門後經 Service Binding 串流轉送；不加前端 key／HMAC、不轉送 session cookie。
- 一般 API 錯誤 `{error:string}`；完整路徑／方法／JSON 以 routes.ts 與 db/queries.ts 為權威。
- 建議題、素材、意見要求嚴格 boolean show_email、terms_accepted===true；伺服器存 TERMS_VERSION／時間，條款變更同步 legal/terms.ts。
- 議題簡介選填、最多 300 Unicode code points；POST 在模型審查／寫入前以 400 拒絕超長，沿用 lib 共用規則。
- 素材正常 collecting→summarizing，briefing 正常 collecting/summarizing→published；違規仍保存成功形狀與 moderation，INSERT abuse_flagged=3、建 source='ai' 回報。
- 違規素材／briefing 不推進狀態，解除誤報不補推；公開 placeholder，沒有自動停權或隱藏門檻。
- 舊 summarize／synthesis prompt 與非空 consensus／disputes／positions briefing POST 至少兩份同議題 abuse_flagged=0 素材，審查／寫入前不足回 422 insufficient_materials、minimum:2、count。
- 單獨 narrative／opinion_prompt 更新與管理 PUT 不新增素材門檻。
- closure 獨立於 status：管理 PATCH 精確 boolean closed，理由 trim 後 1–1000 code points，同狀態／併發衝突 409，成功 `{ok:true}`；不阻擋投稿、投票、匯出。
- opinions 列表 viewer-aware，sort=recent|responses 預設 recent；SSR 僅注入無投票欄位的公開 Opinion；分布遮蔽與作者虛擬票規則見下文。
- pol.is CSV 需登入且 private/no-store；保留 polis_id 舊值／API，不恢復 embed／後台開關，不擅串 Pocket Polis。
- #113 公民投票分群與意見綜整獨立於素材證據管線。四位達標才計算，資格納入作者預設票但各須一張真實票；只計未標記公開意見，公開不下發參與者帳號或個人點，群體小／證據不足時抑制群立場。本人群別只來自當下 session，回應 private/no-store。正式預設關閉，AI 有獨立版本開關、Workflow 去重／預留、24h 刷新限制與來源撤下守門；普通本機 dev 不呼叫模型。
- 內容路由保留 `/`、`/issues/:id`、`/issues/:id/source/:materialId`、`/issues/:id/comment/:opinionId`、`/contribute/:id`、`/about`、`/profile`、`/appeals`、`/privacy`、`/terms`、`/admin`、`/rss.xml`；新增路由核對 `index.ts`、head 與 hydration 註冊，獨立素材／意見所屬議題不符回 404。
- `db/queries.ts` 集中 ct_* 型別與 SQL，不另建平行 repository；`db/issueVoteCountCache.ts` 管公開計數，schema 見 `../migrations/`，私有證據由 `ai/store.ts` 寫入。議題／素材／意見／briefing 保存投稿時 author_id/name/email/show_email，不隨改名／刪帳變動，舊 NULL 不回填、缺名不退回 email；email 始終留存管理追溯。公開 getIssueDetail／獨立詳情／SSR SQL 列舉欄位、禁 SELECT *，email 用 `CASE WHEN show_email = 1 THEN author_email ELSE NULL END`，不輸出 author_id/show_email；僅管理 *WithAuthor() 回完整快照，HTTP 保留 Vary: Cookie，不混公開投影。不以現在帳號資料替換快照或補造資料，不以 UI 隱藏代替 SQL／server 遮蔽。
- 意見投票回 vote_agree/disagree/pass、my_vote、can_view_vote_distribution、can_vote、is_author；匿名／未投票分布 server 以 null 遮蔽，投票後或作者可見，撤回再隱藏。作者虛擬同意不寫 votes、不可自投；其他登入者投 1/-1/0，DELETE 撤回；abuse_flagged=1 展開後才提供控制，2/3 不可投，公開 SQL/API 均守可見性。`opinions/export.ts` 的 CSV 僅公開意見／匿名作者序號，不含 Better Auth id/email/voter identity／跨議題內容。closure/status 分存；沿既有原子條件與衝突回應，不先讀後寫假裝無競態，不由本機 migration／fixture 推定遠端 schema。回歸見 tests/authorPrivacy、issueVisibility、opinionVotes、submissionConcurrency。
- `views/Home.vue` 管分類／排序／預覽，`Issue.vue` 管輪播／step／投票，Contribute 管查核投稿，Admin／Appeals 管管理申訴，Profile 管名稱，Terms／Privacy 管告知，MaterialDetail／OpinionDetail 與 index 核所屬議題。role/tab/step/action 雙向同步 URL／popstate、保留其他 query／登入 callback；首頁 `?action=click_issue_card&issue=<id>` 留 Home 預覽，進入才轉頁。Issue 無 step 顯示 briefing carousel，step=comments|materials|volunteer；citizen 四張，volunteer hydration 後第五張導航；輪播維持視窗內、長文卡內捲動、compact 授權 footer，其他分頁自然捲動／完整 footer。401 以獨立 sessionExpired 提示登入／先複製，不改 authState 成 anonymous 卸載表單。素材先同源 fact-check 且允許才送，server 仍審查，查核中／完成後 readonly；兩素材不足同步停生成／複製／briefing 送出、三語提示且留草稿，narrative/opinion_prompt／管理 PUT 例外保留。closure 只影響首頁分類、保留公開理由日期。DEV 摘要掛載／特定 log 見 components/AGENTS.md；不以登入成功取代隱私驗收、200 或 partial/failed 取代完整保存，不順手重畫無關頁或用 SFC style 解正式樣式。
- `lib/` 的 homeSorting/homeSortPreference、homeLifecycle/homeSearch/homeIssuePreview、issueNavigation、issueDescription、issueTags、profile-name、factCheck 是共用規則；純排序／過濾／解析可由 Worker/SSR 匯入，瀏覽器偏好存取分離，不在頂層讀 window/document/localStorage 或共享 SSR 狀態。300 Unicode code points 與名稱正規化／同名／冷卻供 UI/API 共用，不用 UTF-16 length、不截斷改寫全文、不另實作平行規則或直接寫 auth DB；URL 修改核對 index/Home/Issue，保留合法值／預設、其他 query／callback，不吞未知參數／重設無關狀態、不把 preview 當轉頁；標籤／排序測真實查詢結果，不只函式存在。helper 與 client fact-check 解析不替代 API 邊界驗證、登入、私有 binding 或 server moderation。
- `l10n/zh-TW.ts` messages/MessageKey 定義 canonical keys，en/ja typed catalogs 的 key 與 `{name}` 插值集合一致；新增文案三語同改、不硬寫／以 fallback 補缺。沿 createI18n/provideI18n/useI18n，不另引 vue-i18n；SSR/hydration 初始 zh-TW，mounted 才套偏好／瀏覽器語言，手動偏好優先，無設定才按瀏覽器順序；舊 zh 正規化 zh-TW、沿既有儲存契約，不移除相容。document lang 在瀏覽器同步 zh-TW→zh-Hant，server 不碰 DOM；每 SSR app／未注入 fallback 各新 instance、不共享 locale 或從 localStorage 改 SSR 初值。日期／OPINION.md 隨介面語言，投稿不自動翻譯；條款／隱私／證據告知三語同步核版本及資料處理語意；tests/l10n.test.ts 驗 key/插值後仍人工核譯意，空段／失敗不可譯為沒有爭點。
- `client/civic-entry.ts` 靜態 Views/pages: Record<PageName,Component> 與 ssr/render.ts 同步，從安全 __PAGE__/__SSR_STATE__ createSSRApp hydration；不另建每頁 entry、動態 router 或第二份名稱表。AppHeader mounted 才讀語言偏好；摘要狀態每議題元件各自持有，不從 URL/localStorage 接任意 job ID；language/version 用 server context，409 summary_conflict 顯示衝突、不自動重送替換；切換／卸載沿 generation token/abort/timer 清理，舊回應不覆新語言版本。`client/evidenceSummary.ts` 的 queued/extracting/comparing/generating 輪詢，ai_draft/partial_draft/failed/withdrawn/erased 停止，完整成功須確認 server 已存，partial 僅排查；不憑未驗 HTTP JSON 推論完成／可見性或繞 owner/admin。DEV 呼叫端整體掛載，production 不啟動新摘要查詢／timer/debug，CSS 隱藏不算；失效 session 保草稿，submission pending 同 tick 生效並 finally 還原；clipboard 沿 helper。特定瀏覽器 log 僅 components/AGENTS.md 例外，不一般化私有正文；不存 user 到 localStorage、不轉 cookie 給查核核心。回歸見 tests/evidenceSummaryClient、authSession。
- `ai/` 專業來源：endpoints/routes/human 管八 API／同意修訂，workflow/runner/workflowPolicy 管 Workflow，source/lifecycle 管來源，store 與 ../migrations/0017_evidence_pipeline.sql、0018_evidence_summaries.sql 管帳本/fence/摘要，evidence/comparison/generation 管引用，models/pricing 管模型費率；完整操作讀 `../docs/evidence-api-review.md`、`../Insight.md`，回歸見 tests/evidencePipeline、evidenceStorage、evidenceGeneration。私有草稿以 SOURCE_DB??DB 僅經 source repository 固定參數化 SELECT 讀，寫業務 DB、不寫 SOURCE_DB/DB_AUTH；僅 EVIDENCE_API_ENABLED='1' 開、否則含缺省 404（CSRF 可先403），缺必要 binding503、匿名401、停權403。建立限未停權登入者，job/revisions 讀限 owner/admin、其餘404，修訂僅 owner，admin 不代改。有效建立／GET／修訂／reconcile 可對帳、恢復 queued、發現 deleted 清 payload，非純唯讀；正式登入、新付費、queued 恢復、maintenance 均逐項核來源／帳號角色／當次授權，開關與範例不授權，不自動發布或改 briefing/status。
- POST `/api/issues/:id/evidence-jobs` 精確 `{consent:true,language?,material_ids?}`，zh-TW 預設／en/ja，不收正文/hash/作者；consent 缺/false/字串在對帳／讀來源前400 invalid_request，存告知版本時間，舊 job 不覆同意、非正文所有人同意。省略 IDs 全選合格回 exclusions，明選非空／同議題／可見／不重複正安全整數，空陣列400 invalid_material_ids；實選至少兩份，單份在 claim/預留前422 insufficient_materials（minimum:2/count:1/exclusions）、零份 no_available_materials，既有 GET/修訂不套門檻。回 job_id/status/cache/input_coverage，202 miss/joined、200 hit，保存 failed 可200 joined，200 非成功；GET `/api/evidence-jobs/:jobId` 回 status/usage/error_code/generation_progress/provenance，僅可交付草稿有 data/citation_map；進行與終態按 client 輪詢規則，partial/failed/no_findings 分清，看 diagnostics/progress。
- GET `/api/evidence-jobs/:jobId/revisions` 需 ai_draft/partial_draft 否則422，回 ai_base（id:'ai'/ai_unverified/data/citation_map）和 revisions；先 GET，再以 'ai'／最新 revision.id 為 parent，由完整 ai_base.data／最新 payload 複製修改，保留 consensus/disputes/positions、三段 Overview、群 Core_concern、真實 Sources、AI 原稿/diff。POST 同 revisions URL 精確 `{parent_revision_id,data}`，201 回 revision_id/parent_revision_id/human_unverified，舊 parent409 revision_conflict；讀 id/parentId/payload/diff，不猜 snake_case，人改非已驗證。管理 POST `/api/evidence-maintenance/reconcile` 精確 `{}` 回 ok/checked/withdrawn/erased；erase 精確 `{kind:'issue'|'material',id:正安全整數}` 回 `{ok:true}`。GET `/api/issues/:id/evidence-summary` 必填 language，登入回 version/has_summary/job/summary，job/summary 各限 owner/admin，其餘 null，不進公開 API/SSR；POST 精確 `{consent:true,language,expected_version}`，全選合格沿建立守門並增 version，舊版409 summary_conflict、不自動重送。
- 摘要按語言分槽，0018 的 ct_issues.ai_summaries/ct_ai_summary_slots 只有完整 ai_draft 寫入；先確認替換，partial/failed 不覆舊，舊工作晚完成不蓋新結果，server 保存不依賴輪詢。來源撤下清議題快取副本、原 payload 依政策保留，erase 清相依且不可繞 fence；新 migration 遠端仍另授權。固定 Clairic/Clef/Gemma 4 26B A4B，精確版本參數/schema/usage/費率讀源碼，不複製歷史值；三項共識／爭點／立場各用同一已驗證證據及必要比較資料、不串摘要，各獨立驗證／記帳／保存，不自動重試／修格式／模型或 Responses fallback，不付費重跑成功實驗。Gemma Chat Completions 僅字串 model、唯一 index0、finish_reason stop、assistant 字串完整 JSON，保留完整單一 plain/json fence 例外；拒缺完成原因／截斷/refusal/tool/非字串，忽略 reasoning、不切思考或猜修補，schema 非語義品質證明。
- 共識不設筆數，shared_fact/shared_position 需各來源明示同一事實立場；僅 shared_challenge 可正面相關證據綜整狹窄共同挑戰，不從沉默／共同話題推論，風險建議回應同挑戰、保留條件與轉述歸屬，不升格共同贊同解法。僅跨素材 direct-agree 候選／有效子集且至少兩素材，每來源有正文引用，每候選完整採用／拒絕交代；保留 canonical ID/candidate_map、動態 enum，空候選兩清單空；拒未知／舊 ID、漏交代、重複拒絕／同時採用拒絕／完全重複項，不同命題可共用證據。爭點按問題整合、question 引用留診斷，正規化同問題拒收、不模糊刪除／自動合併；立場成員/Sources 僅 opinions Title/description 引用推導、群名/Core_concern 引用屬本群，direct-disagree 互斥且完整覆蓋／排除，不猜動機。背景引用越界／語義近似重複仍人工驗收，比較不以傳遞路徑替代 direct，座標單位／Unicode 邊界不猜。
- 三項後僅有內容必填仍 null 才最多一輪 Gemma 白名單補完，不改已有值／來源／順序／舊引用、不增第五輪；獨立預留結算，無缺值不付費，必要補完失敗不交缺值草稿，空／失敗／未啟動用三語狀態，不造 citation/結論，空段非無爭點。Workers AI 每帳號 UTC 日20新付費工作、議題五分鐘冷卻、環境模型 USD5/日僅估算準入，非總帳單硬限／整 job 報價，不含 Workers/Workflows/D1；usage 缺／異常 unknown，預留不退款、跨日不釋放、不保證次日恢復。不移除來源 fence／停權／去重／最後快照狀態再查，不覆寫 raw/分項歷史/unknown/tombstone、不重建 quota 繞帳本；Clef 校準僅核可資料、不證 labels/hash 來源，實驗非獨立 gold labels、合成 fixture 非品質驗收。
- 無自動 TTL；hidden/changed 只撤下保 payload、來源失聯 fail-closed；deleted 被查核／對帳發現或管理按來源 erase 才清跨依賴 payload/diff，非單 job 自助刪除、不刪業務來源。留帳號 ID/hash/同意版本時間/usage/unknown/永久 tombstone、來源 ID 不重入；不保證即時發現刪除／撤回在途模型／即清 D1 Time Travel，保留原始0017 SQL/ledger、私有 .wrangler、核准公開結果。業務 DB 有來源快照／完整模型 request/response／引用／人改diff，雖不送作者快照欄正文名稱URL仍可能有個資、未匿名化；Workers AI 推論政策非 D1 零留存，備份／營運／安全／法律例外及 info@vtaiwan.tw 人工權利請求見手冊／三語告知。不恢復退場實驗 profiles/CLI/cookie 匯出工具/fixtures；未驗讀交接，不自行試跑 maintenance。

## ANTI-PATTERNS
- 不在 SSR setup、頂層或共用工廠碰瀏覽器 API／共用可變請求狀態；Cookie session 解析是合法 server 行為。
- 不把使用者資料放 localStorage，不自建 email／密碼登入或通用會員後台，不把 admin HTTP 改黑名單。
- 不恢復 ADMIN_PASSWORD、X-Admin-Token、checkAdmin() 或 POST /api/admin/login。
- 不為新頁另建 client entry／Rollup input；vue-router／vue-i18n 或整站 router 切換須先確認。
- 不以逐端點 Origin 判斷取代全域 CSRF；UI／checkbox／CORS 不構成寫入防線。
- 不藉一般議題編輯清除 closure 理由／日期；獨立素材／意見 URL 跨議題必須 404。
- 不從編譯推論 UI 驗收：三語、桌機／手機、淺／深色、互動／hover／focus／disabled、hydration 必須真實瀏覽器檢查。
- 安全／隱私、狀態／排序／限制／併發與新 bug 補行為回歸；IME／trim／SSR 預設／URL 歷史需對應測試，純文案／樣式不鎖無關實作字串。
- API／DB 補 CRUD、狀態、400/401/403/404、隱私／CSRF smoke；路由含新舊 URL。未執行檢查不可稱通過。
- Auth 真人／遠端驗收須授權，驗兩 provider、linking、登出、me、401/403、admin HTTP 404，唯讀核對 auth sqlite_master；舊成功不算本輪證據。
