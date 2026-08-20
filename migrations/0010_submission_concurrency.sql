-- migration 0010: 投稿版號與使用者回報去重的併發保護
-- 遠端套用需使用者明確授權（見 AGENTS.md 不變量 7）。

-- 歷史上若有競態造成的重複版號，依原版號與建立順序重編；版號只表示同一議題的
-- 時序，不改變 briefing 內容或 created_at。
WITH ranked_briefings AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY issue_id ORDER BY version, id) AS next_version
  FROM ct_briefings
)
UPDATE ct_briefings
SET version = (SELECT next_version FROM ranked_briefings WHERE ranked_briefings.id = ct_briefings.id)
WHERE version <> (SELECT next_version FROM ranked_briefings WHERE ranked_briefings.id = ct_briefings.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_briefings_issue_version
  ON ct_briefings(issue_id, version);

-- 既有 pending 回報保留 NULL key，避免 migration 因歷史重複資料失敗；新回報一律
-- 帶 target key，並由 partial unique index 防止平行請求建立第二筆 pending 回報。
ALTER TABLE ct_abuse_reports ADD COLUMN pending_target_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_abuse_reports_pending_target
  ON ct_abuse_reports(pending_target_key)
  WHERE pending_target_key IS NOT NULL;
