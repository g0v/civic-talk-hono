# #183 證據管線：API 與安全邊界手冊

#183 交付的六端點維持既有契約；#210 新增兩個私有議題摘要端點及建構中的一鍵彙整元件，完整排版與一般 API 正式驗收仍由 [#166](https://github.com/g0v/civic-talk-hono/issues/166) 承接；reconcile／erase 維護驗收見 [#201](https://github.com/g0v/civic-talk-hono/issues/201)，既有交接見 [`TODO_AFTER_MERGE.md`](../TODO_AFTER_MERGE.md)。使用者曾部署 source `73800643596b7114efd0c7623ea436023cd244b9`、`EVIDENCE_API_ENABLED=1`，並確認原六端點匿名 401、跨站簡單 POST 403、`/api/me` 200／super-admin／banned:false；不是完整 API 驗收，也不是 #210 已部署的證據。2026-11-08 使用者核准提前移除實驗／審閱專用 profiles、CLI 與 fixtures。#210 最新決策將整個新 UI 限制在 dev 掛載，production 不呈現亦不由此啟動查詢／輪詢；後端 API 開關維持原契約。本機驗證、原始碼提交／推送與 PR 不能視為已執行合併、遠端 migration、正式付費或 deploy；發布與實測仍依當次授權執行。

## 1. 先看已完成的實驗

使用者已確認品質實驗成功，並已核准手動公開兩份現有報告：[結果與引文](../results/ai-experiment_result.json)、[費用與 provenance](../results/ai-experiment_cost.json)。報告記錄真實議題 13、素材 25／26／27 的工作，結果為 `ai_draft`，共識／爭點／立場地圖均 `completed`，completion 為 `not_needed`；費用報告列 23 attempts、13,362 microUSD（US$0.013362）、unknown／reserved 為 0。這是**該工作**的應用帳本，不是 Cloudflare 帳單核對，也不涵蓋其他工作留下的未知費用。

報告的 evidence、citation map、data、分項 diagnostics、source／artifact hash 和模型 metadata 可用來回查原始材料、條件及歸屬。報告中的 source metadata 為 `e668fa2ea9c70fd3bdbcfd06ebb554b5e3a4747d`、`dirty:true`，不可聲稱與目前 HEAD 逐位相同或來源版本乾淨；重現流程也不保證模型逐字相同。模型 selector 不是不可變權重 SHA；結構與引文錨定通過不代表程式已證明語義正確。這次成功是使用者的實際驗收，並非獨立人工 gold labels 或普遍正確率。過往失敗與版本差異見 [`Insight.md`](../Insight.md)，不是當前成功紀錄的替代品。**不要為確認既有成功而另行呼叫付費模型。** 除這兩份既有報告外，新工作、快照、引文、session 或其他內容不可自動視為獲准公開。

## 2. 從程式理解資料流

| 檢閱焦點     | 檔案與問題                                                                                                                                                                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 接入與開關   | `src/worker.ts`、`src/index.ts`、`src/ai/endpoints.ts`、`src/ai/env.ts`、`wrangler.jsonc`：只在明確 `EVIDENCE_API_ENABLED=1` 時提供新端點；關閉時不進入 Auth／DB／AI，啟用但缺必要 binding 時 fail closed 503。來源使用業務 `DB`。一般 API 的 headers／錯誤處理不得被證據子路由覆蓋。                                                              |
| 來源與隱私   | `src/ai/source.ts`、`src/ai/lifecycle.ts`：固定參數化 SELECT、未正規化 UTF-8 hash、作者快照欄位排除、來源 hidden／changed／deleted 的處理。素材正文仍可能有個資，不等於匿名化。                                                                                                                                                                    |
| API 與授權   | `src/ai/routes.ts`、`src/api/requireUser.ts`、`src/api/csrf.ts`：owner／admin 讀取、只有 owner 可新增 revision、maintenance admin、body／限額與跨站防護。                                                                                                                                                                                          |
| 工件與競態   | `src/ai/store.ts`、`migrations/0017_evidence_pipeline.sql`、`src/ai/human.ts`：私有快照、usage ledger、不可覆寫 AI 基底、人工 diff、來源 generation fence 與永久 tombstone。檢查 revision 回應在讀取後再次確認來源狀態，避免清除競態洩漏。                                                                                                         |
| 工作流與品質 | `src/ai/workflow.ts`、`src/ai/runner.ts`、`src/ai/models.ts`、`src/ai/comparison.ts`、`src/ai/generation.ts`、`src/ai/pricing.ts`：Clairic 抽取、Clef 四分類、Gemma 三項與必要時單次補完，引用守門、分項狀態、attempt／預留／未知成本。檢查 workflow 觀察 RPC 失聯或 unknown 不被當成確定終態；排隊建立失敗後固定 instance ID 的恢復不是模型重試。 |
| 環境與驗收   | `vite.config.mts`、`wrangler.jsonc`、`src/tests/evidencePipeline.test.ts`、`src/tests/evidenceStorage.test.ts`：一般設定、正式來源與合成測試證據的區分。                                                                                                                                                                                           |

