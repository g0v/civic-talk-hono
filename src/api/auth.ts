import { createAuth } from '../auth/createAuth'
import { getAuthContext } from '../auth/authorization'
import type { App } from './types'

export function registerAuthRoutes(app: App): void {
  // 🚫 /api/auth/admin/* 一律 404——整段封鎖，不維護黑名單（不變量 5）。
  //
  // admin plugin 的停權操作走 server 端 createAuth(c.env).api.banUser()，
  // 那是程式呼叫，不經 Hono 路由，整段 404 擋不到它，停權照常運作。
  // 若直接打 HTTP 端點則一律拒絕，包含 create-user、set-user-password、
  // update-user、list-users、list-user-sessions 等 admin plugin 全部端點。
  // 日後若要開放任何端點，必須先問使用者，不得自行移除這條規則。
  app.all('/api/auth/admin/*', c => c.json({ error: 'Not found' }, 404))

  // Better Auth 內建端點（登入、OAuth callback、登出、session）
  app.on(['GET', 'POST'], '/api/auth/*', c => createAuth(c.env).handler(c.req.raw))

  // 前端登入狀態的單一來源。
  app.get('/api/me', async c => {
    const context = await getAuthContext(c.env, c.req.raw.headers)
    if (!context) return c.json({ error: 'Unauthorized' }, 401)
    return c.json(context)
  })
}
