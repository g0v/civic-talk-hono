# #183 證據管線：檢閱與本機操作手冊

這份手冊服務三個目標：**看已完成的品質實驗與費用、理解程式及安全邊界、在不套遠端 migration 的情況下操作六條 API**。交付為 API-only；沒有新的操作 UI。PR #191 與原始 0017 已完成；v5 告知已隨 `e11d6b9` 由使用者手動推送／部署，20 項匿名發布／關閉檢查通過，正式仍為 `0`。本機設定已準備為 `1`，本輪授權修改、驗證及提交，不含推送、部署、付費或清理；這不代表啟用後六 API、真人 OAuth 或登入後寫入已驗收。[清理待辦](../TODO_AFTER_MERGE.md)尚未獲清理授權，目前下列本機流程保留，但付費與 erase 均須取得該次授權。

## 1. 先看已完成的實驗

使用者已確認品質實驗成功，並已核准手動公開兩份現有報告：[結果與引文](../results/ai-experiment_result.json)、[費用與 provenance](../results/ai-experiment_cost.json)。報告記錄真實議題 13、素材 25／26／27 的工作，結果為 `ai_draft`，共識／爭點／立場地圖均 `completed`，completion 為 `not_needed`；費用報告列 23 attempts、13,362 microUSD（US$0.013362）、unknown／reserved 為 0。這是**該工作**的應用帳本，不是 Cloudflare 帳單核對，也不涵蓋其他工作留下的未知費用。

報告的 evidence、citation map、data、分項 diagnostics、source／artifact hash 和模型 metadata 可用來回查原始材料、條件及歸屬。報告中的 source metadata 為 `e668fa2ea9c70fd3bdbcfd06ebb554b5e3a4747d`、`dirty:true`，不可聲稱與目前 HEAD 逐位相同或來源版本乾淨；重現流程也不保證模型逐字相同。模型 selector 不是不可變權重 SHA；結構與引文錨定通過不代表程式已證明語義正確。這次成功是使用者的實際驗收，並非獨立人工 gold labels 或普遍正確率。過往失敗與版本差異見 [`Insight.md`](../Insight.md)，不是當前成功紀錄的替代品。**不要為確認既有成功而另行呼叫付費模型。** 除這兩份既有報告外，新工作、快照、引文、session 或其他內容不可自動視為獲准公開。

## 2. 從程式理解資料流

|檢閱焦點|檔案與問題|
|---|---|
|接入與開關|`src/worker.ts`、`src/index.ts`、`src/ai/endpoints.ts`、`src/ai/env.ts`、`wrangler.jsonc`：只在明確 `EVIDENCE_API_ENABLED=1` 時提供新端點；關閉時不進入 Auth／DB／AI，啟用但缺必要 binding 時 fail closed 503。一般正式 profile 未指定 `SOURCE_DB` 時使用 `DB`；review／experiment 缺少各自明定的 `SOURCE_DB` 則 503，不回退。一般 API 的 headers／錯誤處理不得被證據子路由覆蓋。|
|來源與隱私|`src/ai/source.ts`、`src/ai/lifecycle.ts`：固定參數化 SELECT、未正規化 UTF-8 hash、作者快照欄位排除、來源 hidden／changed／deleted 的處理。素材正文仍可能有個資，不等於匿名化。|
|API 與授權|`src/ai/routes.ts`、`src/api/requireUser.ts`、`src/api/csrf.ts`：owner／admin 讀取、只有 owner 可新增 revision、maintenance admin、body／限額與跨站防護。|
|工件與競態|`src/ai/store.ts`、`migrations/0017_evidence_pipeline.sql`、`src/ai/human.ts`：私有快照、usage ledger、不可覆寫 AI 基底、人工 diff、來源 generation fence 與永久 tombstone。檢查 revision 回應在讀取後再次確認來源狀態，避免清除競態洩漏。|
|工作流與品質|`src/ai/workflow.ts`、`src/ai/runner.ts`、`src/ai/models.ts`、`src/ai/comparison.ts`、`src/ai/generation.ts`、`src/ai/pricing.ts`：Clairic 抽取、Clef 四分類、Gemma 三項與必要時單次補完，引用守門、分項狀態、attempt／預留／未知成本。檢查 workflow 觀察 RPC 失聯或 unknown 不被當成確定終態；排隊建立失敗後固定 instance ID 的恢復不是模型重試。|
|環境與驗收|`vite.config.mts`、`wrangler.ai-experiment.jsonc`、`wrangler.evidence-review.jsonc`、`src/ai/entry.ts`、`scripts/evidence-review-setup.mjs`、`scripts/evidence-review-smoke.mjs`、`src/tests/evidencePipeline.test.ts`、`src/tests/evidenceStorage.test.ts`：分離設定、真實與合成測試證據。|