正式來源為業務 `DB`；既有 BYO token、`GET /api/issues/:id/prompt?type=synthesis`、briefing 與議題狀態不變。AI／人工草稿分別是 `ai_unverified`／`human_unverified`，不是可公開的 briefing。

### 2026-11-18：P1／E1 正式程式接線

目前程式預設使用 `claims-list-p1-v1` 與 `evidence-3-claim-context`。Clairic 的 raw 是不可改寫的定位資料；先沿用相同逐字／座標驗證器，再由 E1 建立主張及必要原文語境，不先經 E0 展句去重。多個 raw 可以指向同一主張，未選到的內容不自行增造主張，已跨多主張的 raw 仍保守保留複合範圍。

新 extraction／最終 job 工件的 `candidate_snapshots` 保留每素材的 content hash、原始錨點及 provider 單位資訊、claim/context ID 和範圍。`anchor_index_kind=value` 表示按 value 索引；不等長陣列通過既有嚴格重配對時為 `span`，不能把兩個原始陣列硬 zip。正式 `evidence.id` 使用 content-hashed claim ID，`quote` 是主張，`context` 是獨立原文語境；引用仍只接受選入的 claim ID，context ID 不能冒作證據。

Clef、三分區及必要補完接收主張與獨立語境，並明示不得把語境中的其他立場當成該主張。context 必須可切回相同素材且包含主張。對應版本為 `symmetric-four-way-v3-claim-context`、`specialized-evidence-v16-consensus-citation-membership`、`specialized-cited-v7-consensus-citations`、`section-values-v7-claim-context`、`missing-fields-only-v5-position-labels`、`cited-field-patches-v2-position-labels`、`citation-map-v2-context`；模型、採樣、token／費用／證據上限及引用守門不變。

共識第一階段先生成實質項目及 `rejected_candidates`，`Overview` 必須為 null，即使已有項目也不能提前生成概述。每項僅有 `candidate_id`／`kind`／`Title`／`description`；句子仍各有 `evidence_ids`，項目不另宣告成員。程式以實質句子引用聯集固定採用證據，拒絕舊格式額外成員清單，不修剪或改寫 raw。候選只是搜尋範圍，未引用的候選成員不自動成為參與來源；所有實際引用仍須位於該候選，至少兩素材且每個參與素材必有 description 引用，不能靠僅標題引用湊跨來源。驗定採用／拒絕完整交代後，再由已採用項目的引用聯集建立 `/consensus/Overview` target。後續概述只准使用這個集合，不得加入僅在輸入背景或未採用候選中出現的證據，也不自動刪除越界引用來修補原 raw。

立場實際分兩次模型呼叫。第一階段每群只接收 `group_id`／`opinions`，不接受 `name`／`Core_concern`；程式先從實質意見引用決定成員及 Sources，驗完整採用／排除與 direct-disagree 互斥。內部草稿的群名及核心關注由程式設為 null，不能直接交付為完整報告。

第二階段重用既有一次 `complete:draft` 白名單補完：每個非空群必有 `/positions/items/<n>/name` 與 `Core_concern` targets，允許 ID 僅由已確定 opinions 引用重建，與必要的 Overview 缺欄位合併在同一次呼叫。這次生成不能增加成員、改意見、來源、順序、既有引用或排除；所有指定欄位完整通過後才交付非空群名／核心關注。沒有立場群組時不為群名呼叫模型，其他分項若有必填缺值仍沿既有規則補完。

因此有成功共識項目或立場群組的正常工作必走先前可能省略的補完；共識概述、群名／核心關注及其他必要缺值合併在同一次呼叫。原本已需補完的工作不再增加一輪，仍最多三個分項加一次補完，沒有第五輪或重試。共識無採用項目時用既有狀態文字，不為空段生成概述；其他分區也無缺值時不付費補完。補完有獨立預留／結算與 immutable raw，失敗／unknown 不交付缺欄位草稿、不重打、不釋放未知費用。此共識修訂仍待真模型品質驗收，也不將先前供應端 `3045` 當作已修復。

新設定／fixture request 指紋隔離舊快取。同版本同輸入的 partial draft 也會命中既有結果，重按建立不自動補跑失敗分項；只有真實協定／輸入變更才形成不同工作，不為重跑亂改 key。已完成的舊工作仍可按既有權限讀取；舊 active 工作若設定不同，沿用 `configuration_changed` 政策在模型呼叫前停止，不把舊 raw 混入新流程，也不釋放 unknown 或重設配額。新版本的完整工作仍可能包含付費擷取／比較／生成，不能視為只重跑共識；真人驗收須另核範圍，不自動執行。這輪程式接線不需新 migration，亦未代表已部署或完整真人／付費驗收通過。

### 2026-11-21：立場群相容性與排除清單

第一階段以相容立場／關切／方案分群，不把同一爭議的支持與反對方放在同群不同 opinions。立場請求的每筆 evidence 新增 `incompatible_with`，只由正式 direct `disagree` 配對對稱推導並排序；不把 reverse diagnostics、uncertain 或未完成比較當成互斥，也不把未列互斥解讀為明示支持。原完整比較資料保留，新增資訊計入原有 48 KiB 請求上限，不截斷或增加模型呼叫。

