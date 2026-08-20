import type {
  AbuseReportReason,
  AuthorSnapshotInput,
  Briefing,
  BriefingWithAuthor,
  Issue,
  IssueListItem,
  IssueListItemWithAuthor,
  IssueStatus,
  Material,
  MaterialWithAuthor,
  Opinion,
  OpinionWithAuthor,
  Stance,
  ModerationSubmissionType,
} from '../db/queries'
import * as db from '../db/queries'
import { isAdminRole, tryGetAuthContext, type AuthContext } from '../auth/authorization'
import { createAuth } from '../auth/createAuth'
import { TERMS_VERSION } from '../legal/terms'
import { moderationReasonForPolicy, moderateSubmission, moderateSubmissionWithDiagnostics, type ModerationDecision, type ModerationSubmission } from '../moderation/service'
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
  if (context.banned) return error('Forbidden: account is banned', 403)
  if (!isAdminRole(context.role)) return error('Forbidden', 403)
  return null
}
async function adminBanUser(request: Request, env: AppBindings, userId: string, banReason: string): Promise<Response | null> {
  try {
    await createAuth(env).api.banUser({
      body: { userId, banReason },
      headers: request.headers,
    })
    return null
  } catch (banErr) {
    const apiErr = banErr as { statusCode?: number; body?: { message?: string } }
    const status = typeof apiErr.statusCode === 'number' ? apiErr.statusCode : 500
    const message = apiErr.body?.message ?? 'Ban failed'
    console.error('banUser failed', { userId, caught: banErr })
    return error(message, status)
  }
}

async function adminUnbanUser(request: Request, env: AppBindings, userId: string): Promise<Response | null> {
  try {
    await createAuth(env).api.unbanUser({
      body: { userId },
      headers: request.headers,
    })
    return null
  } catch (unbanErr) {
    const apiErr = unbanErr as { statusCode?: number; body?: { message?: string } }
    const status = typeof apiErr.statusCode === 'number' ? apiErr.statusCode : 500
    const message = apiErr.body?.message ?? 'Unban failed'
    console.error('unbanUser failed', { userId, caught: unbanErr })
    return error(message, status)
  }
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
  if (context.banned) return { denied: error('Forbidden: account is banned', 403) }
  return { context }
}

/**
 * 申訴守衛只要求仍有有效 session，不檢查 banned；
 * 被停權的人仍可送出申訴。這支只用在申訴端點，不可拿來寫投稿。
 */
async function requireAppealUser(request: Request, env: AppBindings): Promise<{ context: AuthContext } | { denied: Response }> {
  const context = await tryGetAuthContext(env, request.headers)
  if (!context) return { denied: error('Unauthorized', 401) }
  return { context }
}

const PREVIEW_FIELDS: Record<ModerationSubmissionType, string> = {
  issue: 'description',
  material: 'content',
  opinion: 'summary',
  briefing: 'consensus',
}

