# 貢獻者軌跡（#229）

貢獻者頁面、API、作者名稱連結與個人頁入口在 dev 與 production 均可使用。既有 `/profile` 仍是登入者自己的帳號設定頁；公開歷程使用 `/contributors/:publicId`。本分支開放 production 不代表已合併或部署到正式站。

## 資料與公開範圍

- `/contributors/:publicId` 是公開軌跡，預設時間軸；`?tab=list` 切換年度列表，`expanded=2026:issue,2026:material` 保存展開項目。年度以 UTC 分界，日期依介面語言顯示。
- `ct_contributors` 放在業務 DB，`user_id` 與隨機 32 位十六進位 `public_id` 各自唯一。migration 只替已有作者 ID 的投稿建立映射；舊 NULL 作者不以名稱或 email 推定。新投稿及登入者開啟個人頁時可在 dev 與 production 建立映射，不更換既有公開網址。
- 頁首名稱取帳號目前顯示名稱；原投稿的作者名稱快照不變。日期明示為共用 vTaiwan 帳號註冊日，並非首次造訪 Civic Talk。
- 每個議題、素材、公民意見各計一次；每個 briefing 版本統一計一次「彙整／建立議題說明」，不推測彙整、議題說明或再彙整。管理員原地編輯不另計一筆。
- 僅計 `abuse_flagged=0` 且所屬議題同樣正常公開的投稿。刪除、待審或隱藏的投稿不顯示也不保留計數。私有 AI 工作、人改修訂、投票、濫用／失效連結回報皆不列入。
- 公開回應不含內部帳號 ID、email、素材／意見正文、私有 AI payload；已不存在或停權的帳號回 404。作者名稱連結仍沿用投稿快照，沒有名稱時不退回 email。
- briefing 版本連結前往議題目前的說明頁，不會顯示此歷史版本內文；版本標籤只標識該次投稿。
- 貢獻頁沿用首頁的 SVG 自然背景，以更低透明度置於主文後方；純裝飾，不接收操作，也不進入無障礙內容。

## 端點

- `GET /api/contributors/:publicId`：匿名可讀公開軌跡，找不到回 404。
- `GET /api/contributors/me`：登入且未停權；取得或建立自己的公開識別碼，回 `{public_id}`。匿名 401、停權 403。
- 所有回應為 `private, no-store`，保留 `Vary: Cookie` 與 `nosniff`；不開放認證 CORS。
- 帳號名稱及註冊日期只透過參數化 SELECT 讀取 `DB_AUTH`，本站不新增或寫入 auth schema。

## PR body 應附的分階段流程

以下是 #229 的發布順序，勾選需有當次操作證據；本文件不構成遠端操作授權。

- [x] 第一份 PR #230 的完整功能僅 dev 啟用。
- [x] 合併第一份 PR #230（`02045cc`）。
- [x] 經授權後對業務庫 `vtaiwan-civic-talks` 套用 `0019_contributors.sql`；2026-11-19 已核對 16 位作者的公開識別碼回填，未操作 `DB_AUTH`。
- [ ] 另行授權後用 `vp run dev:remote` 及正式資料驗收；此模式使用真實 bindings，不是隔離 sandbox。
- [x] 建立後續分支 `feat/229-contributor-production-ui` 調整 UI。
- [x] 在後續分支開放 dev 與 production，交由後續 PR 審閱。
- [ ] 合併後續 PR。
- [ ] 另行授權後以 `vp run deploy` 發布。

本機合成資料驗收只能證明程式行為，不能取代真人登入或正式資料 UI 驗收；遠端 migration 完成也不代表正式站已部署此功能。
