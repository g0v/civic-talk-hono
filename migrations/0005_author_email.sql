-- #27：完整保存內容建立當下的作者快照，公開 API 再依 show_email 選擇欄位。
--
-- author_email 無論是否公開都保存，供濫用追溯；show_email 才是公開同意。
-- SQLite 以 INTEGER 表示 boolean，並以 CHECK 防止寫入 0／1 以外的值。
ALTER TABLE ct_materials ADD COLUMN author_email TEXT;
ALTER TABLE ct_opinions  ADD COLUMN author_email TEXT;
ALTER TABLE ct_issues    ADD COLUMN author_email TEXT;

ALTER TABLE ct_materials ADD COLUMN show_email INTEGER NOT NULL DEFAULT 0 CHECK (show_email IN (0, 1));
ALTER TABLE ct_opinions  ADD COLUMN show_email INTEGER NOT NULL DEFAULT 0 CHECK (show_email IN (0, 1));
ALTER TABLE ct_issues    ADD COLUMN show_email INTEGER NOT NULL DEFAULT 0 CHECK (show_email IN (0, 1));

-- briefing 在 0004 已有 author_id；作者目前不公開，但仍保存完整快照供稽核。
ALTER TABLE ct_briefings ADD COLUMN author_name TEXT;
ALTER TABLE ct_briefings ADD COLUMN author_email TEXT;
ALTER TABLE ct_briefings ADD COLUMN show_email INTEGER NOT NULL DEFAULT 0 CHECK (show_email IN (0, 1));
