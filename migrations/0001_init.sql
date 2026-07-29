-- Civic Talk initial schema（一律 ct_ 前綴，避免與 vTaiwan 命名空間內其他表衝突）

CREATE TABLE IF NOT EXISTS ct_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'collecting'
    CHECK (status IN ('collecting', 'summarizing', 'published')),
  polis_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ct_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  source_name TEXT,
  source_url TEXT,
  stance TEXT NOT NULL DEFAULT 'unknown'
    CHECK (stance IN ('pro', 'con', 'neutral', 'unknown')),
  content TEXT NOT NULL,
  verified_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES ct_issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ct_briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  consensus TEXT,
  disputes TEXT,
  positions TEXT,
  narrative TEXT,
  opinion_prompt TEXT,
  version INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES ct_issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ct_opinions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES ct_issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ct_materials_issue_id ON ct_materials(issue_id);
CREATE INDEX IF NOT EXISTS idx_ct_briefings_issue_id ON ct_briefings(issue_id);
CREATE INDEX IF NOT EXISTS idx_ct_opinions_issue_id ON ct_opinions(issue_id);
CREATE INDEX IF NOT EXISTS idx_ct_issues_status ON ct_issues(status);
CREATE INDEX IF NOT EXISTS idx_ct_issues_created_at ON ct_issues(created_at);

-- 示範資料（對齊舊 civic-talk schema.sql）
INSERT INTO ct_issues (title, description, status) VALUES
  ('核能重啟爭議', '台灣核電廠是否應重新啟動？涵蓋能源安全、氣候變遷、核廢料處置等面向。', 'published'),
  ('居住正義與囤房稅', '針對多屋持有者課徵高額稅負，是否能有效改善居住問題？', 'collecting');

INSERT INTO ct_materials (issue_id, source_name, source_url, stance, content) VALUES
  (1, '台電官方說明', 'https://www.taipower.com.tw', 'pro',
   '核能發電碳排放極低，在全球淨零排放目標下，核能是過渡期間重要的低碳能源選項。核三廠現有技術條件可安全延役，停機將造成備用容量率下降。'),
  (1, '綠色和平台灣', 'https://www.greenpeace.org/taiwan', 'con',
   '核廢料最終處置場至今無解，延役只是把問題留給下一代。台灣地震頻繁，核安風險遠高於一般評估。再生能源已能填補缺口。'),
  (1, '中研院能源研究報告', 'https://www.sinica.edu.tw', 'neutral',
   '短期內若同時面對燃煤退場與核能停機，確實存在電力缺口風險。應以能源安全為前提，兼顧減碳目標，審慎評估各種能源組合。');

INSERT INTO ct_briefings (issue_id, consensus, disputes, positions, narrative, opinion_prompt) VALUES
  (1,
   '大多數立場都同意：台灣需要穩定電力供應、碳排需要減少、核廢料最終處置是未解問題。',
   '主要爭點有三：(1) 現有核電廠技術是否足夠安全延役？(2) 再生能源能否在短期填補缺口？(3) 核廢料的社會與政治成本如何計算？',
   '**挺核派**（台電、部分工商團體）：核能是低碳穩定電源，短期不可或缺，延役技術上可行。

**反核派**（環保團體、部分民間社會）：核廢料無解、地震風險高，應全力衝刺再生能源。

**中立評估**（學術界）：應依能源安全優先，數據驅動決策，不宜意識形態先行。',
   '台灣的核能爭議，表面上是「要不要開核電廠」，但背後糾纏著至少三個不同的問題：電夠不夠用、碳排怎麼辦、核廢料放哪裡。這三個問題有各自的答案，不同立場的人對這三個問題的優先順序也不同——這才是為什麼這個議題這麼難討論的根本原因。',
   '請根據以下議題說明，用對話方式引導我思考這個議題：

[BRIEFING_PLACEHOLDER]

請先問我：你對這個議題的第一個直覺是什麼？然後根據我的回答，引導我思考：這個直覺背後，我更在乎的是什麼？有沒有我沒想到的面向？不要幫我選邊站，而是幫我說清楚自己真正的想法。聊完後，請幫我整理一份摘要，說明我在乎哪些面向、我的觀點是什麼。'
  );
