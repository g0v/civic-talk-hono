-- migration 0010: AI 違規達門檻後的停權建議（issue #29）
-- Better Auth banUser 需要管理員 session；本表只保存本專案的待複核建議，
-- 不直接寫入 DB_AUTH。實際停權由管理員確認時呼叫 Better Auth admin plugin 完成。

CREATE TABLE ct_moderation_suspension_recommendations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            TEXT    NOT NULL,
  user_name          TEXT,
  user_email         TEXT    NOT NULL,
  violation_count    INTEGER NOT NULL CHECK (violation_count >= 3),
  window_started_at  DATETIME NOT NULL,
  status             TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  admin_id           TEXT,
  admin_name         TEXT,
  resolution_note    TEXT,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at        DATETIME
);

CREATE UNIQUE INDEX idx_ct_moderation_suspension_pending_user
  ON ct_moderation_suspension_recommendations(user_id)
  WHERE status = 'pending';
CREATE INDEX idx_ct_moderation_suspension_status
  ON ct_moderation_suspension_recommendations(status);
CREATE INDEX idx_ct_moderation_suspension_created
  ON ct_moderation_suspension_recommendations(created_at);