正式已部署的 `e11d6b9` 仍為 `EVIDENCE_API_ENABLED=0`，六條 API 的同源請求回 404。本機一般設定已準備為 `1`，尚未發布；必要 binding 完整時匿名回 401，缺失則回 503。跨站簡單寫入仍由全域 CSRF 先擋為 403。現有 BYO token、`GET /api/issues/:id/prompt?type=synthesis`、briefing 與議題狀態不變。AI／人工草稿分別是 `ai_unverified`／`human_unverified`，不是可公開的 briefing。

## 3. 模式、前置與保護範圍

|模式|工作 DB／來源|認證／AI|用途|
|---|---|---|---|
|一般 `vp run dev`|本機；設定為 `1`，必要 binding 完整時六 API 匿名回 401|Auth 刻意停用、登入回 503|一般開發，不是假登入；不建立付費工作|
|一般 `vp run dev:remote`|既有遠端 binding；本機設定為 `1`|既有遠端 Auth／AI|有效登入及同意請求可能寫入業務庫並付費，不作未授權的 #183 試跑|
|`CIVIC_AI_REVIEW=1 vp run dev:remote`|本機 `DB` 與另一個本機 `SOURCE_DB`，獨立 `.wrangler/evidence-review`；固定虛構圖書館素材|既有遠端 `DB_AUTH`，真實 Workers AI|完整六 API 檢閱，不碰遠端業務來源或遠端 migration|
|`CIVIC_AI_EXPERIMENT=1 vp run dev:remote`|本機 `DB`／Workflow、`.wrangler/ai-experiment`；遠端 `SOURCE_DB` 僅供固定 SELECT|既有遠端 `DB_AUTH`，真實 Workers AI|經授權重現真實來源實驗，見第 7 節|

兩個 `CIVIC_AI_*` opt-in 不可同時設定；啟動前確認另一旗標未設定。**兩個 profile 都使用真實付費 AI，不是 mock；以下指令不是本輪付費或清除授權。** Clairic 逐素材、Clef 配對、Gemma 共識／爭點／立場三項，必要時最多另呼叫一次補完。現行官方單價：每百萬 tokens，Clairic input US$0.10、Clef US$0.24、Gemma input／output US$0.10／0.30。每帳號每 UTC 日最多 20 個新付費工作、同議題五分鐘、環境模型 US$5／日估算準入不是整 job 報價或全帳單硬上限，不含 Workers／Workflows／D1；unknown 預留跨日不自動退，也不保證次日恢復。改語言、選材或設定可能 cache miss 並再計費；不得為繞過失敗狀態、配額或費用而清庫、偽變輸入或重試。

本輪告知版本 `evidence-processing-2026-11-07-v5` 尚未發布；v4 是歷史告知，不重寫舊同意或 raw。每個建立請求須 `consent:true`，伺服器存版本／時間；同帳號命中既有 job 不新增同意事件，不代表已取得正文所有人的同意。作者快照欄不送模型，但正文、名稱／網址仍可能含個資，未匿名化。正式資料存業務 `DB`（非 `DB_AUTH`），含原始快照、完整模型 request／response、引用、來源紀錄、人改及 diff；owner／admin 可讀，owner 可新增人工修訂，AI 原稿不覆寫，不自動發布或改 briefing／status。