function isModerationSubmissionType(value: string): value is ModerationSubmissionType {
  return value === 'issue' || value === 'material' || value === 'opinion' || value === 'briefing'
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
type SubmissionModeration = {
  decision: ModerationDecision
  hidden: boolean
}

async function moderateSubmissionForWrite(request: Request, env: AppBindings, submission: ModerationSubmission): Promise<SubmissionModeration> {
  const decision = await moderateSubmission(env.OPEN_ROUTER_API_KEY, env.ASSETS, request.url, submission)
  return { decision, hidden: decision.outcome === 'violation' }
}

function moderationMetadata(decision: Extract<ModerationDecision, { outcome: 'violation' }>, reportId: number | undefined) {
  return {
    hidden: true,
    policy_code: decision.policy_code,
    rationale: decision.rationale,
    report_id: reportId ?? null,
    appeal_allowed: true,
  }
}

function logModerationAuditFailure(kind: string, error: unknown): void {
  console.error('ai_moderation_audit_failure', {
    kind,
    error: error instanceof Error ? error.name : 'unknown',
  })
}

async function recordModerationViolation(
  env: AppBindings,
  context: AuthContext,
  submission: ModerationSubmission,
  decision: Extract<ModerationDecision, { outcome: 'violation' }>,
  target: { issue_id: number | null; material_id: number | null; briefing_id: number | null; opinion_id: number | null }
): Promise<number | undefined> {
  const user = context.user
  try {
    return await db.createAiModerationReport(env.DB, {
      user_id: user.id,
      user_name: user.name?.trim() || null,
      user_email: user.email,
      policy_code: decision.policy_code,
      reason: moderationReasonForPolicy(decision.policy_code),
      submission_type: submission.type,
      content_snapshot: JSON.stringify(submission.fields),
      description: decision.rationale,
      ...target,
    })
  } catch (error) {
    logModerationAuditFailure('create_ai_moderation_report', error)
    return undefined
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
  // GET /api/me/moderation-reports — 只回傳目前登入者待複核的 AI 回報。
  app.get('/api/me/moderation-reports', async c => {
    const auth = await requireUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied
    return json(await db.listPendingAiModerationReportsForUser(c.env.DB, auth.context.user.id))
  })
  // GET /api/me/appealable-moderation-items — 新的集中式「濫用與申訴」頁面資料。
  // 與投稿守衛不同，停權者必須能讀到帳號停權項目並提出申訴。
  app.get('/api/me/appealable-moderation-items', async c => {
    const auth = await requireAppealUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied
    const userId = auth.context.user.id
    const [reports, accountBanAppealPending] = await Promise.all([
      db.listAppealableAiModerationReportsForUser(c.env.DB, userId),
      auth.context.banned ? db.findPendingModerationAppeal(c.env.DB, userId, null, 'account_ban') : Promise.resolve(false),
    ])
    return json({
      account_ban: auth.context.banned && !accountBanAppealPending,
      reports,
    })
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
    const moderation = await moderateSubmissionForWrite(c.req.raw, c.env, {
      type: 'issue',
      fields: {
        title: body.title.trim(),
        description: body.description ?? '',
      },
    })
    const id = await db.createIssue(
      c.env.DB,
      {
        title: body.title.trim(),
        description: body.description ?? '',
        polis_id: body.polis_id ?? null,
        ...buildAuthorSnapshot(auth.context.user, body.show_email === true),
        terms_version: TERMS_VERSION,
      },
      { moderationHidden: moderation.hidden }
    )
    if (!moderation.hidden || moderation.decision.outcome !== 'violation') return json({ id, title: body.title.trim() }, 201)
    const reportId = await recordModerationViolation(
      c.env,
      auth.context,
      {
        type: 'issue',
        fields: {
          title: body.title.trim(),
          description: body.description ?? '',
        },
      },
      moderation.decision,
      { issue_id: id, material_id: null, briefing_id: null, opinion_id: null }
    )
    return json({ id, title: body.title.trim(), moderation: moderationMetadata(moderation.decision, reportId) }, 201)
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
    const submission: ModerationSubmission = {
      type: 'material',
      fields: {
        source_name: body.source_name ?? '',
        source_url: body.source_url ?? '',
        stance: body.stance ?? 'unknown',
        content: body.content.trim(),
      },
    }
    const moderation = await moderateSubmissionForWrite(c.req.raw, c.env, submission)
    const materialId = await db.createMaterial(
      c.env.DB,
      id,
      {
        content: body.content.trim(),
        source_name: body.source_name ?? '',
        source_url: body.source_url ?? '',
        stance: body.stance ?? 'unknown',
        ...buildAuthorSnapshot(auth.context.user, body.show_email === true),
        terms_version: TERMS_VERSION,
      },
      { moderationHidden: moderation.hidden, skipStatusTransition: moderation.hidden }
    )
    if (!moderation.hidden || moderation.decision.outcome !== 'violation') return json({ id: materialId }, 201)
    const reportId = await recordModerationViolation(c.env, auth.context, submission, moderation.decision, {
      issue_id: null,
      material_id: materialId,
      briefing_id: null,
      opinion_id: null,
    })
    return json({ id: materialId, moderation: moderationMetadata(moderation.decision, reportId) }, 201)
  })

  app.get('/api/issues/:id/briefing', async c => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const context = await tryGetAuthContext(c.env, c.req.raw.headers)
    const briefing: Briefing | BriefingWithAuthor | null = context && isAdminRole(context.role) ? await db.getLatestBriefingWithAuthor(c.env.DB, id) : await db.getLatestBriefing(c.env.DB, id)
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
    const submission: ModerationSubmission = {
      type: 'briefing',
      fields: {
        consensus: body.consensus ?? '',
        disputes: body.disputes ?? '',
        positions: body.positions ?? '',
        narrative: body.narrative ?? '',
        opinion_prompt: body.opinion_prompt ?? '',
      },
    }
    const moderation = await moderateSubmissionForWrite(c.req.raw, c.env, submission)
    // 說明頁公開顯示投稿當下名稱；email 僅在 show_email = true 時公開。
    const version = await db.createBriefing(c.env.DB, id, buildAuthorSnapshot(auth.context.user, body.show_email === true), body, {
      moderationHidden: moderation.hidden,
      skipStatusTransition: moderation.hidden,
    })
    if (!moderation.hidden || moderation.decision.outcome !== 'violation') return json({ version }, 201)
    const briefingId = await db.getBriefingIdByVersion(c.env.DB, id, version)
    const reportId =
      briefingId === null
        ? undefined
        : await recordModerationViolation(c.env, auth.context, submission, moderation.decision, {
            issue_id: null,
            material_id: null,
            briefing_id: briefingId,
            opinion_id: null,
          })
    return json({ version, moderation: moderationMetadata(moderation.decision, reportId) }, 201)
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
    const submission: ModerationSubmission = {
      type: 'opinion',
      fields: { summary: body.summary.trim() },
    }
    const moderation = await moderateSubmissionForWrite(c.req.raw, c.env, submission)
    const opinionId = await db.createOpinion(
      c.env.DB,
      id,
      {
        summary: body.summary.trim(),
        ...buildAuthorSnapshot(auth.context.user, body.show_email === true),
        terms_version: TERMS_VERSION,
      },
      { moderationHidden: moderation.hidden }
    )
    if (!moderation.hidden || moderation.decision.outcome !== 'violation') return json({ id: opinionId }, 201)
    const reportId = await recordModerationViolation(c.env, auth.context, submission, moderation.decision, {
      issue_id: null,
      material_id: null,
      briefing_id: null,
      opinion_id: opinionId,
    })
    return json({ id: opinionId, moderation: moderationMetadata(moderation.decision, reportId) }, 201)
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

    const validReasons: AbuseReportReason[] = ['spam', 'hate_speech', 'defamation', 'misinformation', 'other', 'broken_link']
    if (!body.reason || !validReasons.includes(body.reason as AbuseReportReason)) {
      return error('reason must be one of: ' + validReasons.join(', '))
    }

    // broken_link 回報只允許 material_id（素材才有 source_url）
    if (body.reason === 'broken_link' && (briefingId !== null || opinionId !== null)) {
      return error('broken_link reports only support material_id')
    }

    // 同一筆內容若已有 pending 回報，拒絕重複送出
    const alreadyPending = await db.findPendingReportForTarget(c.env.DB, {
      material_id: materialId,
      briefing_id: briefingId,
      opinion_id: opinionId,
    })
    if (alreadyPending) return error('此內容已有待審核的回報，請等待管理員處理後再回報', 409)

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

  // POST /api/appeals — 被拒投稿／帳號停權的申訴；停權者仍可使用。
  app.post('/api/appeals', async c => {
    const auth = await requireAppealUser(c.req.raw, c.env)
    if ('denied' in auth) return auth.denied

    let body: { abuse_report_id?: unknown; appeal_type?: unknown; content_snapshot?: unknown; message?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (body.appeal_type !== 'rejected_submission' && body.appeal_type !== 'account_ban') {
      return error('appeal_type must be "rejected_submission" or "account_ban"')
    }
    const reportId = typeof body.abuse_report_id === 'number' && body.abuse_report_id > 0 ? body.abuse_report_id : null
    if (body.appeal_type === 'rejected_submission' && reportId === null) return error('abuse_report_id is required for rejected submission appeals')

    const report = reportId === null ? null : await db.getAiAbuseReportForUser(c.env.DB, reportId, auth.context.user.id)
    if (reportId !== null && !report) return error('Moderation report not found', 404)
    if (body.appeal_type === 'account_ban' && !auth.context.banned) return error('No active account ban to appeal', 409)
    if (report && report.review_status !== 'pending' && body.appeal_type === 'rejected_submission') {
      return error('Moderation report already resolved', 409)
    }

    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) return error('message is required')
    if (message.length > 10_000) return error('message is too long')
    if (await db.findPendingModerationAppeal(c.env.DB, auth.context.user.id, reportId, body.appeal_type)) {
      return error('An appeal is already pending', 409)
    }

    const submittedSnapshot = typeof body.content_snapshot === 'string' ? body.content_snapshot.trim() : null
    const appealId = await db.createModerationAppeal(c.env.DB, {
      user_id: auth.context.user.id,
      user_name: auth.context.user.name?.trim() || null,
      user_email: auth.context.user.email,
      abuse_report_id: reportId,
      appeal_type: body.appeal_type,
      content_snapshot: report?.content_snapshot ?? submittedSnapshot,
      message,
    })
    return json({ id: appealId, status: 'pending' }, 201)
  })

  // GET /api/admin/moderation/appeals — 管理端查看拒絕／帳號停權申訴。
  app.get('/api/admin/moderation/appeals', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    return json(await db.listModerationAppeals(c.env.DB))
  })

  app.get('/api/admin/moderation/preview', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied

    const text = c.req.query('text')?.trim() ?? ''
    if (!text) return error('text is required')
    const rawType = c.req.query('type') ?? 'opinion'
    if (!isModerationSubmissionType(rawType)) return error('type must be "issue", "material", "opinion", or "briefing"')

    const evaluation = await moderateSubmissionWithDiagnostics(c.env.OPEN_ROUTER_API_KEY, c.env.ASSETS, c.req.url, {
      type: rawType,
      fields: { [PREVIEW_FIELDS[rawType]]: text },
    })
    return json({
      type: rawType,
      verdict: evaluation.model?.verdict ?? null,
      policy_code: evaluation.model?.policy_code ?? null,
      rationale: evaluation.model?.rationale ?? null,
      confidence: evaluation.model?.confidence ?? null,
      decision: evaluation.decision,
      finish_reason: evaluation.diagnostics.finish_reason,
      usage: evaluation.diagnostics.usage,
      failure_kind: evaluation.diagnostics.failure_kind,
    })
  })

  // PATCH /api/admin/moderation/appeals/:id/resolve — 維持或推翻申訴。
  // 帳號停權申訴的 uphold/overturn 會先透過 Better Auth ban/unban，再更新本地記錄。
  app.patch('/api/admin/moderation/appeals/:id/resolve', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid ID', 400)
    let body: { action?: unknown; review_note?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (body.action !== 'uphold' && body.action !== 'overturn') return error('action must be "uphold" or "overturn"')
    const appeal = await db.getModerationAppeal(c.env.DB, id)
    if (!appeal) return error('Appeal not found', 404)
    if (appeal.status !== 'pending') return error('Appeal already resolved', 409)
    const admin = await tryGetAuthContext(c.env, c.req.raw.headers)
    if (!admin) return error('Unauthorized', 401)

    if (appeal.appeal_type === 'account_ban') {
      let targetBanned = false
      try {
        const target = await createAuth(c.env).api.getUser({ query: { id: appeal.user_id }, headers: c.req.raw.headers })
        targetBanned = target?.banned === true
      } catch {
        return error('User not found', 404)
      }
      if (body.action === 'uphold' && !targetBanned) {
        const banError = await adminBanUser(c.req.raw, c.env, appeal.user_id, '帳號申訴維持：管理員確認停權')
        if (banError) return banError
      } else if (body.action === 'overturn' && targetBanned) {
        const unbanError = await adminUnbanUser(c.req.raw, c.env, appeal.user_id)
        if (unbanError) return unbanError
      }
    }

    if (appeal.abuse_report_id !== null) {
      const report = await db.getAbuseReport(c.env.DB, appeal.abuse_report_id)
      if (!report) return error('Moderation report not found', 404)
      await db.resolveAbuseReport(c.env.DB, appeal.abuse_report_id, body.action === 'uphold' ? 'resolved_abuse' : 'resolved_false')
      if (body.action === 'uphold') await db.confirmFlagContent(c.env.DB, report)
      else await db.unflagContent(c.env.DB, report)
    }
    await db.resolveModerationAppeal(
      c.env.DB,
      id,
      body.action === 'uphold' ? 'upheld' : 'overturned',
      { id: admin.user.id, name: admin.user.name?.trim() || null },
      typeof body.review_note === 'string' ? body.review_note.trim() || null : null
    )
    return json({ ok: true })
  })
  // 使用 Better Auth admin plugin getUser，不對 DB_AUTH 下自訂 SQL（不變量 11）。
  // 用途：確認某投稿者提交後是否改名換 email，或目前是否已被停權。
  app.get('/api/admin/users/:userId', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied

    const userId = c.req.param('userId')
    if (!userId) return error('userId is required', 400)

    try {
      const result = await createAuth(c.env).api.getUser({
        query: { id: userId },
        headers: c.req.raw.headers,
      })
      if (!result) return error('User not found', 404)
      // 只回傳管理端需要的欄位，不把整個 session 物件洩漏出去
      return json({
        id: result.id,
        name: result.name,
        email: result.email,
        role: result.role ?? null,
        banned: result.banned ?? false,
        banReason: result.banReason ?? null,
      })
    } catch {
      return error('User not found', 404)
    }
  })

  // GET /api/admin/abuse-reports — 管理端查看所有濫用回報
  app.get('/api/admin/abuse-reports', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied
    const reports = await db.listAbuseReports(c.env.DB)
    return json(reports)
  })

  // 誤報 → 使用者回報時停權回報者；AI 回報誤報不處置任何人；→ 清除旗標 → resolved_false
  // 確認濫用 → 停權張貼者（ban）→ resolved_abuse（旗標維持）
  //
  // ban 先做，成功後才寫 DB——確保失敗時 review_status 保持 pending，
  // 前端拿到真實錯誤碼而非假的 { ok: true }。
  // ban 操作只有 super-admin（adminAc）的 session 才能通過 Better Auth hasPermission 檢查；
  // admin role（userAc）會得到 FORBIDDEN（403）。APIError 在此 catch 後直接轉譯 status + message，
  // 避免錯誤被 Hono 攔截成 500（例如「You cannot ban yourself」原本就是 400）。
  app.patch('/api/admin/abuse-reports/:id/resolve', async c => {
    const denied = await requireAdmin(c.req.raw, c.env)
    if (denied) return denied

    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid ID', 400)

    let body: { action?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (body.action !== 'false_report' && body.action !== 'confirmed_abuse' && body.action !== 'confirmed_broken') {
      return error('action must be "false_report", "confirmed_abuse", or "confirmed_broken"')
    }

    const report = await db.getAbuseReport(c.env.DB, id)
    if (!report) return error('Report not found', 404)
    if (report.review_status !== 'pending') return error('Report already resolved', 409)

    // AI 回報的 reporter_id 是投稿者本人；確認誤報時絕不因同一個人被誤判而停權。
    // ban 先做，且只有 confirmed_abuse 或一般使用者誤報需要 ban。
    const shouldBan = body.action === 'confirmed_abuse' || (body.action === 'false_report' && report.source !== 'ai' && report.reason !== 'broken_link')

    if (shouldBan) {
      const targetUserId = body.action === 'false_report' ? report.reporter_id : report.target_author_id
      const banReason = body.action === 'false_report' ? '濫用回報：誤報，已停權' : '發布違規內容：已確認濫用'
      // ban 先做——Better Auth 的 APIError 會帶 statusCode 與 body.message，
      // catch 後直接轉譯回前端（FORBIDDEN 403、BAD_REQUEST 400 等），DB 不更新。
      if (targetUserId) {
        try {
          await createAuth(c.env).api.banUser({
            body: { userId: targetUserId, banReason },
            headers: c.req.raw.headers,
          })
        } catch (banErr) {
          const apiErr = banErr as { statusCode?: number; body?: { message?: string } }
          const status = typeof apiErr.statusCode === 'number' ? apiErr.statusCode : 500
          const message = apiErr.body?.message ?? 'Ban failed'
          console.error('banUser failed', { reportId: id, action: body.action, caught: banErr })
          return error(message, status)
        }
      }
    }

    // ban 成功（或不需要 ban）才更新業務 DB
    if (body.action === 'false_report') {
      await db.resolveAbuseReport(c.env.DB, id, 'resolved_false')
      await db.unflagContent(c.env.DB, report)
    } else if (body.action === 'confirmed_broken') {
      await db.resolveAbuseReport(c.env.DB, id, 'resolved_broken')
      await db.confirmFlagContent(c.env.DB, report)
    } else {
      await db.resolveAbuseReport(c.env.DB, id, 'resolved_abuse')
      await db.confirmFlagContent(c.env.DB, report)
    }

    return json({ ok: true })
  })
}
