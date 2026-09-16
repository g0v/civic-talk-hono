/**
 * /api/fact-check 的 D1 固定視窗 rate limit（issue #92）。
 *
 * 端點已經有同源檢查、登入守門與綁身分的短效 token，但擋不住「已登入帳號用自己的
 * session 自取 token 餵給外部自動化流程」。core 每次查核要跑數十秒的 AI 管線，因此
 * 在本站閘道以 D1 做每位使用者的固定視窗限流。選 D1 而非 Cloudflare Rate Limiting
 * binding：不必承擔方案／beta 風險，且查核本來就要等 AI 管線，多一次 D1 寫入可忽略。
 *
 * 實作走單一原子敘述（INSERT … ON CONFLICT … RETURNING count）：同一視窗累計，
 * 跨過視窗就重設為 1，計數與視窗推進在一句 SQL 內完成，避免讀寫分離的競態。
 * 每個活躍使用者一列，舊視窗的列會在使用者下次呼叫時被覆寫，不需要背景清理。
 */

/**
 * 每位登入者在限流視窗內可呼叫 /api/fact-check 的次數。
 * 定位是「防洪」而不是配額：只擋洪水式濫用／腳本誤打，正常使用（每次查核本來就要
 * 等數十秒的 AI 管線）遠遠碰不到這個上限；要收緊調整這一個常數即可。
 */
export const FACT_CHECK_RATE_LIMIT = 60

/** 限流視窗長度（秒）。 */
export const FACT_CHECK_RATE_LIMIT_WINDOW_SECONDS = 60

/** 一位使用者一列；key 帶 `user:` 前綴，日後若加其他限流維度可共用同一張表。 */
function limitKey(userId: string): string {
  return `user:${userId}`
}

/**
 * 消耗一次額度。回傳是否放行與 429 時要帶的 `Retry-After` 秒數
 * （本視窗剩餘時間；視窗剛過期時回整個視窗長度）。
 */
export async function consumeFactCheckRateLimit(
  db: D1Database,
  userId: string,
  nowMs: number = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const windowSeconds = FACT_CHECK_RATE_LIMIT_WINDOW_SECONDS
  // 視窗起點對齊 epoch：14:00:00 開始的 60 秒視窗在 14:00:59 過期，而非首筆請求後 60 秒。
  const windowStart = Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds
  const retryAfterSeconds = Math.max(
    1,
    windowStart + windowSeconds - Math.floor(nowMs / 1000)
  )

  const result = await db
    .prepare(
      `INSERT INTO ct_fact_check_rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
         window_start = ?2
       RETURNING count`
    )
    .bind(limitKey(userId), windowStart)
    .first<{ count: number }>()

  if (!result) {
    // RETURNING 理論上一定回一列，回空視同查詢異常，交給上層記錄後放行。
    throw new Error('fact check rate limit upsert returned no row')
  }
  return { allowed: result.count <= FACT_CHECK_RATE_LIMIT, retryAfterSeconds }
}

/**
 * 檢查限流，D1 故障時 fail-open：記結構化錯誤 log 後放行。
 *
 * 理由：這個端點已經要登入且有 token 綁身分，基礎設施故障不該讓事實查核整個壞掉；
 * 代價是故障期間沒有速率保護——與投稿安全審查的 fail-open 同一哲學（#29），
 * 不把基礎設施故障誤判成濫用而擋住使用者。
 */
export async function checkFactCheckRateLimit(
  db: D1Database,
  userId: string,
  nowMs: number = Date.now()
): Promise<{ allowed: true; retryAfterSeconds?: number } | { allowed: false; retryAfterSeconds: number }> {
  try {
    const result = await consumeFactCheckRateLimit(db, userId, nowMs)
    if (result.allowed) return { allowed: true }
    return { allowed: false, retryAfterSeconds: result.retryAfterSeconds }
  } catch (error) {
    console.error(JSON.stringify({
      event: 'fact_check_rate_limit_error',
      message: error instanceof Error ? error.message : String(error),
    }))
    return { allowed: true }
  }
}
