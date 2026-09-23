-- migration 0013: 熱門讀取路徑的複合／partial indexes
-- 遠端套用需使用者明確授權（見 AGENTS.md 不變量 7）。
--
-- 保留既有索引：本 migration 只補上能由目前查詢直接使用、且已用
-- EXPLAIN QUERY PLAN 驗證可避免暫存排序或全表掃描的索引。

-- 議題詳情與管理端皆會依 issue_id 取列表並按時間排序；id 作為同秒資料的
-- deterministic tie-breaker，查詢可沿索引順序直接讀取。
CREATE INDEX IF NOT EXISTS idx_ct_materials_issue_created
  ON ct_materials(issue_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ct_opinions_issue_created
  ON ct_opinions(issue_id, created_at DESC, id DESC);

-- RSS 只收錄可公開的素材。Partial index 不替 abuse_flagged = 2／3 的列付出
-- 儲存與後續維護成本，並讓最新 20 筆不必掃描、排序整張素材表。
CREATE INDEX IF NOT EXISTS idx_ct_materials_rss_visible_created
  ON ct_materials(created_at DESC, id DESC)
  WHERE abuse_flagged IN (0, 1);

-- 使用者申訴頁只讀自己的 pending AI 審查結果；把固定 predicate 留在
-- partial index，索引內容只涵蓋仍需處理的資料。
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_pending_ai_user_created
  ON ct_abuse_reports(target_user_id, created_at DESC)
  WHERE source = 'ai' AND review_status = 'pending';

-- pending 申訴去重與 NOT EXISTS 都同時使用 user_id、abuse_report_id、status。
-- Partial index 會在申訴結案後自動移除該筆索引項目。
CREATE INDEX IF NOT EXISTS idx_ct_moderation_appeals_pending_user_report
  ON ct_moderation_appeals(user_id, abuse_report_id)
  WHERE status = 'pending';

PRAGMA optimize;
