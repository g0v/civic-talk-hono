# src 操作指引

## OVERVIEW
應用程式、私有證據管線與回歸測試的共同邊界；工作樹遞迴評分 13（155 檔 3、17 子目錄 2、154/155 程式比例 2、index.ts 2、AST 宣告 4306 計 2、export 宣告 411 計 2；自有設定與未測引用中心性各 0）。盤點包含本指引但不計入程式分子；AST 僅計 `.ts` 具名宣告（含區域變數）及帶 export 修飾的宣告，不代表引用數。

## STRUCTURE
`api/`／`auth/` 守門；`db/` 業務 SQL；`ai/` 私有工作；`ssr/`／`client/` 渲染契約；`views/`／`components/` 介面；`composables/` 狀態；`lib/` 純邏輯；`l10n/` 三語；`markdown/` 安全渲染；`styles/` token；`moderation/` 審查；`opinions/` CSV；`legal/` 條款；`tests/` 回歸。

## WHERE TO LOOK
| 工作 | 來源 | 注意 |
|---|---|---|
| 入口／舊網址／RSS | `index.ts`、`worker.ts`、`rss.ts` | wrapper 才匯出 `EvidenceWorkflow`，可由 Node 匯入的 index 不直接依賴 `cloudflare:workers` |
| HTML／hydration | `ssr/render.ts`、`ssr/heads.ts`、`ssr/serialize.ts`、`client/civic-entry.ts` | `renderPage` 每請求建立 app，單一靜態頁面註冊表 |
| API／資料 | `api/routes.ts`、`db/queries.ts`、`../migrations/` | SQL／型別集中；公開與管理投影分離 |
| 登入／改名 | `auth/createAuth.ts`、`auth/authorization.ts`、`auth/environment.ts`、`api/auth.ts`、`api/requireUser.ts` | Better Auth 對齊 sibling，角色只讀 |
| 證據／費用／生命週期 | `ai/routes.ts`、`ai/runner.ts`、`ai/store.ts`、`ai/lifecycle.ts`、`ai/source.ts` | 詳見 `../docs/evidence-api-review.md`、`../Insight.md` |
| 模型／引用 | `ai/generation.ts`、`ai/models.ts`、`ai/comparison.ts`、`ai/evidence.ts`、`ai/pricing.ts`、`ai/workflowPolicy.ts` | 版本、schema、費率以來源為準 |
| 互動／樣式 | `views/Issue.vue`、`views/Home.vue`、`components/MarkdownEditor.vue`、`styles/app.css`、`l10n/index.ts` | URL 還原、IME、SSR 初始值一起驗 |
| 投稿／申訴 | `moderation/service.ts`、`legal/terms.ts`、`views/Admin.vue`、`views/Appeals.vue` | 安全審查不等於內容生成 |

