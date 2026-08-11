-- #27：保存建立議題、投稿素材與意見時接受的條款版本與時間。
--
-- 舊資料未經這套伺服器端同意流程，因此維持 NULL，不推定使用者曾接受。
ALTER TABLE ct_issues ADD COLUMN terms_version TEXT;
ALTER TABLE ct_issues ADD COLUMN terms_accepted_at TEXT;

ALTER TABLE ct_materials ADD COLUMN terms_version TEXT;
ALTER TABLE ct_materials ADD COLUMN terms_accepted_at TEXT;

ALTER TABLE ct_opinions ADD COLUMN terms_version TEXT;
ALTER TABLE ct_opinions ADD COLUMN terms_accepted_at TEXT;
