-- migration 0012: 站內事實查核的固定視窗 rate limit（issue #92）
-- 遠端套用需使用者明確授權（見 AGENTS.md 不變量 7）。本機套用：
--   npx wrangler d1 migrations apply vtaiwan-civic-talks --local
--
-- /api/fact-check 已有同源檢查、登入守門與綁身分的短效 token，但擋不住「已登入
-- 帳號用自己的 session 自取 token 餵給外部自動化流程」。core 每次查核要跑數十秒的
-- AI 管線，成本高，因此在本站閘道以 D1 做每位使用者的固定視窗限流。
-- 選 D1 而非 Cloudflare Rate Limiting binding：不必承擔方案／beta 風險，且查核本來
-- 就要等 AI 管線數十秒，多一次 D1 寫入可忽略。
--
-- 語意：key 是 `user:<user.id>`，window_start 是視窗起點的 epoch 秒數。同一視窗內
-- 累計 count；跨過視窗就重設。資料量極小（每個活躍使用者一列），舊視窗的列會在
-- 該使用者下次呼叫時被覆寫，不需要背景清理。

CREATE TABLE ct_fact_check_rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
