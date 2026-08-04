-- #9 素材必須登入才能提交：記錄投稿者，以便濫用時可追溯與究責。
--
-- author_id 是共用 auth DB（vtaiwan-auth）的 user.id。跨資料庫無法下 FOREIGN KEY，
-- 也刻意不存 email——需要對應到真人時由 vTaiwan 後台查 user.id 即可（不變量 11：
-- 本 repo 只讀 auth DB，不擁有使用者資料）。author_name 是投稿當下的顯示名稱快照，
-- 讓管理端不必回查 auth DB 就能辨識投稿者。
--
-- 既有資料的這兩欄會是 NULL（#9 之前的匿名投稿），這是預期狀態，不回填。

ALTER TABLE ct_materials ADD COLUMN author_id TEXT;
ALTER TABLE ct_materials ADD COLUMN author_name TEXT;

CREATE INDEX IF NOT EXISTS idx_ct_materials_author_id ON ct_materials(author_id);
