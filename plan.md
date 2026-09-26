# Issue #107 公民意見投票實作計畫

## 目標

在 Civic Talk 自有的 `ct_opinions` 上加入 Polis 式三態投票：同意（`1`）、不同意（`-1`）、略過（`0`）。投票需登入；一人對同一則意見最多一筆，可改票、可收回。完成後移除 `/about` 步驟 3 的「功能研發中」標記。

本計畫只處理 Civic Talk 自有意見，不改外部 Polis embed，不把資料回寫 Polis，也不把票數餵進既有 AI synthesis prompt。

## 權威決策

以下以 issue comment `#issuecomment-5772029029` 與本次問答為準，覆蓋 issue 原始施工建議中衝突的部分：

1. 投票必須登入；停權帳號沿用 `requireUser()`，回 `403`。
2. 預設維持最新意見優先；另提供「最多回應」排序。
3. 票數不進 AI synthesis prompt。
4. 作者不能另投自己的意見；只要 `ct_opinions.author_id` 存在，查詢、顯示、排序與 CSV 均虛擬加上一票同意。此票不寫入 `ct_opinion_votes`，不回填舊資料。
5. 使用者投票前看不到該則意見的分布；投票後可看並可改票。作者因已有虛擬同意票，可直接看自己意見的分布。
6. 收回投票後重新隱藏該則意見的分布，不保存 `ever-voted` 狀態。
7. `abuse_flagged = 1`（被回報、待審）仍可投票；`2`（確認違規）與 `3`（AI 隱藏待複核）不可投。
8. CSV 只做 pol.is／Sensemaker 相容的 `comments.csv`，不做 Pocket Polis 長格式 `votes.csv`，也不做 `participants-votes.csv`。
9. CSV 需登入才能下載；不看角色。它是唯讀公開內容的匯出，因此登入停權者仍可下載，但不得投票。
10. CSV 是刻意提供的資料檢視入口；一般頁面仍執行投票前隱藏分布的介面規則。

## 已確認的現況與參考實作

- workspace 已包含 `../pocket-polis`。
- Pocket Polis 的 `src/export.ts` 與 `src/conversation.ts` 已成熟實作：
  - `comments.csv` header：`timestamp,datetime,comment-id,author-id,agrees,disagrees,moderated,comment-body`
  - UTF-8、LF、無 BOM、結尾換行。
  - `datetime` 使用固定英文星期／月份與 UTC 字串。
  - `comment-body` 一律以雙引號包住，內部雙引號加倍。
- Civic Talk 目前由 `src/db/queries.ts` 集中所有 D1 SQL；`GET /api/issues/:id/opinions` 已有公開／管理員兩種作者投影。
- `Issue.vue` 與 `OpinionDetail.vue` 的 SSR state 目前不含 session；`useAuth()` 在 hydration 後載入 `/api/me`。
- migration 最新編號為 `0011_issue_last_activity.sql`，本功能使用 `0012_opinion_votes.sql`。
- `0009` 以後的遠端 migration 狀態不能從 repo 檔案推定；本次只做本機 migration，不寫遠端 D1。

## API 與資料契約

### 投票資料型別

新增：

```ts
type OpinionVoteValue = -1 | 0 | 1

interface OpinionVoteState {
  vote_agree: number | null
  vote_disagree: number | null
  vote_pass: number | null
  my_vote: OpinionVoteValue | null
  can_view_vote_distribution: boolean
  can_vote: boolean
  is_author: boolean
}
```

規則：

- 未登入，或已登入但尚未投該則意見：三個統計欄位為 `null`。
- 已投票者：三個統計欄位為數字，`my_vote` 為目前選擇。
- 作者：`is_author = true`、`can_vote = false`、`my_vote = null`，但可看分布；UI 另以「作者當然同意票」呈現鎖定的同意狀態，避免把虛擬票誤認成可刪除的資料列。
- `abuse_flagged = 2/3`：`can_vote = false`；不提供分布。
- 所有回應都不得包含 `voter_id` 或可反推投票者的資料。
- 分布遮蔽必須在伺服器查詢／API 投影層完成，不能只由 Vue 元件隱藏。公開 SSR state、匿名 GET、已登入但未投者的 GET 回應都不得夾帶真實票數；只有存在實體票的目前使用者或意見作者可取得數字。登入限定的 CSV 是另一條明確授權的資料出口，不得拿來放寬一般 JSON／SSR 回應。

### 既有列表端點

擴充 `GET /api/issues/:id/opinions`：

