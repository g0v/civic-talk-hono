import type {
  Briefing,
  Issue,
  IssueListItem,
  IssueStatus,
  Material,
  Opinion,
  Stance,
} from '../db/queries'
import * as db from '../db/queries'
import type { App, AppBindings } from './types'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
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
    }),
  )
}

function error(msg: string, status = 400): Response {
  return json({ error: msg }, status)
}

function checkAdmin(request: Request, env: AppBindings): boolean {
  const token = request.headers.get('X-Admin-Token')
  const password = env.ADMIN_PASSWORD || 'admin'
  return token === password
}

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function registerApiRoutes(app: App): void {
  app.options('/api/*', () => withCors(new Response(null, { status: 204 })))

  app.post('/api/admin/login', async (c) => {
    let body: { password?: string }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    const password = c.env.ADMIN_PASSWORD || 'admin'
    if (body.password === password) return json({ ok: true })
    return json({ ok: false }, 401)
  })

  app.get('/api/admin/stats', async (c) => {
    if (!checkAdmin(c.req.raw, c.env)) return error('Unauthorized', 401)
    const stats = await db.getAdminStats(c.env.DB)
    return json(stats)
  })

  app.get('/api/issues', async (c) => {
    const issues: IssueListItem[] = await db.listIssues(c.env.DB)
    return json(issues)
  })

  app.post('/api/issues', async (c) => {
    let body: { title?: string; description?: string; polis_id?: string | null }
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
    })
    return json({ id, title: body.title.trim() }, 201)
  })

  app.delete('/api/materials/:id', async (c) => {
    if (!checkAdmin(c.req.raw, c.env)) return error('Unauthorized', 401)
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    await db.deleteMaterial(c.env.DB, id)
    return json({ ok: true })
  })

  app.delete('/api/opinions/:id', async (c) => {
    if (!checkAdmin(c.req.raw, c.env)) return error('Unauthorized', 401)
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    await db.deleteOpinion(c.env.DB, id)
    return json({ ok: true })
  })

  app.get('/api/issues/:id', async (c) => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const detail = await db.getIssueDetail(c.env.DB, id)
    if (!detail) return error('Issue not found', 404)
    return json(detail)
  })

  app.put('/api/issues/:id', async (c) => {
    if (!checkAdmin(c.req.raw, c.env)) return error('Unauthorized', 401)
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

  app.delete('/api/issues/:id', async (c) => {
    if (!checkAdmin(c.req.raw, c.env)) return error('Unauthorized', 401)
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    await db.deleteIssueCascade(c.env.DB, id)
    return json({ ok: true })
  })

  app.get('/api/issues/:id/materials', async (c) => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const materials: Material[] = await db.listMaterials(c.env.DB, id)
    return json(materials)
  })

  app.post('/api/issues/:id/materials', async (c) => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const issue = await db.getIssue(c.env.DB, id)
    if (!issue) return error('Issue not found', 404)
    let body: {
      content?: string
      source_name?: string
      source_url?: string
      stance?: Stance
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
    })
    return json({ id: materialId }, 201)
  })

  app.get('/api/issues/:id/briefing', async (c) => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const briefing: Briefing | null = await db.getLatestBriefing(c.env.DB, id)
    return json(briefing)
  })

  app.post('/api/issues/:id/briefing', async (c) => {
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
    const version = await db.createBriefing(c.env.DB, id, body)
    return json({ version }, 201)
  })

  app.put('/api/issues/:id/briefing', async (c) => {
    if (!checkAdmin(c.req.raw, c.env)) return error('Unauthorized', 401)
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

  app.get('/api/issues/:id/opinions', async (c) => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const opinions: Opinion[] = await db.listOpinions(c.env.DB, id)
    return json(opinions)
  })

  app.post('/api/issues/:id/opinions', async (c) => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const issue = await db.getIssue(c.env.DB, id)
    if (!issue) return error('Issue not found', 404)
    let body: { summary?: string }
    try {
      body = await c.req.json()
    } catch {
      return error('Invalid JSON')
    }
    if (!body.summary?.trim()) return error('summary is required')
    const opinionId = await db.createOpinion(c.env.DB, id, body.summary.trim())
    return json({ id: opinionId }, 201)
  })

  app.get('/api/issues/:id/prompt', async (c) => {
    const id = parseId(c.req.param('id'))
    if (!id) return error('Invalid id')
    const type = c.req.query('type') ?? 'summarize'
    const materials = await db.listMaterialsForPrompt(c.env.DB, id)
    const issue: Issue | null = await db.getIssue(c.env.DB, id)
    if (!issue) return error('Issue not found', 404)
    if (materials.length === 0) return error('尚無素材，請先新增素材再生成 Prompt。')

    const materialsText = materials
      .map(
        (m, i) =>
          `【素材 ${i + 1}】來源：${m.source_name || '未知'}（${m.source_url || '無連結'}）\n立場：${m.stance}\n內容：\n${m.content}`,
      )
      .join('\n\n---\n\n')

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
      const opinionsText = opinions
        .map((o, i) => `【意見 ${i + 1}】\n${o.summary}`)
        .join('\n\n---\n\n')
      prompt = `請分析以下 ${opinions.length} 份個人意見，與原有彙整比對，找出新觀點：\n\n原有共識：${briefing?.consensus ?? ''}\n原有爭點：${briefing?.disputes ?? ''}\n\n個人意見：\n${opinionsText}`
    } else {
      return error('Invalid prompt type')
    }

    return json({ prompt, type, material_count: materials.length })
  })
}
