# #183 交付與專用環境清理紀錄

## 2026-11-08 決策

使用者核准提前清理實驗／審閱專用設定，**不再以正式六支 API 完整實測作清理前置**。本輪只做程式／文件清理、無遠端寫入與無付費的本機驗證，以及本機提交；不呼叫正式 evidence API、不推送、不部署、不執行遠端 migration、付費工作或有效 reconcile／erase。

一般 `wrangler.jsonc` 保留正式 `AI`、`EVIDENCE_WORKFLOW` 與 `EVIDENCE_API_ENABLED=1`。使用者先前回報已推送／部署啟用來源 `73800643596b7114efd0c7623ea436023cd244b9`；本輪清理不改動已部署 Worker。關閉 #183 的意義是 API 交付與專用環境退場，**不是正式六 API 已全數驗收，也不是 UI 已完成**。

## 尚未實測：已移交，不勾成完成

|追蹤議題|待驗範圍|
|---|---|
|[#166：UI 與一般 API 整合](https://github.com/g0v/civic-talk-hono/issues/166)|登入後 `consent:false`／缺同意拒絕、逐工作來源與費用同意、建立／輪詢、快取、修訂與過時 parent 衝突、一般登入者／停權／owner／admin／non-owner 權限、來源失效與私有資料隔離、費用／配額及 UI 呈現。|
|[#201：管理維護驗收](https://github.com/g0v/civic-talk-hono/issues/201)|有效 reconcile／erase、非管理員拒絕、來源撤下／刪除、跨相依工作 payload 清除與競態、Workflow 終態／queued 恢復、usage／unknown／tombstone 保留。每次仍需另行核准環境、來源、費用或不可逆處置範圍。|

先前僅提供過正式站 `POST /api/issues/13/evidence-jobs`、`{"consent":false}` 的指令，**未執行或回報結果**；`400`／`invalid_request` 仍是待確認的預期值。既有品質實驗成功不代表本輪正式付費驗收完成，不為確認已成功而重跑。

有效的 evidence GET／建立請求可能先對帳來源並恢復既有 queued 工作；發現來源已刪除時可能清除私有 payload。不能把登入後 GET／reconcile 當成無副作用的純讀取。未實測項目以兩個 GitHub 議題持續追蹤，不隨本檔清理狀態結案。

## 既有證據（本輪不重跑）

- PR #191 已合併；原始 `0017_evidence_pipeline.sql` 已由使用者套用正式業務庫，ledger id 18、`2026-11-06 19:29:04`，八張 `ct_ai_*` 表與七個顯式索引已核對。保留 SQL byte-for-byte 與 ledger；不對 `DB_AUTH` 做 DDL／migration 或直接 SQL 寫入。
- 關閉版來源 `a2ff8ae526aee59a37234562bad1001c65e8c8b5` 曾通過 52 項匿名 smoke；v5 告知來源 `e11d6b912d5a3e60c47a074e95b7a09b33df9f11` 曾通過 20 項匿名發布／關閉檢查。這些是歷史發布證據，不是目前開關為 0。
- 本機啟用修訂曾通過 typecheck、603 項測試、build 與 19 項無登入／無付費 HTTP 檢查，提交後重建；不能拿這個歷史數字代替清理後驗證。
- 使用者回報正式啟用來源 `7380064` 的六支 API 匿名請求均為 `401`、跨站簡單 POST 為 `403`；`GET /api/me` 為 `200`／`super-admin`／`banned:false`。僅證明守門與驗收帳號身分，未證明登入後功能或一般使用者資料隔離。啟用版 Worker Version ID 未提供，不沿用歷史關閉版 ID。
- 已授權公開的[真實品質結果](./results/ai-experiment_result.json)及[費用報告](./results/ai-experiment_cost.json)保留原樣；不是本輪新執行結果或獨立 gold labels。

## 清理範圍

- 移除兩份專用 Wrangler 設定、Vite profile／persist 分支、重複實驗入口、review 識別 header 與專屬環境旗標。
- 移除 review setup／smoke／fixture、舊本機 maintenance CLI、只供已退場 curl 流程使用的 Cookie 匯出工具及其專屬測試；保留 calibration 與正式管線回歸。
- `SOURCE_DB` 仍是內部來源 repository 的讀取介面；入口未指定時使用 `DB`。不移除正式認證、CSRF、private／no-store、binding 守門、來源 fence、計費／配額、快取或人工修訂保護。
- 日常入口只剩一般 `vp run dev` 與 `vp run dev:remote`。前者使用本機資料庫且停用 Auth；後者沿用既有遠端 bindings／真實認證，不能拿來未授權試跑付費工作。完整契約及限制見[手冊](./docs/evidence-api-review.md)。
- 同步 README、手冊、plan、AGENTS、部署須知、環境範例及 Insight 的現況說明；歷史實驗紀錄明標入口已退場，不把舊命令當作可直接執行的日常步驟。

### 保留且不處置

- `src/worker.ts`、正式 `src/ai/` 管線、六 API、AI／Workflow、功能開關及已核准值、所有安全與費用保護。
- 原始 0017、正式 `ct_ai_*` 表、現有工作、配額／usage ledger、unknown 費用、永久 tombstone；不 DROP、不清庫、不改 ledger。
- 私有 `.wrangler/ai-experiment`、`.wrangler/evidence-review` 及其中來源快照、Cookie、費用與工作紀錄；刪設定不授權刪使用者資料。
- 共用 `DB_AUTH`、OAuth 應用程式、其他專案與所有遠端 Worker／Workflow／資料庫。刪本機設定不代表遠端資源已刪，遠端處置仍須另行核對並授權。

政策維持無自動 TTL／固定刪除期限；hidden／changed 只撤下、保留 payload；deleted 被發現或管理員按來源 erase 才清跨相依工作私有 payload／diff，保留帳號 ID、hash、同意版本／時間、usage、unknown 及永久 tombstone。估算 US$5／UTC 日是模型準入控制，非整 job 報價或全帳單硬上限，unknown 跨日不自動退。完整留存／備份與權利請求說明見[手冊](./docs/evidence-api-review.md#3-模式前置與保護範圍)。

## 本輪本機驗證

- [x] `vp exec wrangler types` 完成；`vp check --no-fmt --no-lint` 零錯誤（160 檔）、`vp test` 通過（55 檔、589 項）、`vp run build` 成功。
- [x] 實際啟動一般 `vp run dev`，無專用旗標正常啟動；23 項無 Cookie HTTP smoke 通過，涵蓋頁面／舊網址、本機 session `200/null`、`/api/me` 401、登入 503、六 API 匿名 401 與跨站簡單 POST 403。未執行真人登入或付費模型。
- [x] 現行程式／日常文件無已刪專用入口的依賴；保留的 Insight 命令已明標歷史。原始 0017 與兩份公開報告的 SHA-256 不變；一般建置的正式 AI／Workflow／開關 `1` 與 DB／DB_AUTH 已核對。

提交約定：本機 commit 含 `Closes #183`，提交後重建並核對來源 metadata；不 push／deploy。GitHub 關閉由提交進入預設分支後生效，本機提交本身不會關閉 issue。

[`Issues.md`](./Issues.md) 原有兩項功能待辦仍另案，不混入環境清理，也未在本輪實作。