- 每筆意見新增上述 `OpinionVoteState` 欄位；既有欄位與預設順序不變。
- query：`sort=recent|responses`，缺省為 `recent`。
- `responses` 定義為：顯式同意＋不同意＋略過＋作者虛擬同意票；同票數時以 `created_at DESC, id DESC` 穩定排序。
- 使用一個統計子查詢 `LEFT JOIN` 聚合整個議題，不逐則查 D1。
- 以當前 session user id JOIN 自己的實體票；匿名請求綁定 `NULL`。SQL／資料層只在「本人已有實體票」或「本人是作者」時投影統計數字，其他情況直接投影 `NULL`，而非先把數字送到前端再隱藏。
- 保留 `publicJson()` 的 `Cache-Control: private, no-store`、`Vary: Cookie`、`X-Content-Type-Options: nosniff` 與公開唯讀 CORS。
- 管理員版本仍可取得完整作者快照，但投票分布可見性規則與一般使用者相同；不得順便公開 voter 資料。

`GET /api/issues/:id` 與 SSR 查詢維持匿名公開投影，不把票數放進 SSR state。SSR 與 hydration 首幀都顯示「尚未揭露」狀態；登入後再由前端重新抓 opinions 列表。

### 寫入端點

新增：

- `POST /api/opinions/:id/vote`
  - `requireUser()`。
  - body 嚴格接受 `{ value: 1 | -1 | 0 }`；其他值或型別回 `400`。
  - 意見不存在回 `404`。
  - 作者自投回 `400`。
  - `abuse_flagged = 2/3` 回 `400`；`0/1` 可投。
  - 以 `INSERT ... ON CONFLICT(opinion_id, voter_id) DO UPDATE` 原子新增／改票，並更新 `updated_at`。
  - 回傳該則意見最新的可見統計與 `my_vote`。
- `DELETE /api/opinions/:id/vote`
  - `requireUser()`。
  - 只刪目前使用者的票。
  - 意見不存在或沒有可收回的票回 `404`，不偽裝成功。
  - 成功後回傳 hidden state；前端立即重新隱藏分布。

兩支端點沿用全域 `hono/csrf`；不加逐端點 Origin 檢查，不輸出 CORS 放行標頭。

### CSV 端點

新增 `GET /api/issues/:id/opinions/comments.csv`：

- 必須有 Better Auth session，未登入回 JSON `{ error: 'Unauthorized' }` 與 `401`；不看角色，停權不影響唯讀下載。
- 檔名：`civic-talk-issue-<id>-comments.csv`。
- header 與 Pocket Polis／pol.is 完全一致：

```text
timestamp,datetime,comment-id,author-id,agrees,disagrees,moderated,comment-body
```

- `timestamp`：`created_at` 的 Unix 秒。
- `datetime`：固定 UTC 英文格式，避免 Worker locale 造成內容漂移。
- `comment-id`：`ct_opinions.id`。
- `author-id`：議題範圍內的匿名流水號，依每位已登入作者第一則可匯出意見的 id 穩定排序；同一個非 NULL `author_id` 在同一份匯出中沿用同一匿名號碼。每一則 `author_id IS NULL` 的舊意見各自視為無法連結的獨立匿名作者，配置互不衝突的流水號，不能全部使用 Pocket Polis 保留給 seed／host 的 `0`。不回填 DB，且絕不輸出 Better Auth user id、name 或 email。
- `agrees`：顯式同意票＋有 `author_id` 時的虛擬作者同意票。
- `disagrees`：顯式不同意票。
- `moderated`：`abuse_flagged = 0/1` 都映射 `1`，因為兩者在 Civic Talk 都仍是公開、有效且可投票的意見；`1` 只代表回報待審，不等於 pol.is 的未核准 pending statement。
- `comment-body`：原始意見文字，依 CSV 規則 escaping。
- `abuse_flagged = 2/3` 完全排除，避免匯出已確認或暫時隱藏內容；目前匯出不會產生 `moderated = 0/-1` 的內容列。
- `pass` 不在 pol.is `comments.csv` schema 內，不另加私有欄位。
- response：`text/csv; charset=utf-8`、attachment、`Cache-Control: private, no-store`、`Vary: Cookie`、`X-Content-Type-Options: nosniff`；因需登入，不加 `Access-Control-Allow-Origin: *`。

## 分階段施工

### 1. Migration 與刪除不變量

新增 `migrations/0012_opinion_votes.sql`：

- 建立 `ct_opinion_votes`。
- 欄位：`id`、`opinion_id`、`voter_id`、`value`、`created_at`、`updated_at`。
- `value CHECK (value IN (-1, 0, 1))`。
- `UNIQUE(opinion_id, voter_id)` 作為平行請求的一人一票防線。
- 建立 `opinion_id` 索引。
- 表名與索引名都維持 `ct_` 業務命名。
- 不建立作者虛擬票，不回填任何既有意見或投票。

更新 `deleteOpinion()`／`deleteIssueCascade()`：先刪 `ct_opinion_votes`，再刪意見。維持目前手動 cascade 慣例，不假設 D1 已啟用 foreign key cascade。

