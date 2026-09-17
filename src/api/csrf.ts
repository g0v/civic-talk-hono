import type { MiddlewareHandler } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'

const guard = csrf()

/**
 * 跨站／跨子網域寫入防護。
 *
 * CORS 只控制「回應能不能被讀」，不控制「請求會不會送出」：不需 preflight 的簡單請求
 * （form enctype、text/plain、甚至完全不帶 Content-Type 的 ArrayBuffer body）照樣會帶著
 * SameSite=Lax 的 session cookie 抵達伺服器，副作用已經發生。因此授權模型的第一道閘是這支
 * 中介層，不是 CORS 標頭。
 *
 * hono/csrf 擋非 GET/HEAD 且 content-type 屬於 form 可送出類型（或沒帶 content-type）的請求，
 * 除非 Sec-Fetch-Site 是 same-origin 或 Origin 與本站相符。跨來源的 JSON 請求由「不回 CORS
 * 標頭」讓 preflight 失敗擋掉，兩者互補。
 *
 * 這裡包一層只為了把它的純文字 403 轉成本站統一的 { error: string } 形狀。
 */
export const apiCsrf: MiddlewareHandler = async (c, next) => {
  let entered = false
  try {
    return await guard(c, async () => {
      entered = true
      await next()
    })
  } catch (caught) {
    if (!entered && caught instanceof HTTPException && caught.status === 403) {
      return c.json({ error: 'Forbidden: cross-site request blocked' }, 403)
    }
    throw caught
  }
}
