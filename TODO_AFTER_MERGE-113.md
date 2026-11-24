# 議題113、PR234合併後待辦事項

- [ ] **合併後、部署前**才套用 `0020_opinion_synthesis.sql` 到遠端業務庫 `vtaiwan-civic-talks`。先以 `vp exec wrangler whoami` 核對帳號；獲授權後從合併後的 `main` 執行 `vp exec wrangler d1 migrations apply vtaiwan-civic-talks --remote --config wrangler.jsonc`。**絕對不要對 `vtaiwan-auth` 套 migration。** 本 PR 不授權部署或啟用正式功能。

- [ ] **第一階段：先上線分群與統計，不開 Gemma。** 遠端業務 migration 成功後，另獲正式啟用與部署授權，在 `wrangler.jsonc` 的 `vars` 把 `OPINION_SYNTHESIS_ENABLED` 設為 `"1"`，保持 `OPINION_SYNTHESIS_AI_POLICY` 未設定。將設定變更合併到 `main`，從乾淨 checkout 用 `vp run deploy` 發布。正式驗收第三個「意見綜整」視角、未達門檻提示、達標時的群組圖／統計與小群遮蔽，並確認沒有自動排程 Gemma。若正式資料未達門檻，記錄真實分群尚未驗收，不灌合成資料到遠端。
- [ ] **第二階段：驗收後再開 Gemma 自動報告。** 第一階段驗收完成、三語處理告知已核對，且正式資料處理範圍、模型費用與部署另獲授權後，保留 `OPINION_SYNTHESIS_ENABLED="1"`，在 `wrangler.jsonc` 的 `vars` 加入 `OPINION_SYNTHESIS_AI_POLICY: "opinion-synthesis-v1"`。確認既有 `AI` 與 `OPINION_SYNTHESIS_WORKFLOW` 綁定，將設定變更合併到 `main`，再由 `vp run deploy` 發布。只用獲准、達門檻的議題驗收背景排程、報告引用與同版本快取；不新增 API key，也不需要第二份 migration。

- [ ] 更新About頁面，拿掉意見綜整步驟的"功能研發中"標記