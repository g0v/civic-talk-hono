import { createAuth } from '../auth/createAuth'
import { getAuthContext } from '../auth/authorization'
import type { App } from './types'

export function registerAuthRoutes(app: App): void {
  // 🚫 /api/auth/admin/* 一律擋掉——這是「/api/auth/* 整段轉交給 auth.handler()」的唯一例外。
  //
  // 本站沒開 admin plugin，所以這些端點目前根本不存在；這條擋在前面是**防禦縱深**：
  // 日後若有人為了別的功能開了 plugin，也不會在保護較弱的本站長出
  // set-role／remove-user 這類寫入共用 auth DB 的入口（見 AGENTS.md 不變量 11）。
  // 必須註冊在下面的 /api/auth/* 之前，Hono 才會讓它先命中。
  app.all('/api/auth/admin/*', c => c.json({ error: 'Not found' }, 404))

  // Better Auth 內建端點（登入、OAuth callback、登出、session）
  app.on(['GET', 'POST'], '/api/auth/*', c => createAuth(c.env).handler(c.req.raw))

  // 前端登入狀態的單一來源。
  //
  // 這裡刻意用會 throw 的 getAuthContext：讀不到 session 是「壞掉」而不是「未登入」，
  // 壓成 401 會讓系統故障被前端誤判成登出。
  app.get('/api/me', async c => {
    const context = await getAuthContext(c.env, c.req.raw.headers)
    if (!context) return c.json({ error: 'Unauthorized' }, 401)
    return c.json(context)
  })
}
