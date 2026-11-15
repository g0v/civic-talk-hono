# 共用元件指引

## OVERVIEW
評分 9（檔數 3、程式比例 2、符號 2、匯出 2；引用未量測給 0）；安全編輯、長文授權顯示與共用導覽組成獨立 UI 邊界。

## WHERE TO LOOK
| 工作 | 來源 |
|---|---|
| 導覽／登入／偏好 | `AppHeader.vue`、`SignInButtons.vue`、`ViewerRoleSwitch.vue`、`LanguageSwitcher.vue` |
| 來源與 notices | `AppFooter.vue`、`SourceLicenseLinks.vue` |
| 編輯／長文 | `MarkdownEditor.vue`、`LongTextContent.vue` |
| 作者／卡片 | `AuthorEmailLink.vue`、`IssueCard.vue`、`IssuePreviewCard.vue` |
| 意見投票 | `OpinionVote.vue` |
| 私有摘要 UI | `EvidenceSummary.vue`、`../client/evidenceSummary.ts`、`../views/Issue.vue` |
| 設計來源 | `../styles/app.css`、`../../../vtaiwan-design-system/project/colors_and_type.css` |

## CONVENTIONS
- 以現有 vt-*／Tailwind utilities 與 app.css token 組合，不硬寫顏色、字級、間距；新 token 先定義。
- 不加 SFC `<style>`：目前正式 HTML 不載入抽出 CSS，dev 有效不是 production 證據；接入 CSS 為另需確認的結構改動。
- LongTextContent 超過門檻時完全不輸出原文，只留字數／展開；素材詳情／管理審閱保留全文。
- MarkdownEditor 沿用 renderSafeMarkdown，不另開 parser、raw HTML 或圖片。
- textarea 用 writable computed 的原生 v-model；組字期間只保留 textarea 暫存，不更新投稿 model／計數／預覽，compositionend 才提交。
- Markdown 預覽 trim 後 render，與送出一致，但不改草稿、計數、內文縮排；純文字預覽不 trim。
- 保留編輯／預覽切換、鍵盤 focus、延後 aria-live 播報；字數以 Unicode code points 計。
- 簡介超過 300 停用送出，縮短後恢復；全文保留且不設 maxlength；事實查核中／完成後維持 readonly。
- 公開 opt-in email 用 AuthorEmailLink 信封 mailto，不明碼顯示，無障礙名稱不放地址。
- 地址仍在 href／SSR state，這不是防爬措施；卡片不可巢狀 `<a>`，避免 hydration mismatch。
- 麥穗黃一鍵彙整、同意與進度／結果元件只在 import.meta.env.DEV 掛載（含 dev:remote）。
- production 不掛整個新元件、不查狀態／輪詢／debug log；不能只 CSS 隱藏，不能用 MODE 名稱判斷。
- 此 UI 閘門不改後端開關，舊 BYO 保留；新版報告排版與既有摘要工作不可混為自動發布。
- 完整成功且確認已保存，或 partial_draft 有可交付 data，暫在操作者瀏覽器 console.log data；partial 供排查不代表保存。
- 此特定 log 不送伺服器／公開驗收，不擴大到其他私人內容。

## ANTI-PATTERNS
- 不截短預覽或摘要 CC BY-NC-ND 素材；折疊不能只 CSS 蓋住正文。
- 不用裸 :value/@input 取代原生 v-model，不在 IME 中途送出半成品計數／預覽。
- 不把 UI disabled／checkbox 當後端授權或投稿同意檢查。
- 不刪 footer 的原始碼與 notices 入口，不把移動中的分支 URL 當固定建置來源。