模型須核對整群所有意見 Title／description 引用聯集，而非只核對單條意見。`exclusions` 只列全體輸入 ID 減去所有群採用聯集的剩餘 ID；重疊採用不等於排除。程式仍拒絕直接反對的群、採用兼排除、未交代證據及未知引用，不自動拆群、刪除 exclusion 或修補 raw。提示版本為 `specialized-evidence-v17-position-compatible-grouping`，輸入版本為 `section-values-v8-position-incompatibilities`；三分項 schema、兩階段群名補完、模型參數、費用及來源守門維持既有契約。此改動讓約束更直接，不能保證每次模型均遵守，實際穩定性仍須真人驗收。

### 2026-11-20：尾端議題說明 introduction

原本共識／爭點／立場三分項及單次必要補完維持原生成方式。結構化 JSON 完成驗證後，額外一次相同 Gemma 模型讀取工作快照中的議題標題／簡介，以及這份完成的三分項 JSON，產出 Markdown 議題說明。新工作的 `data` 同層包含 `introduction` 字串、`consensus`、`disputes`、`positions`。這是私有、AI 未驗證的編輯性說明，不能把空段或失敗狀態寫成「沒有歧見」，也不能宣稱逐句已通過原文引用驗證。原三分項與 citation map 保持不變；不因新說明改寫結論或補造引用。

此輪依使用者明示需求增加尾端呼叫，因此最多為三分項、必要補完及 introduction 共五輪 Gemma；沒有自動重試。`prepare-introduction`／`generate-introduction`／`validate-introduction` 使用獨立工件及 `introduction:draft` usage，沿用來源／帳號守門、費用預留、結算、unknown 保留及 raw 保存。提示於 2026-11-21 更新為 `issue-introduction-v2-integrated-narrative`，schema 仍為 `markdown-introduction-v1`；完整提示、schema、參數及哨兵請求參與設定指紋，請求仍受 48 KiB byte 上限保護，不截斷 JSON。

敘述任務先理解議題核心問題、已提供的背景及各方關切之間的關係，再按議題邏輯寫成可獨立閱讀的完整文章。不得依「簡介、共識、爭點、立場」逐段拼接 Overview 或列舉每一筆項目；以連貫段落整合相關觀點，保留歸屬、必要條件及少數意見，不為銜接而捏造因果、解法或共同立場。此為提示品質調整，不增加呼叫或以標題字串規則拒收；實際連貫性仍須真人驗收，不以 prompt 文句斷言假稱已驗模型品質。

輪詢另有 `generation_progress.introduction`（僅該階段已出現事件時提供），最終 provenance 保留 introduction 的 plan／結果／raw 工件 ID，原始 request 含確切輸入與 SHA。新工作只有在 introduction 驗證成功後才發布最終工件；失敗／預算不足／來源失效不發布缺欄位結果，已完成分項仍依既有保留政策保存，不重打。

舊保存工作與人改資料可沒有 introduction；若人改包含該欄，必須是非空文字，修訂與差異照原路徑保存完整 JSON。目前私有結果的 JSON／DEV console 會保留 Markdown 字串；需要顯示 Markdown 的消費者應沿用 `renderSafeMarkdown`，不得直接輸出 HTML。不自動改寫公開 briefing、議題狀態或發布。新增階段仍需真人品質驗收，本機合成驗收不代表已付費驗收或部署。

### 歷史 P0／E0 受控回退紀錄

以下保留先前回退及離線診斷的原因；版本與請求一致性描述僅針對當時工作，不代表上方新預設。

立場生成提示 `specialized-evidence-v12-baseline-v9` 回到 `9ee4bf6c9fd7e70fcb209701b6c04f08d2d1f49b` 的 v9 共用與立場指令，僅保留後來已授權的同素材爭點提示；不再疊加 v10／v11 的焦點或完整單位共用指令。三步構造順序維持：先完成各群 opinions 的實質 `Title`／`description` 並計算引用聯集；再寫 name／Core_concern，引用僅能來自該群聯集，不以這兩欄的引用增加成員或補裝飾性 opinion 引用；最後核對全部輸入證據，必須被 opinion 採用或在 exclusions 恰好列出一次並說明原因，不得遺漏或兩者兼具。每群聯集仍不得包含任何 direct-disagree 配對的兩端；共同主題、群名、關注或中介證據不能豁免。

採樣維持歷史成功工作實際使用的共識／爭點 `temperature=0`、立場與必要欄位補完 `0.2`，模型、schema、token 上限不變。該工作雖記錄來源 commit 為 `9ee4bf6`，同時為 `dirty=true`；此 commit 原檔三項皆為 `0.2`，不能只用 SHA 冒稱已還原成功實測。本輪比對保存的完整請求：Clairic、Clef、共識及立場與該次實測一致；爭點僅多出同素材支援指令。分項 temperature 與實際請求參與工作／context 指紋，不以清快取重跑。

