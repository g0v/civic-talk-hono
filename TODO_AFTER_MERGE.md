# #183 後續驗收

API、正式 migration／啟用與專用環境清理已完成；**正式登入後的完整驗收尚未完成**，不再是清理前置。接下來分別由 [#166](https://github.com/g0v/civic-talk-hono/issues/166) 與 [#201](https://github.com/g0v/civic-talk-hono/issues/201) 追蹤；本清單不是付費、遠端寫入或清除資料的授權。

## 待辦：UI 與一般 API（#166）

- [ ] 完成一鍵彙整 UI 與 API 整合；詳細功能範圍依 #166，不把 API-only 交付當作 UI 已完成。
- [ ] 登入後驗證缺少同意、`consent:false` 或非 boolean true 回 `400 / invalid_request`，不讀來源、不建立工作或產生模型費用。先前正式測試僅提供指令，未執行。
- [ ] 另行確認帳號、指定來源、處理同意與新費用範圍，再驗建立／輪詢、快取／join、失敗與部分草稿、配額／冷卻／估算預算。
- [ ] 驗證一般登入者、停權者、owner／admin／non-owner 的私有資料隔離；只有 owner 可另存人工修訂，AI 原稿不覆寫、過時 parent 回 `409`。
- [ ] 驗證來源失效後停止交付、private／no-store，以及三語、桌機／手機、淺色／深色 UI；保留不含 Cookie、個資與私有正文的驗收紀錄。

## 待辦：管理維護（#201）

- [ ] 先核准環境、管理員／一般使用者帳號、來源與跨相依工作的處置範圍；不拿真實議題 13／素材 25、26、27 作破壞性測試。
- [ ] 實測 reconcile／erase 的管理員成功與非管理員拒絕、來源撤下／刪除、Workflow 明確終態與 queued 恢復；失聯／unknown 不當作終止，不重跑付費模型。
- [ ] 驗證按來源跨工作／申請者清除私有 payload／人改 diff 與競態保護，同時保留來源業務資料、帳號 ID、hash、同意、usage、unknown 與永久 tombstone；來源 ID 不可重新入場。

**操作提醒：** 有效 evidence GET／建立／修訂也可能對帳來源、恢復 queued 工作，或清除已刪來源的私有 payload，不能當作純唯讀試打。付費模型與有效維護操作仍須各別授權；既有品質實驗成功不必為確認成功而重跑。完整端點、費用、留存與清除限制見 [API 手冊](./docs/evidence-api-review.md)。

## 已完成摘要

- PR #191 API-only 管線已合併；原始 `0017_evidence_pipeline.sql` 已套用正式業務庫，v5 告知與 `EVIDENCE_API_ENABLED=1` 已發布。使用者曾確認六 API 匿名 `401`、跨站簡單 POST `403` 與管理員登入身分；不代表上述登入後功能已驗。
- 清理提交 [`cc86644`](https://github.com/g0v/civic-talk-hono/commit/cc8664476e8fcd0606bd20c82eed9ee4192f4763) 已由使用者手動推送；專用 profiles／入口／CLI／fixtures／專屬測試已移除。當時 typecheck、589 項測試、build、23 項本機 HTTP smoke 及提交後來源產物查核通過。**推送不等於部署**；目前沒有該清理版已部署的回報。
- 正式 AI／Workflow／開關 `1`、所有保護、原始 0017／ledger、[公開結果](./results/ai-experiment_result.json)與[費用報告](./results/ai-experiment_cost.json)、[歷史紀錄](./Insight.md)及私有 `.wrangler` 資料保留；未刪遠端資源、清庫或重設 quota／unknown／tombstone。歷史發布與 migration 證據見[部署須知](./deploy_notes.md)。

[`Issues.md`](./Issues.md) 原有的素材投稿上限與再彙整 UI 調整仍屬另案；#9 的四類投稿完整作者快照及管理端快照，也尚未逐項正式驗證。
