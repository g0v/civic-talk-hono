import { getContributorPublicId, getContributorUserId, listContributions, registerContributor } from '../db/queries'
import type { ContributorHistory } from '../lib/contributors'
import type { App, AppBindings } from './types'
import { requireUser } from './requireUser'

/** 日期來自共用帳號的建立時間，介面明示並非本站首次投稿時間。 */
export async function getContributorHistory(env: Pick<AppBindings, 'DB' | 'DB_AUTH'>, publicId: string): Promise<ContributorHistory | null> {
  if (!/^[a-f0-9]{32}$/.test(publicId)) return null
  const userId = await getContributorUserId(env.DB, publicId)
  if (!userId) return null
  const user = await env.DB_AUTH.prepare(
    `SELECT name, "createdAt" AS joined_at FROM "user"
     WHERE id = ? AND (COALESCE(banned, 0) = 0 OR ("banExpires" IS NOT NULL AND datetime("banExpires") <= CURRENT_TIMESTAMP))`
  )
    .bind(userId)
    .first<{ name: string; joined_at: string | number }>()
  if (!user) return null
  // Better Auth 的 SQLite adapter 可能回傳 epoch 毫秒或 ISO 日期。
  const joinedAt = new Date(user.joined_at).toISOString()
  return { public_id: publicId, name: user.name.trim() || null, joined_at: joinedAt, contributions: await listContributions(env.DB, userId) }
}

export function registerContributorRoutes(app: App): void {
  app.use('/api/contributors/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Vary', 'Cookie', { append: true })
    await next()
  })

  app.get('/api/contributors/me', async c => {
    const auth = await requireUser(c)
    if ('denied' in auth) return auth.denied
    await registerContributor(c.env.DB, auth.context.user.id)
    return c.json({ public_id: await getContributorPublicId(c.env.DB, auth.context.user.id) })
  })

  app.get('/api/contributors/:publicId', async c => {
    const history = await getContributorHistory(c.env, c.req.param('publicId'))
    return history ? c.json(history) : c.json({ error: 'Not found' }, 404)
  })
}
