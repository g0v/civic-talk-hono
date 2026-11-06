# PR #191 合併後：正式 API 啟用與實驗設定清理

PR #191 已合併、遠端原始 0017 已由使用者手動套用、正式旗標 `0` 版本已部署並通過 52 項匿名 smoke。本輪 v5 告知已完成本機驗收，尚未部署；不授權發布、啟用、遠端寫入、付費或清理，profiles／CLI／fixtures 與私有資料保留。

## 目標與執行順序

目標是在另獲政策發布／啟用及驗收授權後，讓正式站使用六條證據 API；再另獲清理授權才回到一般設定。這不是當前已啟用狀態。UI 另案，既有 BYO token、synthesis prompt 與 briefing 不變。

**已完成合併 → migration → flag `0` 部署／匿名驗收；待另獲政策發布授權 → 啟用授權 → 六 API 授權驗收 → 清理授權。** 關閉版 smoke 不代替啟用驗收，不能只因合併就刪實驗入口。

## 1. 先讓正式站 API 可用

- [x] 確認 PR #191 已實際合併至 `main`，從合併後的來源建立後續修訂；ready for review 不等於已合併。
- [x] 另行取得遠端 migration 授權，先核對 Wrangler 登入帳號、業務 `DB` 目標、pending 與前序 migration，再套用 `0017_evidence_pipeline.sql`。保留原 SQL，不改 migration ledger；絕不對 `DB_AUTH` 套本 repo migration 或執行 auth DDL。
- [x] 已部署 source `a2ff8ae526aee59a37234562bad1001c65e8c8b5`、Worker `e398bed0-1a14-46d2-8f73-5222fd05b71d`，flag `0`／52 項匿名 smoke 通過；0017 ledger id 18、`2026-11-06 19:29:04`，八張表／七個顯式索引已核對。0016 ledger `2026-10-23 21:26:16`。
- [ ] 另獲授權發布 `evidence-processing-2026-11-07-v5`；本機修訂與驗收已完成，尚未部署，歷史 v4／舊同意／raw 不回寫。核對正式 bindings、費用、隱私與留存；完整政策見[手冊第 3 節](./docs/evidence-api-review.md#3-模式前置與保護範圍)。
- [ ] 新政策依[部署須知](./deploy_notes.md)另獲發布授權後，公開來源並建置、維持 flag `0`；之後另獲啟用授權才設 `1`，不將已完成的關閉版 smoke 當作啟用成功。
- [ ] 以授權的帳號、測試資料與費用同意，在正式站確認六支 API 的建立／輪詢、快取、修訂／衝突、權限及維護行為。新的模型工作會計費；reconcile／erase 可能永久清除資料，必須另外確認處置範圍，不拿真實議題 13／素材 25、26、27 作破壞性測試。
- [ ] 確認正常登入者與管理員能從正式站使用 API；保留不公開原始 Cookie／私人工作內容的驗收紀錄。正式驗收成功後才進行第 2 節。

政策無自動 TTL／固定刪除期限，hidden／changed 只撤下、保留 payload；deleted 被發現或管理員按來源 erase 才清跨依賴工作／申請者相關 execution 私有 payload／diff。保留帳號 ID、hash、同意版本／時間、usage、unknown、永久 tombstone，來源 ID 不可重新入場。人工權利請求寄 `info@vtaiwan.tw`；不保證即時發現刪除或撤回已送模型請求，D1 依方案 7／30 天 Time Travel 備份不保證即時清除。Workers AI 一般推論 ZDR／不訓練有 metadata、安全及法律例外，不代表 D1 零留存。估算控制非整 job 報價／全帳單上限，不含 Workers／Workflows／D1；unknown 跨日不自動退，不保證次日恢復。

## 2. 清理專用設定與完整呼叫鏈

在後續清理修訂中一次遷移相關呼叫端與測試，不只刪兩個設定檔而留下失效指令。

|待清理範圍|合併後的處理方式|
|---|---|
|`wrangler.ai-experiment.jsonc`、`wrangler.evidence-review.jsonc`|移除專用部署／binding 設定；保留一般 `wrangler.jsonc` 的正式 AI／Workflow 與功能開關。刪本機檔案不代表刪除遠端資源。|
|`vite.config.mts`|移除 `CIVIC_AI_EXPERIMENT`／`CIVIC_AI_REVIEW` 的 profile 選擇、互斥檢查及專用 config／persist 分支，回到一般開發路徑。登入仍需 canonical origin；不要順便更改 OAuth callback 或一般本機 Auth 停用政策。|
|`src/ai/entry.ts`|正式入口已是 `src/worker.ts`，移除僅供實驗的重複 Hono／OAuth 入口；保留正式應用的 CSRF、認證與證據子路由。|
|型別、環境守門與 header|清除 `src/ai/env.ts`、`src/api/types.ts`、`src/index.ts` 中僅供兩個 profile 使用的旗標、來源要求與 `X-Civic-Evidence-Review`。保留正式開關與必要 binding 檢查；內部來源 repository 仍需正常的來源 binding，不可直接刪掉所有 `SOURCE_DB` 使用而破壞管線。|
|專用工具與合成來源|移除 `scripts/evidence-review-*.mjs`、`scripts/evidence-review-fixture.d.mts`、`fixtures/evidence-review/`；`scripts/evidence-maintenance.mjs` 固定操作舊實驗目錄，移除前核對其呼叫端。正式管理維護改用既有授權 API，不把本機 SQLite CLI 改成直接寫正式資料庫。|
|測試|移除僅適用已刪 profile／CLI 的測試或案例，例如 `src/tests/evidenceReviewCli.test.ts` 及正式邊界測試的 profile 專屬情境；保留登入／角色、來源失效、清除競態、計費、配額、快取、人改衝突及正式開關的行為回歸。不得為了簡化設定刪掉仍適用的安全測試。|
|文件與環境範例|同步 README、檢閱手冊、plan、AGENTS、部署須知及 `.dev.vars.example`，將日常操作改為一般開發與正式 API；歷史實驗指令明標為歷史，不能仍宣稱可直接執行。保留 [Insight](./Insight.md) 與已授權公開的兩份 [結果](./results/ai-experiment_result.json)／[費用報告](./results/ai-experiment_cost.json)，不改寫原始工件。|

- [ ] 依表格移除整條專用設定鏈，確認沒有有效呼叫端仍依賴已刪檔案、旗標、review header 或舊啟動命令。
- [ ] 保留一般 `dev` 的本機資料庫與 `dev:remote` 的既有遠端語意。日常需要登入的開發仍走原本的 Google／Better Auth 流程；不為簡化而加入假登入、移除 CSRF 或默默把本機開發連到正式業務庫。
- [ ] 若仍需無憑證／無付費的自動驗證，沿用隔離的合成 provider／SQLite 行為測試，不把 fake provider 做成正式 runtime fallback，也不以「正式站可用」取代回歸測試。

## 3. 不可跟著設定檔一起刪除的項目

- 正式 `src/ai/` 管線、六條 API、`src/worker.ts` 的 Workflow export、AI／Workflow bindings、功能開關及其已核准的啟用值、所有授權／費用／來源 fence 保護。清理後部署不能意外把已啟用的正式 API 改回關閉。
- `migrations/0017_evidence_pipeline.sql`、正式八張 `ct_ai_*` 表、配額／usage ledger、未知費用、永久 tombstone 與已保存工作；不 DROP 表、不回滾 ledger、不為重跑清庫。
- `.wrangler/ai-experiment`、`.wrangler/evidence-review` 內的使用者私有資料。先停止自己擁有的服務、確認在途工作與 unknown 費用、由擁有人決定私下封存及留存政策。**刪設定不授權刪這些目錄**；Cookie、來源快照與私人封存不得提交 git。
- 共用 `DB_AUTH`、OAuth 應用程式及其他專案資源。若曾建立真正的遠端實驗 Worker／Workflow，先核對資源歸屬與執行中工作，另獲刪除授權；不能從本機設定檔推定遠端資源存在或可刪。

## 4. 清理後驗收

- [ ] `vp check --no-fmt --no-lint`、`vp test`、`vp run build` 全部通過；binding 變更後重新執行 `vp exec wrangler types`，不手改生成物。
- [ ] 實際啟動一般 `vp run dev`，確認無實驗旗標也能正常開發、舊 API／路由不退化；需登入的開發再按既有 `dev:remote` 規則驗證，不猜測 session 或 callback 可用。
- [ ] 依已獲授權的範圍驗證正式六支 API 仍可用，沒有因刪除本機設定影響正式 Workflow、來源查核、private／no-store、配額或清除保護。若需新付費／寫入／erase 測試，仍須先確認同意與範圍。
- [ ] 文件中的日常入口只剩一般設定；必要歷史紀錄仍可由固定 commit 查回。更新 PR／驗收紀錄，清楚區分已完成清理、未執行的遠端操作與後續 UI 議題。

原先兩項功能待辦仍保留於 [`Issues.md`](./Issues.md)，不混入本次環境清理，也不代表已授權實作。
