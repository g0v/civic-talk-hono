-- migration 0011: 收緊 AI 回報不得帶公開內容目標（issue #29 review）
-- 0009 的 AI 分支曾允許 target id 欄位帶值；AI 回報只保存私有快照，三個公開目標
-- 必須全部為 NULL。此 migration 以 ct_ 暫存表重建兩張互相有 FK 的業務表，
-- 先移除子表再移除父表；不要依賴 transaction 內 PRAGMA foreign_keys 的行為。

CREATE TABLE ct_abuse_reports_backup AS SELECT * FROM ct_abuse_reports;
CREATE TABLE ct_moderation_appeals_backup AS SELECT * FROM ct_moderation_appeals;

DROP TABLE ct_moderation_appeals;
DROP TABLE ct_abuse_reports;

CREATE TABLE ct_abuse_reports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id       TEXT    NOT NULL,
  reporter_name     TEXT,
  reporter_email    TEXT    NOT NULL,
  reason            TEXT    NOT NULL CHECK (reason IN ('spam', 'hate_speech', 'defamation', 'misinformation', 'other', 'broken_link')),
  description       TEXT,
  material_id       INTEGER REFERENCES ct_materials(id) ON DELETE CASCADE,
  briefing_id       INTEGER REFERENCES ct_briefings(id) ON DELETE CASCADE,
  opinion_id        INTEGER REFERENCES ct_opinions(id)  ON DELETE CASCADE,
  review_status     TEXT    NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'resolved_false', 'resolved_abuse', 'resolved_broken')),
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  source            TEXT    NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai')),
  policy_code       TEXT    CHECK (policy_code IS NULL OR policy_code IN ('spam', 'sexual_content', 'hate_speech', 'defamation', 'misinformation', 'illegal')),
  submission_type   TEXT    CHECK (submission_type IS NULL OR submission_type IN ('issue', 'material', 'opinion', 'briefing')),
  content_snapshot  TEXT,
  target_user_id    TEXT,
  CHECK (
    ((material_id IS NOT NULL) + (briefing_id IS NOT NULL) + (opinion_id IS NOT NULL) = 1)
    OR (source = 'ai' AND material_id IS NULL AND briefing_id IS NULL AND opinion_id IS NULL AND submission_type IS NOT NULL AND target_user_id IS NOT NULL)
  ),
  CHECK (source = 'user' OR policy_code IS NOT NULL)
);

INSERT INTO ct_abuse_reports (
  id, reporter_id, reporter_name, reporter_email, reason, description,
  material_id, briefing_id, opinion_id, review_status, created_at,
  source, policy_code, submission_type, content_snapshot, target_user_id
)
SELECT
  id, reporter_id, reporter_name, reporter_email, reason, description,
  material_id, briefing_id, opinion_id, review_status, created_at,
  source, policy_code, submission_type, content_snapshot, target_user_id
FROM ct_abuse_reports_backup;

DROP TABLE ct_abuse_reports_backup;

CREATE TABLE ct_moderation_appeals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT    NOT NULL,
  user_name         TEXT,
  user_email        TEXT    NOT NULL,
  abuse_report_id   INTEGER REFERENCES ct_abuse_reports(id) ON DELETE SET NULL,
  appeal_type       TEXT    NOT NULL CHECK (appeal_type IN ('rejected_submission', 'automatic_ban')),
  content_snapshot  TEXT,
  message           TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'overturned')),
  admin_id          TEXT,
  admin_name        TEXT,
  review_note       TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at       DATETIME,
  CHECK (appeal_type = 'automatic_ban' OR abuse_report_id IS NOT NULL)
);

INSERT INTO ct_moderation_appeals (
  id, user_id, user_name, user_email, abuse_report_id, appeal_type,
  content_snapshot, message, status, admin_id, admin_name, review_note,
  created_at, reviewed_at
)
SELECT
  id, user_id, user_name, user_email, abuse_report_id, appeal_type,
  content_snapshot, message, status, admin_id, admin_name, review_note,
  created_at, reviewed_at
FROM ct_moderation_appeals_backup;

DROP TABLE ct_moderation_appeals_backup;

CREATE INDEX idx_ct_abuse_reports_material ON ct_abuse_reports(material_id);
CREATE INDEX idx_ct_abuse_reports_briefing ON ct_abuse_reports(briefing_id);
CREATE INDEX idx_ct_abuse_reports_opinion  ON ct_abuse_reports(opinion_id);
CREATE INDEX idx_ct_abuse_reports_status   ON ct_abuse_reports(review_status);
CREATE INDEX idx_ct_abuse_reports_created  ON ct_abuse_reports(created_at);
CREATE INDEX idx_ct_abuse_reports_source   ON ct_abuse_reports(source);
CREATE INDEX idx_ct_abuse_reports_policy   ON ct_abuse_reports(policy_code);
CREATE INDEX idx_ct_abuse_reports_target_user ON ct_abuse_reports(target_user_id);

CREATE INDEX idx_ct_moderation_appeals_user ON ct_moderation_appeals(user_id);
CREATE INDEX idx_ct_moderation_appeals_report ON ct_moderation_appeals(abuse_report_id);
CREATE INDEX idx_ct_moderation_appeals_status ON ct_moderation_appeals(status);
CREATE INDEX idx_ct_moderation_appeals_created ON ct_moderation_appeals(created_at);
