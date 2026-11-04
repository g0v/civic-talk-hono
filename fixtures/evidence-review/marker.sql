-- 僅用於隔離的本機來源 D1，記錄首次初始化完成；絕不覆寫或清除。
CREATE TABLE IF NOT EXISTS ct_evidence_review_fixture (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version = 1)
);
