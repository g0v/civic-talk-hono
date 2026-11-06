-- #183 實驗資料僅寫入隔離的本機業務 D1；來源與認證庫不設外鍵。
CREATE TABLE ct_ai_source_fences (
  namespace TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'material')),
  source_id INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  erased_at TEXT,
  reason_code TEXT,
  PRIMARY KEY (namespace, kind, source_id)
);

CREATE TABLE ct_ai_executions (
  id TEXT PRIMARY KEY,
  input_key TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL,
  issue_id INTEGER NOT NULL,
  charged_owner_id TEXT NOT NULL,
  language TEXT NOT NULL,
  manifest TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'extracting', 'comparing', 'generating', 'ai_draft', 'partial_draft', 'failed', 'withdrawn', 'erased')),
  error_code TEXT,
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_day TEXT NOT NULL
);
CREATE INDEX idx_ct_ai_executions_quota ON ct_ai_executions(charged_owner_id, created_day);

CREATE TABLE ct_ai_sources (
  execution_id TEXT NOT NULL REFERENCES ct_ai_executions(id),
  namespace TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'material')),
  source_id INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  generation INTEGER NOT NULL,
  payload TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (execution_id, kind, source_id),
  FOREIGN KEY (namespace, kind, source_id) REFERENCES ct_ai_source_fences(namespace, kind, source_id)
);
CREATE INDEX idx_ct_ai_sources_lookup ON ct_ai_sources(namespace, kind, source_id, execution_id);

CREATE TABLE ct_ai_jobs (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES ct_ai_executions(id),
  owner_id TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (execution_id, owner_id)
);
CREATE INDEX idx_ct_ai_jobs_owner ON ct_ai_jobs(owner_id, created_at);

CREATE TABLE ct_ai_issue_cooldowns (
  namespace TEXT NOT NULL,
  issue_id INTEGER NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (namespace, issue_id)
);

CREATE TABLE ct_ai_usage (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES ct_ai_executions(id),
  step_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  started_day TEXT NOT NULL,
  estimate_micro_usd INTEGER NOT NULL CHECK (estimate_micro_usd > 0),
  actual_micro_usd INTEGER CHECK (actual_micro_usd IS NULL OR actual_micro_usd >= 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'started', 'unknown', 'settled')),
  settled_at TEXT,
  UNIQUE (execution_id, step_key)
);
CREATE INDEX idx_ct_ai_usage_budget ON ct_ai_usage(started_day, state);

CREATE TABLE ct_ai_artifacts (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES ct_ai_executions(id),
  attempt_id TEXT REFERENCES ct_ai_usage(id),
  kind TEXT NOT NULL CHECK (kind IN ('raw', 'extraction', 'comparison', 'generation', 'diagnostics')),
  payload TEXT,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ct_ai_artifacts_execution ON ct_ai_artifacts(execution_id, created_at);
CREATE UNIQUE INDEX idx_ct_ai_artifacts_raw_attempt ON ct_ai_artifacts(attempt_id) WHERE kind = 'raw';

CREATE TABLE ct_ai_revisions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ct_ai_jobs(id),
  parent_id TEXT NOT NULL,
  editor_id TEXT NOT NULL,
  payload TEXT,
  payload_hash TEXT NOT NULL,
  diff TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, parent_id)
);
CREATE INDEX idx_ct_ai_revisions_job ON ct_ai_revisions(job_id, created_at);
