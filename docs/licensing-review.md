# #126 授權切換：法律審查盤點

本文件記錄授權來源、法務裁示與發布限制。盤點及裁示日期：**2026-10-11（Asia/Taipei）**。維護者 Bestian Tang 自述兼任本案法務，已明確核准整體切換為 AGPL-3.0-only、以 `v0.2.0` tag 界定首個正式版，並確認現有來源限制不阻擋合併。核准不代表已合併、建立 tag 或正式部署。

範圍為軟體程式碼與建置／執行文件；投稿內容另行處理。footer 依現有條款標示意見摘要 CC-BY-SA 4.0 屬範圍澄清，不撤銷先前已合法授出的 CC 許可。本次不授予額外商標使用權，也不替未查明來源補造許可；下方限制繼續保留。原始碼入口位於 footer。

## 授權分界

| 項目                 | 固定紀錄                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| MIT final tag        | [`v0.1.0-mit-final`](https://github.com/g0v/civic-talk-hono/tree/v0.1.0-mit-final) |
| MIT baseline commit  | `0cb5f309fa373e69ff60563bdc3fb0201332ceba`                                         |
| Tag 發佈日期         | 2026-10-11；來自 annotated tag 時間，不以 commit 日期代替                          |
| 首個 AGPL 正式版     | `v0.2.0`；合併後建立，指向實際 merge commit；不預填 SHA／發布日期                  |
| 原 MIT 著作權 notice | `Copyright (c) 2026 Bestian Tang`；[`LICENSE-MIT`](../LICENSE-MIT) 原封保留        |
| 主授權               | AGPL-3.0-only；不是後續版本任選 MIT／AGPL 的雙重授權                               |

## 本 repo 的作者與同意紀錄

以完整、非 shallow 的 Git history 執行 `git shortlog -sne v0.1.0-mit-final`，共 **227** 個 commits（含 merge commits）；Git 作者資料是 attribution 證據，不足以單獨證明權利歸屬。此處不重複公布作者 email，也不改寫歷史。

| Git 作者名稱                 | Commits | 可查證同意／尚待確認                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bestian Tang（兩組作者紀錄） |     167 | #126 提案及本次維護者兼法務的正式切換核准；不代表擁有所有第三方權利                                                                                                                                                                                                                                                                                                                                                                                                      |
| Link1515／Terry              |      45 | [Link1515 回覆](https://github.com/g0v/civic-talk-hono/issues/126#issuecomment-5881817204)；Terry 的 GitHub noreply 記錄含 Link1515                                                                                                                                                                                                                                                                                                                                      |
| jiangzuojin226-sys           |       6 | [同意回覆](https://github.com/g0v/civic-talk-hono/issues/126#issuecomment-5884842263)                                                                                                                                                                                                                                                                                                                                                                                    |
| Lynn                         |       4 | [clhuang224 同意回覆](https://github.com/g0v/civic-talk-hono/issues/126#issuecomment-5882215174)；Git 作者識別可對照原紀錄                                                                                                                                                                                                                                                                                                                                               |
| tahodev                      |       1 | 未另行取得同意，不視為默認同意。Commit `fdbb0e30cc0a6c469f0bc1e4b7b9155bdb98a013`（[PR #86](https://github.com/g0v/civic-talk-hono/pull/86)）將五處議題內容字級改為 mobile-readable utilities；本次替換為共用語意樣式，仍保留歷史、MIT 來源及 notices                                                                                                                                                                                                                    |
| 苗                           |       1 | Commit `4cc4333ced68fa249c1f071cc089754d387bf46f`（[PR #75](https://github.com/g0v/civic-talk-hono/pull/75)）在兩個語系的投稿提示加入司法判決項目。PR 帳號為 `miao-agent-ctrl`，不是 shuyanglin；[本人說明](https://github.com/g0v/civic-talk-hono/pull/75#issuecomment-5385906460)涉及正式代表關係會轉交背後真人。已[補送徵詢](https://github.com/g0v/civic-talk-hono/issues/126#issuecomment-6104466808)，尚未取得同意；本次以新文案替換該項目，不將帳號等同實際權利人 |
| Claude                       |       3 | Git 工具作者紀錄；不是從名稱即可認定的法律權利人或授權同意                                                                                                                                                                                                                                                                                                                                                                                                               |

[shuyanglin 在 #126 的同意回覆](https://github.com/g0v/civic-talk-hono/issues/126#issuecomment-5884793016)另行保留；維護者確認它**不涵蓋**上表「苗」的 commit。

Git history 另含 Cursor、Codex 與 Claude 的 co-author／session 標記；保留 attribution，工具署名不視為權利人授權書，未回覆或期限屆滿都不是同意證據。維護者兼法務核准依既有 MIT 許可與 notices 推進整體切換；兩筆小修改的替換不撤銷歷史權利，也不以「寫法不同」宣稱消除原貢獻的著作權問題。

## 移植／參考來源

### 原始 Civic Talk

- 公開來源：[`v-taiwan/civic-talk@e2d516081cfbb25e9a669c5483ae8faf270d1a80`](https://github.com/v-taiwan/civic-talk/tree/e2d516081cfbb25e9a669c5483ae8faf270d1a80)。
- 該版本完整 tree 未見獨立 `LICENSE`；[README](https://github.com/v-taiwan/civic-talk/blob/e2d516081cfbb25e9a669c5483ae8faf270d1a80/README.md) 的 License 節標示 **MIT**，並保留感謝 ronny wang 提供概念與授權社群使用的文字。GitHub license metadata 為 null，故沒有將 metadata 當成「沒有授權」。
- [舊首頁](https://github.com/v-taiwan/civic-talk/blob/e2d516081cfbb25e9a669c5483ae8faf270d1a80/public/index.html) 頁尾標示 `© 2026 vTaiwan · CC-BY-SA 4.0`。維護者兼法務核准此次依現有投稿條款澄清 footer，不撤銷先前已合法授出的 CC 許可；舊聲明的具體範圍仍作來源限制保留。
- 本 repo 移植 commit：`9b98f88eac6b8796120cd183fef38ddd251e2679`；涵蓋 `src/api/routes.ts`、`src/db/queries.ts`、`migrations/0001_init.sql`、初始 views／components／l10n／樣式及 `public/vtaiwan-logo.svg` 等，後續多有修改。參見該 commit 的 diff；不是宣稱這些現行檔案全部仍等同舊站。
- 固定來源 SHA 是查核版本；尚未證明它就是移植時本機 sibling checkout 的精確 SHA。來源及已找到的聲明保留於 [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)，不補造缺少的原作者 copyright notice。

### vTaiwan-hono

- 公開來源：[`g0v/vTaiwan-hono@fb04555cc02f9a4ce1de86622e0ae63c00ee2db6`](https://github.com/g0v/vTaiwan-hono/tree/fb04555cc02f9a4ce1de86622e0ae63c00ee2db6)。該版本 [LICENSE](https://github.com/g0v/vTaiwan-hono/blob/fb04555cc02f9a4ce1de86622e0ae63c00ee2db6/LICENSE) 為 MIT，著作權 notice 與本 repo 的原 MIT 文本完全相同。
- Better Auth 對齊紀錄：本 repo `29ddfdad0e97540f5c350ab347d1aeb05dca6df5`，涉及 `src/auth/createAuth.ts`／`authorization.ts` 等；上游參考路徑為 `src/server/lib/createAuth.ts`／`authorization.ts`。查核 SHA 不冒充精確複製時的 checkout SHA。
- Favicon／OG 匯入 commit：`4cdc54156cebd6b233973c1d6dd2abc3866807e7`。上游查核版本的 **18** 個同路徑檔案 Git blob 與本 baseline 完全相同：`public/browserconfig.xml`、`public/favicon.ico` 及 `public/img/*` 的 16 個檔案。`public/manifest.json` 已客製；兩個 `public/vtaiwan-logo*.svg` 未在該 snapshot 找到相同 blob。
- 檔案相同與 repo MIT notice 是來源證據，但不單獨證明品牌原始圖像的著作權鏈或商標使用權；品牌資產列入下方待確認項目。

### 設計 token 與品牌資產

- 本 repo `912d2a1d890bae47eb6625d5633cedb6f03ed03e` 將設計系統 token 導入 `src/styles/app.css`。原紀錄僅指定 sibling 路徑 `vtaiwan-design-system/project/colors_and_type.css`。
- 維護者已確認來源專案為：[`Tofuswang/vtaiwan-design-system@19152d2f3e6427cd80978fa4899072f967eb1e3c`](https://github.com/Tofuswang/vtaiwan-design-system/tree/19152d2f3e6427cd80978fa4899072f967eb1e3c)。精確匯入時的 checkout SHA 仍未查證；此固定 SHA 是本次盤點版本。
- 查核根／project README、完整 tree 及 token 原檔：未找到明確軟體授權或獨立 LICENSE。project README 說 logo 由使用者提供，並列出其他參考 codebase；這些來源說明不是使用者有權再授權的證明。
- 本次不替 token、logo／favicon／OG 圖補造 AGPL 或 MIT 授權，也不將「商標權保留」誤寫成已解決圖像著作權。維護者兼法務確認現有依據足以支持合併，並要求保留未查明限制；這不等於已取得未找到的許可，也不能撤銷已合法授出的許可。權利人、精確匯入版本與適用 notices 仍須按新增證據補充。

### 其他可見來源

- Google／GitHub 品牌圖示在 `636d0f4521e589a08e6c767d01269fc3270e3771` 導入 `src/views/Admin.vue`，之後於 `e618634b832fded26d07c00be4c3c9e80d565699` 移至 `src/components/SignInButtons.vue`。軟體授權不替代品牌使用規範；本次核准不宣稱取得額外品牌許可。
- `src/ssr/render.ts` 透過 Google Fonts 載入 Noto Sans TC／Noto Serif TC，沒有將字體檔打包進本 repo；字體原來源條款另行適用。
- `src/views/Issue.vue` 載入外部 `https://polis.tw/embed.js`；Civic Talk 的 AGPL grant 不宣稱重新授權該外部程式。
- `FACT_CHECK_CORE` 為獨立 Service Binding Worker；本 PR 不修改或替該服務重新授權，也不宣稱 Civic Talk 的 grant 涵蓋它。維護者兼法務核准保留此外部服務界線聲明。
- `src/components/AboutFlowIllustration.vue` 是本 repo `cbbc33bc68e3af184da5a76173c0d0d6ff179c55` 新增的 inline SVG，保留該 commit 的 attribution；不將工具 co-author 名稱當成權利歸屬結論。

## npm 依賴

[`licensing-dependencies.tsv`](./licensing-dependencies.tsv) 逐筆記錄 lockfile 的 **356** 個非 root entries（2026-11-04，Better Auth 1.7.15 及其相依升級後同步；移除 `@opentelemetry/semantic-conventions`，較前次少 1 個 Apache-2.0 entry；workerd 的 scoped override 所加入的 6 個 Apache-2.0 entries 維持不變）：路徑、版本、license metadata、dev／devOptional／optional 標記及 resolved URL（lockfile 未提供時記為 `UNSPECIFIED`）。使用 `node scripts/licensing-dependencies.mjs` 重產，`node scripts/licensing-dependencies.mjs --check` 驗證；CI 執行一致性查核。這是 metadata 盤點，**不是逐一檢查完整著作權 notices 或所有發布產物的法律清單**，也不依 flags 就宣稱某個套件不會進入部署。

| License metadata（原樣保留）             | Entries |
| ---------------------------------------- | ------: |
| MIT                                      |     274 |
| MIT OR Apache-2.0                        |       4 |
| Apache-2.0                               |      29 |
| LGPL-3.0-or-later                        |      10 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT |       1 |
| Apache-2.0 AND LGPL-3.0-or-later         |       3 |
| CC0-1.0                                  |       1 |
| 0BSD                                     |       2 |
| PSF-2.0                                  |       1 |
| BSD-2-Clause                             |       2 |
| ISC                                      |       4 |
| MPL-2.0                                  |      24 |
| BSD-3-Clause                             |       1 |

六個直接 runtime dependencies（`vue`／`@vue/server-renderer`／`hono`／`better-auth`／`markdown-it`／`vue3-carousel`）的 lockfile metadata 皆 MIT，已從安裝套件逐字保存其 license 全文至 `THIRD-PARTY-NOTICES.md`，並核對 installed version 與 lockfile。實際 client／Worker bundle 的轉依賴另外由建置流程產生 notices；lockfile 盤點不取代產物清單。

歷史建置曾發現 `@better-auth/utils@0.4.2` 的 npm 包及上游 `v0.4.2` tree 都沒有 LICENSE；[npm metadata](https://registry.npmjs.org/@better-auth/utils/0.4.2) 與 [固定 README](https://github.com/better-auth/utils/blob/b20329a32d78f1f9bcc088bbd6f982b28c4192f1/README.md) 明確聲明 MIT，author metadata 為 Bereket Engida。維護者兼法務當時核准保留此限定版本，依公開聲明補充標準 MIT 許可／免責全文於 [`scripts/third-party-licenses/better-auth-utils-0.4.2.txt`](../scripts/third-party-licenses/better-auth-utils-0.4.2.txt)。當時產物明確標示為本站補充，不偽稱上游原文、不補造 copyright 年份；此歷史補充檔及 attribution 繼續保留。目前 `@better-auth/utils@0.5.1` 已隨套件附帶上游 `LICENSE`（MIT，Copyright (c) 2024 - present, Bereket Engida），建置直接收集該原文，不再使用舊版補充例外；所有已打包套件仍須提供實際許可全文，缺漏即中止建置。

## 原始碼入口與操作限制

- footer 同時標示軟體 AGPL-3.0-only、意見摘要 CC-BY-SA 4.0 及素材原來源授權；提供固定 commit 的完整 archive 與該 commit 的 LICENSE。
- 兩個 Vite config 共用 Git-derived metadata。`CIVIC_SOURCE_REPOSITORY` 可覆蓋 origin，只接受不含憑證的 GitHub repository URL；沒有有效 Git metadata 或存在未提交的 tracked／untracked 來源時，不提供可能錯誤的固定版本連結。
- 建置輸出 `public/styles.css`、`public/licenses/{client,worker}.txt`、`public/civic-source-manifest.json` 不納入來源 dirty／identity 判斷；其餘來源（含 CSS source 與補充授權全文）仍須提交。兩份 Vite config 使用單次 runner 的 metadata snapshot；build 前後核對 Git diff 與 untracked 內容的 identity。
- `vp run deploy` 先 build，再核對實際 Worker／client／部署資產 metadata 與 hashes，匿名查核建置 commit 是否在指定公開 repository 的發布分支（預設 `main`）歷史上。先解析該 repository 的確切 `refs/heads/<branch>`，再以 ref 回傳的固定 SHA 比較，驗證 compare 的 `base_commit.sha` 與 `identical`／`ahead`；head 以請求 URL 鎖定，不使用不存在的 `head_commit` 或從有分頁限制的 `commits` 推斷。拒絕 SHA 冒充分支、他人 fork 的 `owner:ref`、tag／PR ref，避免 `forkSHA...forkSHA` 回傳 `identical` 而放行。不以 fork-network 的 commit 可讀作為充分依據；禁止直接 `wrangler deploy`／`versions upload` 繞過此流程。
- footer 永遠提供軟體授權條款，可靠 metadata 缺失時不偽造版本來源。完整 archive 包含 tracked 來源與設定範本；秘密與資料庫個資不公布。部署後仍須驗證頁尾可見性、免費下載、實際版本一致及 notices 可取得；技術檢查不是完整法律合規證明。

## 核准紀錄與發布門檻

- **已核准**：整體採 AGPL-3.0-only，保留 MIT 權利、原 notices 與歷史；未另行回覆者不視為同意。
- **已核准**：footer 的意見摘要 CC-BY-SA 4.0 屬現有條款範圍澄清，不撤銷既有合法許可。
- **已核准**：現有來源依據可支持合併，保留舊站、token、品牌圖像及外部服務的未查明限制；不補造不存在的許可。
- **已核准**：以 merge commit 合併；合併後建立 `v0.2.0` tag 指向該 commit。原 MIT tag 與 SHA 不移動。
- **需技術驗收**：型別、完整測試、production build、實際 bundle notices、footer 及來源發布分支／產物查核。
- **需發布時執行**：另經授權 commit／push／merge／建 tag；從乾淨公開版本重新建置，部署仍需獨立授權與正式站 smoke test。文件不聲稱上述遠端動作已完成。
- **獨立政策選項，未實施**：保護 MIT／AGPL release tags；DCO sign-off 或 AGPL §14 proxy。DCO 是貢獻授權紀錄，不等於任意調整未來授權的許可；此次不加入 proxy 或 or-later。

## 供顧問核對的原文

- [MIT 原文](https://opensource.org/license/mit)：保留著作權與許可 notice。
- [GNU AGPL v3 原文](https://www.gnu.org/licenses/agpl-3.0.txt)／[OSI 顯示版本](https://opensource.org/license/agpl-3-0)：第 1、5、7、13、14 節。
- [SPDX AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html)：version 3 only 識別。

這些連結及上方查核結果提供審閱材料，不代替法律顧問的結論。
