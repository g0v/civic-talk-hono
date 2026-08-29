-- migration 0011: 議題最新活動時間欄位（issue #77）
-- 遠端套用需使用者明確授權（見 AGENTS.md 不變量 7）。
--
-- #77 首頁「最新」排序需要議題層級的 last_activity_at。先前的 COALESCE 子查詢版
-- 抓不到 updateLatestBriefing()（原地 UPDATE 不產生新列），改為由四個寫入路徑
-- （createMaterial／createOpinion／createBriefing／updateLatestBriefing）同步維護的
-- ct_issues 欄位。
--
-- 語意：NULL 表示尚無任何子內容活動（含新建議題），讀取層統一以
-- COALESCE(last_activity_at, created_at) fallback，SQL 端不做 fallback。
-- 回填取三類子內容（abuse_flagged IN (0, 1)，與公開查詢口徑一致）的最新
-- created_at；完全沒有子內容的議題維持 NULL，不回填 created_at。
-- abuse_flagged = 3 的議題列一併回填（管理端可見，行為一致）。

ALTER TABLE ct_issues ADD COLUMN last_activity_at DATETIME;

UPDATE ct_issues
SET last_activity_at = (
  SELECT MAX(t) FROM (
    SELECT created_at AS t FROM ct_materials
      WHERE ct_materials.issue_id = ct_issues.id AND ct_materials.abuse_flagged IN (0, 1)
    UNION ALL
    SELECT created_at AS t FROM ct_opinions
      WHERE ct_opinions.issue_id = ct_issues.id AND ct_opinions.abuse_flagged IN (0, 1)
    UNION ALL
    SELECT created_at AS t FROM ct_briefings
      WHERE ct_briefings.issue_id = ct_issues.id AND ct_briefings.abuse_flagged IN (0, 1)
  )
);
