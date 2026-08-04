-- #9 延伸：議題與意見也記錄建立者／投稿者，才談得上問責。
--
-- 形狀與 0002 的 ct_materials 完全一致：author_id 是共用 auth DB（vtaiwan-auth）的
-- user.id，跨資料庫無法下 FOREIGN KEY；author_name 是當下的顯示名稱快照，讓管理端
-- 不必回查 auth DB。一樣不存 email（不變量 11：本 repo 不擁有使用者資料）。
--
-- 🚫 這兩組欄位**不對外公開**：ct_opinions 的意見在前台是公開顯示的，投稿者只給管理端。
-- 對應的查詢在 src/db/queries.ts 一律列舉公開欄位，不准 SELECT *。
--
-- 既有資料的這兩欄會是 NULL（需登入之前建立的議題與意見），這是預期狀態，不回填。

ALTER TABLE ct_issues ADD COLUMN author_id TEXT;
ALTER TABLE ct_issues ADD COLUMN author_name TEXT;

ALTER TABLE ct_opinions ADD COLUMN author_id TEXT;
ALTER TABLE ct_opinions ADD COLUMN author_name TEXT;

CREATE INDEX IF NOT EXISTS idx_ct_issues_author_id ON ct_issues(author_id);
CREATE INDEX IF NOT EXISTS idx_ct_opinions_author_id ON ct_opinions(author_id);
