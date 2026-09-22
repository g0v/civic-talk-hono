-- migration 0012: 公民意見投票（issue #107）
-- 遠端套用需使用者明確授權（見 AGENTS.md 不變量 7）。
--
-- 票值沿用 pol.is／pocket-polis 的語意：1 同意、-1 不同意、0 略過。
-- 「略過」是刻意保留的選項，讓「看不懂／沒意見」有地方去，不會被迫歸成同意或不同意。
--
-- 一人一票由 PRIMARY KEY (opinion_id, voter_id) 保證，不倚賴應用層先查後寫——
-- 兩個平行請求會同時通過應用層檢查，只有資料庫的唯一性約束擋得住。改票走
-- INSERT ... ON CONFLICT DO UPDATE（見 src/db/queries.ts 的 upsertOpinionVote）。
--
-- 提議者的「當然贊成票」不寫進這張表（#107 Bestian 裁示）：投稿當下不補一筆投票列，
-- 而是在計數與顯示時，對 author_id 不為 NULL 的意見加一票贊成。既有資料因此不必回填。
CREATE TABLE IF NOT EXISTS ct_opinion_votes (
  opinion_id INTEGER NOT NULL,
  -- Better Auth user.id。投票不保存姓名／email 快照：投票不是具名投稿，
  -- 任何公開端點都不得回推投票者身分（CSV 匯出一律改用 p1、p2⋯ 代號）。
  voter_id TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (opinion_id, voter_id),
  FOREIGN KEY (opinion_id) REFERENCES ct_opinions(id) ON DELETE CASCADE
);

-- 逐則意見統計票數、以及 CSV 匯出依意見掃描時走索引。
CREATE INDEX IF NOT EXISTS idx_ct_opinion_votes_opinion ON ct_opinion_votes(opinion_id);
