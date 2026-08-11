-- #27：使用者提交時可選擇公開 email（opt-in）
-- NULL = 未選擇公開；非 NULL = 使用者同意公開的 email 快照
ALTER TABLE ct_materials ADD COLUMN author_email TEXT;
ALTER TABLE ct_opinions  ADD COLUMN author_email TEXT;
ALTER TABLE ct_issues    ADD COLUMN author_email TEXT;
