# #113 意見綜整：近端目視資料

以下資料全部為合成內容，只可套用到**新建且獨立的本機業務 D1**。不寫認證庫、不需要帳號、不使用 `dev:remote` 或 `--remote`，不開啟 Workers AI。從 repository 根目錄執行：

```bash
QA_DB=$(mktemp -d "${TMPDIR:-/tmp}/civic-talk-113.XXXXXX")
vp exec wrangler d1 migrations apply vtaiwan-civic-talks \
  --local --config wrangler.jsonc --persist-to "$QA_DB"
vp exec wrangler d1 execute vtaiwan-civic-talks \
  --local --config wrangler.jsonc --persist-to "$QA_DB" \
  --file scripts/fixtures/opinion-synthesis-demo.sql
vp run build
CIVIC_LOCAL_D1_PATH="$QA_DB" CIVIC_LOCAL_OPINION_SYNTHESIS=1 \
  vp dev --host 127.0.0.1 --port 5179 --strictPort
```

不需要改 `wrangler.jsonc` 或 `.dev.vars`。`CIVIC_LOCAL_*` 只對一般 `vp dev` 生效。資料使用明確 ID；不用 `OR REPLACE`，遇到既有 ID 就報錯，不應套用到日常開發資料庫。

若這份工作區已交付 `.wrangler/issue-113-demo`，不要重複灌資料；啟動時直接用 `CIVIC_LOCAL_D1_PATH=.wrangler/issue-113-demo`。

## 目視清單

| 本機網址 | 預期 |
| --- | --- |
| `http://127.0.0.1:5179/issues/11301?step=comments&action=browse&view=synthesis` | 八人達標、兩群各四人；群組圖、共識／分歧，以及有清楚標記的三語合成快取報告。點引用可回到公開意見。 |
| `http://127.0.0.1:5179/issues/11302?step=comments&action=browse&view=synthesis` | 只有三位達標；顯示投票、提出意見入口，不應有群組圖或報告。 |
| `http://127.0.0.1:5179/issues/11303?step=comments&action=browse&view=synthesis` | 四人分為兩個小群；不可顯示小群座標或跨群立場，不能生成 AI 報告。 |

用瀏覽器切換「逐則投票／列表／意見綜整」，再前進、返回、重整；確認網址還原。一般本機開發刻意停用 OAuth，匿名畫面不應顯示本人群別；會員隔離由 API 回歸另外驗證。

報告快取是用同一綜整程式搭配合成的模型回應建立，不是 Gemma 實際推論。若改動投票使證據改變，舊快取會失效；可以用此確認資料不同時不再呈現舊報告。

驗完先用 `Ctrl+C` 關閉伺服器，只清理本次新建的 `$QA_DB`。如果這份演示資料提交在 PR 中，請先撤銷**單獨的合成資料 commit**再 approve；不必回退功能 commit。
