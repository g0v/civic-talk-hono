import { Hono } from 'hono'
import { apiCsrf } from '../api/csrf'
import { getAuthContext } from '../auth/authorization'
import { createAuth } from '../auth/createAuth'
import type { EvidenceBindings } from './env'
import { hasEvidenceBindings } from './env'
import { evidenceEndpoints } from './endpoints'
import { registerEvidenceRoutes } from './routes'

const app = new Hono<{ Bindings: EvidenceBindings }>()

app.use('/api/*', apiCsrf)

// 實驗入口也必須明確啟用；正常 OAuth／session 端點維持原本的限制。
for (const [method, path] of evidenceEndpoints) {
  app.on(method, path, async (c, next) => {
    if (c.env.EVIDENCE_API_ENABLED !== '1') return c.json({ error: 'Not found' }, 404)
    await next()
  })
}

app.use('/api/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Vary', 'Cookie', { append: true })
})

for (const [method, path] of evidenceEndpoints) {
  app.on(method, path, async (c, next) => {
    if (!hasEvidenceBindings(c.env)) return c.json({ error: 'service_unavailable' }, 503)
    await next()
  })
}

// 只開 OAuth／session 正常生命週期；不暴露 Better Auth 個資或 admin 寫入端點。
app.post('/api/auth/sign-in/social', c => createAuth(c.env).handler(c.req.raw))
app.post('/api/auth/sign-out', c => createAuth(c.env).handler(c.req.raw))
app.get('/api/auth/get-session', c => createAuth(c.env).handler(c.req.raw))
app.get('/api/auth/error', c => createAuth(c.env).handler(c.req.raw))
app.get('/api/auth/callback/:provider', async c => {
  if (!['google', 'github'].includes(c.req.param('provider'))) return c.json({ error: 'Not found' }, 404)
  return createAuth(c.env).handler(c.req.raw)
})
app.all('/api/auth/*', c => c.json({ error: 'Not found' }, 404))
app.get('/api/me', async c => {
  const context = await getAuthContext(c.env, c.req.raw.headers)
  return context ? c.json(context) : c.json({ error: 'Unauthorized' }, 401)
})

registerEvidenceRoutes(app)
app.notFound(c => c.json({ error: 'Not found' }, 404))

export { EvidenceWorkflow } from './workflow'
export default app
