import type { Briefing, Issue, IssueListItem, IssueListItemWithAuthor, IssueStatus, Material, MaterialWithAuthor, Opinion, OpinionWithAuthor, Stance } from '../db/queries'
import * as db from '../db/queries'
import { isAdminRole, tryGetAuthContext, type AuthContext } from '../auth/authorization'
import type { App, AppBindings } from './types'

// 公開讀取端點維持開放跨來源；管理端則刻意「不可跨來源」——
// 授權改看 cookie session 之後，帶 cookie 的跨來源請求需要
// Access-Control-Allow-Credentials: true，而那又不能搭配 Allow-Origin: *。
// 我們兩者都不給：跨來源請求不會帶到 session cookie，管理端一律回 401。
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function json(data: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

function error(msg: string, status = 400): Response {
  return json({ error: msg }, status)
}

/**
 * 管理權限守衛：通過回 null，否則回該擋下的 Response。
 *
 * 角色來自共用 auth DB 的 `user.role`（見 src/auth/authorization.ts），本站只讀不寫——
 * 升降權一律在 vTaiwan-hono 後台做（AGENTS.md 不變量 11）。
 *
 * 401 與 403 要分清楚：未登入是 401（前端該引導登入），已登入但權限不足是 403
 * （前端該說「這個帳號沒有權限」，引導再登入一次只會繞圈）。
 */
async function requireAdmin(request: Request, env: AppBindings): Promise<Response | null> {
  const context = await tryGetAuthContext(env, request.headers)
  if (!context) return error('Unauthorized', 401)
  // 停權帳號即使有 admin 角色也不得操作：先判 banned，再判角色（#11）
  if (context.banned) return error('Forbidden: account is suspended', 403)
  if (!isAdminRole(context.role)) return error('Forbidden', 403)
  return null
}

/**
 * 登入守衛（不看角色，任何登入者都通過）：通過回 AuthContext，否則回 401 Response。
 *
 * #9 用它把素材投稿限縮成「登入才能投」——目的是素材品質與濫用時的可追溯性，
 * 不是權限分級，所以一般 user 角色就夠，不要在這裡誤用 isAdminRole()。
 */
async function requireUser(request: Request, env: AppBindings): Promise<{ context: AuthContext } | { denied: Response }> {
  const context = await tryGetAuthContext(env, request.headers)
  if (!context) return { denied: error('Unauthorized', 401) }
  // 停權帳號不得執行任何寫入動作（#11）
  if (context.banned) return { denied: error('Forbidden: account is suspended', 403) }
  return { context }
}

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function registerApiRoutes(app: App): void {
  app.options('/api/*', () => withCors(new Response(null, { status: 204 })))

  // POST /api/admin/login 已隨密碼制一併移除（#5）：管理身分改由 Better Auth session
  // 決定，登入入口是 /api/auth/sign-in/social。前端 Admin.vue 已不再呼叫它。

  app.get('/api/admin/stats', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const stats = await db.getAdminStats(c.env.DB)
    return json(stats)
  })

  // 建立者只給管理端看（與素材、意見同一套規則）
  app.get('/api/issues', async c => {
    const context = await tryGetAuthContext(c.env, c.req.raw.headers)
    const issues: IssueListItem[] | IssueListItemWithAuthor[] = context && isAdminRole(context.role) ? await db.listIssuesWithAuthor(c.env.DB) : await db.listIssues(c.env.DB)
    const res = json(issues)
    res.headers.set('Vary', 'Cookie')
    return res
  })

  // 建立議題同樣需要登入（#9 的延伸，使用者裁示）：議題是所有素材與意見的容器，
  // 開放匿名建立等於開一扇沒有守門的門。
  app.post('/api/issues', async c => {
    const auth = await requireUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied
    let body: { title?: string; description?: string; polis_id?: string | null; show_email?: boolean }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (!body.title?.trim()) return error('title is required')
    const id = await db.createIssue(c.env.DB, {
      title: body.title.trim(),
      description: body.description ?? '',
      polis_id: body.polis_id ?? null,
      author_id: auth.context.user.id,
      author_name: auth.context.user.name || auth.context.user.email,
      author_email: body.show_email ? auth.context.user.email : null,
    })
    return json({ id, title: body.title.trim() }, 201)
  })

  app.delete('/api/materials/:id', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    await db.deleteMaterial(c.env.DB, id)
    return json({ ok: true })
  })

  app.delete('/api/opinions/:id', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    await db.deleteOpinion(c.env.DB, id)
    return json({ ok: true })
  })

  app.get('/api/issues/:id', async c => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const detail = await db.getIssueDetail(c.env.DB, id)
    if (!detail) return error('Issue not found', 404)
    return json(detail)
  })

  app.put('/api/issues/:id', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const existing = await db.getIssue(c.env.DB, id)
    if (!existing) return error('Issue not found', 404)
    let body: {
      title?: string
      description?: string
      status?: IssueStatus
      polis_id?: string | null
    }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (!body.title?.trim()) return error('title is required')
    await db.updateIssue(c.env.DB, id, {
      title: body.title.trim(),
      description: body.description ?? '',
      status: body.status ?? 'collecting',
      polis_id: body.polis_id ?? null,
    })
    return json({ ok: true })
  })

  app.delete('/api/issues/:id', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    await db.deleteIssueCascade(c.env.DB, id)
    return json({ ok: true })
  })

  // 投稿者只給管理端看：一般讀取回公開欄位，管理員多拿 author_id／author_name。
  // 這是擴充而非變更——公開回應的欄位與語意不變（不變量 5）。
  app.get('/api/issues/:id/materials', async c => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const context = await tryGetAuthContext(c.env, c.req.raw.headers)
    const materials: Material[] | MaterialWithAuthor[] = context && isAdminRole(context.role) ? await db.listMaterialsWithAuthor(c.env.DB, id) : await db.listMaterials(c.env.DB, id)
    const res = json(materials)
    // 回應內容依 cookie（登入身分）而異——標 Vary 讓任何快取層不會把管理員版本
    // 餵給一般讀者。目前 Worker 回應沒設 Cache-Control 所以不會被邊緣快取，
    // 這是「靠設計成立」而非「靠沒設定成立」。
    res.headers.set('Vary', 'Cookie')
    return res
  })

  // #9：素材投稿必須登入（品質把關 + 濫用時可追溯）。這是不變量 5 的授權例外之一，
  // 由 issue #9 明確授權：路徑、方法與成功回應形狀照舊，只是未登入改回 401。
  app.post('/api/issues/:id/materials', async c => {
    const auth = await requireUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const issue = await db.getIssue(c.env.DB, id)
    if (!issue) return error('Issue not found', 404)
    let body: {
      content?: string
      source_name?: string
      source_url?: string
      stance?: Stance
      show_email?: boolean
    }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (!body.content?.trim()) return error('content is required')
    const materialId = await db.createMaterial(c.env.DB, id, {
      content: body.content.trim(),
      source_name: body.source_name ?? '',
      source_url: body.source_url ?? '',
      stance: body.stance ?? 'unknown',
      author_id: auth.context.user.id,
      author_name: auth.context.user.name || auth.context.user.email,
      author_email: body.show_email ? auth.context.user.email : null,
    })
    return json({ id: materialId }, 201)
  })

  app.get('/api/issues/:id/briefing', async c => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const briefing: Briefing | null = await db.getLatestBriefing(c.env.DB, id)
    return json(briefing)
  })

  app.post('/api/issues/:id/briefing', async c => {
    // 志願者工具會產生 prompt 並回寫彙整／說明頁；與其他投稿一樣要求登入，
    // 才能確保工具使用與內容異動都有可追溯的帳號。
    const auth = await requireUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const issue = await db.getIssue(c.env.DB, id)
    if (!issue) return error('Issue not found', 404)
    let body: {
      consensus?: string
      disputes?: string
      positions?: string
      narrative?: string
      opinion_prompt?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    const version = await db.createBriefing(c.env.DB, id, auth.context.user.id, body)
    return json({ version }, 201)
  })

  app.put('/api/issues/:id/briefing', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    let body: {
      consensus?: string
      disputes?: string
      positions?: string
      narrative?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    const ok = await db.updateLatestBriefing(c.env.DB, id, body)
    if (!ok) return error('No briefing found', 404)
    return json({ ok: true })
  })

  // 投稿者只給管理端看：意見在前台是公開顯示的，不能連帶把投稿者曝光
  app.get('/api/issues/:id/opinions', async c => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const context = await tryGetAuthContext(c.env, c.req.raw.headers)
    const opinions: Opinion[] | OpinionWithAuthor[] = context && isAdminRole(context.role) ? await db.listOpinionsWithAuthor(c.env.DB, id) : await db.listOpinions(c.env.DB, id)
    const res = json(opinions)
    res.headers.set('Vary', 'Cookie')
    return res
  })

  // 意見投稿同樣需要登入（#9 的延伸，使用者裁示），並記錄投稿者以便問責。
  // 注意意見在前台是公開顯示的，所以 author_* 只回給管理員（見 GET 那支）。
  app.post('/api/issues/:id/opinions', async c => {
    const auth = await requireUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const issue = await db.getIssue(c.env.DB, id)
    if (!issue) return error('Issue not found', 404)
    let body: { summary?: string; show_email?: boolean }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (!body.summary?.trim()) return error('summary is required')
    const opinionId = await db.createOpinion(c.env.DB, id, {
      summary: body.summary.trim(),
      author_id: auth.context.user.id,
      author_name: auth.context.user.name || auth.context.user.email,
      author_email: body.show_email ? auth.context.user.email : null,
    })
    return json({ id: opinionId }, 201)
  })

  app.get('/api/issues/:id/prompt', async c => {
    // Prompt 是志願者工具的一部分，不對匿名使用者提供。
    const auth = await requireUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const type = c.req.query('type') ?? 'summarize'
    const materials = await db.listMaterialsForPrompt(c.env.DB, id)
    const issue: Issue | null = await db.getIssue(c.env.DB, id)
    if (!issue) return error('Issue not found', 404)
    if (materials.length === 0) return error('尚無素材，請先新增素材再生成 Prompt。')

    const materialsText = materials.map((m, i) => `【素材 ${i + 1}】來源：${m.source_name || '未知'}（${m.source_url || '無連結'}）\n立場：${m.stance}\n內容：\n${m.content}`).join('\n\n---\n\n')

    let prompt = ''
    if (type === 'summarize') {
      prompt = `你是一位公民審議助理。請根據以下關於「${issue.title}」的素材，整理出：\n\n1. **共識**：大多數立場都同意的事實或前提（2-4 點）\n2. **爭點**：各方有明顯分歧的核心問題（2-4 點）\n3. **立場地圖**：誰在乎哪些面向、各自的論據是什麼（分立場描述）\n\n要求：忠實呈現原始素材的內容，不添加立場判斷。格式使用繁體中文 Markdown。\n\n以下是素材：\n\n${materialsText}`
    } else if (type === 'narrative') {
      const briefing = await db.getLatestBriefing(c.env.DB, id)
      if (!briefing) return error('請先完成彙整再生成說明頁。')
      prompt = `你是一位公民議題編輯。請根據以下彙整結果，寫一份一頁式說明（800字以內，繁體中文）：\n\n議題：${issue.title}\n共識：${briefing.consensus}\n爭點：${briefing.disputes}\n立場地圖：${briefing.positions}`
    } else if (type === 'synthesis') {
      const opinions = await db.listOpinionSummaries(c.env.DB, id, 50)
      const briefing = await db.getLatestBriefing(c.env.DB, id)
      if (opinions.length === 0) return error('尚無民眾意見。')
      const opinionsText = opinions.map((o, i) => `【意見 ${i + 1}】\n${o.summary}`).join('\n\n---\n\n')
      prompt = `請分析以下 ${opinions.length} 份個人意見，與原有彙整比對，找出新觀點：\n\n原有共識：${briefing?.consensus ?? ''}\n原有爭點：${briefing?.disputes ?? ''}\n\n個人意見：\n${opinionsText}`
    } else {
      return error('Invalid prompt type')
    }

    return json({ prompt, type, material_count: materials.length })
  })
}