**無自動 TTL 或固定刪除時限。** 隱藏／變更只 withdrawn 停止交付，payload 保留。對帳／查核發現 deleted 或管理員按來源 erase 才清相關 execution 全部私有 payload／diff，跨依賴該來源的工作／申請者，不是單 job 自助刪除；保留帳號 ID、hash、同意時間／版本、usage、unknown 與永久 tombstone，來源 ID 不可重新入場。不保證即時發現刪除，不能撤回已送模型請求。人工權利請求：`info@vtaiwan.tw`。D1 Time Travel 依方案 7／30 天，erase 不保證即時清備份；Workers AI 一般推論零資料留存／不訓練有營運 metadata、安全及法律例外，D1 不是零留存。參考 [Workers AI](https://developers.cloudflare.com/workers-ai/platform/data-usage/)、[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[Workflows 計價](https://developers.cloudflare.com/workflows/reference/pricing/)。

需要 `vp`、Node.js `>=22.18`、`curl`、`jq`、Wrangler 的 Workers／D1／Workers AI 權限、Google OAuth 與 Better Auth 設定。先在本機私下用 `vp exec wrangler whoami` 核對帳號，不貼輸出。`.dev.vars` 私下配置 `BETTER_AUTH_URL=http://localhost:5173` 與 `BETTER_AUTH_SECRET`、Google／GitHub client ID／secret；不印出、不提交。由維護者確認 Google app 允許 `http://localhost:5173/api/auth/callback/google`；目前 GitHub app 不允許 localhost callback，本機**只使用 Google**。需要既有未停權的 admin／super-admin 與另一位一般使用者 Google 帳號；不以 SQL 改 role、不建立 auth 表或假 session。正常 Better Auth OAuth／session 生命週期可能寫遠端 `DB_AUTH`，除此之外不直接寫入，也不對它跑 DDL／migration。

`0017_evidence_pipeline.sql` 是正式保留的八張 `ct_ai_*` 表 migration，已套隔離本機；使用者亦已手動套用遠端原始 SQL，ledger id 18、`applied_at=2026-11-06 19:29:04`，八張表與七個顯式索引已核對。**SQL 必須 byte-for-byte 不變，不重跑或修改 ledger。** 本節 setup 只套本機，兩個 reviewer DB 使用不同虛構 database ID；不要對 `DB_AUTH` 跑 migration。`DB.remote:false` 不是 CLI `--remote` 安全鎖。後續遠端操作仍須另獲授權，本輪不執行；唯讀核對方式見[部署須知](../deploy_notes.md)，不以會初始化 ledger 的 `migrations list` 作零寫入檢查。

以下以 repo root、**同一個私有 Bash session**操作。不要啟用 `set -x`，不把 Cookie、token、`.dev.vars`、`/api/me` 原始回應、私人 payload 或未核准來源貼到終端錄影、PR、聊天或 git。確認 5173 的 IPv4／IPv6 listener：

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

只有在確認沒有其他 listener，或停止自己擁有的服務後繼續；不要終止未知程序。使用 `localhost:5173`，不要因 port 被占用改用另一 port 做 OAuth。

## 4. 準備 reviewer 環境並登入

```bash
node scripts/evidence-review-setup.mjs
```

此零參數 setup 固定 `wrangler.evidence-review.jsonc` 與 `.wrangler/evidence-review`，僅對本機 `DB`／`SOURCE_DB` 套 migration，並建立合成議題 `900013`、素材 `900025`／`900026`（週末圖書館開館案例，非真人資料）。重跑不清除任何狀態；若尚無完成標記，setup 可補入缺少的 fixture，但不覆寫衝突資料；已有完成標記後若 fixture 缺失或內容被修改，則拒絕而非重設。保留既有 jobs、費用、quota、tombstone 和使用者私有工作，不刪 `.wrangler` 或為重跑重建狀態。

另開 terminal 啟動，`vp run dev:remote` 會先 build；僅停止自己啟動的 server：

```bash
CIVIC_AI_REVIEW=1 vp run dev:remote
```

登入或傳送任何 Cookie 前，先確認 port 確實指向 reviewer Worker。以下匿名 preflight 只印安全狀態；沒有專屬 header 就停止，不向該服務送 Cookie：

```bash
set +x
set -o pipefail
umask 077
BASE='http://localhost:5173'
STATE='.wrangler/evidence-review'
test "$BASE" = 'http://localhost:5173' || exit 1
PREFLIGHT_CODE=$(curl --disable --noproxy '*' --silent --show-error --max-time 15 \
  --output /dev/null --dump-header "$STATE/review-headers.txt" --write-out '%{http_code}' \
  "$BASE/api/evidence-jobs/00000000-0000-0000-0000-000000000000") || exit 1
test "$PREFLIGHT_CODE" = 401 && tr -d '\r' < "$STATE/review-headers.txt" | grep -Eiq '^x-civic-evidence-review:[[:space:]]*1[[:space:]]*$' \
  || { printf '%s\n' '不是可用的 reviewer Worker；停止，不送 Cookie' >&2; exit 1; }
printf '%s\n' 'reviewer Worker 已確認'
```

在 `http://localhost:5173/` 用 Google 登入 admin。可使用頁面登入入口；若使用原實驗的 API-only 入口，可在該同源頁面的 DevTools Console 使用以下程式，**不輸出 URL 或 token**：

```js
(async () => {
  const response = await fetch('/api/auth/sign-in/social', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
  })
  const auth = await response.json()
  if (typeof auth.url !== 'string') throw new Error('OAuth start failed')
  location.assign(auth.url)
})()
```

完成 Google 流程後，如果 Network 尚無 session 請求，可在同源 Console 執行以下程式，只顯示是否有 session：

```js
fetch('/api/auth/get-session', { credentials: 'include' })
  .then(response => response.json())
  .then(session => console.info(session?.user?.id ? 'session 已建立' : '沒有 session'))
```

從該頁 DevTools Network 的 `GET /api/auth/get-session` **Request Headers** 取得 `Cookie` 值（不是 `Set-Cookie`，不要複製正式站 cookie）。以下 helper 從隱藏輸入建立 mode 0600 的 Netscape jar，不在命令列、history 或 stdout 放 Cookie。只可把它送到核對過的 `http://localhost:5173`；jar 不含 port scope，request header 本身也不含原 Cookie 的 Domain／Path／HttpOnly 屬性。

```bash
import_session() {
  local jar="$1" cookie
  IFS= read -r -s -p '貼上 Cookie request header 值（不含 Cookie: 前綴）：' cookie || return 1
  printf '\n' >&2
  printf '%s' "$cookie" | node scripts/session-cookie-jar.mjs "$BASE" "$jar" || { unset cookie; return 1; }
  unset cookie
  curl --disable --noproxy '*' --fail --silent --show-error --max-time 15 \
    --cookie "$jar" "$BASE/api/auth/get-session" |
    jq -e 'type == "object" and (.user.id | type == "string")' >/dev/null
}
import_session "$STATE/admin.cookies" || { printf '%s\n' 'admin session 驗證失敗' >&2; exit 1; }
curl --disable --noproxy '*' --fail --silent --show-error --cookie "$STATE/admin.cookies" "$BASE/api/me" |
  jq -e '.banned == false and (.role == "admin" or .role == "super-admin")' >/dev/null || exit 1
printf '%s\n' '已確認未停權 admin'
```

以另一個瀏覽器 profile 登入另一位**一般使用者**，重複上述 DevTools 取得該 profile 的本機 Cookie，再匯入與檢查，不印 `/api/me` 身分 JSON：

```bash
import_session "$STATE/other.cookies" || { printf '%s\n' '一般使用者 session 驗證失敗' >&2; exit 1; }
curl --disable --noproxy '*' --fail --silent --show-error --cookie "$STATE/other.cookies" "$BASE/api/me" |
  jq -e '.banned == false and .role == "user"' >/dev/null || exit 1
printf '%s\n' '已確認未停權一般使用者'
cp "$STATE/admin.cookies" "$STATE/session.cookies"
chmod 600 "$STATE/session.cookies"
```

以下用 admin 建立自己的 job，使一般使用者成為 non-owner；兩個實際帳號是必要前提，不要改 role 或使用合成登入。review helper 固定使用 `session.cookies`、canonical origin，且每次帶 Cookie 前自行檢查 reviewer header；每個回應另存隨機檔名、mode 0600 並印 `response_file`。這些檔案屬私人資料，不會自動刪除或覆寫。

## 5. 建立、輪詢、快取與修訂

以下 `create` 是**真實付費工作**，請先取得該次素材與平台計費同意；遇到錯誤不要連續重送。相同設定的舊失敗工作可能直接返回 `200`／`joined`／`failed`，不是新的一次模型執行。依 CLI 顯示的安全摘要輸入真實 job ID，不憑空填 UUID：

```bash
node scripts/evidence-review-smoke.mjs create --consent
read -r -p '輸入上方 job_id：' JOB_ID
node scripts/evidence-review-smoke.mjs job "$JOB_ID"
read -r -p '輸入上方 response_file 路徑：' JOB_FILE
jq '{job_id, status, error_code, generation_progress, usage}' "$JOB_FILE"
```

新工作通常 `202`／`miss`；同一進行中執行為 `202`／`joined`，完成快取為 `200`／`hit`。每隔幾秒可重複 `job "$JOB_ID"`，不要一直 POST。`queued`／`extracting`／`comparing`／`generating` 是進行中，`ai_draft`、`partial_draft`、`failed`、`withdrawn`、`erased` 是應停止輪詢的狀態。三個生成項目及可能的補完需要時間；停止等待不取消在途推論，也不退費。GET／網路錯誤時勿把舊檔當最新結果；用同一 job ID 稍後查詢，不因不確定而重送。

私下檢閱最近的有效 `JOB_FILE`：

```bash
jq '{status, error_code, input_key, generation_artifact, generation_progress, usage,
     sources: [.sources[]? | {kind,id,hash}], initial_input_diagnostics, current_issue_exclusions}' "$JOB_FILE"
# 以下包含生成文字及引文，只在私有本機查看。
jq '{data, evidence, citation_map, diagnostics, provenance}' "$JOB_FILE"
```

核對每句引用、原素材與條件；區分直接比較和候選路徑、模型提議和 Clef 正式關係。`no_findings`、`failed`、`not_started` 不可混為一談；`partial_draft` 不冒充完整草稿。來源失聯 fail closed；非同步失敗查看 `status`、`error_code`、分項 diagnostics 與 `usage.uncertain`，不要從 HTTP 200 推定模型成功。

### 同輸入快取

只有 `JOB_FILE` 已為 `ai_draft`／`partial_draft`，且來源、設定、素材及語言未改時才作此檢查。即使如此，重送仍是正式 admission，**若意外 miss 會產生新計費工作**；不接受此風險就跳過。先保存前次回應路徑，再以原本的 `create --consent` 重送一次，核對 CLI 回 `200`／`hit` 且 job ID 相同；若不是，停止且不再 POST。

```bash
jq -e '.status == "ai_draft" or .status == "partial_draft"' "$JOB_FILE" >/dev/null || exit 1
BEFORE="$JOB_FILE"
node scripts/evidence-review-smoke.mjs create --consent
# 人工確認上方是同一 job_id、HTTP 200、cache hit，否則停止。
node scripts/evidence-review-smoke.mjs job "$JOB_ID"
read -r -p '輸入這次 job 的 response_file 路徑：' AFTER
jq -s '.[0].usage == .[1].usage' "$BEFORE" "$AFTER"
```

`true` 只比較此 job 的帳本，並非 Cloudflare invoice 或完整 quota 測試。不要為示範燒滿配額或移除帳本。

### 只由 owner 新增人工 revision

工作有可用 draft 時，先 GET revision，再讓 helper 以 AI data 準備本機編輯檔；若 `revision.json` 已存在，helper 不覆寫並停止，先由擁有人檢視並決定如何保留，不要為重做清空資料庫。既有 cache hit 的 job 可能已有修訂：以下從剛取得的 history 以最新 revision 為 parent 與 data 基底；沒有修訂才用 `ai`。這只取代 helper **本次剛建立**的編輯檔。

```bash
node scripts/evidence-review-smoke.mjs revisions "$JOB_ID"
node scripts/evidence-review-smoke.mjs prepare-revision "$JOB_ID" || { printf '%s\n' '準備失敗；保留現有私有檔並停止' >&2; exit 1; }
read -r -p '輸入 prepare-revision 的 response_file 路徑：' REVISION_BASE
jq -e '(.revisions | type) == "array" and (.ai_base.id == "ai")' "$REVISION_BASE" >/dev/null || exit 1
if jq -e '.revisions | length > 0' "$REVISION_BASE" >/dev/null; then
  NEXT_REVISION=$(mktemp "$STATE/revision-current.XXXXXX") || exit 1
  jq '{parent_revision_id: .revisions[-1].id, data: .revisions[-1].payload}' "$REVISION_BASE" > "$NEXT_REVISION" || exit 1
  mv "$NEXT_REVISION" "$STATE/revision.json"
fi
${EDITOR:-vi} "$STATE/revision.json"
node scripts/evidence-review-smoke.mjs revise "$JOB_ID"
node scripts/evidence-review-smoke.mjs revisions "$JOB_ID"
read -r -p '輸入最後一次 revisions 的 response_file 路徑：' REVISIONS_FILE
jq '{ai_base: {id: .ai_base.id, verification: .ai_base.verification},
     revisions: [.revisions[] | {id,parentId,verification,diff}]}' "$REVISIONS_FILE"
```

在編輯器中修改一處文字，保持 JSON 與三類 `Overview`、每組 `Core_concern` 非空，來源資訊不可偽造；成功 POST 為 `201`／`human_unverified`。檢查 AI 基底未覆寫、diff 對應改動，人改文字不能沿用舊 citation 宣稱已驗證。保留同一個已過時 parent 的編輯檔並再次 `revise`，預期 `409 revision_conflict`，CLI 因非 2xx 會以非零狀態結束；這只檢查過時 parent，不建立第二版。

## 6. 權限、CSRF、維護與來源生命週期

### API 與權限矩陣

|方法與路徑|權限、請求與主要結果|
|---|---|
|`POST /api/issues/:id/evidence-jobs`|未停權登入者；`{consent:true, material_ids?:number[], language?:string}`，語言可為 `zh-TW`、`en` 或 `ja`。`202` miss／joined、`200` hit 或已保存失敗狀態；不接受呼叫者自填來源正文。|
|`GET /api/evidence-jobs/:jobId`|owner 或 admin 可讀工作／進度；非 owner 一般使用者及無效 ID `404`。|
|`GET /api/evidence-jobs/:jobId/revisions`|owner 或 admin 可讀該 job 的 AI 基底與修訂；無可用 draft `422`。|
|`POST /api/evidence-jobs/:jobId/revisions`|只有 owner；`{parent_revision_id,data}`，成功 `201`，過時 parent `409`；即使 admin 也不能替別人的 job 造修訂。|
|`POST /api/evidence-maintenance/reconcile`|admin／super-admin；body 精確 `{}`，回 `{ok,checked,withdrawn,erased}`，並觀察活動工作流的已知終態。可能發現來源刪除並清除 payload。|
|`POST /api/evidence-maintenance/erase`|admin／super-admin；body 精確包含 `kind`（`issue` 或 `material`）與正安全整數 `id`，清除目前工作 DB 的相關 payload 並留下永久 tombstone；不改來源 DB。|

開關非 `1` 時六端點的同源請求回 `404`；跨站簡單寫入先經全域 CSRF 回 `403`，兩者都不進行 Auth／DB／AI 操作。已開啟但必要 binding 缺失回 `503`。啟用且同源請求時，未登入 `401`、停權 `403`；非 owner 非 admin 查 job／revisions 回 `404`，非 owner 的 revision POST 回 `404`，maintenance 非 admin 回 `403`。同源寫入送 `Origin: http://localhost:5173` 和 JSON content type；跨來源 JSON 依不提供 CORS 放行而無法通過瀏覽器 preflight。不要把 CORS 當作唯一寫入保護。

其他常見狀態：`400` 無效 JSON／欄位／語言或未同意、`413` body 過大、`422` 來源不合格／空正文／無可用 draft 或來源已撤下／清除、`409` 輸入或 revision 衝突、`429` 帳號日限或議題冷卻（看 `reset_at`／`retry_at`）、`503` 日預算／來源或服務不可用。單次最多 64 份素材、單份 48 KiB、總正文 512 KiB；抽取後超過 64 段以 job `failed`／`too_many_evidence` 顯示，不截斷冒充成功。這不是全站素材投稿上限。

### 無登入、non-owner 與跨站請求

在 admin 的 job 已存在後，以下只顯示 HTTP 狀態、不印私人 body。手寫 curl 前，必須重做第 4 節的匿名 reviewer header 檢查；如果 server 已重啟或 port 被其他服務占用，先重新確認。預期依序 `401`、`404`、`404`、`403`、`403`：

```bash
curl --disable --noproxy '*' -sS -o /dev/null -w 'anonymous job: %{http_code}\n' \
  "$BASE/api/evidence-jobs/$JOB_ID"
curl --disable --noproxy '*' -sS -o /dev/null -w 'non-owner job: %{http_code}\n' \
  --cookie "$STATE/other.cookies" "$BASE/api/evidence-jobs/$JOB_ID"
curl --disable --noproxy '*' -sS -o /dev/null -w 'non-owner revisions: %{http_code}\n' \
  --cookie "$STATE/other.cookies" "$BASE/api/evidence-jobs/$JOB_ID/revisions"
curl --disable --noproxy '*' -sS -o /dev/null -w 'non-admin reconcile: %{http_code}\n' \
  --cookie "$STATE/other.cookies" -H "Origin: $BASE" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/evidence-maintenance/reconcile" --data-binary '{}'
curl --disable --noproxy '*' -sS -o /dev/null -w 'cross-site form: %{http_code}\n' \
  --cookie "$STATE/admin.cookies" -H 'Origin: https://attacker.invalid' -H 'Content-Type: text/plain' \
  -X POST "$BASE/api/evidence-maintenance/reconcile" --data-binary '{}'
```

如要驗證 non-owner revision POST `404`，同樣以 `other.cookies`、正確 Origin、JSON `{}` POST 到該 job 的 `/revisions`；owner 檢查會在內容可保存前拒絕。不要使用停權帳號或修改遠端角色來製造測試。

### Admin reconcile；本機來源隱藏／刪除

確認目前 CLI 的 `session.cookies` 是 admin，執行第 5 條 API：

```bash
cp "$STATE/admin.cookies" "$STATE/session.cookies"
chmod 600 "$STATE/session.cookies"
node scripts/evidence-review-smoke.mjs reconcile
```

檢查列印的 `response_file`，回應應有 `ok` 與 checked／withdrawn／erased 計數；對帳可能清除已刪來源的私有工件，所以先確認本機狀態與資料處置需求。每個 isolate 的首次認證 evidence request 也會做來源對帳與工作流狀態觀察；狀態失聯或 unknown 不能推斷終止，也不重啟可能仍在執行的 Workflow。遠端沒有刪除通知；跨庫失效偵測及清除不是即時或原子同步，已送出的 AI 呼叫不能保證撤回。

**僅供 reviewer 本機合成來源的可選破壞性案例**：完成草稿／快取／revision 檢閱後，若接受本機工作失效，可用下列完全指定的 `--local`、專用 config、專用 persist 修改 `900026`，執行 reconcile，再 GET job；隱藏應使受影響的舊稿 `withdrawn` 並不再回正文。不要在原實驗或正式來源執行這些 SQL，也不要對真實 13／25／26／27 下任何寫入。

```bash
vp exec wrangler d1 execute SOURCE_DB --local --config wrangler.evidence-review.jsonc --persist-to .wrangler/evidence-review --command 'UPDATE ct_materials SET abuse_flagged = 3 WHERE issue_id = 900013 AND id = 900026;'
node scripts/evidence-review-smoke.mjs reconcile
node scripts/evidence-review-smoke.mjs job "$JOB_ID"
# 恢復本機 fixture 的可見標記；這不保證已 withdrawn 的工作重新可讀。
vp exec wrangler d1 execute SOURCE_DB --local --config wrangler.evidence-review.jsonc --persist-to .wrangler/evidence-review --command 'UPDATE ct_materials SET abuse_flagged = 0 WHERE issue_id = 900013 AND id = 900026;'
```

若要另驗證來源**刪除**的清除路徑，最後階段可在完全相同的本機 config／persist 下將上面的 SQL 改為 `DELETE FROM ct_materials WHERE issue_id = 900013 AND id = 900026;`，再執行 reconcile／GET。刪除會使相關 payload 被清除並留下永久 tombstone；setup 會偵測 fixture 缺失並拒絕，不要重新插入、重建 DB、刪 tombstone 或改 generation 以強迫重跑。這是一次性、不可逆案例，不是日常 reset。

### 最後執行 erase

**全部其他檢閱完成後**，且接受永久清除虛構 fixture 工作，再執行第 6 條 API；helper 固定 issue `900013`，不是遠端真實議題 13：

```bash
node scripts/evidence-review-smoke.mjs erase --confirm-irreversible
node scripts/evidence-review-smoke.mjs job "$JOB_ID"
```

預期 erase 回 `200 {ok:true}`，受影響的 job 為 `erased` 且不再回 data／引用／正文。快照、模型 raw／生成工件、人改 payload／diff 被清除，但 hash／時間與 tombstone 留存；fence 使較晚到達的模型回應不能復活已清除正文。不要以刪除 tombstone、重建狀態或改 source ID 恢復這個工作。隱藏／變更為 `withdrawn`，不等於物理 erase。

完成後可各自對已確認的本機服務 sign-out，並由各帳號持有人安全處置自己的 Cookie jar；不要清除整個 persist 或私人結果。重新啟動只停止／啟動自己擁有的 server，重新執行匿名 preflight 後以相同 ID GET。正式 Worker 可能有多個 isolate，不能憑單一 isolate 冷啟就 restart 仍在執行的 Workflow，也不宣稱重啟服務會自動續跑或撤銷在途費用。

## 7. 選擇性重現原真實來源實驗

這不是閱讀已成功報告或審查 API 的必要條件。若確有新的實驗目的，須事先同意**實際來源、隱私與新費用**。原設定及既有 `.wrangler/ai-experiment` 資料、quota、ledger、tombstone 不重設。`SOURCE_DB` 是遠端業務 D1，其 binding 並非資料庫層唯讀憑證；程式限制為參數化 SELECT，**人工也不可寫入或套 migration**。`DB_AUTH` 同第 3 節限制。

本機 `DB` 使用原 config／persist，僅缺 migration 時使用下列原命令，絕不換 `--remote`：

```bash
vp exec wrangler d1 migrations apply DB --local --config wrangler.ai-experiment.jsonc --persist-to .wrangler/ai-experiment
```

每次以固定唯讀查詢確認素材仍屬議題且未隱藏；只讀識別／狀態／長度，不讀正文，不修改遠端資料：

```bash
vp exec wrangler d1 execute SOURCE_DB --remote --config wrangler.ai-experiment.jsonc --json --command "SELECT id, title, status, abuse_flagged FROM ct_issues WHERE id = 13; SELECT id, issue_id, length(source_name) AS source_name_chars, length(source_url) AS source_url_chars, length(CAST(content AS BLOB)) AS content_utf8_bytes, abuse_flagged FROM ct_materials WHERE issue_id = 13 AND id IN (25, 26, 27) ORDER BY id;"
```

若來源已更動／撤下，記錄差異並停止；不要更動或悄悄替換真實資料。停止自己擁有的 reviewer server，確認 canonical port 無未知 listener 且未設定 review 旗標，再啟動原模式：

```bash
CIVIC_AI_EXPERIMENT=1 vp run dev:remote
```

原入口是 API-only，根路徑 404；先確認 localhost listener 確實是**自己啟動的實驗 server**，再依第 4 節同源 JavaScript Google 登入，並於同一 Bash session 將 `STATE` 切至 `.wrangler/ai-experiment`，使用第 4 節的 `import_session "$STATE/session.cookies"` 匯入及驗證該次 session。勿把 reviewer profile 的 cookie 盲送其他 listener。驗證身份後，一次建立真實來源工作，回應保留在 mode 0600 的本機檔：

```bash
STATE='.wrangler/ai-experiment'
import_session "$STATE/session.cookies" || exit 1
umask 077
POST_FILE=$(mktemp "$STATE/job-post.XXXXXX")
HTTP=$(curl --disable --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 120 \
  --output "$POST_FILE" --write-out '%{http_code}' --cookie "$STATE/session.cookies" \
  --header "Origin: $BASE" --header 'Content-Type: application/json' \
  --request POST "$BASE/api/issues/13/evidence-jobs" \
  --data-binary '{"material_ids":[25,26,27],"language":"zh-TW","consent":true}') || exit 1
printf 'POST HTTP %s\n' "$HTTP"
case "$HTTP" in 200|202) ;; *) printf '%s\n' '停止，不重送' >&2; exit 1 ;; esac
JOB_ID=$(jq -er '.job_id | select(type == "string")' "$POST_FILE") || exit 1
jq '{job_id,status,cache,input_coverage}' "$POST_FILE"
```

以同一 job ID 有限輪詢，必要時稍後重做這段 GET，不重送 POST；若 GET 失敗，不使用先前的舊 `JOB_FILE`：

```bash
i=0
while [ "$i" -lt 30 ]; do
  JOB_FILE=$(mktemp "$STATE/job.XXXXXX") || exit 1
  HTTP=$(curl --disable --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 15 \
    --output "$JOB_FILE" --write-out '%{http_code}' --cookie "$STATE/session.cookies" \
    "$BASE/api/evidence-jobs/$JOB_ID") || { printf '%s\n' 'GET 失敗；停止，不重送 POST' >&2; exit 1; }
  test "$HTTP" = 200 || { printf 'GET HTTP %s；停止\n' "$HTTP" >&2; exit 1; }
  STATUS=$(jq -er '.status | select(type == "string")' "$JOB_FILE") || exit 1
  jq '{status,error_code,generation_progress,usage}' "$JOB_FILE"
  case "$STATUS" in
    ai_draft|partial_draft|failed|withdrawn|erased) break ;;
    queued|extracting|comparing|generating) sleep 2 ;;
    *) printf '%s\n' '未知工作狀態；停止' >&2; exit 1 ;;
  esac
  i=$((i + 1))
done
```

依第 5 節以該次有效 `JOB_FILE` 私下判讀來源、證據、引用、三項、費用與失敗；原樣重送仍可能 miss／付費。原實驗的 maintenance CLI 固定操作 `.wrangler/ai-experiment`，請勿拿它操作 reviewer DB。需要真實來源 erase 或不可逆資料處置時，須取得對**該次、該來源**的額外授權，不提供以真實 13／25／26／27 清除作例行測試的指令。

## 8. 合併後的分階段 rollout

PR #191、遠端原始 0017 與關閉版驗收已完成；v5 告知已隨 `e11d6b9` 公開並部署，20 項匿名發布／關閉檢查通過（歷史版本見 [`deploy_notes.md`](../deploy_notes.md)）。正式仍為 `0`，本輪準備本機設定 `1`、驗證並提交，不含推送／部署。後續另獲發布授權後才上傳啟用版；有效登入者逐工作同意即可使用，不限管理員。再按授權帳號、資料與費用範圍驗收六 API；關閉版 smoke 不代替此驗收。profile／CLI／fixtures 暫留，清理另需授權。絕不對 `DB_AUTH` 套本站 migration，本輪不做遠端寫入、付費或 erase。