本機驗證：

1. 套用 `vp exec wrangler d1 migrations apply vtaiwan-civic-talks --local`。
2. 查本機 `sqlite_master`，確認新增表只有 `ct_opinion_votes`，且沒有未加 `ct_` 前綴的業務表。
3. 驗證唯一約束可擋平行重複新增。

### 2. 資料層

在 `src/db/queries.ts`：

- 新增 `OpinionVoteValue`、`OpinionVoteState` 與帶投票狀態的公開／管理員型別。
- 新增單次聚合的意見列表查詢；支援 viewer id 與 `recent|responses` 排序。
- 新增 `upsertOpinionVote()`、`deleteOpinionVote()`、單筆最新統計查詢。
- 把作者虛擬同意票集中在 SQL 投影中計算，避免 API、CSV、排序各自出現不同口徑。
- 寫入條件同時檢查意見存在、非作者、`abuse_flagged IN (0, 1)`；失敗後只做必要的一次狀態查詢，以映射正確的 `400/404`。
- 禁止 `SELECT *`；公開投影不含 `author_id`、`show_email` 或 `voter_id`。

### 3. CSV formatter 與查詢

新增 `src/opinions/export.ts`：

- 從 Pocket Polis 移植必要且最小的 `polisDatetime()`、CSV quote 與 `formatCommentsCsv()` 邏輯。
- 不 import 或複製 Pocket Polis 的 Durable Object／投票引擎。
- formatter 使用純資料列，便於黃金樣本測試。

在資料層新增一次查詢取得可匯出的意見、匿名 author sequence 與聚合票數；不做每意見一次查詢。

### 4. API 路由

在 `src/api/routes.ts`：

- 擴充 opinions GET 的 viewer-aware 投影與 sort 驗證；未知 sort 回 `400`。
- 新增 POST／DELETE vote 路由。
- 新增登入限定的 comments.csv route 與下載 headers。
- 寫入錯誤維持 `{ error: string }`；CSV 未登入仍回 JSON 錯誤，不回假 CSV。

### 5. 共用投票元件

新增 `src/components/OpinionVote.vue`，只用 Tailwind utilities，不新增 `<style scoped>`：

- 三個按鈕：同意、不同意、略過。
- `authState === 'loading'`：SSR 與 hydration 首幀一致的中性骨架／停用狀態。
- 未登入：按鈕可見、不顯示票數；點擊後展開 `SignInButtons`，不替換或隱藏原意見。
- 已登入未投：按鈕可操作、不顯示分布。
- 已投：顯示三種票數、標示自己的選擇；點其他按鈕改票，點已選按鈕收回。
- 作者：顯示鎖定的「作者當然同意」狀態與分布，不呼叫寫入端點。
- `abuse_flagged = 1`：只在既有展開內容後顯示並允許投票。
- `2/3`：不顯示投票控制。
- 防重入：請求進行中停用三個按鈕；錯誤保留原狀態並顯示可翻譯訊息。
- 以 emit 回傳最新 `OpinionVoteState`，由頁面更新對應意見，不整頁重載。

### 6. 接入兩個頁面與排序

`src/views/Issue.vue`：

- 在意見卡內容後放 `OpinionVote`。
- 新增「最新／最多回應」選擇器；預設最新。
- 變更排序時呼叫 `/api/issues/:id/opinions?sort=...`，由伺服器排序；不把隱藏票數偷偷塞到前端做 client sort。
- hydration 後等待共用 `ensureAuthSession()`；登入時抓一次 opinions endpoint，取得自己的票與可見分布。匿名 SSR 不額外抓分布。
- 在意見分頁提供 `comments.csv` 下載入口。匿名狀態顯示登入提示；登入後連到下載 endpoint。

`src/views/OpinionDetail.vue`：

- 在主卡內容後放同一個 `OpinionVote`。
- hydration 後登入者從既有 opinions 列表 endpoint 取得這一則的 viewer-aware 狀態；不新增 N+1 或另一套投票 API。
- SSR state 維持公開內容，不含 `my_vote` 或可見統計。

### 7. i18n、About 與文件

同步更新 `src/l10n/zh-TW.ts`、`src/l10n/en.ts`：

- 三種投票、票數、投票前隱藏、作者虛擬同意、登入提示、收回、錯誤、排序、CSV 下載等 key。
- `abt_step3_desc` 改成同時描述提交意見與已上線的投票功能；兩個語言檔一起移除已失去用途的 `abt_step3_wip_note`。

更新 `src/views/About.vue`：

- 步驟 3 `wip: false`、`wipNote: ''`，不再顯示 `abt_wip_badge`；實際功能文字由 `abt_step3_desc` 顯示。
- 步驟 5 的 Sensemaker 研發中標記保留，不因本 issue 一併移除。

