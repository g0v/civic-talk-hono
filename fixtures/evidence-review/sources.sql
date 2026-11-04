-- 完全虛構、僅供本機 API 審閱的資料；不可套用至遠端資料庫。
-- 初始化前後由 setup 比對欄位；INSERT OR IGNORE 絕不覆寫既有內容。
INSERT OR IGNORE INTO ct_issues (id, title, description, status, abuse_flagged) VALUES
  (900013, '【虛構案例】社區圖書館週末開館', '此議題與素材均為合成資料，僅供本機證據草稿 API 審閱。', 'published', 0);

INSERT OR IGNORE INTO ct_materials (id, issue_id, source_name, source_url, stance, content, abuse_flagged) VALUES
  (900025, 900013, '虛構居民甲', 'https://example.invalid/evidence-review/900025', 'pro', '虛構居民甲支持延長社區圖書館週末開館時間，認為上班族和學生能有更多使用空間的機會；甲也認為應先公開估算人力與照明成本。', 0),
  (900026, 900013, '虛構居民乙', 'https://example.invalid/evidence-review/900026', 'con', '虛構居民乙擔心延長週末開館會增加人力負擔與夜間交通需求，建議先試辦並公布成本；乙同意應讓更多居民方便使用圖書館。', 0);

INSERT OR IGNORE INTO ct_evidence_review_fixture (id, version) VALUES (1, 1);
