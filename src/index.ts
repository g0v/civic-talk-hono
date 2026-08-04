import { Hono } from 'hono'
import { registerApiRoutes } from './api/routes'
import { registerAuthRoutes } from './api/auth'
import type { AppBindings } from './api/types'
import { listIssues, getIssue, getIssueDetail } from './db/queries'
import { renderPage } from './ssr/render'
import {
  headForAbout,
  headForAdmin,
  headForContribute,
  headForHome,
  headForIssue,
} from './ssr/heads'
import HomeView from './views/Home.vue'
import AboutView from './views/About.vue'
import IssueView from './views/Issue.vue'
import ContributeView from './views/Contribute.vue'
import AdminView from './views/Admin.vue'

const app = new Hono<{ Bindings: AppBindings }>()

// 先掛 auth：/api/auth/* 與 /api/me 要在 registerApiRoutes 的 /api/* 泛用處理之前命中
registerAuthRoutes(app)
registerApiRoutes(app)

// ── 舊網址導向（只能新增、不能刪除）──────────────────────────
app.get('/index.html', (c) => c.redirect('/', 301))
app.get('/about.html', (c) => c.redirect('/about', 301))
app.get('/admin.html', (c) => c.redirect('/admin', 301))
app.get('/issue.html', (c) => {
  const id = c.req.query('id')
  if (id && /^\d+$/.test(id)) return c.redirect(`/issues/${id}`, 302)
  return c.redirect('/', 302)
})
app.get('/contribute.html', (c) => {
  const id = c.req.query('id')
  if (id && /^\d+$/.test(id)) return c.redirect(`/contribute/${id}`, 302)
  return c.redirect('/', 302)
})

app.get('/', async (c) => {
  const origin = new URL(c.req.url).origin
  const initialIssues = await listIssues(c.env.DB)
  const html = await renderPage(HomeView, { initialIssues }, headForHome(origin), {
    hydrate: { page: 'home', state: { initialIssues } },
  })
  return c.html(html)
})

app.get('/about', async (c) => {
  const origin = new URL(c.req.url).origin
  const html = await renderPage(AboutView, {}, headForAbout(origin), {
    hydrate: { page: 'about', state: {} },
  })
  return c.html(html)
})

app.get('/issues/:id', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id) || id <= 0) return c.redirect('/', 302)
  const origin = new URL(c.req.url).origin
  const detail = await getIssueDetail(c.env.DB, id)
  if (!detail) return c.notFound()
  const html = await renderPage(
    IssueView,
    { issueId: id, initialDetail: detail },
    headForIssue(
      detail.issue.title,
      detail.issue.description ?? '',
      id,
      origin,
    ),
    {
      hydrate: {
        page: 'issue',
        state: { issueId: id, initialDetail: detail },
      },
    },
  )
  return c.html(html)
})

app.get('/contribute/:id', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id) || id <= 0) return c.redirect('/', 302)
  const origin = new URL(c.req.url).origin
  const issue = await getIssue(c.env.DB, id)
  if (!issue) return c.notFound()
  const html = await renderPage(
    ContributeView,
    { issueId: id, issueTitle: issue.title },
    headForContribute(issue.title, id, origin),
    {
      hydrate: {
        page: 'contribute',
        state: { issueId: id, issueTitle: issue.title },
      },
    },
  )
  return c.html(html)
})

app.get('/admin', async (c) => {
  const origin = new URL(c.req.url).origin
  const html = await renderPage(AdminView, {}, headForAdmin(origin), {
    hydrate: { page: 'admin', state: {} },
  })
  return c.html(html)
})

app.get('*', async (c) => {
  if (!c.env.ASSETS) return c.notFound()
  return c.env.ASSETS.fetch(c.req.raw)
})

export default app