Clairic 回退至 `claims-list-v3`：完整閱讀後優先主要明示論述，「通常一至三項」只是核心選材指引，不是片段數量門檻；仍要求保留重要反例、限制、少數觀點、歸屬及條件，優先正文而非重複標題或統計介紹。它仍可能漏抽或回傳詞級片段；不以 confidence 或字數閾值刪掉難處理的結果，也不宣稱回退已提升完整性。

抽取回到行為相同的 `evidence-2`，保留逐字座標驗證與原文句界展開；證據 ID／去重依展開後的 UTF-16 範圍，provider raw 保留全部回傳片段與座標，不改寫歷史資料。Clef `symmetric-four-way-v2` 與三項生成 `section-values-v6-gemma-chat` 只投影 `id`／`material_id`／`quote`；必要欄位補完恢復 `missing-fields-only-v3`，接收白名單證據的 `id`／`quote`／`raw_quote`，但不附加焦點規則，亦不得改動既有正文、來源或引用。展句與去重沒有新增猜測拆句或補寫；句界完整不等於語義完整，同一單位仍可能含多方主張或不同問題。

數量不一致的嚴格相容路徑仍保留：每組座標須在素材原文內、逐字匹配已回傳片段，所有片段均須被覆蓋，且不同座標單位不得指向不同原文範圍；任一無效、未匹配、越界、範圍歧義或片段缺漏，整份抽取仍拒收。相同文字的各有效位置都先驗證、展句，再按相同完整單位去重，不任選一個位置作字串搜尋補救；重複 value 可由同一有效座標覆蓋。數量一致時維持原索引配對。證據數、byte／Workflow／預算上限不變，不自動截斷或提高上限。

爭點允許同一素材的不同證據支持不同側，適用 contradiction／opposition／tension；同源關係保留 `status='same_material'`，整項標為 `generation_proposal`／`formal_relation=null`，不冒稱跨來源佐證或 Clef 正式判斷。每側仍須有獨立且不重疊的 evidence ID，claim 引用覆蓋該側，description 引用每側，Overview 只引用已採用項目；未知、越界、同一證據分列兩側、側內 direct-disagree 等仍拒收。共識的跨素材至少兩份及建立新工作的至少兩份合格素材門檻不變。

這是受控回退，不是整個分支 reset：保留嚴格座標相容、同素材爭點、既有引用／覆蓋／互斥守門及帳務／來源生命週期。最新失敗與歷史成功使用相同來源 hash 和相同 temperature；最新三項皆正常結束，但共識宣告未使用證據、爭點 opposition 跨側含 Clef agree、立場名稱／核心引用超出該群 opinions 聯集，因而全部拒收。原始回應在原版 9ee4bf6 與回退後驗證器離線重播得到相同結果，不能將失敗歸因於新版驗證器變嚴；也不以刪除壞項目、補裝飾性引用、改成 tension 或放寬守門讓它通過。

本輪僅唯讀診斷與離線重播，沒有新增付費模型呼叫或改寫工作狀態。歷史成功工作的爭點為空，反方素材只選入標題；最新失敗其實已選入反方正文，因此 `ai_draft` 不代表內容完整，回退也可能恢復既有漏抽風險。後續優化應一次只改一個變因，先檢驗抽取論述單位與比較問題的粒度，避免把多命題段落的一個全域 agree／disagree 當成所有問題的關係；需另獲付費實驗授權，不能以此輪離線一致性宣稱生成成功率提升。

實驗來源追溯：`dev:remote` 的 `sourceDefines()` metadata 在 Vite 啟動時固定，HMR 不會更新；修改或提交後，下次實驗前須由操作者重新啟動服務，避免記錄舊 commit／dirty 狀態。Prompt／演算法版本與設定指紋仍應一併核對，不以來源 SHA 單獨推定實際模型請求。

## 3. 模式、前置與保護範圍

| 模式                     | 工作 DB／來源                                          | 認證／AI                  | 用途                                                           |
| ------------------------ | ------------------------------------------------------ | ------------------------- | -------------------------------------------------------------- |
| 一般 `vp run dev`        | 本機；設定為 `1`，必要 binding 完整時六 API 匿名回 401 | Auth 刻意停用、登入回 503 | 一般開發，不是假登入；不建立付費工作                           |
| 一般 `vp run dev:remote` | 既有遠端 binding；本機設定為 `1`                       | 既有遠端 Auth／AI         | 有效登入及同意請求可能寫入業務庫並付費，不作未授權的 #183 試跑 |

實驗／審閱專用入口已移除，不再提供其 setup、CLI、fixture 或 Cookie 匯出流程；歷史執行紀錄見 [`Insight.md`](../Insight.md)。既有私有 `.wrangler` 資料、帳本、quota、unknown 與 tombstone 全數保留，不因清理而重設。一般 `vp run dev` 與 `vp run dev:remote` 的 Auth／遠端語意不變；後者不是安全的未授權試跑環境。

