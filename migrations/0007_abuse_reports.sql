-- migration 0007: 濫用回報管道（issue #21）
-- 新增 ct_abuse_reports 表；三種內容表加上 abuse_flagged 旗標欄位。
-- 遠端套用需授權（見 AGENTS.md 不變量 7）。

CREATE TABLE IF NOT EXISTS ct_abuse_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id    TEXT    NOT NULL,
  reporter_name  TEXT,
  reporter_email TEXT    NOT NULL,
  reason         TEXT    NOT NULL CHECK (reason IN ('spam', 'hate_speech', 'defamation', 'misinformation', 'other')),
  description    TEXT,
  material_id    INTEGER REFERENCES ct_materials(id) ON DELETE CASCADE,
  briefing_id    INTEGER REFERENCES ct_briefings(id) ON DELETE CASCADE,
  opinion_id     INTEGER REFERENCES ct_opinions(id)  ON DELETE CASCADE,
  review_status  TEXT    NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'resolved_false', 'resolved_abuse')),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK ((material_id IS NOT NULL) + (briefing_id IS NOT NULL) + (opinion_id IS NOT NULL) = 1)
);

CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_material ON ct_abuse_reports(material_id);
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_briefing ON ct_abuse_reports(briefing_id);
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_opinion  ON ct_abuse_reports(opinion_id);
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_status   ON ct_abuse_reports(review_status);
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_created  ON ct_abuse_reports(created_at);

-- 第 1 次回報即打標（abuse_flagged = 1）；前台折疊顯示
ALTER TABLE ct_materials ADD COLUMN abuse_flagged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ct_briefings ADD COLUMN abuse_flagged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ct_opinions  ADD COLUMN abuse_flagged INTEGER NOT NULL DEFAULT 0;
