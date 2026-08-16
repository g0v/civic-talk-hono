-- migration 0009: AI 投稿審查、違規快照與申訴（issue #29）
-- 只建立／改動 ct_ 前綴資料表；遠端套用需使用者另行授權。
-- 0008 已重建過 ct_abuse_reports，但這次需要保存 AI 來源與沒有公開目標列的投稿快照，
-- 因此以新表搬移既有回報資料，避免對共用 auth DB 做任何寫入。

PRAGMA foreign_keys = OFF;

CREATE TABLE ct_abuse_reports_new (
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
  CHECK ((material_id IS NOT NULL) + (briefing_id IS NOT NULL) + (opinion_id IS NOT NULL) = 1 OR (source = 'ai' AND submission_type IS NOT NULL AND target_user_id IS NOT NULL)),
  CHECK (source = 'user' OR policy_code IS NOT NULL)
);

INSERT INTO ct_abuse_reports_new (
  id, reporter_id, reporter_name, reporter_email, reason, description,
  material_id, briefing_id, opinion_id, review_status, created_at,
  source, policy_code, submission_type, content_snapshot, target_user_id
)
SELECT
  id, reporter_id, reporter_name, reporter_email, reason, description,
  material_id, briefing_id, opinion_id, review_status, created_at,
  'user', NULL, NULL, NULL, NULL
FROM ct_abuse_reports;

DROP TABLE ct_abuse_reports;
ALTER TABLE ct_abuse_reports_new RENAME TO ct_abuse_reports;

CREATE INDEX idx_ct_abuse_reports_material ON ct_abuse_reports(material_id);
CREATE INDEX idx_ct_abuse_reports_briefing ON ct_abuse_reports(briefing_id);
CREATE INDEX idx_ct_abuse_reports_opinion  ON ct_abuse_reports(opinion_id);
CREATE INDEX idx_ct_abuse_reports_status   ON ct_abuse_reports(review_status);
CREATE INDEX idx_ct_abuse_reports_created  ON ct_abuse_reports(created_at);
CREATE INDEX idx_ct_abuse_reports_source   ON ct_abuse_reports(source);
CREATE INDEX idx_ct_abuse_reports_policy   ON ct_abuse_reports(policy_code);
CREATE INDEX idx_ct_abuse_reports_target_user ON ct_abuse_reports(target_user_id);

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

CREATE INDEX idx_ct_moderation_appeals_user ON ct_moderation_appeals(user_id);
CREATE INDEX idx_ct_moderation_appeals_report ON ct_moderation_appeals(abuse_report_id);
CREATE INDEX idx_ct_moderation_appeals_status ON ct_moderation_appeals(status);
CREATE INDEX idx_ct_moderation_appeals_created ON ct_moderation_appeals(created_at);

PRAGMA foreign_keys = ON;