## CONVENTIONS
- SSR 不碰瀏覽器 API，也不共享可變請求狀態：setup、模組頂層、共用工廠皆適用；瀏覽器操作放 client-only／onMounted 或明確守衛；從 Cookie 解析 session 合法。
- 新頁面同步 View、`ssr/heads.ts`、`index.ts` 路由；需 hydration 再同步 `PageName` 與 `client/civic-entry.ts` 的靜態 import／pages，沿用 `renderPage` 選項與安全 escaping。
- 首屏 Worker 查 D1，互動 hydration 後打本站 API；SSR／client 固定 zh-TW、Issue citizen、Markdown 編輯分頁。語言／志願者／主題偏好 hydration 後處理；保持靜態殼可用。
- `l10n/zh-TW.ts`、`l10n/en.ts`、`l10n/ja.ts` 的 key／插值集合一致；文字走 key，保留舊 zh 偏好，日期與 OPINION.md 跟介面語言，投稿不自動翻譯。
- 同資料共用同 View；role／tab／step／action 與 URL 雙向同步，重新整理、前進／返回還原。Home `?action=click_issue_card&issue=<id>` 留預覽，按「進入」才跳議題。
- Issue 無 step 顯示 briefing carousel；comments／materials／volunteer 切換與 popstate 保留其他 query／登入 callback；citizen 四張，volunteer hydration 後第五張。輪播在視窗內、長文卡內捲動、compact 授權 footer；其他分頁自然捲動與完整 footer，保留原始碼／notices 入口。
- 樣式用 `styles/app.css` token、vt-*／既有 utilities；設計參考相鄰 vtaiwan-design-system 的 project/colors_and_type.css（本機缺檔，未核對），新 token 先定義，不順手重畫。正式 HTML 未載入 SFC CSS，維持無 style 區塊；接入抽出 CSS 另需確認。
- `LongTextContent` 超門檻完全不輸出原文，只顯示字數／展開鈕，不截短或摘要 CC BY-NC-ND；素材詳情與管理審閱維持全文。卡片不巢狀 a。
- `MarkdownEditor` 沿用 `renderSafeMarkdown`，禁 raw HTML、圖片或另開 parser；議題簡介純文字／換行，最多 300 個 Unicode code points，超過時 UI 停用送出、縮短後恢復，保留全文且不加 maxlength；`POST /api/issues` 共用相同規則，在模型審查與寫入前以 400 拒絕超長簡介，選填語意不變（#218）。事實查核中及完成後 readonly。
- textarea 用 writable computed 的原生 v-model；組字只留 textarea 暫存，不更新 model／計數／預覽，compositionend 才提交。Markdown 預覽先 trim 再 render 與送出一致，不改草稿／計數／縮排；純文字預覽不 trim；保留分頁、focus、延後 aria-live。
- `requireUser` 未登入 401、停權 403、不限角色；`requireAdmin` 僅 admin／super-admin，無權限 403；停權者仍可申訴。前端 `useAuth` 共用查詢，不把個資存 localStorage；SSR loading 骨架，Admin client 分 anonymous／forbidden／admin；若 SSR 個人化不可邊緣快取。
- 共用 DB_AUTH、Google／GitHub OAuth 與 BETTER_AUTH_SECRET；版本核對 sibling package／lock，BETTER_AUTH_URL 用各環境 origin，換網域／建環境核對兩 provider callback。trusted 同 email linking 已由使用者確認，但不代表跨域 SSO；不擅改 cookie domain。
- DB_AUTH 只由 Better Auth 寫；正常認證生命週期（含 OAuth image 更新）外僅已授權 ban/unban（server admin plugin API 附管理員 session headers）與登入者 update-user。允許參數化 SELECT 授權／同名／冷卻；schema／改名 triggers 唯一來源是 sibling，user.role 只讀，升降權／會員列表／日誌留 sibling。
- `/api/auth/admin/*` HTTP 整段一律 404，不改黑名單；其餘 Auth 交 handler。本站無 email／密碼登入或通用會員後台。update-user UI 只送 name；含 name 正規化、同名確認、30 天冷卻，handler 仍可能接受 Better Auth 其他原生欄位，不能說 API name-only。
- `/api/me` 回 user／role／banned／nameChangeCooldownDays／hasDuplicateDisplayName，不搬 permissions。一般 dev 僅 DEV && MODE==='development' 停 Auth：session 200/null、me 401、登入／callback／更新 503、受保護寫入 401；不初始化本機 auth 表、不關 schema 檢查、不造 fake user／匿名寫入；dev:remote／正式保留 Auth。
- 四種投稿存 author_id／author_name／author_email／show_email 快照，不隨改名／刪帳變更；舊 NULL 不回填，缺名稱不退回 email。email 始終保存供追溯，公開只按該筆 show_email=1。
- 議題／素材／意見建立要求嚴格 boolean show_email、terms_accepted===true；server 存 TERMS_VERSION／時間，不信 client 版本／時間，改條款同步 `legal/terms.ts`。
- 公開 SQL（含 getIssueDetail、獨立詳情及 SSR）列舉欄位，禁 SELECT *；email 用 CASE WHEN show_email = 1 THEN author_email ELSE NULL END，不輸出 author_id／show_email；管理 *WithAuthor 才完整快照，回應 Vary: Cookie。
- 公開 email 僅 `AuthorEmailLink` 信封 mailto，不輸出明碼文字，無障礙名稱不含地址；地址仍在 href／SSR state，不是防爬。投稿 401 用獨立 sessionExpired 提示登入／先複製，不改 authState 成 anonymous 卸載草稿；UI／checkbox 不代替 server 防線。
- `index.ts` 全域 `/api/*` CSRF 在所有 API 前，不改逐端點 Origin；SameSite=Lax 不擋 sibling 簡單跨站寫入。管理／寫入禁 Access-Control-Allow-* 與 Allow-Credentials；公開唯讀可 Allow-Origin:*，保留 private,no-store／nosniff／Vary:Cookie；證據 API 私有且不開 CORS。
- 業務 API 契約見 `api/routes.ts`／`db/queries.ts`，錯誤通常 `{error:string}`；議題 GET/POST、詳情 GET/PUT/DELETE（管理級聯）、素材 GET/POST 與管理 DELETE、briefing GET/POST/PUT（新增版本遞增）、意見 GET/POST 與管理 DELETE、prompt 登入取得 summarize／narrative／synthesis（預設 summarize）均維持原權限。
- 素材投稿前端先完成同源 fact-check 且允許，server 仍審查；POST /api/fact-check 登入後以 FACT_CHECK_CORE Service Binding 串流轉送私有核心，不是生成，不加前端 key／HMAC、不轉送 session cookie。
- 正常素材 collecting→summarizing，正常 briefing collecting/summarizing→published；四種投稿 OpenRouter openai/gpt-oss-safeguard-20b 審查，基礎設施故障 fail-open、結構化記錯，不記 key／正文／完整模型回應或誤判濫用。
- 審查違規仍保存成功形狀附 moderation，INSERT abuse_flagged=3 並建 source='ai' 回報，公開 placeholder；素材／briefing 不推進狀態，解除誤報也不補推，無自動停權／隱藏門檻。admin stats／投稿者現況／診斷／申訴列表及 resolve 限管理；preview 不寫 D1 仍呼叫模型，帳號處置經 Better Auth。
- 舊 summarize／synthesis prompt 與非空 consensus／disputes／positions 的 briefing POST 只計同議題 abuse_flagged=0 素材，至少兩份；不足在審查／寫入前回 422 insufficient_materials／minimum:2／count。UI 停用生成／複製／送出，三語提示並保留可編輯草稿；單獨 narrative／opinion_prompt、管理 PUT 不加此限制。
- closure 與 status 獨立，只影響首頁分類，不阻投稿／投票／匯出，公開理由／日期保留，一般編輯不清除；PATCH /api/issues/:id/closure 管理限定，{closed:boolean,reason:string} trim 後 1–1000 code points，同狀態／競態 409，成功 {ok:true}。
- 意見 sort=recent|responses 預設 recent；vote_agree/disagree/pass、my_vote、can_view_vote_distribution、can_vote、is_author 由 server 決定；匿名／未投票分布 null，投票後或作者可見。作者為虛擬同意票、不寫 votes、不自投；POST vote 1/-1/0，DELETE 撤回後再隱藏。
- abuse_flagged=1 展開內容後才提供控制，2/3 不可投；comments.csv 登入、private/no-store、pol.is 相容，只匯公開意見／匿名作者序號，不輸出 Auth id／email／voter identity。舊 polis.tw embed／後台開關已移除，保留 polis_id／API，不擅接 Pocket Polis；證據立場分組不是公民投票分群成果。
- 內容路由保留 /、/issues/:id、/issues/:id/source/:materialId、/issues/:id/comment/:opinionId、/contribute/:id、/about、/profile、/appeals、/privacy、/terms、/admin、/rss.xml；獨立素材／意見不屬議題回 404。POST /api/appeals 登入且允許停權者，型別 rejected_submission／account_ban。
- #210 一鍵彙整整個元件只在 import.meta.env.DEV 掛載（含 dev:remote），production 無狀態查詢／輪詢／debug log；不以 CSS 隱藏或 MODE 判斷，不改後端開關。舊 BYO token／prompt 保留，server 不代打一般生成，新版報告排版屬 #166；草稿不自動發布或改 briefing／status。
- 證據來源 SOURCE_DB ?? DB，保存到業務 DB 非 DB_AUTH；來源 repository 只做固定參數化 SELECT，不交寫入 repository。正式設定保留 AI／EVIDENCE_WORKFLOW／EVIDENCE_API_ENABLED=1，只有字串 1 開啟，其餘 404（CSRF 可能先 403）、缺 binding 503、匿名 401、停權 403。
- 有效建立／GET／修訂可對帳、恢復 queued、發現 deleted 清 payload，不是唯讀試打；正式登入呼叫、新付費、queued 恢復、有效 maintenance 都須核對來源、帳號／角色及個別授權。實驗／審閱 profiles、CLI、cookie helper、fixtures 已退場，不恢復舊入口或重跑已成功付費實驗。
- POST /api/issues/:id/evidence-jobs 精確 {consent:true,language?,material_ids?}，語言預設 zh-TW／可 en、ja，不收正文／hash／作者；consent 缺／false／字串在對帳／讀來源前 400 invalid_request；保存告知版本／時間，cache 命中不覆寫原同意，不能視為取得所有正文權利人同意。
- 省略 material_ids 選全部合格並回 exclusions；指定須非空、不重複正安全整數、同議題且可見。至少兩份才開始，單份在 claim／費用預留前 422 insufficient_materials／minimum:2／count:1／exclusions；零份 no_available_materials、明選空陣列 400 invalid_material_ids；既有 GET／修訂／生命週期不套新門檻。
- 建立回 job_id／status／cache／input_coverage(selection,material_ids,exclusions)：新建 202/miss、進行中 202/joined、完成 200/hit、保存 failed 可 200/joined。用 job_id 輪詢 GET /api/evidence-jobs/:jobId：owner／admin 讀、其他 404，回 usage／error_code／generation_progress／provenance，有草稿才有 data／citation_map。
- queued/extracting/comparing/generating 持續輪詢，ai_draft/partial_draft/failed/withdrawn/erased 停止；partial 非完整、failed 不等於 no_findings，HTTP 200 非成功，查分區 diagnostics／progress；網路不確定／版本衝突不可自動重送建立 POST。
- 2026-11-25 交付完整度：任一核心分項 items 空亦使整份 partial_draft；no_findings 仍是有效空結果，不標 failed、不強迫補內容。原覆蓋／失敗／intro 缺口判定保留，root diagnostics／指南／持久狀態由同一 partial 判斷產生；只套0018時新partial不覆蓋舊完整稿，PR merge前不套0019。
- GET /api/evidence-jobs/:jobId/revisions 限 owner／admin 且需 ai_draft／partial_draft 否則 422，回 job_id／ai_base(id:'ai',verification:'ai_unverified',data,citation_map)／revisions；POST 僅 owner（admin 不能代改、404），精確 {parent_revision_id:string,data}，201 回 revision_id／parent_revision_id／human_unverified，舊 parent 409 revision_conflict。
- 人改先 GET revisions，無人改 parent='ai'，否則最新 revision.id；複製 ai_base.data／最新 payload 完整 data，保留 introduction（若有）、consensus／disputes／positions、三段 Overview、群 Core_concern、真實 Sources。舊 data 可無 introduction，含該欄時須非空文字。revision 用 id/parentId/payload/diff 不猜 snake_case；保留 AI 原稿／diff，human_unverified 不冒稱已驗。
- POST /api/evidence-maintenance/reconcile 管理、精確 {}，回 {ok,checked,withdrawn,erased} 並可能恢復 queued；erase 管理、精確 {kind:'issue'|'material',id:正安全整數} 回 {ok:true}，按來源清跨依賴 execution／申請者內容，不刪業務來源。
- GET /api/issues/:id/evidence-summary 必填 language=zh-TW|en|ja、登入，回 {version,has_summary,job,summary}；job／summary 各限該次 owner／admin，其他登入者 null，不進公開 API／SSR。POST 精確 {consent:true,language,expected_version} 全選合格、沿用建立守門並增加 version，舊版 409 summary_conflict 不自動重送。
- 摘要依語言保存；0018 的 ct_issues.ai_summaries／ct_ai_summary_slots 經 `../migrations/0019_partial_evidence_summaries.sql` 延續原子保存觸發器：最新註冊 partial_draft 僅在語言 slot 空缺時填入，不覆蓋既有完整或部分結果；完整 ai_draft 可依確認更新。JSON/API status 與 review_required:true 明示需人工校對才可發布，仍 ai_unverified／私有；舊完整 JSON 相容。舊完成不蓋新請求，來源撤下清副本、erase 清相依，副本不得繞 fence；0019 僅隔離本機驗，遠端仍另需授權，不稱已部署。
- 完整成功確認保存，或 partial_draft 有可交付 data 時，#210 暫在操作者瀏覽器 console.log(data)；部分結果須重查summary同一最新job/status/review_required才顯示已保存，其他partial不覆蓋舊結果、未知只重查GET，不送server log／公開紀錄；production元件閘門仍適用。
- 歷史ai_draft已實際保存且progress明示no_findings時，顯示已保存但有空分項的saved_no_findings提示，不稱內容完整也不謊稱未覆蓋；不回寫歷史工件。P1 v2目標遍讀全文不同實質命題；v19爭點提示明示空direct-disagree seeds不封鎖有正面證據的tension，不能把尺度差異或單純相關自動當取捨／正式反對，引用與來源守門不改。新語義品質仍須人工驗。
- 固定 Clairic／Clef／Gemma 4 26B A4B；共識／爭點／立場各用同一已驗證證據及必要比較，不以摘要串接，各自驗證／記帳／保存，不自動重試、格式修復或模型／Responses fallback。Workflow checkpoint 只含識別／狀態，不放正文／模型回應；手建 instance 不繞開關／binding／payload，bounded handoff 不等於付費重試。
- Gemma Chat Completions 只接受字串 model、唯一 index 0、finish_reason stop 的 assistant 字串內容與完整 JSON（保留完整單一 plain/json fence 例外）；拒絕缺完成原因／截斷／refusal／tool／非字串，忽略 reasoning，不切思考文字或猜測修補；schema 支援非語義品質。
- 共識不設筆數；shared_fact／shared_position 要各來源明示支持同命題；僅 shared_challenge 可依正面相關證據綜整較窄具體共同挑戰，不能從沉默／同話題推論，風險建議須回應同挑戰；保留條件／轉述歸屬，不升格共同贊同解法。
- 共識限跨素材 direct-agree 候選及有效子集、至少兩素材，各候選交代採用／拒絕、各參與來源正文引用；canonical ID／candidate_map／動態 enum，空候選兩清單空；拒絕未知／舊 ID、漏交代、重複拒絕、同時採拒、完全重複項目；不同命題可共用證據。項目只收 candidate_id／kind／Title／description，程式由句子引用聯集固定採用成員，不另收項目 evidence_ids 或自動修剪舊 raw；每個實際參與素材仍必有 description 引用，標題不能補足第二來源。第一階段 Overview 必須 null，先驗定採用項目，再由既有補完依採用引用聯集生成概述，不以背景或未採用證據擴充。
- 爭點按問題整合，question 引用留診斷，正規化同問題拒收，不模糊刪／自動合併；立場第一階段只產 group_id／opinions／Overview／exclusions，不收群名或核心關注，成員／Sources 只從 opinions Title／description 引用推導。第二階段依已定成員白名單生成群名／Core_concern，引用屬該群，維持 direct-disagree 互斥與完整覆蓋／排除，不猜動機；背景越界／語義近似重複仍人工驗，不放寬。
- 三項後最多一輪 Gemma 白名單補完：有成功共識項目必補 Overview，有成功立場群組必補程式設為 null 的 name／Core_concern，連同其他內容必填 null 欄位一併生成，不改已有值／來源／順序／引用；獨立預留／結算，無缺值不付費，必要補完失敗不交缺值草稿。空／失敗／未啟動分區用三語狀態、不偽造結論／引用，空段非無爭點。
- 2026-11-20 明示新增尾端一次 Gemma introduction（最多第五輪）：只讀議題 title／description 與完成的三分項 JSON，產出同層 Markdown 字串，不改三分項／citation map，不偽稱原文逐句驗證。獨立 introduction:draft 帳務／raw／來源守門與零付費重試；新工作缺該欄不發布，舊資料相容。失敗保留有效分項工件，不自動重打或改公開 briefing；顯示仍用既有安全 Markdown 路徑。
- 來源 fence、停權、去重、最後快照／狀態再查不可移除；不覆寫歷史 raw／分項／unknown／tombstone。Clef 校準只對核可資料，不證 labels／hash 來源，真實實驗非獨立 gold labels。
- Workers AI 每帳號／UTC 日 20 新付費工作、議題五分鐘冷卻、環境模型 USD5／日僅估算準入，非全帳單硬上限／整 job 報價、不含 Workers／Workflows／D1；usage 缺失異常保持 unknown，unknown 預留不退款且跨日不自動釋放、不保證次日恢復，不重建 quota 繞過。
- 無自動 TTL；hidden／changed 只撤下留 payload，失聯 fail-closed；deleted 被查核／對帳發現或管理按來源 erase 才清跨依賴私有 payload／diff，非單 job 自助刪除、不刪業務來源；留帳號 ID／hash／告知版本時間／usage／unknown／永久 tombstone，來源 ID 不再入場。
- 不保證即時發現刪除、撤回在途呼叫或即時清 D1 Time Travel；保留原始 0017 SQL／ledger、私有 .wrangler 狀態與核准公開結果，不以清理重設帳本。業務 DB 含來源快照、完整模型 request/response、引用、人改／diff；模型不收作者快照欄但正文／名稱／URL 可能含個資，未匿名化，推論政策非 D1 零留存；備份／營運／安全／法律例外與 info@vtaiwan.tw 權利請求見手冊及三語告知。

