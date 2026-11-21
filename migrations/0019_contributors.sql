-- 公開識別碼與共用帳號 ID 的對照只存本站業務庫；不更動 DB_AUTH。
CREATE TABLE ct_contributors (
  user_id TEXT PRIMARY KEY NOT NULL,
  public_id TEXT NOT NULL UNIQUE CHECK (length(public_id) = 32)
);

-- 只有可確定作者的舊投稿可歸戶；不以名稱或 email 推定 NULL 作者。
INSERT INTO ct_contributors (user_id, public_id)
SELECT author_id, lower(hex(randomblob(16)))
FROM (
  SELECT author_id FROM ct_issues
  UNION SELECT author_id FROM ct_materials
  UNION SELECT author_id FROM ct_briefings
  UNION SELECT author_id FROM ct_opinions
)
WHERE author_id IS NOT NULL;
