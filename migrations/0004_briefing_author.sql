-- 志願者送出的彙整／說明頁也必須可追溯到建立帳號。
--
-- author_id 是共用 auth DB（vtaiwan-auth）的 user.id。跨資料庫無法下 FOREIGN KEY，
-- 且不存 email 或顯示名稱，避免把作者身分帶進公開的 briefing API 與 SSR 狀態。
-- 既有 briefing 的 author_id 為 NULL，預期且不回填。

ALTER TABLE ct_briefings ADD COLUMN author_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ct_briefings_author_id ON ct_briefings(author_id);
