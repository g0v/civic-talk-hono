-- migration 0012: 公民意見投票（issue #107）
-- 新增 ct_opinion_votes 表；一人對同一則意見最多一票，可改票（ON CONFLICT UPDATE）。
-- 遠端套用需使用者明確授權（見 AGENTS.md 不變量 7）。
--
-- 語意（依 plan.md 權威決策）：
--   value：1 = 同意、-1 = 不同意、0 = 略過（Polis 三態）。
--   UNIQUE(opinion_id, voter_id) 是平行請求下一人一票的最後防線。
--   作者的虛擬同意票不落表——由查詢層以 ct_opinions.author_id 即時計算，
--   不回填任何既有意見或投票。
--
-- 這裡不宣告 FOREIGN KEY：既有手動 cascade 慣例（deleteOpinion／deleteIssueCascade
-- 先刪投票列再刪內容），不假設 D1 已啟用 foreign key cascade。

CREATE TABLE IF NOT EXISTS ct_opinion_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  opinion_id INTEGER NOT NULL,
  voter_id   TEXT    NOT NULL,
  value      INTEGER NOT NULL CHECK (value IN (-1, 0, 1)),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(opinion_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_ct_opinion_votes_opinion ON ct_opinion_votes(opinion_id);
CREATE INDEX IF NOT EXISTS idx_ct_opinion_votes_voter   ON ct_opinion_votes(voter_id);