- 三分項與既有補完的模型引用採 request-local `e1`／`e2` 短 ID，依全體 canonical ID 字典序編號，補完子集不重編號；所有關係、互斥、候選與引用同步映射，schema 列舉合法 ID。解析只精確解碼後走原來源／引用／互斥／覆蓋守門，未知或舊 namespace 拒收；不改文句、分類、群組或補缺引用。`GenerationRequest.evidence_id_map` 僅存 plan sidecar，不送模型；API／citation map／source evidence 仍 canonical，raw 不改，改版須真指紋隔離。

- 2026-11-22 intro 專用 native Markdown/text request，共用 `nativeCompletion.ts` 的完整 stop/assistant/refusal/tool/截斷守門；JSON 三項及補完不改，最後由程式保存 introduction 字串。輸入帶真 section_status、只投影公開資料，8192/.2/48KiB不變，真policy/request/限制進指紋。必要補完有效後，僅 intro 尾端失敗交三項原資料/citation_map 的 partial_draft，不造 intro、不替換舊summary；來源/帳戶/erase/config失敗仍不得交data，unknown原樣、不自動paidretry。新文章語義未由協定測試證明。
## ANTI-PATTERNS
- 不新增 vue-router／vue-i18n、每頁 client entry／Rollup input；全站 router、CSS 載入等結構變動先確認。不恢復 ADMIN_PASSWORD／X-Admin-Token／checkAdmin()／POST /api/admin/login；不對 DB_AUTH 做原始 SQL INSERT/UPDATE/DELETE、auth DDL 或本站 migrations/auth。
- 改 bug 補可重現回歸；安全／隱私／狀態／排序／限制／併發回歸放 tests，從 vite-plus/test 匯入；i18n 測 key／插值並人工核翻譯，純樣式／文案不鎖無關字串。API／DB 補 CRUD、狀態、400/401/403/404、隱私／CSRF smoke，路由驗新舊 URL；本機檢查不冒充正式驗收。
- UI 真瀏覽器驗三語、桌機／手機、淺／深、互動／hover／focus／disabled、hydration 無 mismatch；IME／trim／SSR 預設／URL 歷史有對應回歸，不能以讀 CSS／build 代替。Auth 變動取得真人／遠端授權後驗兩 provider、同 email linking、登出／me／401/403／admin HTTP 404，唯讀查 auth sqlite_master 無新表；不重跑已確認結果冒充本輪證據。
