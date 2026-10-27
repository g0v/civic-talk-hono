# Clairic 素材抽取實驗（#183）

這是供管理員觀察 Cloudflare Workers AI Clairic 抽取能力的**只讀預覽**，不是共識判定、正式說明頁或自動發布流程。新模式一次以全部選取素材為背景抽取跨素材候選，但只返回原文片段，不產生新文字，也不證明投稿者相互認同或來源文章的內容屬實。它沒有 UI，不寫入業務資料或發布內容；Better Auth 的既有 session 生命週期仍可能寫入認證資料庫。一般志願者的內容生成流程仍使用志願者自己的 AI token。如何在本機以 `dev:remote`、管理員 session 與同源 CSRF 標頭呼叫，見 [README](../README.md#clairic-抽取實驗)。

## 資料範圍與使用方式

`POST /api/issues/:id/extraction-preview` 僅限未停權的 `admin`／`super-admin`。議題必須存在且 `abuse_flagged < 2`；只選該議題 `abuse_flagged = 0` 的素材。建議以 `{ "scope": "issue" }` 選取全部符合條件的素材，或用 `{ "scope": "issue", "material_ids": [12, 15] }` 選擇 1–8 個不同的正整數素材 ID。順序依素材 `created_at`、ID 升冪，不依請求的 ID 順序。無素材時回錯誤；指定不存在、屬於其他議題或不可抽取的素材時整批拒絕，不透露哪一筆不可見。`scope` 若存在，唯一有效值為字串 `"issue"`；其他值或型別回 `400`。

README 範例請在同一個互動式終端完整貼上並執行括號區塊，待提示出現再輸入 Cookie 值；不要把 Cookie 與程式碼一起貼上。範例不在指令行尾放 `#` 註解，因為預設互動式 zsh 會將其當成指令文字。

一次至多 8 筆，每筆原文至多 4,000 **UTF-8 bytes**；新模式的整批 state（含素材 ID 標籤及分隔文字）另限 8,000 UTF-8 bytes。超過回 `413`，不默默選前幾筆或截短內容；超過八筆時可明示選取包括較晚 ID 在內的子集。這些是實驗上限，不是全站可存素材的數量限制，也不是 token 數的保證。輸入錯誤、未登入、權限不足、查無資料分別回 `400`、`401`、`403`、`404`；AI binding 缺失回 `503`，模型錯誤、回傳截斷、無效格式或非素材原文摘錄回 `502`。錯誤形狀為 `{ "error": "..." }`。成功及錯誤回應均為 `private, no-store`，並帶 `Vary: Cookie`；全域 CSRF 防護仍適用。

新模式將全部選取的完整原文以素材 ID 標籤分隔、放進**單個** `state`，只呼叫一次 `@cf/cloudflare/clairic`；即使模型可能在一次呼叫內執行多個 pass，也不代表多次 API 呼叫。不另傳議題或素材的作者快照、資料庫的來源名稱及網址，不抓取來源網址。模型不接收 session cookie 或請求 headers；Cookie 僅用於既有登入守門。素材原文仍可能自行包含 URL、姓名、聯絡方式等個資，必須先確認有權將內容送往 Cloudflare；「不傳作者快照」不代表原文自動去識別。不要把 session cookie、模型輸入或含投稿內容的預覽貼到 issue、訊息或公開日誌。

省略 `scope` 則維持既有逐素材模式：`{}` 和 `{ "material_ids": [12, 15] }` 的選取規則不變，每份素材原文分別作為一個 state、每份呼叫一次 Clairic，回應保持 `extractions` 格式及每次呼叫各自的 `usage`。新模式的單次用量不會虛分攤給素材。

## 回應與 Markdown 層級

新模式成功 JSON 有 `issue_id`、`model`、`candidate: true`、`scope: "issue"`、`selection: "all" | "selected"`、排序後的 `material_ids`、`material_count`、`usage`、`analysis` 與 `markdown`。`candidate: true` 表示候選，不是認證結果。`usage` 為**整次呼叫**的數字用量，可能包含 `input_tokens`、`output_tokens`、`passes` 等，不是每篇素材的成本。

`analysis` 的結構如下（型別示意，非實測輸出）：

```text
consensus:    { overview: Evidence, opinions: Evidence[], opinions_diagnostics: ListDiagnostics }
disputes:     { overview: Evidence, opinions: Evidence[], opinions_diagnostics: ListDiagnostics }
position_map: { overview: Evidence, positions: PositionSlot[] }

Evidence:        { value, material_ids, span, confidence, p_null, source_match }
ListDiagnostics: { confidence, p_null }
PositionSlot:    { material_id, source: { title, href }, name: Evidence,
                   core_concern: Evidence, opinions: Evidence[], opinions_diagnostics: ListDiagnostics }
```

`overview`、`name`、`core_concern` 是原文摘錄或 `null`；共識、爭點及每素材立場的 `opinions` 為多個原文摘錄，未找到時為空陣列。每個項目分別驗證，沒有用多組平行 list 的順序猜測觀點與角色的配對。每個 PositionSlot 錨定一個素材，其欄位必須出現在該素材；即使在同一素材，name、core concern 與 opinions 仍是獨立候選，其關聯須人工核對，不自動合併成推測的相同立場或 actor。

每個 Evidence 的 `material_ids` 是所有實際包含該摘錄的**選取素材**，並非模型猜出的支持關係。只出現一次為 `source_match: "unique"`；在不同素材出現或在同一素材重複出現為 `"ambiguous"`，必須人工確認上下文，不能任選一個出處。text 欄位為 `null` 時，`material_ids` 為空陣列，`span` 與 `source_match` 為 `null`；不使用模型的 `guess` 補缺值。模型 `span`／list 各項 `spans` 為原始診斷，單位未經確認，不用來切原文或判定來源；缺失或無法安全讀取的 list 項目 span 為 `null`。

模型回報的 list `confidence`／`p_null` 是**整個 list 的診斷**，放在 `opinions_diagnostics`；不可當作各摘錄的個別信心，所以各 opinion Evidence 的 `confidence`、`p_null` 均為 `null`。其他 text 欄位的信心也只是模型診斷，不保證判讀正確或完整。

Markdown 保留 #181 所需的 **共識**、**爭點**及**立場地圖**，各有 `Overview`，前兩者有 `Opinion 清單`，立場地圖有 `各方立場`；這些均為待審候選。新模式 Opinion 的 Title 與 description 都使用完整候選原文，不依不確定句界或引號內問號截斷，也不由模型擬寫標題。Position 的 Source Title 取自該素材資料庫的來源名稱；`source.href` 只使用無 credentials 的絕對 `http`／`https` 網址，無效或缺失時為 `null`。Markdown 的動態文字與來源名稱會做 Markdown／HTML 安全跳脫，來源網址不會被抓取。

既有逐素材模式維持 `extractions` 陣列：每筆包含 `material_id`、各欄的 `value`、`span`、`confidence`、`p_null`、`source_match` 與各自的 `usage`；其 `source_match` 只判斷同一素材中是否重複。舊模式每份素材每類使用固定欄位，候選數量有限；Opinion Title 是同一候選原文的第一個完整句子（注意成對引號，不在引號內問號截壞；找不到句界時使用全文），description 為完整候選。兩種模式都不是完整列舉，不應直接視為公眾共識、定稿或其他需要授權的成果。

## 人工檢查建議

1. 挑選有權送出的具代表性素材，也選包含相反立場、長段落、重複句、繁體中文與 emoji 的例子；以 `material_ids` 避免超過數量或 state 大小上限。
2. 對照每筆 `material_ids` 的原文，逐項檢查摘錄、上下文與共識／爭點／立場分類；`ambiguous` 可能表示跨素材相同文字或一篇內重複，不表示支持、同意或共識。
3. 檢查每個 PositionSlot 是否錨定正確素材，name、關注與 opinions 是否確實有關；核對來源名稱和安全網址。新模式 Title 應為完整候選原文，舊模式則為首個完整句子；缺值不以 `guess` 或其他素材補上。
4. 檢查 Markdown 文字、連結及結構是否安全且可讀，並比較原文中的未列觀點；list 診斷、信心值或 `source_match: unique` 都不證明輸出完整或正確，也不能代替對來源文章的事實查核。
5. 若 API 返回 `413`、`502`、`503` 或模型截斷，不要把錯誤回應當成功預覽；以錯誤狀態調查，避免把素材或 cookie 寫入紀錄。

## 2026-10-27 既有逐素材模式實測紀錄

- `dev:remote` 的應用程式匿名 POST 回 `401`，跨站 `text/plain` POST 回 `403`；兩者均有 `private, no-store`、`Vary: Cookie`、`nosniff`，且未放行 CORS。
- 以獨立的臨時遠端 AI binding harness 測試正式站公開議題 20 的素材 60、63；這是模型能力測試，**不是**應用端點或繞過應用登入的測試。素材 60 回報 `input_tokens: 2426`、`output_tokens: 0`、`passes: 8`；素材 63 分別為 `1706`、`0`、`8`。兩筆的共識候選皆為 `null`；素材 63 的 Core_concern 選到「環保團體」，顯示可能把團體名稱誤判為核心關注。臨時 harness 已刪除。
- 尚無真正管理員 session，因此**未實測經應用程式認證後的 HTTP 成功路徑**。上述兩筆結果不代表涵蓋所有素材，亦不證明任何共識。

## 2026-10-27 議題 13 全批實驗紀錄

- 自動化的 `vp test src/tests/extractionPreview.test.ts src/tests/apiCsrf.test.ts` 為 **2 個測試檔、36 個測試通過**。測試以 SQLite 及受控的模型回應檢查全批結果、逐項出處、拒絕非法摘錄與存取防護；認證與模型回應為測試替身，因此不代表真模型品質或已實測管理員登入成功路徑。
- 兩次以本機獨立遠端 AI binding harness，對議題 13 的素材 25、26、27 各以一次完整 state 呼叫新 service 與真模型；不是經認證的應用 HTTP 端點。兩次均回 `502 invalid_model_response`。第一次未保留原始回應，不能推定失敗原因或用量。
- 第二次是另一次明確授權的診斷呼叫，不是應用自動重試。診斷顯示 root 與欄位型別、list 格式正常，`truncated: false`；但 `position_25_opinions` 含只出現在素材 26、未出現在錨定素材 25 的摘錄，故整批正確拒絕，不能把違規項忽略或改成缺值。這次不是 parser 型別錯誤或模型截斷；共識 overview 仍選了單方主張，list 也有短碎片，不能據此宣稱品質改善。對這批素材，目前真模型尚未交付可安全接受的完整 `analysis`；單次結果也不能推斷所有後續呼叫必然失敗。
- 診斷摘要另存於 [`clairic_test_result/13-issue-diagnostic.json`](../clairic_test_result/13-issue-diagnostic.json)，是失敗結果與安全診斷，並非成功的 analysis；既有 `13.json` 未覆蓋。
- 本次全批診斷與既有逐素材 baseline 的用量比較：

  | 模式 | API 呼叫次數 | input tokens | output tokens | passes |
  | --- | ---: | ---: | ---: | ---: |
  | 全批（第二次診斷） | 1 | 11078 | 0 | 10 |
  | 逐素材（`13.json` 合計） | 3 | 10166 | 0 | 24 |

  一次 AI 呼叫不保證較少 tokens 或只有一個模型內部 pass；這是本次觀察值，不是通用成本比較。
- 新模式的 `dev:remote` 應用 HTTP smoke 中，同源匿名 JSON POST 回 `401`，跨站 `text/plain` 簡單請求回 `403`；兩者均有 `private, no-store`、`Vary: Cookie`、`nosniff`，且沒有 `Access-Control-Allow-Origin`。
- 尚無真正管理員 session，**未實測經應用程式認證後的 HTTP 成功路徑**；不要將測試替身的成功結果或診斷資料當成正式產出的成功 analysis，也不要將任何候選當成已驗證共識或來源文章事實查核。

## 官方限制、計費與隱私

[Clairic 模型頁](https://developers.cloudflare.com/workers-ai/models/clairic/) 標示 context window 為 65,536 tokens；[輸入 schema](https://developers.cloudflare.com/workers-ai/models/clairic/schema-input.json) 另提到 fields 放不進單一 8,192-token pass 時會分批平行處理。[發布說明](https://blog.cloudflare.com/clairic-extraction-model/) 表示各 pass 會看到完整 input，但未說明超過單 pass 長度的 state 如何處理。不可把 8,192 等同整體 context window，亦不能推定 65,536 以內絕不截斷。輸出有 `truncated` boolean，官方 schema 未明訂其所有觸發條件；本實驗遇到 `truncated: true` 會拒絕結果。

Clairic 是抽取模型：`text` 返回原文片段，而非自行撰寫摘要；其 [schema](https://developers.cloudflare.com/workers-ai/models/clairic/schema-input.json) 沒有巢狀 object 欄位，list 也只支援 text／number／date。官方 [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) 文件的支援模型清單不含 Clairic；本實驗用固定欄位及程式組織 Markdown，不宣稱 Clairic 支援任意巢狀 JSON Schema。模型目前是 preview，型別、信心及合法格式都不保證正確。

依 [Workers AI 定價](https://developers.cloudflare.com/workers-ai/platform/pricing/)，Clairic 為每百萬 input tokens **US$0.10**（9,091 neurons）；不產生 output tokens，因此沒有 output token 費用。Workers AI 每日有 10,000 neurons 免費額度，超過須有 Workers Paid，並按超額 neurons 計費。新模式一次呼叫包含所有選取素材，請參考頂層 `usage` 與帳號實際用量；舊模式每份素材各呼叫一次，參考各筆 `usage`。欄位及可能的多 pass 會影響輸入量，單次呼叫不保證比多次呼叫便宜。開發環境也會使用遠端 AI 和帳號額度。

[Workers AI 資料使用政策](https://developers.cloudflare.com/workers-ai/platform/data-usage/) 說明：標準無狀態 inference 完成處理後不保留輸入／輸出，且不以 Customer Content 訓練模型；但有安全、法律等例外，啟用 AI Gateway 的日誌／快取、應用日誌或其他有狀態功能也可能另行儲存。Cloudflare 可保留營運 metadata。輸入仍會傳到 Cloudflare，請依實際資料、服務設定與適用政策評估風險。
