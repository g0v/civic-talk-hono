# 議題113、PR234合併後待辦事項

- [x] **合併後、部署前**套用 `0020_opinion_synthesis.sql` 到遠端業務庫 `vtaiwan-civic-talks`。已從合併 PR #234 後的 `main`（`9b7f3f8`）執行 `vp exec wrangler whoami` 確認帳號為 `vTaiwan.tw`，依使用者授權執行 `vp exec wrangler d1 migrations apply vtaiwan-civic-talks --remote --config wrangler.jsonc`。**未操作 `vtaiwan-auth`，未部署或啟用正式功能。**
  - 遠端 ledger：`id=21`、`name=0020_opinion_synthesis.sql`、`applied_at=2026-11-24 20:18:21 UTC`；本機 migration 檔案已全部套用，保留既有歷史 ledger `0004_author_email.sql`。
  - 核對 `sqlite_master` 僅新增預期的兩張 `ct_opinion_synthesis_*` 表、兩個索引與四個 trigger；未移除既有物件。議題 28、素材 72、briefing 58、意見 28、投票 23、貢獻者 16，套用前後筆數相同；兩張新表皆為空。
  - 本機驗證：`vp test src/tests/opinionSynthesisRoutes.test.ts` 的 12 項測試通過；隔離本機 D1 已成功套用全部 20 份 migration 並核對新物件與業務表前綴，暫存已移除。未執行遠端模型呼叫或功能驗收。

- [x] **第一階段：先上線分群與統計，不開 Gemma。** 使用者已回報手動合併進 `main`、部署並完成第一階段驗收；本輪採用此回報，不重跑已確認的 UI。這不是第二階段 Gemma 已部署或付費驗收的證據。
  - [x] 第一階段來源設定（歷史）：`OPINION_SYNTHESIS_ENABLED="1"`，當時未設定 `OPINION_SYNTHESIS_AI_POLICY`；Gemma 未啟用，既有 AI／Workflow 綁定不變。
  - 本機驗證：型別檢查 184 檔、完整測試 65 檔／780 項及 build 通過。以實際建置的開關、正式 client 與 production 模式編譯的 SSR，搭配隔離 SQLite／合成匿名回應驗證三語 × 桌機／手機 × 淺／深色的 36 個情境（達標分群／未達門檻／小群遮蔽）；無橫向溢出、hydration mismatch 或瀏覽器錯誤。另驗三語 9 個 API 情境、投票後排程入口與 Workflow 執行入口；模型呼叫、Workflow 呼叫、背景排程與費用預留皆為 0。以上不是正式資料、真人認證或部署驗收。
- [ ] **第二階段：驗收後再開 Gemma 自動報告。** 第一階段驗收完成、三語處理告知已核對，且正式資料處理範圍、模型費用與部署另獲授權後，保留 `OPINION_SYNTHESIS_ENABLED="1"`，在 `wrangler.jsonc` 的 `vars` 加入 `OPINION_SYNTHESIS_AI_POLICY: "opinion-synthesis-v1"`。確認既有 `AI` 與 `OPINION_SYNTHESIS_WORKFLOW` 綁定，將設定變更合併到 `main`，再由 `vp run deploy` 發布。只用獲准、達門檻的議題驗收背景排程、報告引用與同版本快取；不新增 API key，也不需要第二份 migration。
  - [x] 第二階段來源設定：保留 `OPINION_SYNTHESIS_ENABLED="1"`，加入 `OPINION_SYNTHESIS_AI_POLICY="opinion-synthesis-v1"`；已核對既有 `AI`、`OPINION_SYNTHESIS_WORKFLOW` 綁定與 Worker 的 `OpinionSynthesisWorkflow` 匯出，不新增 API key 或 migration。
  - 非 UI 本機驗證：型別檢查 184 檔、完整測試 65 檔／780 項及 build 通過；已核對實際建置的開關與 bindings，以及 Worker／client／ASSETS 來源與雜湊一致。隔離 SQLite／合成模型回應的 13 個 API 情境通過，含投票後排程、同工作並行只執行一次、三語報告快取、跨站不排程、門檻與小群遮蔽、缺漏／未核准政策不排程及模型輸入不含作者快照／逐人投票識別碼；合成工作與模型回應各 3 次，對外網路呼叫 0，無實際費用。依使用者指示不重跑 UI；暫存腳本已移除，真實模型品質仍未驗收。
  - [ ] 第二階段正式部署、獲准議題的背景排程／真實模型報告／引用與同版本快取驗收。本輪僅準備來源設定與非 UI 本機驗證，不代為部署、觸發正式付費工作或擴張正式資料處理範圍；第二階段主項維持未完成。

- [ ] 更新About頁面，拿掉意見綜整步驟的"功能研發中"標記