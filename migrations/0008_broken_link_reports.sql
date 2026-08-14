-- migration 0008: 素材連結失效回報（issue #22）
-- 重建 ct_abuse_reports，新增 reason='broken_link' 與 review_status='resolved_broken'。
-- 目前表內均為測試資料，DROP 安全；遠端套用需授權（見 AGENTS.md 不變量 7）。

DROP TABLE IF EXISTS ct_abuse_reports;

CREATE TABLE ct_abuse_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id    TEXT    NOT NULL,
  reporter_name  TEXT,
  reporter_email TEXT    NOT NULL,
  reason         TEXT    NOT NULL CHECK (reason IN ('spam', 'hate_speech', 'defamation', 'misinformation', 'other', 'broken_link')),
  description    TEXT,
  material_id    INTEGER REFERENCES ct_materials(id) ON DELETE CASCADE,
  briefing_id    INTEGER REFERENCES ct_briefings(id) ON DELETE CASCADE,
  opinion_id     INTEGER REFERENCES ct_opinions(id)  ON DELETE CASCADE,
  review_status  TEXT    NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'resolved_false', 'resolved_abuse', 'resolved_broken')),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK ((material_id IS NOT NULL) + (briefing_id IS NOT NULL) + (opinion_id IS NOT NULL) = 1)
);

CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_material ON ct_abuse_reports(material_id);
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_briefing ON ct_abuse_reports(briefing_id);
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_opinion  ON ct_abuse_reports(opinion_id);
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_status   ON ct_abuse_reports(review_status);
CREATE INDEX IF NOT EXISTS idx_ct_abuse_reports_created  ON ct_abuse_reports(created_at);
