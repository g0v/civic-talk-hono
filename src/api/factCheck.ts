import type { App } from './types'
import { FACT_CHECK_TOKEN_HEADER } from '../lib/factCheck'
import { verifyFactCheckToken } from '../lib/factCheckToken'
import { checkFactCheckRateLimit } from '../lib/factCheckRateLimit'
import { tryGetAuthContext } from '../auth/authorization'

/**
 * /api/fact-check（issue #92）：本站唯一的事實查核入口，以 Service Binding 呼叫
 * `fact-check-core`。core 刻意沒有公開 route（`workers_dev: false`），公開 HTTP、CORS
 * 與用戶端限制都留在本層，符合 core 的邊界。
 *
 * 守門順序（由便宜到昂貴、由不變到可變）：
 *   1. **同源 Origin**：只接受 Origin 等於請求本身來源的呼叫；缺少 Origin 一律擋掉。
 *      這擋的是「別站瀏覽器」，不是後端（後端可以自己偽造 Origin）。
 *   2. **密鑰設定**：`CIVIC_TALK_API_KEY` 沒設就 fail closed。
 *   3. **登入 session**：token 綁 Better Auth 的 `user.id`，所以先取 session 才能知道
 *     要比對的 subject；只有同源 + token 時，任何未登入訪客抓一次頁面就能拿到有效
 *      token，等於擋不住「別的後端用抓來的 token 轉送」——綁 session 之後偷來的 token
 *      在別人 session 下一律無效。停權帳號（`banned`）同樣拒絕，與其他寫入端點一致。
 *   4. **短效 token**：`X-Civic-Talk-Token`，由 SSR 以 `env.CIVIC_TALK_API_KEY` 簽發
 *      （見 src/lib/factCheckToken.ts），secret 本身永不進到前端。
 *   5. **Rate limit**（D1 固定視窗，見 src/lib/factCheckRateLimit.ts）：token 通過後、
 *      呼叫 core 前檢查；超限回 429。D1 故障時 fail-open 放行，理由與代價見該模組。
 *   6. **Service Binding**：缺 binding 回 503、丟例外回 502。
 *
 * rate limit 之後殘留的風險只剩「自動化流程完全模仿瀏覽器行為、跨視窗慢慢打」，
 * 若需要更強的防線再考慮邊緣層 rate limit／Turnstile。
 */

/** core 唯一的查核端點；Service Binding 不吃 DNS，只是固定的 URL 形狀。 */
const CORE_ENDPOINT = 'https://fact-check-core/fact-check'

function corsHeaders(origin: string): Record<string, string> {
  // 明確回具體 origin（不用 `*`），因為這支只服務同源呼叫。不給
  // Access-Control-Allow-Credentials：這裡同時驗 session cookie 與 token 標頭，
  // 但跨來源呼叫一律拒絕，回具體同源 origin 就夠，不需要允許跨來源帶 cookie。
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${FACT_CHECK_TOKEN_HEADER}`,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function sameOrigin(request: Request): string | null {
  // 瀏覽器送 POST 與預檢都會帶 Origin；缺 Origin 的是非瀏覽器呼叫，不給過。
  const origin = request.headers.get('Origin')
  if (!origin || origin !== new URL(request.url).origin) return null
  return origin
}

function jsonError(origin: string | null, error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      // 不同源就沒必要讓對方的瀏覽器讀到回應內容，連 CORS 標頭都不給。
      ...(origin === null ? {} : corsHeaders(origin)),
    },
  })
}

export function registerFactCheckRoutes(app: App): void {
  // 這條必須排在 registerApiRoutes 的 `app.options('/api/*')` 之前，否則預檢會先被那條
  // 泛用規則接走，同源限制就形同虛設。
  app.options('/api/fact-check', c => {
    const origin = sameOrigin(c.req.raw)
    if (origin === null) return jsonError(null, 'FORBIDDEN_ORIGIN', 403)
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  })

  app.post('/api/fact-check', async c => {
    const origin = sameOrigin(c.req.raw)
    if (origin === null) return jsonError(null, 'FORBIDDEN_ORIGIN', 403)

    const secret = c.env.CIVIC_TALK_API_KEY
    if (!secret) {
      // fail closed：沒有密鑰就無法簽發／驗證 token，寧可不提供服務。
      console.error('fact-check 未設定 CIVIC_TALK_API_KEY，拒絕請求')
      return jsonError(origin, 'FACT_CHECK_NOT_CONFIGURED', 503)
    }

    // token 的 subject 是登入者的 user.id，所以 session 必須在 token 驗證之前解析。
    // tryGetAuthContext 把環境問題（本機沒有 auth 表等）壓成「未登入」回 401，
    // 不讓例外冒泡成 500。
    const context = await tryGetAuthContext(c.env, c.req.raw.headers)
    if (!context) return jsonError(origin, 'UNAUTHORIZED', 401)
    if (context.banned) {
      // 停權帳號與其他寫入端點一致：已登入但被禁用，回 403 而不是 401。
      return jsonError(origin, 'FORBIDDEN', 403)
    }

    const tokenStatus = await verifyFactCheckToken(secret, c.req.header(FACT_CHECK_TOKEN_HEADER) ?? null, {
      subject: context.user.id,
    })

    if (tokenStatus !== 'ok') {
      return jsonError(origin, tokenStatus === 'expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', 401)
    }

    // token 驗證通過後、呼叫 core 前限流：每位登入者固定視窗限額（限額與視窗長度
    // 是具名常數，見 src/lib/factCheckRateLimit.ts）。D1 故障時 fail-open 放行，
    // 理由與代價見該模組註解。
    const rateLimit = await checkFactCheckRateLimit(c.env.DB, context.user.id)
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({ error: 'RATE_LIMITED' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Retry-After': String(rateLimit.retryAfterSeconds),
          ...corsHeaders(origin),
        },
      })
    }

    const core = c.env.FACT_CHECK_CORE
    if (!core) {
      console.error('fact-check 缺少 FACT_CHECK_CORE service binding')
      return jsonError(origin, 'FACT_CHECK_UNAVAILABLE', 503)
    }
    try {
      // body 原封不動轉給 core：輸入驗證與大小上限都在 core（單一來源），這裡不重寫一份，
      // 呼叫端看到的錯誤形狀也與 core 一致。
      const upstream = await core.fetch(CORE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': c.req.header('Content-Type') ?? 'application/json' },
        body: c.req.raw.body,
      })
      const headers = new Headers(upstream.headers)
      headers.set('Cache-Control', 'no-store')
      for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value)
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (error) {
      console.error(JSON.stringify({
        event: 'fact_check_binding_error',
        message: error instanceof Error ? error.message : String(error),
      }))
      return jsonError(origin, 'FACT_CHECK_UNAVAILABLE', 502)
    }
  })
}
