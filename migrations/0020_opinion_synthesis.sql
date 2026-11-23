-- #113：只留匿名報告與不可退款的模型準入紀錄，不保存帳號／逐人投票或模型原始輸入。
CREATE TABLE ct_opinion_synthesis_attempts (
  issue_id INTEGER NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('zh-TW', 'en', 'ja')),
  revision TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd > 0),
  dispatched_at INTEGER,
  model_started_at INTEGER,
  generated_at INTEGER,
  report TEXT,
  PRIMARY KEY (issue_id, language, revision)
);

CREATE INDEX idx_ct_opinion_synthesis_started ON ct_opinion_synthesis_attempts(started_at);
CREATE INDEX idx_ct_opinion_synthesis_issue_started ON ct_opinion_synthesis_attempts(issue_id, language, started_at);

CREATE TABLE ct_opinion_synthesis_sources (
  issue_id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL
);

-- 來源撤下或修改後不保留可閱讀的生成正文。預留紀錄不能刪，避免重置額度。
CREATE TRIGGER ct_opinion_synthesis_opinion_removed AFTER DELETE ON ct_opinions
WHEN OLD.abuse_flagged = 0
BEGIN
  INSERT INTO ct_opinion_synthesis_sources (issue_id, version) VALUES (OLD.issue_id, 1)
  ON CONFLICT(issue_id) DO UPDATE SET version = version + 1;
  UPDATE ct_opinion_synthesis_attempts SET report = NULL WHERE issue_id = OLD.issue_id AND report IS NOT NULL;
END;

CREATE TRIGGER ct_opinion_synthesis_opinion_changed AFTER UPDATE OF summary, abuse_flagged ON ct_opinions
WHEN (OLD.abuse_flagged = 0 OR NEW.abuse_flagged = 0)
  AND (OLD.summary IS NOT NEW.summary OR OLD.abuse_flagged IS NOT NEW.abuse_flagged)
BEGIN
  INSERT INTO ct_opinion_synthesis_sources (issue_id, version) VALUES (OLD.issue_id, 1)
  ON CONFLICT(issue_id) DO UPDATE SET version = version + 1;
  UPDATE ct_opinion_synthesis_attempts SET report = NULL WHERE issue_id = OLD.issue_id AND report IS NOT NULL;
END;

CREATE TRIGGER ct_opinion_synthesis_issue_hidden AFTER UPDATE OF abuse_flagged ON ct_issues
WHEN NEW.abuse_flagged <> OLD.abuse_flagged
BEGIN
  INSERT INTO ct_opinion_synthesis_sources (issue_id, version) VALUES (OLD.id, 1)
  ON CONFLICT(issue_id) DO UPDATE SET version = version + 1;
  UPDATE ct_opinion_synthesis_attempts SET report = NULL WHERE issue_id = OLD.id AND report IS NOT NULL;
END;

CREATE TRIGGER ct_opinion_synthesis_issue_removed AFTER DELETE ON ct_issues
BEGIN
  INSERT INTO ct_opinion_synthesis_sources (issue_id, version) VALUES (OLD.id, 1)
  ON CONFLICT(issue_id) DO UPDATE SET version = version + 1;
  UPDATE ct_opinion_synthesis_attempts SET report = NULL WHERE issue_id = OLD.id AND report IS NOT NULL;
END;
