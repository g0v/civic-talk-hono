# 貢獻與授權來源

本專案的軟體整體主授權為 **GNU Affero General Public License version 3 only（AGPL-3.0-only）**。授權分界與既有 MIT 部分見 [`NOTICE`](./NOTICE)、[`LICENSE-MIT`](./LICENSE-MIT) 及 [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)。來源限制與法務決策見 [`docs/licensing-review.md`](./docs/licensing-review.md)。

## 新增／修改貢獻

請確認您有權提供貢獻，並在 PR 正文記錄來源與授權。不移轉著作權；不要求貢獻者替其他作者、雇主或第三方權利人授權。若包含第三方程式碼、圖像或其他作品，請保留其原 notices，標明涵蓋範圍與適用條款。

新的 Civic Talk 軟體貢獻請明確使用 **AGPL-3.0-only**。不要將專案的新貢獻宣告成 `AGPL-3.0-or-later`；第三方元件本身使用的其他 SPDX 授權識別不得因此被改寫。

## 什麼情況下應新增測試

送出 PR 前請確認 `vp check --no-fmt --no-lint`、`vp test` 與 `vp run build` 都通過（CI 也會執行）。除了讓既有測試通過，以下改動請在同一個 PR 補上 `src/tests/` 的測試：

- **修 bug**：先寫能重現問題的測試，修好後讓它通過，避免同一個 bug 再次出現
- **安全與隱私相關**：使用者輸入的呈現（XSS）、跨站請求（CSRF）、作者 email／`author_id` 的公開範圍、登入與權限檢查
- **有判斷邏輯的功能**：排序、狀態轉換、限制條件（如改名冷卻期）、防重複送出
- **新增 i18n key**：既有的 `l10n.test.ts` 會自動檢查，不需另寫

純文案或樣式調整通常不需要新增測試。不確定時可在 PR 中詢問。測試寫法可參考 `src/tests/` 既有檔案，並從 `vite-plus/test` import `describe`／`it`／`expect`。

## 舊分支、舊 PR 與 cherry-pick

commit 日期不決定授權。MIT final tag 未涵蓋的新增修改，也不能只因為基於 MIT 分支就推定已採 MIT。

1. 以授權切換後的主線為合併目標，列出原始 commit SHA、來源網址與檔案範圍。rebase／squash 改變 SHA 時保留原始 SHA 對照。
2. 有可查證 MIT 發布來源的部分，保留原著作權、許可與免責 notices，並在 `THIRD-PARTY-NOTICES.md` 或相關檔案旁記錄來源及後續修改。既有 MIT 權利不撤銷。
3. 尚未有適用許可的新增／修改部分，由有權授權者明確同意以 AGPL-3.0-only 提供；來源或授權不明時先釐清、取得許可，或排除該部分。
4. 解決衝突時維持新主線的 `LICENSE`、套件 metadata 與授權說明，保留 `LICENSE-MIT` 與第三方 notices，不讓舊分支將整體主授權改回 MIT。

這套處理方式依循 [issue #126](https://github.com/g0v/civic-talk-hono/issues/126) 的方案；維護者兼法務於 2026-10-11 核准整體切換，保留既有 MIT 許可及各來源限制。

可在 PR 填寫以下聲明：

> 本 PR 帶入的歷史程式碼來自：［來源網址／原始 commit SHA／檔案範圍］，適用授權與原著作權、許可及免責 notices 已保留於［位置］。
>
> 對於本 PR 中本人有權授權的新增／修改軟體貢獻，本人同意以 GNU Affero General Public License version 3 only（AGPL-3.0-only）提供。
>
> 其他權利人的貢獻及第三方內容，其來源、適用授權或同意紀錄為：［逐項列出；沒有則填無］。本聲明不撤銷任何先前已授出的 MIT 權利。

## 網路服務與原始碼

提供修改版網路服務時，須依 [AGPL 第 13 節](https://opensource.org/license/agpl-3-0)向遠端互動使用者顯著提供免費取得該版本 Corresponding Source 的機會。需包含必要的建置、安裝與執行來源，不能僅連到與實際部署版本不符的 `main`。

本專案的 footer 在乾淨的 Git checkout 建置時連到該 commit 的原始碼 archive 與 `LICENSE`；沒有可靠版本資訊時，仍提供 AGPL 條款入口，但不偽造原始碼連結。只透過 `vp run deploy` 部署：先 build，再查核實際 Worker／client／部署資產與公開發布分支的版本，通過才上傳。fork 請將 `origin` 設為自己的公開 GitHub repository，或以公開的 `CIVIC_SOURCE_REPOSITORY` build 環境變數指定來源；發布分支預設 `main`，非 `main` 使用 `CIVIC_SOURCE_BRANCH`。具體限制與人工驗收見 [`deploy_notes.md`](./deploy_notes.md)。

`CIVIC_SOURCE_BRANCH` 只接受目標 repository 的真正分支名稱；先查核 `refs/heads/<branch>`，再以其固定 SHA 比較。不得指定 SHA、其他 fork 的 `owner:ref` 或 tag／PR ref；7–40 位純十六進位名稱也不作發布分支。

## 投稿內容與品牌

這份文件處理軟體貢獻，不替代平台投稿條款。公民意見摘要維持 CC-BY-SA 4.0，素材依原來源授權；footer 的範圍澄清不撤銷先前已合法授出的 CC 許可。本次軟體授權切換不授予額外的商標使用權；品牌圖像的來源限制仍如實保留。
