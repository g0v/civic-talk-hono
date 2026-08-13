import type { AbuseReportReason, AuthorSnapshotInput, Briefing, BriefingWithAuthor, Issue, IssueListItem, IssueListItemWithAuthor, IssueStatus, Material, MaterialWithAuthor, Opinion, OpinionWithAuthor, Stance } from '../db/queries'
import * as db from '../db/queries'
import { isAdminRole, tryGetAuthContext, type AuthContext } from '../auth/authorization'
import { createAuth } from '../auth/createAuth'
import { TERMS_VERSION } from '../legal/terms'
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

type SubmissionOptions = {
  show_email?: unknown
  terms_accepted?: unknown
}

export function validateSubmissionOptions(body: SubmissionOptions): Response | null {
  if (body.terms_accepted !== true) return error('terms_accepted must be true')
  if (body.show_email !== undefined && typeof body.show_email !== 'boolean') return error('show_email must be a boolean')
  return null
}

export function buildAuthorSnapshot(user: AuthContext['user'], showEmail: boolean): AuthorSnapshotInput {
  const name = user.name?.trim()
  return {
    author_id: user.id,
    // 公開名稱不可退回 email，否則未勾選公開 email 仍可能經 author_name 洩漏。
    author_name: name || null,
    author_email: user.email,
    show_email: showEmail,
  }
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

  // 一般讀取只拿公開作者投影；管理員另拿完整快照與條款同意記錄。
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
    let body: { title?: string; description?: string; polis_id?: string | null } & SubmissionOptions
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (!body.title?.trim()) return error('title is required')
    const invalidOptions = validateSubmissionOptions(body)
    if (invalidOptions) return invalidOptions
    const id = await db.createIssue(c.env.DB, {
      title: body.title.trim(),
      description: body.description ?? '',
      polis_id: body.polis_id ?? null,
      ...buildAuthorSnapshot(auth.context.user, body.show_email === true),
      terms_version: TERMS_VERSION,
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

  // 一般讀取公開顯示名稱與 opt-in email；管理員另拿完整快照與條款同意記錄。
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
    } & SubmissionOptions
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (!body.content?.trim()) return error('content is required')
    const invalidOptions = validateSubmissionOptions(body)
    if (invalidOptions) return invalidOptions
    const materialId = await db.createMaterial(c.env.DB, id, {
      content: body.content.trim(),
      source_name: body.source_name ?? '',
      source_url: body.source_url ?? '',
      stance: body.stance ?? 'unknown',
      ...buildAuthorSnapshot(auth.context.user, body.show_email === true),
      terms_version: TERMS_VERSION,
    })
    return json({ id: materialId }, 201)
  })

  app.get('/api/issues/:id/briefing', async c => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const context = await tryGetAuthContext(c.env, c.req.raw.headers)
    const briefing: Briefing | BriefingWithAuthor | null =
      context && isAdminRole(context.role) ? await db.getLatestBriefingWithAuthor(c.env.DB, id) : await db.getLatestBriefing(c.env.DB, id)
    const res = json(briefing)
    res.headers.set('Vary', 'Cookie')
    return res
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
      show_email?: unknown
    }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (body.show_email !== undefined && typeof body.show_email !== 'boolean') return error('show_email must be a boolean')
    // 說明頁公開顯示投稿當下名稱；email 僅在 show_email = true 時公開。
    const version = await db.createBriefing(c.env.DB, id, buildAuthorSnapshot(auth.context.user, body.show_email === true), body)
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

  // 一般讀取公開顯示名稱與 opt-in email；管理員另拿完整快照與條款同意記錄。
  app.get('/api/issues/:id/opinions', async c => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const context = await tryGetAuthContext(c.env, c.req.raw.headers)
    const opinions: Opinion[] | OpinionWithAuthor[] = context && isAdminRole(context.role) ? await db.listOpinionsWithAuthor(c.env.DB, id) : await db.listOpinions(c.env.DB, id)
    const res = json(opinions)
    res.headers.set('Vary', 'Cookie')
    return res
  })

  // 意見投稿同樣需要登入（#9 的延伸，使用者裁示），並記錄完整作者快照以便問責。
  app.post('/api/issues/:id/opinions', async c => {
    const auth = await requireUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const issue = await db.getIssue(c.env.DB, id)
    if (!issue) return error('Issue not found', 404)
    let body: { summary?: string } & SubmissionOptions
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (!body.summary?.trim()) return error('summary is required')
    const invalidOptions = validateSubmissionOptions(body)
    if (invalidOptions) return invalidOptions
    const opinionId = await db.createOpinion(c.env.DB, id, {
      summary: body.summary.trim(),
      ...buildAuthorSnapshot(auth.context.user, body.show_email === true),
      terms_version: TERMS_VERSION,
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

  // POST /api/abuse-reports — 登入者回報濫用（需登入，不看角色）
  app.post('/api/abuse-reports', async c => {
    const auth = await requireUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied

    let body: {
      material_id?: unknown
      briefing_id?: unknown
      opinion_id?: unknown
      reason?: unknown
      description?: unknown
    }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }

    const materialId = typeof body.material_id === 'number' && body.material_id > 0 ? body.material_id : null
    const briefingId = typeof body.briefing_id === 'number' && body.briefing_id > 0 ? body.briefing_id : null
    const opinionId = typeof body.opinion_id === 'number' && body.opinion_id > 0 ? body.opinion_id : null
    const nonNullCount = [materialId, briefingId, opinionId].filter(v => v !== null).length
    if (nonNullCount !== 1) return error('Exactly one of material_id, briefing_id, opinion_id must be a positive number')

    const validReasons: AbuseReportReason[] = ['spam', 'hate_speech', 'defamation', 'misinformation', 'other']
    if (!body.reason || !validReasons.includes(body.reason as AbuseReportReason)) {
      return error('reason must be one of: ' + validReasons.join(', '))
    }

    const descriptionRaw = typeof body.description === 'string' ? body.description.trim() : null
    const user = auth.context.user
    await db.createAbuseReport(c.env.DB, {
      reporter_id: user.id,
      reporter_name: user.name?.trim() || null,
      reporter_email: user.email,
      reason: body.reason as AbuseReportReason,
      description: descriptionRaw || null,
      material_id: materialId,
      briefing_id: briefingId,
      opinion_id: opinionId,
    })

    return json({ ok: true }, 201)
  })

  // GET /api/admin/abuse-reports — 管理端查看所有濫用回報
  app.get('/api/admin/abuse-reports', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const reports = await db.listAbuseReports(c.env.DB)
    return json(reports)
  })

  // PATCH /api/admin/abuse-reports/:id/resolve — 審核濫用回報：誤報或確認濫用
  // 誤報   → 停權回報者（ban）→ 清除旗標 → resolved_false
  // 確認濫用 → 停權張貼者（ban）→ resolved_abuse（旗標維持）
  //
  // ban 先做，成功後才寫 DB——確保失敗時 review_status 保持 pending，
  // 前端拿到真實錯誤碼而非假的 { ok: true }。
  // 只有 super-admin（adminAc）的 session 帶入 headers 才能通過 Better Auth 的 banUser
  // hasPermission 檢查；admin role（userAc）會得到 FORBIDDEN，這是刻意行為。
  app.patch('/api/admin/abuse-reports/:id/resolve', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied

    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid ID', 400)

    let body: { action?: unknown }
    try { body = await c.req.json() } catch { return error('Invalid JSON') }
    if (body.action !== 'false_report' && body.action !== 'confirmed_abuse') {
      return error('action must be "false_report" or "confirmed_abuse"')
    }

    const report = await db.getAbuseReport(c.env.DB, id)
    if (!report) return error('Report not found', 404)
    if (report.review_status !== 'pending') return error('Report already resolved', 409)

    const targetUserId = body.action === 'false_report' ? report.reporter_id : report.target_author_id
    const banReason = body.action === 'false_report' ? '濫用回報：誤報，已停權' : '發布違規內容：已確認濫用'

    // ban 先做——失敗時直接拋出（FORBIDDEN、user-not-found 等），DB 不更新
    if (targetUserId) {
      await createAuth(c.env).api.banUser({
        body: { userId: targetUserId, banReason },
        headers: c.req.raw.headers,
      })
    }

    // ban 成功（或無 userId 需要 ban）才更新業務 DB
    if (body.action === 'false_report') {
      await db.resolveAbuseReport(c.env.DB, id, 'resolved_false')
      await db.unflagContent(c.env.DB, report)
    } else {
      await db.resolveAbuseReport(c.env.DB, id, 'resolved_abuse')
    }

    return json({ ok: true })
  })
}