Clairic 逐素材、Clef 配對、Gemma 共識／爭點／立場三項，必要時最多另呼叫一次補完。現行官方單價：每百萬 tokens，Clairic input US$0.10、Clef US$0.24、Gemma input／output US$0.10／0.30。每帳號每 UTC 日最多 20 個新付費工作、同議題五分鐘、環境模型 US$5／日估算準入不是整 job 報價或全帳單硬上限，不含 Workers／Workflows／D1；unknown 預留跨日不自動退，也不保證次日恢復。改語言、選材或設定可能 cache miss 並再計費；不得為繞過失敗狀態、配額或費用而清庫、偽變輸入或重試。

已發布的告知版本為 `evidence-processing-2026-11-07-v5`；v4 是歷史告知，不重寫舊同意或 raw。每個建立請求須 `consent:true`，伺服器存版本／時間；同帳號命中既有 job 不新增同意事件，不代表已取得正文所有人的同意。作者快照欄不送模型，但正文、名稱／網址仍可能含個資，未匿名化。正式資料存業務 `DB`（非 `DB_AUTH`），含原始快照、完整模型 request／response、引用、來源紀錄、人改及 diff；owner／admin 可讀，owner 可新增人工修訂，AI 原稿不覆寫，不自動發布或改 briefing／status。

