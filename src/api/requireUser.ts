import type { Context } from 'hono'
import { tryGetAuthContext, type AuthContext } from '../auth/authorization'

/** 登入且未停權即可使用一般工具；實驗與既有路由共用相同守門。 */
export async function requireUser(c: Context): Promise<{ context: AuthContext } | { denied: Response }> {
  const context = await tryGetAuthContext(c.env, c.req.raw.headers)
  if (!context) return { denied: c.json({ error: 'Unauthorized' }, 401) }
  if (context.banned) return { denied: c.json({ error: 'Forbidden: account is banned' }, 403) }
  return { context }
}
