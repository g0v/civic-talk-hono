import type { Context } from 'hono'
import { createAuth } from '../auth/createAuth'
import { getAuthContext } from '../auth/authorization'
import { DISPLAY_NAME_MAX_LENGTH, nameChangeCooldownExpiresAt, NAME_CHANGE_COOLDOWN_CODE, normalizeDisplayName } from '../lib/profile-name'
import type { App, AppBindings } from './types'

type AppEnv = { Bindings: AppBindings }

type UserNameChangeRow = {
  name: string
  nameChangedAt: string | null
}

type NameUpdateRequest = {
  name: string
  request: Request
}

async function normalizeNameUpdateRequest(request: Request): Promise<NameUpdateRequest | null> {
  // 此 helper 只重建 Better Auth 的 POST /update-user 請求；Fetch 不允許 GET／HEAD 帶 body。
  if (request.method !== 'POST') return null

  try {
    const body = (await request.clone().json()) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'name')) return null

    const name = normalizeDisplayName((body as { name?: unknown }).name)
    if (!name) return null

    // Better Auth 不會替 update-user 的 name 做正規化；用新 Request 交給它，
    // 才能保證直接呼叫 API 與個人資料頁寫入的是同一個名稱。
    const headers = new Headers(request.headers)
    headers.set('Content-Type', 'application/json')
    headers.delete('Content-Length')
    return {
      name,
      request: new Request(request, { method: 'POST', body: JSON.stringify({ ...(body as Record<string, unknown>), name }), headers }),
    }
  } catch {
    // 格式錯誤交給 Better Auth 依既有行為回應。
    return null
  }
}

/**
 * 在交給 Better Auth 更新前先提供可辨識的 429；共用 auth DB 的 trigger 仍是併發與繞過
 * 應用程式時的最終防線（由 vTaiwan-hono 維護，本站不執行 auth schema migration）。
 */
async function enforceNameChangeCooldown(c: Context<AppEnv>): Promise<Response | NameUpdateRequest | null> {
  // 先讓 Better Auth 維持既有的未登入 401 語意，再驗證名稱內容。
  const context = await getAuthContext(c.env, c.req.raw.headers)
  if (!context) return null

  const update = await normalizeNameUpdateRequest(c.req.raw)
  if (update === null) {
    try {
      const body = (await c.req.raw.clone().json()) as unknown
      if (body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'name')) {
        return c.json({ error: `name must be a non-empty string of at most ${DISPLAY_NAME_MAX_LENGTH} characters` }, 400)
      }
    } catch {
      // 格式錯誤交給 Better Auth 依既有行為回應。
    }
    return null
  }

  const user = await c.env.DB_AUTH.prepare('SELECT "name", "nameChangedAt" FROM "user" WHERE "id" = ?').bind(context.user.id).first<UserNameChangeRow>()
  if (user && user.name !== update.name && nameChangeCooldownExpiresAt(user.nameChangedAt) !== null) {
    return c.json({ code: NAME_CHANGE_COOLDOWN_CODE }, 429)
  }

  return update
}

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
  app.on(['GET', 'POST'], '/api/auth/*', async c => {
    if (new URL(c.req.url).pathname === '/api/auth/update-user' && c.req.method === 'POST') {
      const update = await enforceNameChangeCooldown(c)
      if (update instanceof Response) return update
      if (update) return createAuth(c.env).handler(update.request)
    }
    return createAuth(c.env).handler(c.req.raw)
  })

  // 前端登入狀態的單一來源。
  app.get('/api/me', async c => {
    const context = await getAuthContext(c.env, c.req.raw.headers)
    if (!context) return c.json({ error: 'Unauthorized' }, 401)
    return c.json(context)
  })
}