**無自動 TTL 或固定刪除時限。** 隱藏／變更只 withdrawn 停止交付，payload 保留。對帳／查核發現 deleted 或管理員按來源 erase 才清相關 execution 全部私有 payload／diff，跨依賴該來源的工作／申請者，不是單 job 自助刪除；保留帳號 ID、hash、同意時間／版本、usage、unknown 與永久 tombstone，來源 ID 不可重新入場。不保證即時發現刪除，不能撤回已送模型請求。人工權利請求：`info@vtaiwan.tw`。D1 Time Travel 依方案 7／30 天，erase 不保證即時清備份；Workers AI 一般推論零資料留存／不訓練有營運 metadata、安全及法律例外，D1 不是零留存。參考 [Workers AI](https://developers.cloudflare.com/workers-ai/platform/data-usage/)、[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[Workflows 計價](https://developers.cloudflare.com/workflows/reference/pricing/)。

`0017_evidence_pipeline.sql` 是正式保留的八張 `ct_ai_*` 表 migration；使用者已手動套用遠端原始 SQL，ledger id 18、`applied_at=2026-11-06 19:29:04`，八張表與七個顯式索引已核對。**SQL 必須 byte-for-byte 不變，不重跑或修改 ledger。** 不對 `DB_AUTH` 跑 DDL／migration 或直接 SQL 寫入；正常 Better Auth OAuth／session 生命週期仍可能寫入遠端認證庫。後續遠端操作須另獲授權，唯讀核對方式見[部署須知](../deploy_notes.md)。

`0018_evidence_summaries.sql` 新增 `ct_issues.ai_summaries` JSON（按語言保存完整結構化資料、引用與工作關聯）及 `ct_ai_summary_slots`（各語言的最新申請／CAS 版本）。完成、快取附掛與來源失效以同交易 trigger 更新；只複製完整且通過來源 fence 的原始工件，不接受 client 自填正文。來源撤下時移除議題快取副本，但原私有工作 payload 仍依既有政策保留；erase 才清原工作相依內容。此新增 migration 本輪僅本機驗證，不能當作正式已套用。

## 4. 建立、輪詢、快取與修訂契約

本輪正式登入後、付費與維護實測全部延後，不安排真人登入或提供立即執行的範例。後續若另獲指定帳號、來源與費用授權，手動操作應在已確認的同源瀏覽器 Console 使用自包含程式，不匯出 Cookie、不依賴跨貼上變數；每次建立、快取重送、輪詢與維護處置均先說明副作用及取得各別授權。

建立新工作通常 `202`／`miss`；同一進行中執行為 `202`／`joined`，完成快取為 `200`／`hit`。舊失敗工作可能直接返回 `200`／`joined`／`failed`，不是新一次模型執行。快取重送仍走 admission，意外 miss 可能新增計費，不應為確認既有成功重跑模型。

開始彙整時，省略 `material_ids` 採所有合格素材，指定時則只計選入且同議題、可見、不重複的素材；兩種方式都須至少兩份。隱藏素材不計入，空正文仍拒絕。單份回 `422 {error:"insufficient_materials",minimum:2,count:1,exclusions:[...]}`；零份保留 `no_available_materials`，明選空陣列／重複 ID 仍為 `400 invalid_material_ids`。門檻在 claim／費用預留前檢查，不能以議題總素材數或快取命中繞過；不影響既有 job 的 GET／修訂或既有來源對帳／Workflow 恢復機制。

`queued`／`extracting`／`comparing`／`generating` 是進行中；`ai_draft`、`partial_draft`、`failed`、`withdrawn`、`erased` 應停止輪詢。停止等待不取消在途推論或退費。GET 不是保證唯讀：首次認證 evidence request 可能對帳、清除已刪來源 payload，並恢復既有 queued Workflow；不可當成無副作用的檢查。網路或 GET 錯誤不能把舊回應當最新結果，也不能因不確定重送 POST。

逐句核對引用、原素材與條件，區分直接比較與候選路徑、模型提議與 Clef 正式關係。`no_findings`、`failed`、`not_started` 不可混同，`partial_draft` 不是完整草稿；來源失聯 fail closed。非同步失敗查看 `status`、`error_code`、分項 diagnostics、`generation_progress` 與 `usage.uncertain`，HTTP 200 不代表模型成功，job 帳本不代表 Cloudflare invoice。

只有 owner 能新增人工 revision；先讀最新 history，有修訂時以最新 ID／payload 作 parent 與基底，沒有時才用 `ai`。三類 `Overview`、每組 `Core_concern` 須非空，來源不可偽造。成功為 `201`／`human_unverified`，過時 parent 為 `409 revision_conflict`；AI 基底不覆寫，diff 對應修改，人改文字不能沿用舊 citation 宣稱已驗證。

### #210：私有議題摘要與操作入口

志願者工具的麥穗黃「一鍵彙整」按鈕在既有生成 Prompt 旁，**暫僅於 `import.meta.env.DEV` 掛載**（含 dev:remote）；production 即使 mode 名稱為 development，也不掛載新按鈕／同意視窗／狀態提示，不觸發其查詢、輪詢或 debug log。此限制只隔離建構中的 UI，後端 API 與守門維持原契約；不移除 BYO 流程、不修改舊 briefing／議題 status，也不提供新版報告排版。dev 操作前需明確同意現行處理告知，含來源正文可能有個資、Workers AI／平台費用、留存與清除限制；已有該語言結果時另需確認替換。開始後不自動重送 POST 或重試模型；網路／輪詢錯誤只提供明確恢復查詢。

- `GET /api/issues/:id/evidence-summary?language=zh-TW|en|ja`：語言必填；回 `{version,has_summary,job,summary}`。未停權登入者可見指定語言的版本與有無結果，只有該 job 的 owner／管理員可取得其 job ID／狀態或摘要正文；其他登入者相應欄位為 null。新欄位不進公開列表、詳情或 SSR。
- `POST /api/issues/:id/evidence-summary`：精確 JSON `{consent:true,language,expected_version}`；全選至少兩份合格素材，沿用來源、停權、同意紀錄、admission、cache、quota、冷卻與費用守門。成功沿用建立 job 的 JSON，另有 `version`。版本不符回 `409 summary_conflict`，不能跳過重新讀取與替換確認。
- 繁中／英文／日文各自保存。只有完整 `ai_draft` 才由伺服器保存結構化 `data`／引用及工作關聯到 `ct_issues.ai_summaries`；不依賴瀏覽器留在頁面。`partial_draft`／failed 不覆蓋成功結果；較舊請求晚完成不能覆蓋新結果。原始 job、工件、usage、revision／diff 不因替換被刪除。
- 議題保存副本仍受來源檢查與 fence：hidden／changed 停止交付，來源 deleted 被對帳發現或按來源 erase 時清除副本，不得繞過原私有工作生命週期。新端點與原六 API 使用相同開關、必要 bindings、CSRF、private/no-store／Vary Cookie／無 CORS 政策。
- UI 只顯示進度與成功／部分完成／失敗提示。完整成功並確認已保存後，或 `partial_draft` 回傳可交付 `data` 時，依 #210 暫在操作者瀏覽器 `console.log` 輸出 `data`；部分草稿只供排查，不表示已保存或成功。同一語言／工作／版本在元件生命週期內不重複輸出，重新整理會重新輸出；沒有資料、失敗、撤下／清除或已離開範圍的遲到回應不輸出。不送伺服器 log，不將私人 Console 記錄當成可公開的驗收證據。
- 重新整理恢復目前獲授權的工作，不自動發起新生成。切換介面語言不把另一語言工作結果寫錯欄位；讀取工作／摘要仍可能核對來源，並非正式站的無副作用 smoke。

### Checkpoint B 主張／語境觀測（dev-only）

新工作仍透過既有 `?include_extraction=1` 與同一私人 DEV console 輸出，checkpoint 為 `B:claim-context`。`[extraction:raw]` 保留模型原值；`[extraction:claim]` 顯示原始錨點、完整主張及對應；`[extraction:context]` 顯示獨立語境。只投影保存結果，不重新提取或修改 raw。沒有保存的主張／語境明示 `unavailable/no_saved_claim_context`，不把空／失敗當作沒有觀點。

下一個人工檢查點是另行核可一次完整一鍵彙整：先確認帳號／角色、議題與至少兩份合格素材、既有配額／unknown、`0018` 前置及實際 API／Workflow 設定版本。獲授權後才重啟 `vp run dev:remote`、開 DevTools，依正常同意及替換確認開始一次工作。此動作可能呼叫逐素材 Clairic、配對 Clef、三分區 Gemma 與必要補完，不能沿用前一次單段 P1 的授權。

檢查 raw 沒被改寫、主張保留各方及必要條件、語境沒有被當成額外支持／反對；全教總警告等被轉述內容應帶原歸屬且不混成自學團體立場。最後逐項看共識／爭點／立場與引用，區分 `ai_draft`、部分完成與失敗；本機合成回歸及既有 raw 離線重播不代替這次語義驗收。這輪不執行上述新付費或遠端操作。

### Checkpoint A 歷史提取觀測（dev-only）

以下描述僅適用舊 A 工作；新 B 工件採上方 claim/context 投影。

2026-11-14 使用者回報實測 log 已出現，作為 checkpoint A 觀測接線的手動驗收；不把此回報擴張成原子化、語義品質或後續實驗已通過。

依 [`plan.md`](../plan.md) 第 6 節第 1 步，先提供 A／P0＋E0 的可觀測性：**Clairic 提示、展句／去重、Clef／Gemma 請求與生成流程均未改動**；原子 claim／context、E1 與後續對照尚未實作。這不是新的提取品質驗收。

- dev 的工作 GET 可精確加上 `?include_extraction=1`，取得 `extraction_debug`（`version: extraction-observation-v1`）；未 opt-in 不新增欄位。production 即使手送 query，也不讀取提取 raw、不回傳診斷欄位。既有登入／停權、owner／admin、private/no-store、來源查核及最後 fence 維持。
- 回傳與 console 只投影已保存的提取資料：`[extraction:raw]` 保留原始 `value／spans`（可能不等長）、confidence／p_null；`[extraction:expanded]` 顯示 legacy quote／原始及展句座標、拒收與去重；無正常 extraction 工件時仍可讀已保存的 raw／`[extraction:diagnostic]`，不偽造展句。
- A 舊工件的 `claim／context` 明示 `unavailable/not_created_at_checkpoint_A`。metadata 使用該工作的保存設定、來源 commit／dirty、素材 content hash 與工件 ID／hash；歷史 legacy quote 不重新命名為 claim/context。
- 以付費 `extract:<materialId>` step key 辨識 raw 歸屬，不用正文比對猜測素材；同文字不同素材仍可區分。不輸出完整 request、state_text、coverage.state_mapping、作者快照或其他模型的 raw，不把私人內容送到伺服器 log。
- dev 一鍵彙整的既有輪詢會自動 opt-in；提取資料一旦可讀就輸出，最後 failed／partial 不影響上游診斷。每個工作／工件 ID／hash 只印一次；離開頁面、切換語言／帳號或卸載後不印遲到資料。重新整理會重新印。

手動實測：

1. 使用 npm 12 與專案 Vite+；由操作者重啟 `vp run dev:remote`，更新啟動時固定的 commit／dirty metadata。一般 `vp run dev` 停用 Auth，不能作真人登入的提取驗收。本輪程式未提交，預期 metadata 顯示 dirty；不停止他人的既有服務。
2. 先開 DevTools Console，再以有權限的帳號進入既有議題的志願者工具、選對介面語言。若該語言已有目前獲授權的工作，還原／輪詢時便會出現分素材的原始抽取、legacy 展句及設定；**不必為看 log 再按一次生成**。GET／頁面還原仍可能觸發來源對帳或 queued 恢復，非無副作用試打。
3. 若要檢視未附掛目前摘要的舊 job，先確認該 job 與操作範圍已獲授權，再於同源 dev Console 執行下方自包含程式。只要求現有工作，不輸出整份 API body 或 Cookie；owner／admin 以外仍回 404。
4. 觀察否定／條件／歸屬是否已在 raw 中、legacy 展句是否混入其他立場，以及原始 value／spans、拒收／去重與 content／設定 hash；不要將 legacy 筆數當作原子命題數。缺 raw 是未取得保存結果，不等於沒有主張。
5. 本 checkpoint 不建立 extraction-only 流程。按「同意並開始彙整」仍會走既有完整付費工作，可能呼叫 Clef、Gemma 與必要補完並更新私人摘要；只有操作者另行同意該來源、帳號、費用與寫入範圍後才做，不為確認歷史成功而重跑。

```js
;(async () => {
  const jobId = window.prompt('已獲准檢視的既有工作 ID')
  if (!jobId) return
  const response = await fetch(`/api/evidence-jobs/${encodeURIComponent(jobId)}?include_extraction=1`, { credentials: 'same-origin' })
  const body = await response.json()
  if (!response.ok || !body.extraction_debug) {
    console.log({ http_status: response.status, job_status: body.status, error: body.error, extraction_debug: 'unavailable' })
    return
  }
  const { logExtractionDebug } = await import('/src/client/extractionDebug.ts')
  logExtractionDebug(body.extraction_debug)
})()
```

手動貼上的程式每次都會輸出；元件自動輪詢才有生命週期內的工件去重。Console 內文仍可能含個資，不能公開貼到 PR；來源 erase 不能追回瀏覽器已顯示的副本。投影與輸出入口為 `src/ai/extractionDebug.ts`、`src/client/extractionDebug.ts`。


## 5. 權限、CSRF、維護與來源生命週期

### API 與權限矩陣

| 方法與路徑                                 | 權限、請求與主要結果                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/issues/:id/evidence-jobs`       | 未停權登入者；`{consent:true, material_ids?:number[], language?:string}`，語言可為 `zh-TW`、`en` 或 `ja`。`202` miss／joined、`200` hit 或已保存失敗狀態；不接受呼叫者自填來源正文。 |
| `GET /api/evidence-jobs/:jobId`            | owner 或 admin 可讀工作／進度；非 owner 一般使用者及無效 ID `404`。                                                                                                                  |
| `GET /api/evidence-jobs/:jobId/revisions`  | owner 或 admin 可讀該 job 的 AI 基底與修訂；無可用 draft `422`。                                                                                                                     |
| `POST /api/evidence-jobs/:jobId/revisions` | 只有 owner；`{parent_revision_id,data}`，成功 `201`，過時 parent `409`；即使 admin 也不能替別人的 job 造修訂。                                                                       |
| `POST /api/evidence-maintenance/reconcile` | admin／super-admin；body 精確 `{}`，回 `{ok,checked,withdrawn,erased}`，並觀察活動工作流的已知終態。可能發現來源刪除並清除 payload。                                                 |
| `POST /api/evidence-maintenance/erase`     | admin／super-admin；body 精確包含 `kind`（`issue` 或 `material`）與正安全整數 `id`，清除目前工作 DB 的相關 payload 並留下永久 tombstone；不改來源 DB。                               |
| `GET /api/issues/:id/evidence-summary?language=zh-TW` | 登入者讀版本／有無結果；job 與 summary 正文各限該 owner／管理員，否則 null。 |
| `POST /api/issues/:id/evidence-summary` | 登入者；精確 `{consent:true,language,expected_version}`，沿用建立工作回應並增加 version；併發衝突 409／summary_conflict。 |

開關非 `1` 時八端點的同源請求回 `404`；跨站簡單寫入先經全域 CSRF 回 `403`，兩者都不進行 Auth／DB／AI 操作。已開啟但必要 binding 缺失回 `503`。啟用且同源請求時，未登入 `401`、停權 `403`；非 owner 非 admin 查 job／revisions 回 `404`，非 owner 的 revision POST 回 `404`，maintenance 非 admin 回 `403`。同源寫入送 `Origin: http://localhost:5173` 和 JSON content type；跨來源 JSON 依不提供 CORS 放行而無法通過瀏覽器 preflight。不要把 CORS 當作唯一寫入保護。

其他常見狀態：`400` 無效 JSON／欄位／語言或未同意、`413` body 過大、`422` 來源不合格／空正文／無可用 draft 或來源已撤下／清除、`409` 輸入或 revision 衝突、`429` 帳號日限或議題冷卻（看 `reset_at`／`retry_at`）、`503` 日預算／來源或服務不可用。單次最多 64 份素材、單份 48 KiB、總正文 512 KiB；抽取後超過 64 段以 job `failed`／`too_many_evidence` 顯示，不截斷冒充成功。這不是全站素材投稿上限。

### 對帳、來源生命週期與競態

reconcile 可能清除已刪來源的私有工件，也會觀察活動工作流的已知終態；失聯或 unknown 不代表已終止，不得重啟可能仍在執行的 Workflow。遠端沒有刪除通知，跨庫失效偵測及清除不是即時或原子同步，已送出的 AI 呼叫不能保證撤回。

來源 hidden／changed 使受影響的舊稿 `withdrawn` 並停止交付正文，不等於物理 erase；恢復可見標記不保證舊工作重新可讀。發現 deleted 或管理員按來源 erase，會跨相依工作與申請者清除快照、模型 raw／生成工件、人改 payload／diff，保留帳號 ID、hash、同意、時間、usage、unknown 與永久 tombstone。erase 成功為 `200 {ok:true}`，相關 job 為 `erased` 且不再交付 data／引用／正文；generation fence 阻止晚到模型回應復活正文。不得刪 tombstone、重建狀態或改 source ID 讓來源重新入場。

維護操作必須另行確認該次來源、跨工作依賴範圍及不可逆清除；不是日常 reset，也不以真實來源刪除／隱藏當作例行測試。正式 Worker 可有多個 isolate，不憑單一 isolate 冷啟判定 Workflow 已終止，不宣稱重啟服務會撤銷費用。

## 6. 交付與後續驗收

2026-11-08 提前清理不以前述六 API 完整正式實測為前置，也不把未執行的 `consent:false` 拒絕、建立／快取／輪詢／修訂／衝突、一般使用者與 non-owner／non-admin、有效 reconcile／erase 標為通過。UI／一般 API 驗收見 [#166](https://github.com/g0v/civic-talk-hono/issues/166)；維護驗收見 [#201](https://github.com/g0v/civic-talk-hono/issues/201)，進度見 [`TODO_AFTER_MERGE.md`](../TODO_AFTER_MERGE.md)。該清理輪次未 push／deploy、付費或遠端寫入；#210 本輪發布授權見本文開頭，公開歷史報告、原始 0017、`Insight.md` 與全部私有狀態仍保留。