更新 `AGENTS.md`：

- migration 現況與 API 契約新增三個 endpoint。
- 記錄作者虛擬同意、分布揭露與 CSV 隱私規則。
- 不把功能標成已部署；只記錄程式碼完成度與待遠端 migration／部署驗證。

若新 Tailwind class 造成輸出變更，透過 `vp run css` 重新生成 tracked 的 `public/styles.css`，不手改生成物。

## 測試策略

新增真正保護契約的測試，不測 source text 或單純 wiring：

1. **資料／migration**
   - 唯一索引讓同一 `(opinion_id, voter_id)` 只有一列。
   - 首投、同值重投、改票、收回後統計正確。
   - 作者虛擬票不落表，但統計與 response sort 都加一票同意。
   - 舊資料 `author_id = NULL` 不虛增票。
   - status `1` 可投；`2/3` 不可投。
   - 刪除意見／議題後無殘留票。
2. **API**
   - 未登入 POST／DELETE `401`；停權 `403`。
   - 非法 value `400`、不存在 `404`、作者自投 `400`。
   - 改票與收回的可見狀態正確；收回後統計回 `null`。
   - 匿名、已登入未投使用者及公開 SSR state 都拿不到分布；投過者與作者拿得到。測試直接檢查序列化 JSON／SSR state 不含被遮蔽數字，避免只測畫面隱藏。
   - 作者回應帶 `is_author = true`、`my_vote = null`，不可把虛擬同意票誤做成可 DELETE 的實體票。
   - `recent` 與 `responses` 排序、tie-break 穩定。
   - 公開回應不含 `voter_id`。
3. **CSV 黃金樣本**
   - header、UTC datetime、Unix 秒、LF、無 BOM、結尾換行逐位元組相符。
   - 逗號、雙引號、換行與中文正確 escaping。
   - 已登入作者匿名化且同作者編號一致；每則 legacy `author_id = NULL` 意見取得不同、互不衝突且非 `0` 的匿名編號；檔案不含 Better Auth id／email／name。
   - 作者虛擬同意計入；pass 不新增欄位。
   - status `0/1` 的 `moderated` 都是 `1`；`2/3` 不出現在檔案。
   - 未登入 `401`；登入後 content type／attachment／cache headers 正確。
4. **i18n**
   - 既有 `l10n.test.ts` 保證中英文 key 集合一致；人工核對語意。

## 驗證流程

實作完成後依序執行：

1. `vp check --no-fmt --no-lint`
2. `vp test`
3. `vp run build`
4. 本機 D1 API smoke test：首投、改票、收回、作者自投、status `1/2/3`、兩種排序、CSV 下載、刪除 cascade。
5. 啟動實際 UI，以 browser 驗證桌機與手機：
   - 匿名按投票只展開登入入口，不吃掉意見內容。
   - 投票前無分布；投票後顯示；改票即時更新；收回後重新隱藏。
   - 作者顯示虛擬同意且不可另投。
   - status `1` 展開後可投，`3` placeholder 無投票控制。
   - 最新／最多回應切換正確。
   - CSV 未登入提示與登入後下載入口正確。
   - console 無 hydration mismatch。
6. 若本機 auth 無法完成真實登入，使用瀏覽器攔截 `/api/me` 與 vote API 做 UI 狀態 smoke test；真實 OAuth／D1 端到端驗證列為部署前驗收，不以 mock 冒充完成。

## 遠端與部署邊界

本分支施工期間：

- 不執行 `--remote` migration。
- 不 deploy、push、merge 或關閉 issue。
- 不操作 `vtaiwan-auth` migration。

上線前另行取得明確授權，先執行 `wrangler whoami`，再查清遠端 `vtaiwan-civic-talks` migration 狀態。若 `0009`–`0011` 仍 pending，必須依序套用所有 pending migration，再套用 `0012`，確認只新增／修改 `ct_*` 業務表後才能部署程式碼。不得先部署會查詢 `ct_opinion_votes` 的程式。

## 完成條件

- 登入者可對他人可投意見同意／不同意／略過、改票、收回。
- 平行請求仍維持一人一票。
- 作者虛擬同意在統計、排序、顯示、CSV 全部一致，且不寫入 vote table。
- 投票前隱藏分布；作者與已投者可見；收回後重新隱藏。
- status `1` 可投，`2/3` 不可投。
- 最新與最多回應排序可切換。
- 登入者可下載逐位元組符合 pol.is schema、可直接交給 Sensemaker 的 `comments.csv`。
- 公開 API 與 CSV 均不洩漏 voter identity。
- `/about` 步驟 3 移除研發中，步驟 5 保留。
- typecheck、tests、build 與本機 smoke test 全部通過。
