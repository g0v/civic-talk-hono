/**
 * /api/fact-check 的同源短效 token（issue #92）。
 *
 * **為什麼不把 key 交給前端。** 前端只要能「解密」出原始 key，key 就等於公開了——解密
 * 金鑰必須跟著送到瀏覽器，任何拿到頁面的人都拿得到。正確形狀是：伺服器端以
 * `env.CIVIC_TALK_API_KEY` 對 `{ aud, exp, n, sub }` 做 HMAC-SHA256，SSR 只注入
 * `v1.<payload>.<signature>`，前端原樣帶回，API 驗簽與期限；secret 永不離開 Worker。
 *
 * **時間性。** payload 帶 `exp`（簽發時間 + {@link FACT_CHECK_TOKEN_TTL_SECONDS}），
 * 逾時即失效，所以外流的 token 只能在該時窗內被重用，不是永久通行證。
 *
 * **為什麼綁登入身分（`sub`）。** 只有同源 + token 時，任何未登入訪客抓一次頁面就能
 * 取得有效 token，等於擋不住「別的後端用抓來的 token 轉送」。token 綁定 Better Auth 的
 * `user.id`（`sub`），驗證時必須與請求者 session 的 user.id 相符——別人偷走 token 也
 * 用不了（他的 session 是不同的 user.id）。簽發也只在「已登入且未被停權」時發生。
 *
 * ⚠️ 殘留風險（誠實紀錄）：已登入的帳號仍可用自己的 session 取得 token 轉送給外部
 * 自動化流程；真正的自動化濫用防線是邊緣層的 rate limit／Turnstile，不是這顆 token。
 * token 也沒有一次性 nonce 的伺服器端紀錄，有效期內可在同一帳號下重放。
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** token 格式版本。payload 形狀或簽章方式一改就遞增，舊 token 一律視為無效。 */
const TOKEN_VERSION = 'v1'
/** 用途標記，避免同一把密鑰簽給其他用途的 token 在這裡通用。 */
const TOKEN_AUDIENCE = 'fact-check'

/** 前端回傳 token 時使用的標頭名稱。 */
export const FACT_CHECK_TOKEN_HEADER = 'X-Civic-Talk-Token'

/** token 有效期（秒）。頁面重新載入會取得新 token，逾時後一律回 `TOKEN_EXPIRED`。 */
export const FACT_CHECK_TOKEN_TTL_SECONDS = 900

/** `missing`／`invalid` 都回 401，`expired` 另回 `TOKEN_EXPIRED` 讓前端能提示重新載入。 */
export type FactCheckTokenStatus = 'ok' | 'missing' | 'invalid' | 'expired'
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** 每次簽發都不重複的隨機值；日後若要加一次性 nonce 的伺服器端紀錄，就靠這個欄位。 */
function randomNonce(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/** 簽發短效 token。`sub` 是 Better Auth 的 `user.id`——token 只能用同一個 session 身分消費。`nowMs` 只為了測試可注入，正式路徑一律用當下時間。 */
export async function issueFactCheckToken(secret: string, subject: string, nowMs: number = Date.now()): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: TOKEN_AUDIENCE,
        exp: Math.floor(nowMs / 1000) + FACT_CHECK_TOKEN_TTL_SECONDS,
        n: randomNonce(),
        sub: subject,
      })
    )
  )
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload))
  return `${TOKEN_VERSION}.${payload}.${toBase64Url(new Uint8Array(signature))}`
}

/**
 * 驗證 token。先驗簽章（`crypto.subtle.verify` 為常數時間比較），再讀 payload——
 * 未驗簽的內容一律當成不可信資料。`subject` 必須是呼叫者 session 的 user.id，
 * `sub` 與之不符時一律 `invalid`（偷來的 token 在別人 session 下無效）。
 */
export async function verifyFactCheckToken(
  secret: string,
  token: string | null,
  options: { subject: string; nowMs?: number }
): Promise<FactCheckTokenStatus> {
  const subject = options.subject
  const nowMs = options.nowMs ?? Date.now()
  if (!token) return 'missing'
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return 'invalid'
  const [, payload, signature] = parts
  const signatureBytes = fromBase64Url(signature)
  if (!signatureBytes) return 'invalid'
  if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), signatureBytes, encoder.encode(payload)))) return 'invalid'

  const payloadBytes = fromBase64Url(payload)
  if (!payloadBytes) return 'invalid'
  let claims: unknown
  try {
    claims = JSON.parse(decoder.decode(payloadBytes))
  } catch {
    return 'invalid'
  }
  if (typeof claims !== 'object' || claims === null) return 'invalid'
  const { aud, exp, n, sub } = claims as { aud?: unknown; exp?: unknown; n?: unknown; sub?: unknown }
  if (aud !== TOKEN_AUDIENCE || typeof exp !== 'number' || !Number.isFinite(exp)) return 'invalid'
  if (typeof sub !== 'string' || sub.length === 0 || sub !== subject) return 'invalid'
  if (typeof n !== 'string' || n.length === 0) return 'invalid'

  const now = Math.floor(nowMs / 1000)
  if (now > exp) return 'expired'
  // 簽發當下就寫死 exp，所以期限超過 TTL 的 token 只可能來自時鐘異常或密鑰外流。
  if (exp - now > FACT_CHECK_TOKEN_TTL_SECONDS) return 'invalid'
  return 'ok'
}

