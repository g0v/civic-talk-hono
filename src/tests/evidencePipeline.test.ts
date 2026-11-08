/// <reference lib="es2024.promise" />
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Hono } from 'hono'
import type { WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { apiCsrf } from '../api/csrf'
import type { EvidenceBindings } from '../ai/env'
import { registerEvidenceRoutes } from '../ai/routes'
import { runEvidenceWorkflow } from '../ai/runner'
import { statusOverview } from '../ai/overviewStatus'
import { EvidenceStore, EvidenceStoreError, type ArtifactSummary } from '../ai/store'
import { sha256, SOURCE_NAMESPACE } from '../ai/source'
import type { CompletedDraft } from '../ai/generation'

type DraftResponse = CompletedDraft & { diagnostics: { generation: { completion: unknown } } }

const auth = vi.hoisted(() => ({ current: null as null | { user: { id: string; name: string; email: string; image: null }; role: 'user' | 'admin'; banned: boolean; nameChangeCooldownDays: null } }))
vi.mock('../auth/authorization', () => ({
  tryGetAuthContext: async () => auth.current,
  hasDuplicateDisplayName: async () => false,
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
}))

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(':memory:')
  constructor(sql: string) {
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    this.sqlite.exec(sql)
  }
  prepare(sql: string) {
    const sqlite = this.sqlite
    class Statement {
      constructor(readonly values: SQLInputValue[] = []) {}
      bind(...values: SQLInputValue[]) {
        return new Statement(values)
      }
      execute() {
        const result = sqlite.prepare(sql).run(...this.values)
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      }
      async run() {
        return this.execute()
      }
      async first<T>() {
        return (sqlite.prepare(sql).get(...this.values) ?? null) as T | null
      }
      async all<T>() {
        return { success: true, results: sqlite.prepare(sql).all(...this.values) as T[] }
      }
    }
    return new Statement()
  }
  async batch(statements: Array<{ execute(): unknown }>) {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map(statement => statement.execute())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
  asD1(): D1Database {
    return this as unknown as D1Database
  }
}

const user = (id: string, role: 'user' | 'admin' = 'user', banned = false) => ({ user: { id, name: id, email: `${id}@example.test`, image: null }, role, banned, nameChangeCooldownDays: null })
let local: SQLiteD1
let source: SQLiteD1
let app!: Hono<{ Bindings: EvidenceBindings }>
let env!: EvidenceBindings
let recordedRequests: unknown[]
let stepOutputs: unknown[]
let instances: Map<string, 'running' | 'waiting' | 'errored' | 'complete' | 'terminated' | 'unknown'>
let restarts: number
let workflowCreates: number
let workflowProbeFailure: 'get' | 'status' | null
let aiRun: (model: string, input: unknown) => Promise<unknown>

const requestHeaders = { 'Content-Type': 'application/json', Origin: 'http://localhost' }
const GENERATION_MODEL = '@cf/google/gemma-4-26b-a4b-it'
function send(method: string, path: string, body?: unknown) {
  return app.request(`http://localhost${path}`, { method, headers: requestHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
}
function testStep() {
  return {
    async do(_name: string, _config: unknown, callback: () => Promise<unknown>) {
      const result = await callback()
      stepOutputs.push(result)
      return result
    },
  } as unknown as WorkflowStep
}

type RetryStepConfig = { retries: { limit: number; delay?: string; backoff?: string }; timeout?: string }
function retryingStep(invoke?: (name: string, attempt: number, callback: () => Promise<unknown>) => Promise<unknown>) {
  const attempts = new Map<string, number>()
  const configs = new Map<string, RetryStepConfig>()
  const failures = new Map<string, unknown[]>()
  const step = {
    async do(name: string, config: RetryStepConfig, callback: () => Promise<unknown>) {
      configs.set(name, config)
      let number = 0
      while (true) {
        number++
        attempts.set(name, number)
        try {
          const result = invoke ? await invoke(name, number, callback) : await callback()
          stepOutputs.push(result)
          return result
        } catch (error) {
          const previous = failures.get(name)
          if (previous) previous.push(error)
          else failures.set(name, [error])
          if (number > config.retries.limit) throw error
        }
      }
    },
  } as unknown as WorkflowStep
  return { step, attempts, configs, failures }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('invalid test input')
  return value as Record<string, unknown>
}

function generationResponse(data: unknown) {
  return {
    object: 'chat.completion',
    model: 'gemma-4-26b-a4b-it',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(data), refusal: null } }],
    usage: { prompt_tokens: 200, completion_tokens: 80 },
  }
}

async function model(modelName: string, input: unknown): Promise<unknown> {
  recordedRequests.push(input)
  const request = object(input)
  if (modelName === '@cf/cloudflare/clairic') {
    const content = String(request.state)
    return {
      model: 'clairic',
      truncated: false,
      state_text: content,
      answers: { claims: { type: 'list', value: [content], spans: [[0, content.length]] } },
      usage: { input_tokens: 100, output_tokens: 0 },
    }
  }
  if (modelName === '@cf/cloudflare/clef') {
    const questions = object(request.questions)
    return {
      model: 'clef',
      answers: Object.fromEntries(
        Object.keys(questions).map(id => [id, { type: 'choice', choice: 'agree', probabilities: { agree: 0.91, disagree: 0.03, unrelated: 0.03, uncertain: 0.03 }, confidence: 0.91 }])
      ),
      usage: { input_tokens: 120, output_tokens: 0 },
    }
  }
  if (modelName === GENERATION_MODEL) {
    // 合成 provider 只接受本輪使用的原生結構化輸入，不模擬語義品質保證。
    const allowed = ['messages', 'max_completion_tokens', 'temperature', 'chat_template_kwargs', 'stream', 'response_format']
    const messages = request.messages
    const format = object(request.response_format)
    const schema = object(format.json_schema)
    if (
      Object.keys(request).some(key => !allowed.includes(key)) ||
      !Array.isArray(messages) ||
      messages.length !== 2 ||
      object(messages[0]).role !== 'system' ||
      typeof object(messages[0]).content !== 'string' ||
      object(messages[1]).role !== 'user' ||
      typeof object(messages[1]).content !== 'string' ||
      !Number.isSafeInteger(request.max_completion_tokens) ||
      Number(request.max_completion_tokens) <= 0 ||
      object(request.chat_template_kwargs).enable_thinking !== false ||
      request.stream !== false ||
      format.type !== 'json_schema' ||
      schema.strict !== true ||
      typeof schema.name !== 'string' ||
      object(schema.schema).type !== 'object'
    ) {
      throw new Error('unsupported native generation request')
    }
    const generatedInput = JSON.parse(String(object(messages[1]).content)) as
      | { operation: 'fill_missing_fields'; base_hash: string; targets: Array<{ pointer: string; evidence_ids: string[] }>; section?: never }
      | { section: 'consensus'; evidence: Array<{ id: string }>; comparison: { consensus_groups: Array<{ candidate_id: string; evidence_ids: string[] }> }; operation?: never }
      | { section: 'disputes' | 'positions'; evidence: Array<{ id: string }>; operation?: never }
    const expectedName = generatedInput.operation === 'fill_missing_fields' ? 'evidence_completion' : `evidence_${generatedInput.section}`
    if (schema.name !== expectedName) throw new Error('unsupported native generation schema')
    if (generatedInput.operation === 'fill_missing_fields') {
      const data = {
        base_hash: generatedInput.base_hash,
        fills: generatedInput.targets.map(target => ({ pointer: target.pointer, sentences: [{ text: '補完欄位。', evidence_ids: target.evidence_ids }] })),
      }
      return generationResponse(data)
    }
    const cite = (text: string, ids: string[]) => [{ text, evidence_ids: ids }]
    const groups = generatedInput.section === 'consensus' ? generatedInput.comparison.consensus_groups : []
    const group = groups[0]
    const ids = generatedInput.evidence.map(item => item.id)
    const data =
      generatedInput.section === 'consensus'
        ? {
            Overview: group ? cite('相容主張的摘要。', group.evidence_ids) : null,
            items: group
              ? [
                  {
                    candidate_id: group.candidate_id,
                    evidence_ids: group.evidence_ids,
                    kind: 'shared_position',
                    Title: cite('相容主張。', group.evidence_ids),
                    description: cite('材料呈現的主張。', group.evidence_ids),
                  },
                ]
              : [],
            rejected_candidates: groups.slice(1).map(candidate => ({ candidate_id: candidate.candidate_id, reason: 'not_selected' })),
          }
        : generatedInput.section === 'disputes'
          ? { Overview: null, items: [] }
          : {
              Overview: cite('能源觀點的摘要。', ids),
              items: [
                {
                  group_id: 'energy',
                  name: cite('能源觀點。', ids),
                  Core_concern: cite('素材中的能源關注。', ids),
                  opinions: [{ Title: cite('能源轉型。', ids), description: cite('素材呈現能源主張。', ids) }],
                },
              ],
              exclusions: [],
            }
    return generationResponse(data)
  }
  throw new Error('unexpected model')
}

function generationPayload(modelName: string, input: unknown): Record<string, unknown> | null {
  if (modelName !== GENERATION_MODEL) return null
  return object(JSON.parse(String(object((object(input).messages as unknown[])[1]).content)))
}

function responseMessage(response: unknown): Record<string, unknown> {
  return object(object((object(response).choices as unknown[])[0]).message)
}

function addThirdMaterial() {
  source.sqlite.exec("INSERT INTO ct_materials VALUES (6, 7, '丙', 'https://example.test/third', '亦關注能源政策。', 0, 'private-author', 'private@example.test')")
}

// 保留一個既有 Overview，讓工作流測試同時檢查缺值補完與不可改動的欄位。
async function missingFieldsModel(modelName: string, input: unknown): Promise<unknown> {
  const response = await model(modelName, input)
  const request = generationPayload(modelName, input)
  if (request?.section === 'consensus' || request?.section === 'disputes' || request?.section === 'positions') {
    const message = responseMessage(response)
    const data = object(JSON.parse(String(message.content)))
    if (request.section === 'consensus' && (data.items as unknown[]).length) data.Overview = null
    if (request.section === 'disputes') {
      const ids = (request.evidence as Array<{ id: string }>).map(item => item.id)
      const cite = (text: string, evidence_ids: string[]) => [{ text, evidence_ids }]
      data.items = [
        {
          kind: 'tension',
          question: cite('如何衡量能源轉型的取捨？', ids),
          sides: ids.map(id => ({ evidence_ids: [id], claim: cite('一方的主張。', [id]) })),
          comparison_conditions: cite('比較條件。', ids),
          Title: cite('待審爭點。', ids),
          description: cite('兩方素材的敘述。', ids),
        },
      ]
    }
    if (request.section === 'positions') object((data.items as unknown[])[0]).Core_concern = null
    message.content = JSON.stringify(data)
  }
  return response
}

beforeEach(() => {
  auth.current = null
  recordedRequests = []
  stepOutputs = []
  instances = new Map()
  restarts = 0
  workflowCreates = 0
  workflowProbeFailure = null
  aiRun = model
  local = new SQLiteD1(readFileSync(new URL('../../migrations/0017_evidence_pipeline.sql', import.meta.url), 'utf8'))
  source = new SQLiteD1(`
    CREATE TABLE ct_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, abuse_flagged INTEGER, author_id TEXT, author_email TEXT);
    CREATE TABLE ct_materials (id INTEGER PRIMARY KEY, issue_id INTEGER, source_name TEXT, source_url TEXT, content TEXT, abuse_flagged INTEGER, author_id TEXT, author_email TEXT);
    INSERT INTO ct_issues VALUES (7, '能源議題', '討論能源。', 0, 'private-author', 'private@example.test');
    INSERT INTO ct_materials VALUES (2, 7, '甲', 'https://example.test/', '支持再生能源。', 0, 'private-author', 'private@example.test');
    INSERT INTO ct_materials VALUES (4, 7, '乙', NULL, '再生能源有助轉型。', 0, 'private-author', 'private@example.test');
  `)
  const dbAuth = {
    prepare() {
      return {
        bind(id: string) {
          return {
            async first() {
              return { id }
            },
          }
        },
      }
    },
  } as unknown as D1Database
  const workflow = {
    async get(id: string) {
      if (workflowProbeFailure === 'get') throw new Error('workflow_get_unavailable')
      return {
        async status() {
          if (workflowProbeFailure === 'status') throw new Error('workflow_status_unavailable')
          const status = instances.get(id)
          if (!status) throw new Error('not found')
          return { status }
        },
        async restart() {
          restarts++
        },
      }
    },
    async create({ id }: { id: string }) {
      workflowCreates++
      instances.set(id, 'running')
      return { id }
    },
  }
  env = {
    DB: local.asD1(),
    SOURCE_DB: source.asD1(),
    DB_AUTH: dbAuth,
    AI: { run: (modelName: string, input: unknown) => aiRun(modelName, input) },
    EVIDENCE_WORKFLOW: workflow,
  } as unknown as EvidenceBindings
  app = new Hono<{ Bindings: EvidenceBindings }>()
  app.use('/api/*', apiCsrf)
  registerEvidenceRoutes(app)
})

afterEach(() => {
  local.sqlite.close()
  source.sqlite.close()
})

describe('evidence API 與實際 SQLite 工作流', () => {
  it.each(['selected', 'deleted', 'hidden-1', 'hidden-2', 'hidden-3'])('不足兩份素材時拒絕建立，不占額度、冷卻或啟動工作流（%s）', async scenario => {
    auth.current = user('owner')
    if (scenario === 'deleted') source.sqlite.prepare('DELETE FROM ct_materials WHERE id = 4').run()
    if (scenario.startsWith('hidden-')) source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = ? WHERE id = 4').run(Number(scenario.at(-1)))
    const body = scenario === 'selected' ? { consent: true, material_ids: [2] } : { consent: true }
    const response = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'insufficient_materials',
      minimum: 2,
      count: 1,
      exclusions: scenario.startsWith('hidden-') ? [{ id: 4, reason: 'hidden' }] : [],
    })
    for (const table of ['ct_ai_jobs', 'ct_ai_executions', 'ct_ai_usage', 'ct_ai_issue_cooldowns']) {
      expect(local.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 })
    }
    expect(workflowCreates).toBe(0)
    expect(recordedRequests).toEqual([])
  })

  it.each([undefined, [4, 2]])('剛好兩份合格素材允許開始彙整（選材 %j）', async materialIds => {
    auth.current = user('owner')
    const response = await send('POST', '/api/issues/7/evidence-jobs', { consent: true, ...(materialIds ? { material_ids: materialIds } : {}) })
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      status: 'queued',
      cache: 'miss',
      input_coverage: { selection: materialIds ? 'selected' : 'all_eligible', material_ids: [2, 4], exclusions: [] },
    })
    expect(workflowCreates).toBe(1)
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_jobs').get()).toMatchObject({ n: 1 })
  })

  it('工作保存目前告知與伺服器同意時間，重用時不改寫既有同意', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-07T00:00:00.000Z'))
    try {
      auth.current = user('owner')
      const response = await send('POST', '/api/issues/7/evidence-jobs', { consent: true })
      expect(response.status).toBe(202)
      const created = (await response.json()) as { job_id: string }
      const consentQuery = local.sqlite.prepare('SELECT consent_version, consent_at FROM ct_ai_jobs WHERE id = ?')
      const recorded = {
        consent_version: 'evidence-processing-2026-11-07-v5',
        consent_at: '2026-11-07T00:00:00.000Z',
      }
      expect(consentQuery.get(created.job_id)).toMatchObject(recorded)

      vi.setSystemTime(new Date('2026-11-07T00:01:00.000Z'))
      const reused = await send('POST', '/api/issues/7/evidence-jobs', { consent: true })
      expect(reused.status).toBe(202)
      expect(await reused.json()).toMatchObject({ job_id: created.job_id, cache: 'joined' })
      expect(consentQuery.get(created.job_id)).toMatchObject(recorded)
      expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_jobs').get()).toMatchObject({ n: 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    { label: '未傳入同意', body: {} },
    { label: '明確拒絕', body: { consent: false } },
    { label: '以字串冒充同意', body: { consent: 'true' } },
  ])('$label 不建立工作或費用預留', async ({ body }) => {
    auth.current = user('owner')
    const response = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
    expect(
      local.sqlite
        .prepare(`SELECT
      (SELECT COUNT(*) FROM ct_ai_jobs) AS jobs,
      (SELECT COUNT(*) FROM ct_ai_executions) AS executions,
      (SELECT COUNT(*) FROM ct_ai_usage) AS reservations`)
        .get()
    ).toMatchObject({ jobs: 0, executions: 0, reservations: 0 })
  })

  it('來源查核失聯、隱藏及變更時不得交付任何舊快照', async () => {
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const liveSource = env.SOURCE_DB
    env.SOURCE_DB = {
      prepare() {
        throw new Error('offline')
      },
    } as unknown as D1Database
    const unavailable = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('支持再生能源')
    env.SOURCE_DB = liveSource
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 2').run()
    const hidden = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    const payload = (await hidden.json()) as { status: string; error_code: string }
    expect(payload).toMatchObject({ status: 'withdrawn', error_code: 'source_withdrawn' })
    expect(JSON.stringify(payload)).not.toContain('支持再生能源')
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 0, content = ? WHERE id = 2').run('來源內容已變更。')
    auth.current = user('admin', 'admin')
    expect((await send('POST', '/api/evidence-maintenance/reconcile', {})).status).toBe(200)
    auth.current = user('owner')
    const stale = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as { status: string; error_code: string }
    expect(stale).toMatchObject({ status: 'withdrawn', error_code: 'source_stale' })
    expect(JSON.stringify(stale)).not.toContain('支持再生能源')
    source.sqlite.prepare('DELETE FROM ct_materials WHERE id = 2').run()
    const erased = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as { status: string }
    expect(erased.status).toBe('erased')
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
  })

  it.each([
    { disposition: 'erased', resource: 'job' },
    { disposition: 'withdrawn', resource: 'job' },
    { disposition: 'erased', resource: 'revisions' },
    { disposition: 'withdrawn', resource: 'revisions' },
  ] as const)('$resource 最後一次快照讀取後觀察到 $disposition 時不交付舊正文', async ({ disposition, resource }) => {
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    const original = await store.getSnapshot(job!.executionId)
    const material = original!.sources.find(item => item.kind === 'material')
    if (!material || material.kind !== 'material') throw new Error('missing material')
    if (resource === 'revisions') {
      const base = (await store.getArtifact(job!.executionId, job!.artifactId!))!.payload as CompletedDraft
      const data = structuredClone(base.data)
      data.consensus.Overview = '不可交付的人工修訂。'
      expect((await send('POST', `/api/evidence-jobs/${created.job_id}/revisions`, { parent_revision_id: 'ai', data })).status).toBe(201)
    }

    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>(resolve => {
      release = resolve
    })
    const paused = new Promise<void>(resolve => {
      reached = resolve
    })
    const realGetSnapshot = EvidenceStore.prototype.getSnapshot
    let reads = 0
    let capturedSnapshot = false
    const barrier = vi.spyOn(EvidenceStore.prototype, 'getSnapshot').mockImplementation(async function (this: EvidenceStore, executionId: string) {
      const snapshot = await realGetSnapshot.call(this, executionId)
      if (++reads === 2) {
        capturedSnapshot = snapshot !== null && snapshot.sources.some(item => item.kind === 'material' && item.payload.content === material.payload.content)
        reached()
        await waiting
      }
      return snapshot
    })
    const path = `/api/evidence-jobs/${created.job_id}${resource === 'revisions' ? '/revisions' : ''}`
    const pending = Promise.resolve(send('GET', path))
    try {
      await paused
      expect(capturedSnapshot).toBe(true)
      if (disposition === 'erased') {
        await store.eraseSource({ namespace: 'vtaiwan-civic-talks', kind: 'material', id: material.id, reason: 'request' })
      } else {
        await store.reconcileSource({ namespace: 'vtaiwan-civic-talks', kind: 'material', id: material.id, status: 'withdrawn', currentHash: null })
      }
      const latest = await store.getJob(created.job_id, 'owner')
      expect(latest?.status).toBe(disposition)
      release()
      const response = await pending
      expect(response.status).toBe(resource === 'job' ? 200 : 422)
      const bodyText = await response.text()
      const body = JSON.parse(bodyText) as Record<string, unknown>
      if (resource === 'job') {
        expect(body).toMatchObject({ status: disposition, error_code: latest!.errorCode, updated_at: latest!.updatedAt, usage: latest!.usage })
      } else {
        expect(body).toEqual({ error: 'draft_unavailable' })
      }
      for (const field of ['data', 'sources', 'evidence', 'citation_map', 'provenance', 'generation_artifact', 'input_manifest', 'diagnostics', 'ai_base', 'revisions'])
        expect(body).not.toHaveProperty(field)
      expect(bodyText).not.toContain(material.payload.content)
      if (disposition === 'erased') {
        expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_sources WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
        expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
      }
    } finally {
      release()
      await pending.catch(() => undefined)
      barrier.mockRestore()
    }
  })

  it('啟動對帳失敗可重試，完成後輪詢只查本工作；管理員可再次全域對帳', async () => {
    source.sqlite.exec(`
      INSERT INTO ct_issues VALUES (8, '另一議題', '另一說明。', 0, 'private-author', 'private@example.test');
      INSERT INTO ct_materials VALUES (6, 8, '另一來源', NULL, '另一議題的材料。', 0, 'private-author', 'private@example.test');
      INSERT INTO ct_materials VALUES (7, 8, '另一來源乙', NULL, '另一議題的補充材料。', 0, 'private-author', 'private@example.test');
    `)
    auth.current = user('owner')
    const first = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, first.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const second = (await (await send('POST', '/api/issues/8/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, second.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const liveSource = env.SOURCE_DB
    env.SOURCE_DB = {
      prepare(sql: string) {
        const statement = source.prepare(sql)
        return {
          bind(...values: SQLInputValue[]) {
            if (values[0] === 8 || values[0] === 6) throw new Error('unrelated_source_offline')
            return statement.bind(...values)
          },
        }
      },
    } as unknown as D1Database
    expect((await send('GET', `/api/evidence-jobs/${first.job_id}`)).status).toBe(200)
    // 重建入口相當於冷啟；全量啟動對帳失敗不能交付，恢復後可重試。
    app = new Hono<{ Bindings: EvidenceBindings }>()
    app.use('/api/*', apiCsrf)
    registerEvidenceRoutes(app)
    expect((await send('GET', `/api/evidence-jobs/${first.job_id}`)).status).toBe(503)
    env.SOURCE_DB = liveSource
    expect((await send('GET', `/api/evidence-jobs/${first.job_id}`)).status).toBe(200)
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 6').run()
    expect((await send('POST', '/api/evidence-maintenance/reconcile', {})).status).toBe(403)
    auth.current = user('admin', 'admin')
    expect((await send('POST', '/api/evidence-maintenance/reconcile', {})).status).toBe(200)
    expect(await new EvidenceStore(local.asD1()).getJob(second.job_id, 'owner')).toMatchObject({ status: 'withdrawn' })
  })

  it('一般輪詢不重啟進行中工作，也不因 instance 暫時不存在而建立新工作', async () => {
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    expect(workflowCreates).toBe(1)
    for (const status of ['running', 'waiting'] as const) {
      instances.set(job!.executionId, status)
      expect(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()).toMatchObject({ status: 'queued' })
    }
    instances.delete(job!.executionId)
    expect(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()).toMatchObject({ status: 'queued' })
    expect(restarts).toBe(0)
    expect(workflowCreates).toBe(1)
    expect(recordedRequests).toHaveLength(0)
  })

  it.each([
    { observation: 'missing', retryOwner: 'owner' },
    { observation: 'unknown', retryOwner: 'owner' },
    { observation: 'missing', retryOwner: 'other' },
  ] as const)('首次 Workflow create 失敗後，$retryOwner 重送 admission 可恢復 $observation instance 且不重複預留', async ({ observation, retryOwner }) => {
    const originalCreate = env.EVIDENCE_WORKFLOW.create.bind(env.EVIDENCE_WORKFLOW)
    let creates = 0
    let scheduledJobId: string | undefined
    env.EVIDENCE_WORKFLOW.create = (async options => {
      if (++creates === 1) throw new Error('workflow_create_unavailable')
      scheduledJobId = options?.params?.jobId
      return originalCreate(options)
    }) as typeof env.EVIDENCE_WORKFLOW.create
    auth.current = user('owner')
    const failed = await send('POST', '/api/issues/7/evidence-jobs', { consent: true })
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: 'service_unavailable' })
    const admitted = local.sqlite.prepare('SELECT id, execution_id FROM ct_ai_jobs').get() as { id: string; execution_id: string }
    const store = new EvidenceStore(local.asD1())
    const before = await store.getJob(admitted.id, 'owner')
    expect(before).toMatchObject({ status: 'queued', usage: { attempts: 0, uncertain: 0 } })
    if (observation === 'unknown') instances.set(admitted.execution_id, 'unknown')
    auth.current = user(retryOwner)
    const retried = await send('POST', '/api/issues/7/evidence-jobs', { consent: true })
    expect(retried.status).toBe(202)
    const result = (await retried.json()) as { job_id: string }
    expect(result).toMatchObject({ status: 'queued', cache: 'joined' })
    expect(result.job_id === admitted.id).toBe(retryOwner === 'owner')
    expect((await store.getJob(result.job_id, retryOwner))!.executionId).toBe(admitted.execution_id)
    expect(scheduledJobId).toBe(admitted.id)
    expect(creates).toBe(2)
    expect(instances.get(admitted.execution_id)).toBe('running')
    expect((await store.getJob(admitted.id, 'owner'))!.usage).toEqual(before!.usage)
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_jobs').get()).toMatchObject({ n: retryOwner === 'owner' ? 1 : 2 })
    for (const table of ['ct_ai_executions', 'ct_ai_usage']) {
      expect(local.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 1 })
    }
    expect(recordedRequests).toHaveLength(0)
  })

  it('Workflow create 失敗且查詢仍 unknown 時回 503，保留原 admission 待明確重送恢復', async () => {
    const originalGet = env.EVIDENCE_WORKFLOW.get.bind(env.EVIDENCE_WORKFLOW)
    const originalCreate = env.EVIDENCE_WORKFLOW.create.bind(env.EVIDENCE_WORKFLOW)
    let creates = 0
    env.EVIDENCE_WORKFLOW.get = (async () => ({
      async status() {
        return { status: 'unknown' }
      },
    })) as unknown as typeof env.EVIDENCE_WORKFLOW.get
    env.EVIDENCE_WORKFLOW.create = (async options => {
      if (++creates < 3) throw new Error('workflow_create_unavailable')
      return originalCreate(options)
    }) as typeof env.EVIDENCE_WORKFLOW.create
    auth.current = user('owner')
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await send('POST', '/api/issues/7/evidence-jobs', { consent: true })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'service_unavailable' })
    }
    const admitted = local.sqlite.prepare('SELECT id FROM ct_ai_jobs').get() as { id: string }
    const store = new EvidenceStore(local.asD1())
    const before = await store.getJob(admitted.id, 'owner')
    expect(before).toMatchObject({ status: 'queued', usage: { attempts: 0, uncertain: 0 } })
    env.EVIDENCE_WORKFLOW.get = originalGet
    const recovered = await send('POST', '/api/issues/7/evidence-jobs', { consent: true })
    expect(recovered.status).toBe(202)
    expect(await recovered.json()).toMatchObject({ job_id: admitted.id, status: 'queued', cache: 'joined' })
    expect(creates).toBe(3)
    expect((await store.getJob(admitted.id, 'owner'))!.usage).toEqual(before!.usage)
    for (const table of ['ct_ai_jobs', 'ct_ai_executions', 'ct_ai_usage']) {
      expect(local.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 1 })
    }
    expect(recordedRequests).toHaveLength(0)
  })

  it.each(['errored', 'complete', 'terminated'] as const)('清理 step 失敗後 native 為 %s，授權輪詢收斂工作而不重打', async state => {
    let validated = false
    const brokenCleanup = retryingStep(async (name, _attempt, callback) => {
      if (name === 'finish-generation-disputes' || name === 'fail-workflow') throw new Error('private_step_failure')
      const result = await callback()
      if (name === 'validate-generation-disputes') validated = true
      return result
    })
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    await expect(runEvidenceWorkflow(env, created.job_id, brokenCleanup.step)).rejects.toThrow('evidence_workflow_cleanup_failed')
    expect(validated).toBe(true)
    for (const name of ['finish-generation-disputes', 'fail-workflow']) {
      expect(brokenCleanup.attempts.get(name)).toBe(4)
      expect(brokenCleanup.configs.get(name)).toMatchObject({ retries: { limit: 3, delay: '1 second', backoff: 'exponential' }, timeout: '30 seconds' })
    }
    const store = new EvidenceStore(local.asD1())
    const before = await store.getJob(created.job_id, 'owner')
    expect(before).toMatchObject({ status: 'generating', usage: { attempts: 5, uncertain: 0 } })
    const savedRaw = await store.listArtifacts(before!.executionId, 'raw')
    const savedSections = (await store.listArtifacts(before!.executionId, 'generation')).filter(item => object(item.payload).stage === 'generation_section')
    expect(savedRaw).toHaveLength(5)
    expect(savedSections).toHaveLength(2)
    instances.set(before!.executionId, state)

    auth.current = user('other')
    expect((await send('GET', `/api/evidence-jobs/${created.job_id}`)).status).toBe(404)
    expect((await store.getJob(created.job_id, 'owner'))?.status).toBe('generating')
    auth.current = user('owner')
    const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(response.status).toBe(200)
    const body = object(await response.json())
    expect(body).toMatchObject({ status: 'failed', error_code: 'provider_uncertain', usage: before!.usage })
    expect(body.data).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('private_step_failure')
    expect(await store.listArtifacts(before!.executionId, 'raw')).toEqual(savedRaw)
    expect((await store.listArtifacts(before!.executionId, 'generation')).filter(item => object(item.payload).stage === 'generation_section')).toEqual(savedSections)
    expect(local.sqlite.prepare("SELECT step_key, state FROM ct_ai_usage WHERE step_key LIKE 'generate:%' ORDER BY step_key").all()).toEqual([
      { step_key: 'generate:consensus', state: 'settled' },
      { step_key: 'generate:disputes', state: 'settled' },
    ])
    expect(recordedRequests).toHaveLength(5)
    expect(workflowCreates).toBe(1)
    expect(restarts).toBe(0)
    expect(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()).toMatchObject({ status: 'failed', usage: before!.usage })
  })

  it('失敗清理遇暫時儲存故障會重試，再將工作收斂為失敗而不重打模型', async () => {
    const originalMark = EvidenceStore.prototype.markAttemptsUnknown
    let markCalls = 0
    const mark = vi.spyOn(EvidenceStore.prototype, 'markAttemptsUnknown').mockImplementation(function (this: EvidenceStore, executionId, now) {
      markCalls++
      if (markCalls === 1) throw new EvidenceStoreError('storage_error')
      return originalMark.call(this, executionId, now)
    })
    const workflow = retryingStep(async (name, _attempt, callback) => {
      if (name === 'finish-generation-disputes') throw new Error('simulated_step_timeout')
      return callback()
    })
    try {
      auth.current = user('owner')
      const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
      expect(await runEvidenceWorkflow(env, created.job_id, workflow.step)).toEqual({ status: 'failed' })
      expect(workflow.attempts.get('finish-generation-disputes')).toBe(4)
      expect(workflow.attempts.get('fail-workflow')).toBe(2)
      expect(markCalls).toBe(2)
      const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status: 'failed', error_code: 'internal_error', usage: { attempts: 5, uncertain: 0, reservedMicroUsd: 0 } })
      expect(local.sqlite.prepare("SELECT step_key, state FROM ct_ai_usage WHERE step_key LIKE 'generate:%' ORDER BY step_key").all()).toEqual([
        { step_key: 'generate:consensus', state: 'settled' },
        { step_key: 'generate:disputes', state: 'settled' },
      ])
      expect(recordedRequests).toHaveLength(5)
    } finally {
      mark.mockRestore()
    }
  })

  it.each(['poll', 'startup', 'maintenance'] as const)('%s：native 查詢失聯或 unknown 不誤判在途工作，明確終態才保留未知預留', async scenario => {
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>()
    const { promise: called, resolve: started } = Promise.withResolvers<void>()
    let disputeCalls = 0
    aiRun = async (modelName, input) => {
      if (generationPayload(modelName, input)?.section === 'disputes') {
        disputeCalls++
        started()
        await waiting
      }
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const running = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    const store = new EvidenceStore(local.asD1())
    const before = await store.getJob(created.job_id, 'owner')
    try {
      const attempt = local.sqlite.prepare("SELECT state, estimate_micro_usd, actual_micro_usd FROM ct_ai_usage WHERE step_key = 'generate:disputes'").get() as {
        state: string
        estimate_micro_usd: number
        actual_micro_usd: number | null
      }
      expect(attempt).toMatchObject({ state: 'started', actual_micro_usd: null })
      for (const probe of ['running', 'waiting', 'get', 'status', 'unknown'] as const) {
        workflowProbeFailure = probe === 'get' || probe === 'status' ? probe : null
        instances.set(before!.executionId, probe === 'unknown' ? 'unknown' : probe === 'waiting' ? 'waiting' : 'running')
        if (scenario === 'startup') {
          app = new Hono<{ Bindings: EvidenceBindings }>()
          app.use('/api/*', apiCsrf)
          registerEvidenceRoutes(app)
        } else if (scenario === 'maintenance') {
          auth.current = user('owner', 'admin')
          expect((await send('POST', '/api/evidence-maintenance/reconcile', {})).status).toBe(200)
        }
        const observed = await send('GET', `/api/evidence-jobs/${created.job_id}`)
        expect(observed.status).toBe(200)
        expect(await observed.json()).toMatchObject({ status: 'generating', error_code: null, usage: before!.usage })
        expect(await store.getJob(created.job_id, 'owner')).toMatchObject({
          status: 'generating',
          errorCode: null,
          updatedAt: before!.updatedAt,
          usage: before!.usage,
        })
        expect(local.sqlite.prepare("SELECT state, estimate_micro_usd, actual_micro_usd FROM ct_ai_usage WHERE step_key = 'generate:disputes'").get()).toMatchObject(attempt)
      }
      workflowProbeFailure = null
      instances.set(before!.executionId, 'terminated')
      const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        status: 'failed',
        error_code: 'provider_uncertain',
        usage: { attempts: 5, actualMicroUsd: before!.usage.actualMicroUsd, reservedMicroUsd: attempt.estimate_micro_usd, uncertain: 1 },
      })
      expect(local.sqlite.prepare("SELECT state, actual_micro_usd FROM ct_ai_usage WHERE step_key = 'generate:disputes'").get()).toMatchObject({ state: 'unknown', actual_micro_usd: null })
      expect(disputeCalls).toBe(1)
      expect(recordedRequests).toHaveLength(4)
      expect(workflowCreates).toBe(1)
      expect(restarts).toBe(0)
    } finally {
      release()
      await running
    }
    const after = await store.getJob(created.job_id, 'owner')
    expect(after).toMatchObject({ status: 'failed', errorCode: 'provider_uncertain', usage: { attempts: 5, reservedMicroUsd: 0, uncertain: 0 } })
    expect(after!.usage.actualMicroUsd).toBeGreaterThan(before!.usage.actualMicroUsd)
    expect(await store.listArtifacts(before!.executionId, 'raw')).toHaveLength(4)
    expect(disputeCalls).toBe(1)
    expect(recordedRequests).toHaveLength(5)
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'generate:positions'").get()).toMatchObject({ n: 0 })
  })

  it('設定指紋改變後舊工作不混入新 prompt，未付費預留得釋放', async () => {
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    const snapshot = await store.getSnapshot(job!.executionId)
    const manifest = structuredClone(snapshot!.manifest)
    const settings = manifest.settings as { hashes: { config: string } }
    settings.hashes.config = '0'.repeat(64)
    local.sqlite.prepare('UPDATE ct_ai_executions SET manifest = ? WHERE id = ?').run(JSON.stringify(manifest), job!.executionId)
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    expect(await store.getJob(created.job_id, 'owner')).toMatchObject({ status: 'failed', errorCode: 'configuration_changed' })
    expect(recordedRequests).toHaveLength(0)
    expect((await store.budget()).committedMicroUsd).toBe(0)
  })

  it('明選素材不因未選素材隱藏或刪除而多次付費，仍顯示目前排除狀態', async () => {
    addThirdMaterial()
    auth.current = user('owner')
    const body = { consent: true, material_ids: [2, 6] }
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', body)).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    expect(recordedRequests).toHaveLength(6)
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 4').run()
    const hidden = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(hidden.status).toBe(200)
    expect(await hidden.json()).toMatchObject({ job_id: created.job_id, cache: 'hit', input_coverage: { selection: 'selected', material_ids: [2, 6], exclusions: [] } })
    const detail = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
    expect(detail).toMatchObject({ current_issue_exclusions: [{ id: 4, reason: 'hidden' }], initial_input_diagnostics: [{ stage: 'input', initial_issue_exclusions: [] }] })
    source.sqlite.prepare('DELETE FROM ct_materials WHERE id = 4').run()
    const deleted = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toMatchObject({ job_id: created.job_id, cache: 'hit' })
    expect(recordedRequests).toHaveLength(6)
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_executions').get()).toMatchObject({ n: 1 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_usage').get()).toMatchObject({ n: 6 })
  })

  it('全量合格素材集合變更必須使用新快取鍵；未選隱藏素材後續刪除不影響新工作', async () => {
    addThirdMaterial()
    auth.current = user('owner')
    const body = { consent: true }
    const first = (await (await send('POST', '/api/issues/7/evidence-jobs', body)).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, first.job_id, testStep())).toEqual({ status: 'ai_draft' })
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 4').run()
    expect((await send('POST', '/api/issues/7/evidence-jobs', body)).status).toBe(429)
    // 模擬冷卻期限已過，不修改來源庫或已保存的工作。
    local.sqlite.prepare('UPDATE ct_ai_issue_cooldowns SET claimed_at = ? WHERE issue_id = ?').run('2000-01-01T00:00:00.000Z', 7)
    const next = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(next.status).toBe(202)
    const nextBody = (await next.json()) as { job_id: string; input_coverage: unknown }
    expect(nextBody.job_id).not.toBe(first.job_id)
    expect(nextBody.input_coverage).toMatchObject({ selection: 'all_eligible', material_ids: [2, 6], exclusions: [{ id: 4, reason: 'hidden' }] })
    source.sqlite.prepare('DELETE FROM ct_materials WHERE id = 4').run()
    const joined = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(joined.status).toBe(202)
    expect(await joined.json()).toMatchObject({ job_id: nextBody.job_id, cache: 'joined', input_coverage: { exclusions: [] } })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_executions').get()).toMatchObject({ n: 2 })
  })

  it('忽略原生推理並採用最終結構化結果；擁有者及管理員取得正確工件雜湊與白名單 provenance', async () => {
    aiRun = async (modelName, input) => {
      const response = await model(modelName, input)
      if (generationPayload(modelName, input)?.section === 'consensus') {
        responseMessage(response).reasoning = 'private-reasoning-not-final-json'
      }
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(response.status).toBe(200)
    const audit = (await response.json()) as {
      input_key: string
      input_manifest: unknown
      generation_artifact: { id: string; sha256: string }
      provenance: { artifacts: ArtifactSummary[] }
      diagnostics: { generation: { sections: { consensus: { details: { candidate_map: Array<{ candidate_id: string; canonical_id: string }>; adopted: Array<{ candidate_id: string }> } } } } }
    }
    expect(audit).toMatchObject({
      data: { consensus: { items: [{ Title: '相容主張。', description: '材料呈現的主張。' }] } },
      diagnostics: { generation: { sections: { consensus: { status: 'completed' } } } },
    })
    expect(JSON.stringify(audit)).not.toContain('private-reasoning-not-final-json')
    expect(audit.input_key).toBe(await sha256(JSON.stringify(audit.input_manifest)))
    const generation = local.sqlite.prepare('SELECT payload_hash, payload FROM ct_ai_artifacts WHERE id = ? AND kind = ?').get(audit.generation_artifact.id, 'generation') as {
      payload_hash: string
      payload: string
    }
    expect(audit.generation_artifact.sha256).toBe(generation.payload_hash)
    expect(audit.generation_artifact.sha256).toBe(await sha256(generation.payload))
    const raw = audit.provenance.artifacts.filter(item => item.kind === 'raw')
    expect(raw).toHaveLength(6)
    expect(new Set(raw.map(item => item.model?.selector))).toEqual(new Set(['@cf/cloudflare/clairic', '@cf/cloudflare/clef', GENERATION_MODEL]))
    for (const summary of raw) {
      expect(Object.keys(summary).sort()).toEqual(['attempt', 'created_at', 'id', 'kind', 'model', 'sha256'])
      expect(Object.keys(summary.model!).sort()).toEqual(['pricing_version', 'provider_model', 'provider_revision', 'request_id', 'request_sha256', 'selector', 'system_fingerprint', 'usage_status'])
      expect(Object.keys(summary.attempt!).sort()).toEqual(['actual_micro_usd', 'estimated_micro_usd', 'id', 'state'])
      expect(summary.model).toMatchObject({ provider_revision: null, request_id: null, system_fingerprint: null, usage_status: 'reported' })
      const stored = local.sqlite.prepare('SELECT payload_hash, payload FROM ct_ai_artifacts WHERE id = ?').get(summary.id) as { payload_hash: string; payload: string }
      const payload = JSON.parse(stored.payload) as { request: unknown }
      expect(summary.sha256).toBe(stored.payload_hash)
      expect(summary.sha256).toBe(await sha256(stored.payload))
      expect(summary.model?.request_sha256).toBe(await sha256(JSON.stringify(payload.request)))
      expect(summary.attempt).toMatchObject({ state: 'settled' })
    }
    // 模型只見短 ID，擁有者的診斷仍能追溯到原始比較候選；不可改寫 raw 回應。
    const comparisons = local.sqlite.prepare("SELECT payload FROM ct_ai_artifacts WHERE kind = 'comparison'").all() as Array<{ payload: string }>
    const analysis = comparisons.map(row => object(JSON.parse(row.payload))).find(payload => payload.analysis !== undefined)!
    const canonical = object((object(analysis.analysis).consensus_groups as unknown[])[0]).id
    const consensusDetails = audit.diagnostics.generation.sections.consensus.details
    expect(consensusDetails.candidate_map).toEqual([{ candidate_id: 'C1', canonical_id: canonical }])
    expect(consensusDetails.adopted[0].candidate_id).toBe(canonical)
    const consensusRaw = local.sqlite.prepare("SELECT a.payload FROM ct_ai_artifacts a JOIN ct_ai_usage u ON u.id = a.attempt_id WHERE a.kind = 'raw' AND u.step_key = 'generate:consensus'").get() as {
      payload: string
    }
    const native = object(JSON.parse(consensusRaw.payload))
    expect(responseMessage(native.response).reasoning).toBe('private-reasoning-not-final-json')
    expect(local.sqlite.prepare("SELECT state, actual_micro_usd FROM ct_ai_usage WHERE step_key = 'generate:consensus'").get()).toMatchObject({ state: 'settled', actual_micro_usd: 44 })
    const adoptedRaw = object(JSON.parse(String(responseMessage(native.response).content)))
    expect(object((adoptedRaw.items as unknown[])[0]).candidate_id).toBe('C1')
    const summaryJson = JSON.stringify(audit.provenance.artifacts)
    expect(summaryJson).not.toContain('"request":')
    expect(summaryJson).not.toContain('"response":')
    expect(summaryJson).not.toContain('private-author')
    expect(summaryJson).not.toContain('private@example.test')
    expect(summaryJson).not.toContain('owner_id')
    expect(summaryJson).not.toContain('actor_id')
    expect(summaryJson).not.toContain('editor_id')
    expect(summaryJson).not.toContain('支持再生能源')
    auth.current = user('other')
    expect((await send('GET', `/api/evidence-jobs/${created.job_id}`)).status).toBe(404)
    auth.current = user('admin', 'admin')
    const admin = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
    expect(admin).toMatchObject({ input_key: audit.input_key, generation_artifact: audit.generation_artifact, provenance: { artifacts: audit.provenance.artifacts } })
  })

  it('工作流依意見標題及敘述引用推導群組來源、重疊與排除', async () => {
    addThirdMaterial()
    aiRun = async (modelName, input) => {
      const response = await model(modelName, input)
      const request = generationPayload(modelName, input)
      if (request?.section !== 'positions') return response
      const evidence = request.evidence as Array<{ id: string; material_id: number }>
      const first = evidence.find(item => item.material_id === 2)!.id
      const second = evidence.find(item => item.material_id === 4)!.id
      const excluded = evidence.find(item => item.material_id === 6)!.id
      const cite = (text: string, id: string) => [{ text, evidence_ids: [id] }]
      responseMessage(response).content = JSON.stringify({
        Overview: cite('立場摘要。', first),
        items: [
          {
            group_id: 'shared',
            name: cite('共同群組。', first),
            Core_concern: cite('群組關注。', first),
            opinions: [{ Title: cite('第一則標題。', first), description: cite('第二份素材的敘述。', second) }],
          },
          {
            group_id: 'second',
            name: cite('另一群組。', second),
            Core_concern: cite('另一關注。', second),
            opinions: [{ Title: cite('第二則標題。', second), description: cite('第二則敘述。', second) }],
          },
        ],
        exclusions: [{ evidence_id: excluded, reason: '無法歸入這些群組' }],
      })
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(response.status).toBe(200)
    const detail = (await response.json()) as DraftResponse & {
      status: string
      diagnostics: {
        partial: boolean
        generation: {
          sections: {
            positions: {
              details: {
                groups: Array<{ group_id: string; evidence_ids: string[] }>
                coverage: Array<{ evidence_id: string; group_ids: string[]; status: string; reason: string | null }>
              }
            }
          }
        }
      }
    }
    const byMaterial = new Map(detail.evidence.map(item => [item.material_id, item.id]))
    const first = byMaterial.get(2)!
    const second = byMaterial.get(4)!
    const excluded = byMaterial.get(6)!
    const firstSource = { Title: '甲', href: 'https://example.test/', material_id: 2 }
    const secondSource = { Title: '乙', href: '/issues/7/source/4', material_id: 4 }
    expect(detail).toMatchObject({ status: 'ai_draft', diagnostics: { partial: false, generation: { sections: { positions: { status: 'completed' } } } } })
    expect(detail.data.positions).toEqual({
      Overview: '立場摘要。',
      items: [
        { name: '共同群組。', Sources: [firstSource, secondSource], Core_concern: '群組關注。', opinions: [{ Title: '第一則標題。', description: '第二份素材的敘述。' }] },
        { name: '另一群組。', Sources: [secondSource], Core_concern: '另一關注。', opinions: [{ Title: '第二則標題。', description: '第二則敘述。' }] },
      ],
    })
    const details = detail.diagnostics.generation.sections.positions.details
    expect(details.groups.map(group => [group.group_id, new Set(group.evidence_ids)])).toEqual([
      ['shared', new Set([first, second])],
      ['second', new Set([second])],
    ])
    expect(details.coverage).toHaveLength(3)
    expect(details.coverage).toEqual(
      expect.arrayContaining([
        { evidence_id: first, group_ids: ['shared'], status: 'grouped', reason: null },
        { evidence_id: second, group_ids: ['shared', 'second'], status: 'overlapping', reason: null },
        { evidence_id: excluded, group_ids: [], status: 'excluded', reason: '無法歸入這些群組' },
      ])
    )
    expect(detail.citation_map.filter(entry => entry.pointer.startsWith('/positions/items/0/')).map(entry => [entry.pointer, entry.evidence_ids])).toEqual([
      ['/positions/items/0/name', [first]],
      ['/positions/items/0/Core_concern', [first]],
      ['/positions/items/0/opinions/0/Title', [first]],
      ['/positions/items/0/opinions/0/description', [second]],
    ])
    expect(detail.citation_map.find(entry => entry.pointer === '/positions/items/0/opinions/0/description')).toMatchObject({
      evidence_ids: [second],
      sources: [{ evidence_id: second, material_id: 4, source: secondSource }],
    })
    const revisions = await send('GET', `/api/evidence-jobs/${created.job_id}/revisions`)
    expect(revisions.status).toBe(200)
    const revisionBody = (await revisions.json()) as { ai_base: { data: CompletedDraft['data']; citation_map: CompletedDraft['citation_map'] } }
    expect(revisionBody.ai_base.data.positions).toEqual(detail.data.positions)
    expect(revisionBody.ai_base.citation_map).toEqual(detail.citation_map)
    expect(recordedRequests).toHaveLength(7)
  })

  it.each([
    ['群組名稱引用另一群組的證據', 'name', 'generation_cross_candidate_citation'],
    ['核心關注引用已排除的證據', 'Core_concern', 'generation_cross_candidate_citation'],
    ['證據沒有出現在意見或排除清單', 'missing_coverage', 'generation_incomplete_coverage'],
    ['同組意見引用直接反對的證據', 'direct_disagree', 'generation_contradictory_group'],
  ] as const)('%s 時只拒收立場，保留其他分項且不重試', async (_label, violation, validationCode) => {
    addThirdMaterial()
    let contraryIds: string[] = []
    aiRun = async (modelName, input) => {
      const response = await model(modelName, input)
      if (modelName === '@cf/cloudflare/clef' && violation === 'direct_disagree') {
        const answers = object(object(response).answers)
        answers[Object.keys(answers)[0]] = {
          type: 'choice',
          choice: 'disagree',
          probabilities: { agree: 0.03, disagree: 0.91, unrelated: 0.03, uncertain: 0.03 },
          confidence: 0.91,
        }
        return response
      }
      const request = generationPayload(modelName, input)
      if (request?.section !== 'disputes' && request?.section !== 'positions') return response
      const evidence = request.evidence as Array<{ id: string; material_id: number }>
      const first = evidence.find(item => item.material_id === 2)!.id
      const second = evidence.find(item => item.material_id === 4)!.id
      const third = evidence.find(item => item.material_id === 6)!.id
      const cite = (text: string, ids: string[]) => [{ text, evidence_ids: ids }]
      if (request.section === 'disputes') {
        const ids = [first, second]
        responseMessage(response).content = JSON.stringify({
          Overview: cite('爭點摘要。', ids),
          items: [
            {
              kind: 'tension',
              sides: ids.map(id => ({ evidence_ids: [id], claim: cite('一方主張。', [id]) })),
              question: cite('如何衡量能源轉型的取捨？', ids),
              comparison_conditions: cite('比較條件。', ids),
              Title: cite('待審爭點。', ids),
              description: cite('兩方素材的敘述。', ids),
            },
          ],
        })
        return response
      }
      let items = [
        {
          group_id: 'first',
          name: cite('第一群組。', [first]),
          Core_concern: cite('第一關注。', [first]),
          opinions: [{ Title: cite('第一主張。', [first]), description: cite('第一敘述。', [first]) }],
        },
        {
          group_id: 'second',
          name: cite('第二群組。', [second]),
          Core_concern: cite('第二關注。', [second]),
          opinions: [{ Title: cite('第二主張。', [second]), description: cite('第二敘述。', [second]) }],
        },
      ]
      let exclusions = [{ evidence_id: third, reason: '無法歸入這些群組' }]
      if (violation === 'name') items[0].name = cite('跨群組名稱。', [second])
      if (violation === 'Core_concern') items[0].Core_concern = cite('排除證據的關注。', [third])
      if (violation === 'missing_coverage') exclusions = []
      if (violation === 'direct_disagree') {
        const direct = (object(request.comparison).direct_comparisons as Array<{ evidence_ids: string[]; relation: string }>).find(item => item.relation === 'disagree')!
        contraryIds = direct.evidence_ids
        const [left, right] = contraryIds
        items = [
          {
            group_id: 'conflicted',
            name: cite('群組。', [left]),
            Core_concern: cite('關注。', [left]),
            opinions: [{ Title: cite('一方標題。', [left]), description: cite('另一方敘述。', [right]) }],
          },
        ]
        exclusions = [{ evidence_id: evidence.find(item => !contraryIds.includes(item.id))!.id, reason: '無法歸入這些群組' }]
      }
      responseMessage(response).content = JSON.stringify({
        Overview: cite('立場摘要。', items[0].opinions[0].Title[0].evidence_ids),
        items,
        exclusions,
      })
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(response.status).toBe(200)
    const detail = (await response.json()) as DraftResponse & {
      diagnostics: { comparisons: { direct_comparisons: Array<{ evidence_ids: string[]; relation: string }> } }
    }
    expect(detail).toMatchObject({
      status: 'partial_draft',
      error_code: null,
      usage: { attempts: 7, uncertain: 0, reservedMicroUsd: 0 },
      data: {
        consensus: { Overview: '相容主張的摘要。', items: [{ Title: '相容主張。', description: '材料呈現的主張。' }] },
        disputes: { Overview: '爭點摘要。', items: [{ Title: '待審爭點。', description: '兩方素材的敘述。' }] },
        positions: { Overview: statusOverview('positions', 'failed', 'zh-TW'), items: [] },
      },
      diagnostics: {
        partial: true,
        generation: {
          sections: {
            consensus: { status: 'completed' },
            disputes: { status: 'completed' },
            positions: { status: 'failed', reason: 'invalid_generation', validation_code: validationCode, artifact_id: null },
          },
          completion: { status: 'not_needed', targets: [] },
        },
      },
    })
    expect(detail.citation_map.some(entry => entry.pointer.startsWith('/consensus/items/'))).toBe(true)
    expect(detail.citation_map.some(entry => entry.pointer.startsWith('/disputes/items/'))).toBe(true)
    expect(detail.citation_map.some(entry => entry.pointer.startsWith('/positions/'))).toBe(false)
    if (violation === 'direct_disagree') {
      expect(contraryIds).toHaveLength(2)
      expect(detail.diagnostics.comparisons.direct_comparisons).toContainEqual(expect.objectContaining({ evidence_ids: contraryIds, relation: 'disagree' }))
    }
    expect(local.sqlite.prepare("SELECT step_key, state FROM ct_ai_usage WHERE step_key LIKE 'generate:%' ORDER BY step_key").all()).toEqual([
      { step_key: 'generate:consensus', state: 'settled' },
      { step_key: 'generate:disputes', state: 'settled' },
      { step_key: 'generate:positions', state: 'settled' },
    ])
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: 0 })
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    expect(await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()).toMatchObject({ job_id: created.job_id, cache: 'hit', status: 'partial_draft' })
    expect(recordedRequests).toHaveLength(7)
  })

  it.each([
    ['共識候選無效', 'invalid_candidate', 'generation_invalid_candidate'],
    ['原生回應未完成', 'incomplete', 'generation_incomplete_completion'],
  ] as const)('%s 時只拒收該段，保留其他有效分項及已回報費用', async (_label, failure, validationCode) => {
    aiRun = async (modelName, input) => {
      const response = await model(modelName, input)
      if (generationPayload(modelName, input)?.section !== 'consensus') return response
      if (failure === 'incomplete') {
        object((object(response).choices as unknown[])[0]).finish_reason = 'length'
      } else {
        const message = responseMessage(response)
        const content = JSON.parse(String(message.content))
        content.items[0].candidate_id = 'unknown-candidate'
        message.content = JSON.stringify(content)
      }
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const body = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(body).toMatchObject({
      status: 'partial_draft',
      error_code: null,
      usage: { attempts: 6, uncertain: 0, reservedMicroUsd: 0 },
      data: { consensus: { Overview: statusOverview('consensus', 'failed', 'zh-TW'), items: [] } },
      diagnostics: {
        generation: {
          sections: {
            consensus: { status: 'failed', reason: 'invalid_generation', validation_code: validationCode },
            disputes: { status: 'no_findings' },
            positions: { status: 'completed' },
          },
        },
      },
    })
    if (failure === 'incomplete') {
      const saved = local.sqlite.prepare("SELECT a.payload FROM ct_ai_artifacts a JOIN ct_ai_usage u ON u.id = a.attempt_id WHERE a.kind = 'raw' AND u.step_key = 'generate:consensus'").get() as {
        payload: string
      }
      const raw = object(object(JSON.parse(saved.payload)).response)
      expect(raw).toMatchObject({ choices: [{ index: 0, finish_reason: 'length' }], usage: { prompt_tokens: 200, completion_tokens: 80 } })
      expect(JSON.parse(String(responseMessage(raw).content))).toMatchObject({ items: [{ candidate_id: 'C1' }] })
    }
    const attempts = local.sqlite.prepare("SELECT step_key, state, actual_micro_usd FROM ct_ai_usage WHERE step_key LIKE 'generate:%' ORDER BY step_key").all()
    expect(attempts).toEqual([
      { step_key: 'generate:consensus', state: 'settled', actual_micro_usd: 44 },
      { step_key: 'generate:disputes', state: 'settled', actual_micro_usd: 44 },
      { step_key: 'generate:positions', state: 'settled', actual_micro_usd: 44 },
    ])
    const total = local.sqlite.prepare('SELECT SUM(actual_micro_usd) AS total FROM ct_ai_usage').get() as { total: number }
    expect(object(body.usage).actualMicroUsd).toBe(total.total)
    const citations = body.citation_map as Array<{ pointer: string }>
    expect(citations.some(entry => entry.pointer.startsWith('/consensus/'))).toBe(false)
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    expect(recordedRequests).toHaveLength(6)
    expect(local.sqlite.prepare("SELECT step_key, state, actual_micro_usd FROM ct_ai_usage WHERE step_key LIKE 'generate:%' ORDER BY step_key").all()).toEqual(attempts)
  })

  it('生成費用預留包含原生請求宣告的最大輸出 token，不只計入輸入', async () => {
    const generationInputs: Record<string, unknown>[] = []
    aiRun = async (modelName, input) => {
      if (modelName === GENERATION_MODEL) generationInputs.push(object(input))
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    expect(generationInputs).toHaveLength(3)
    for (const request of generationInputs) {
      if (typeof request.max_completion_tokens !== 'number') throw new Error('missing native output limit')
      expect(request.max_completion_tokens).toBe(8192)
      const inputBound = new TextEncoder().encode(JSON.stringify(request)).byteLength * 4 + 4096
      const expectedMicroUsd = Math.ceil((inputBound * 10 + request.max_completion_tokens * 30) / 100)
      const { section } = generationPayload(GENERATION_MODEL, request)!
      const attempt = local.sqlite.prepare('SELECT estimate_micro_usd, state FROM ct_ai_usage WHERE step_key = ?').get(`generate:${section}`)
      expect(attempt).toMatchObject({ estimate_micro_usd: expectedMicroUsd, state: 'settled' })
    }
  })

  it.each([
    {
      label: 'SDK JSON Mode 失敗',
      error: Object.assign(new Error("5007: JSON Mode couldn't be met; private-provider-detail"), { name: 'InferenceUpstreamError', status: 400, request: 'private-provider-detail' }),
      expected: { error_name: 'InferenceUpstreamError', provider_code: 5007, http_status: 400, category: 'json_mode_unmet' },
    },
    {
      label: '未知例外與非數字狀態',
      error: { name: 'private-provider-detail', message: 'private-provider-detail', status: '403', code: 'private-provider-detail', stack: 'private-provider-detail' },
      expected: { error_name: null, provider_code: null, http_status: null, category: 'unknown' },
    },
    {
      label: '逾時例外',
      error: new DOMException('private-provider-detail', 'TimeoutError'),
      expected: { error_name: 'TimeoutError', provider_code: null, http_status: null, category: 'timeout' },
    },
  ])('$label 只留下安全診斷，不重試或釋放未知費用', async ({ error, expected }) => {
    let generationCalls = 0
    aiRun = async (modelName, input) => {
      if (modelName !== GENERATION_MODEL) return model(modelName, input)
      generationCalls++
      throw error
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string; error_code: string; diagnostics: unknown[]; usage: { attempts: number; uncertain: number; reservedMicroUsd: number } }
    expect(body).toMatchObject({ status: 'failed', error_code: 'provider_error', usage: { attempts: 6, uncertain: 3 } })
    for (const section of ['consensus', 'disputes', 'positions']) {
      expect(body.diagnostics).toContainEqual({
        stage: 'provider',
        code: 'provider_error',
        step_key: `generate:${section}`,
        model_selector: GENERATION_MODEL,
        ...expected,
      })
    }
    expect(JSON.stringify(body)).not.toContain('private-provider-detail')
    const stored = local.sqlite.prepare("SELECT payload FROM ct_ai_artifacts WHERE kind = 'diagnostics'").all()
    expect(JSON.stringify(stored)).not.toContain('private-provider-detail')
    const attempts = local.sqlite.prepare("SELECT state, actual_micro_usd, estimate_micro_usd FROM ct_ai_usage WHERE step_key LIKE 'generate:%'").all() as Array<{
      state: string
      actual_micro_usd: number | null
      estimate_micro_usd: number
    }>
    expect(attempts).toHaveLength(3)
    for (const attempt of attempts) expect(attempt).toMatchObject({ state: 'unknown', actual_micro_usd: null })
    expect(body.usage.reservedMicroUsd).toBe(attempts.reduce((sum, attempt) => sum + attempt.estimate_micro_usd, 0))
    expect(generationCalls).toBe(3)
    auth.current = user('other')
    expect((await send('GET', `/api/evidence-jobs/${created.job_id}`)).status).toBe(404)
  })

  it('診斷儲存失敗仍保留 provider_error 與未知費用，不輸出例外內容', async () => {
    const originalSave = EvidenceStore.prototype.saveArtifact
    const save = vi.spyOn(EvidenceStore.prototype, 'saveArtifact').mockImplementation(function (this: EvidenceStore, input) {
      if (input.kind === 'diagnostics' && object(input.payload).stage === 'provider') throw new Error('private-storage-detail')
      return originalSave.call(this, input)
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    aiRun = async (modelName, input) => {
      if (modelName !== GENERATION_MODEL) return model(modelName, input)
      throw new Error('private-provider-detail')
    }
    try {
      auth.current = user('owner')
      const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
      expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
      const body = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
      expect(body).toMatchObject({ status: 'failed', error_code: 'provider_error', usage: { attempts: 6, uncertain: 3 } })
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-provider-detail')
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-storage-detail')
      expect(JSON.stringify(body)).not.toContain('private-provider-detail')
      expect(JSON.stringify(body)).not.toContain('private-storage-detail')
      expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key LIKE 'generate:%' AND state = 'unknown' AND actual_micro_usd IS NULL").get()).toMatchObject({ n: 3 })
    } finally {
      save.mockRestore()
      log.mockRestore()
    }
  })

  it('缺失或格式錯誤的 provider 用量保留未知預留，稽核摘要如實標示', async () => {
    aiRun = async (modelName, input) => {
      const response = object(await model(modelName, input))
      if (modelName !== '@cf/cloudflare/clairic') return response
      if (object(input).state === '支持再生能源。') {
        const { usage: _usage, ...withoutUsage } = response
        return withoutUsage
      }
      return { ...response, usage: { input_tokens: 100, output_tokens: 0, passes: 'invalid' } }
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const audit = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as { provenance: { artifacts: ArtifactSummary[] }; usage: { uncertain: number; reservedMicroUsd: number } }
    const clairic = audit.provenance.artifacts.filter(item => item.kind === 'raw' && item.model?.selector === '@cf/cloudflare/clairic')
    expect(clairic.map(item => item.model?.usage_status).sort()).toEqual(['malformed', 'missing'])
    for (const summary of clairic) {
      expect(summary.attempt).toMatchObject({ state: 'unknown', actual_micro_usd: null })
      expect(summary.attempt!.estimated_micro_usd).toBeGreaterThan(0)
    }
    expect(audit.usage.uncertain).toBe(2)
    expect(audit.usage.reservedMicroUsd).toBeGreaterThan(0)
  })

  it('重放遇到其他模型的舊 raw 不以新單價結算或重送，未知預留維持原值', async () => {
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    const snapshot = await store.getSnapshot(job!.executionId)
    const attempt = await store.beginAttempt({
      executionId: job!.executionId,
      stepKey: 'generate:consensus',
      estimateMicroUsd: 1000,
      generations: snapshot!.generations,
    })
    if (attempt.outcome !== 'started') throw new Error('failed to seed interrupted attempt')
    const oldRawPayload = {
      selector: '@cf/openai/gpt-oss-120b',
      request: {},
      response: { usage: { input_tokens: 200, output_tokens: 80 } },
      provenance: {},
    }
    const saved = await store.saveArtifact({
      executionId: job!.executionId,
      attemptId: attempt.attemptId,
      kind: 'raw',
      generations: snapshot!.generations,
      payload: oldRawPayload,
    })
    expect(saved.outcome).toBe('saved')
    if (saved.outcome !== 'saved') throw new Error('failed to seed historical raw')
    const originalRaw = local.sqlite.prepare('SELECT payload FROM ct_ai_artifacts WHERE id = ?').get(saved.artifactId)
    const originalReservation = local.sqlite.prepare('SELECT estimate_micro_usd FROM ct_ai_usage WHERE id = ?').get(attempt.attemptId) as { estimate_micro_usd: number }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    expect(local.sqlite.prepare('SELECT state, actual_micro_usd, estimate_micro_usd FROM ct_ai_usage WHERE id = ?').get(attempt.attemptId)).toMatchObject({
      state: 'unknown',
      actual_micro_usd: null,
      estimate_micro_usd: originalReservation.estimate_micro_usd,
    })
    expect(recordedRequests.filter(request => object(request).messages !== undefined).map(request => generationPayload(GENERATION_MODEL, request)!.section)).toEqual(['disputes', 'positions'])
    const result = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(object(result.usage)).toMatchObject({ uncertain: 1, reservedMicroUsd: originalReservation.estimate_micro_usd })
    expect(recordedRequests).toHaveLength(5)
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    expect(recordedRequests).toHaveLength(5)
    expect(local.sqlite.prepare('SELECT state, actual_micro_usd, estimate_micro_usd FROM ct_ai_usage WHERE id = ?').get(attempt.attemptId)).toMatchObject({
      state: 'unknown',
      actual_micro_usd: null,
      estimate_micro_usd: originalReservation.estimate_micro_usd,
    })
    expect(local.sqlite.prepare('SELECT payload FROM ct_ai_artifacts WHERE id = ?').get(saved.artifactId)).toEqual(originalRaw)
    const old = await store.getArtifact(job!.executionId, saved.artifactId)
    expect(old!.payload).toEqual(oldRawPayload)
  })

  it('登入守門、CSRF、完整流水線、跨帳號快取及私人修訂', async () => {
    const payload = { consent: true, language: 'zh-TW' }
    expect((await send('POST', '/api/issues/7/evidence-jobs', payload)).status).toBe(401)
    auth.current = user('banned', 'user', true)
    expect((await send('POST', '/api/issues/7/evidence-jobs', payload)).status).toBe(403)
    auth.current = user('owner')
    const cross = await app.request(
      'http://localhost/api/issues/7/evidence-jobs',
      { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'consent=true' },
      env
    )
    expect(cross.status).toBe(403)
    const before = source.sqlite.prepare('SELECT * FROM ct_materials ORDER BY id').all()
    const created = await send('POST', '/api/issues/7/evidence-jobs', payload)
    expect(created.status).toBe(202)
    const createdJson = (await created.json()) as { job_id: string; cache: string }
    expect(createdJson.cache).toBe('miss')
    expect(await runEvidenceWorkflow(env, createdJson.job_id, testStep())).toEqual({ status: 'ai_draft' })
    expect(source.sqlite.prepare('SELECT * FROM ct_materials ORDER BY id').all()).toEqual(before)
    expect(JSON.stringify(recordedRequests)).not.toContain('private-author')
    expect(JSON.stringify(recordedRequests)).not.toContain('private@example.test')
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
    expect(recordedRequests).toHaveLength(6)

    const result = await send('GET', `/api/evidence-jobs/${createdJson.job_id}`)
    expect(result.status).toBe(200)
    const draft = (await result.json()) as {
      data: { consensus: { items: Array<{ description: string }> } }
      citation_map: unknown[]
      diagnostics: { comparisons: { diagnostics: { direct_judgments: number } } }
      usage: { attempts: number }
    }
    expect(draft.data.consensus.items).toHaveLength(1)
    expect(draft.diagnostics.comparisons.diagnostics.direct_judgments).toBe(1)
    expect(draft.usage.attempts).toBe(6)
    const original = JSON.stringify(draft.data)
    const changed = structuredClone(draft.data)
    changed.consensus.items[0].description = '人工修改。'
    const revision = await send('POST', `/api/evidence-jobs/${createdJson.job_id}/revisions`, { parent_revision_id: 'ai', data: changed })
    expect(revision.status).toBe(201)
    expect(await revision.json()).toMatchObject({ verification: 'human_unverified' })
    expect((await send('POST', `/api/evidence-jobs/${createdJson.job_id}/revisions`, { parent_revision_id: 'ai', data: changed })).status).toBe(409)
    const history = (await (await send('GET', `/api/evidence-jobs/${createdJson.job_id}/revisions`)).json()) as {
      ai_base: { data: unknown }
      revisions: Array<{ verification: string; diff: unknown[] }>
    }
    expect(JSON.stringify(history.ai_base.data)).toBe(original)
    expect(history.revisions[0].verification).toBe('human_unverified')
    expect(history.revisions[0].diff).toContainEqual({ path: '/consensus/items/0/description', before: '材料呈現的主張。', after: '人工修改。' })

    auth.current = user('other')
    expect((await send('GET', `/api/evidence-jobs/${createdJson.job_id}`)).status).toBe(404)
    const cached = await send('POST', '/api/issues/7/evidence-jobs', payload)
    expect(cached.status).toBe(200)
    const otherJob = (await cached.json()) as { job_id: string; cache: string }
    expect(otherJob).toMatchObject({ cache: 'hit' })
    expect(otherJob.job_id).not.toBe(createdJson.job_id)
    const otherHistory = (await (await send('GET', `/api/evidence-jobs/${otherJob.job_id}/revisions`)).json()) as { revisions: unknown[] }
    expect(otherHistory.revisions).toEqual([])
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_usage').get()).toMatchObject({ n: 6 })
    auth.current = user('admin', 'admin')
    expect((await send('GET', `/api/evidence-jobs/${createdJson.job_id}`)).status).toBe(200)
    expect((await send('POST', `/api/evidence-jobs/${createdJson.job_id}/revisions`, { parent_revision_id: 'ai', data: changed })).status).toBe(404)
  })

  it.each(['compare-0', 'generate-consensus', 'validate-generation-consensus'])('%s 的工件已保存但 checkpoint 未提交，重放只完成剩餘分項而不重付', async pausedStep => {
    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>(resolve => {
      release = resolve
    })
    const paused = new Promise<void>(resolve => {
      reached = resolve
    })
    const stalledStep = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        const result = await callback()
        if (name === pausedStep) {
          reached()
          await waiting
        }
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const interrupted = runEvidenceWorkflow(env, created.job_id, stalledStep)
    await paused
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    expect(job?.status).toBe(pausedStep === 'compare-0' ? 'comparing' : 'generating')
    const oldRaw = await store.listArtifacts(job!.executionId, 'raw')
    const beforeCount = pausedStep === 'compare-0' ? 3 : 4
    expect(oldRaw).toHaveLength(beforeCount)
    expect(recordedRequests).toHaveLength(beforeCount)
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const afterRaw = await store.listArtifacts(job!.executionId, 'raw')
    expect(afterRaw).toHaveLength(6)
    expect(afterRaw.slice(0, beforeCount).map(item => item.id)).toEqual(oldRaw.map(item => item.id))
    expect(recordedRequests).toHaveLength(6)
    release()
    await interrupted
    expect((await store.getJob(created.job_id, 'owner'))?.status).toBe('ai_draft')
  })
  it.each([
    { label: '爭點完成診斷 step 逾時耗盡', stepName: 'finish-generation-disputes', fault: 'timeout' },
    { label: '立場前查核 step 逾時耗盡', stepName: 'prepare-generation-positions', fault: 'timeout' },
    { label: '爭點完成診斷儲存重試耗盡', stepName: 'finish-generation-disputes', fault: 'storage' },
    { label: '爭點完成診斷收到無效儲存操作', stepName: 'finish-generation-disputes', fault: 'invalid_input' },
  ] as const)('$label 時失敗，不啟動立場且保留已驗證工件與已結算費用', async ({ stepName, fault }) => {
    let validated = false
    let injections = 0
    const originalSave = EvidenceStore.prototype.saveArtifact
    const save = vi.spyOn(EvidenceStore.prototype, 'saveArtifact').mockImplementation(function (this: EvidenceStore, input) {
      if (fault !== 'timeout' && input.kind === 'diagnostics') {
        const event = object(input.payload)
        if (event.stage === 'generation' && event.phase === 'finished' && object(event.outcome).section === 'disputes') {
          injections++
          throw new EvidenceStoreError(fault === 'storage' ? 'storage_error' : 'invalid_input')
        }
      }
      return originalSave.call(this, input)
    })
    const failingStep = retryingStep(async (name, _attempt, callback) => {
      if (name === stepName && fault === 'timeout') {
        injections++
        throw new Error('simulated_step_timeout')
      }
      const result = await callback()
      if (name === 'validate-generation-disputes') validated = true
      return result
    })
    try {
      auth.current = user('owner')
      const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
      expect(await runEvidenceWorkflow(env, created.job_id, failingStep.step)).toEqual({ status: 'failed' })
      expect(validated).toBe(true)
      expect(injections).toBe(fault === 'invalid_input' ? 1 : 4)
      expect(failingStep.attempts.get(stepName)).toBe(fault === 'invalid_input' ? 1 : 4)
      expect(failingStep.configs.get(stepName)).toMatchObject({ retries: { limit: 3, delay: '1 second', backoff: 'exponential' }, timeout: '30 seconds' })
      for (const [name, config] of failingStep.configs) {
        if (/^(extract|compare|generate)-/.test(name)) expect(config).toMatchObject({ retries: { limit: 0 }, timeout: '10 minutes' })
      }
      const attempts = local.sqlite.prepare('SELECT id, step_key, state, actual_micro_usd FROM ct_ai_usage ORDER BY step_key').all() as Array<{
        id: string
        step_key: string
        state: string
        actual_micro_usd: number | null
      }>
      expect(attempts.map(item => item.step_key)).toEqual(['compare:0', 'extract:2', 'extract:4', 'generate:consensus', 'generate:disputes'])
      for (const attempt of attempts) {
        expect(attempt.state).toBe('settled')
        expect(attempt.actual_micro_usd).not.toBeNull()
      }
      const actual = attempts.reduce((sum, item) => sum + item.actual_micro_usd!, 0)
      const store = new EvidenceStore(local.asD1())
      const job = await store.getJob(created.job_id, 'owner')
      const raw = await store.listArtifacts(job!.executionId, 'raw')
      const sections = (await store.listArtifacts(job!.executionId, 'generation')).filter(item => object(item.payload).stage === 'generation_section')
      expect(raw).toHaveLength(5)
      expect(new Set(sections.map(item => object(object(item.payload).result).section))).toEqual(new Set(['consensus', 'disputes']))
      for (const section of sections) {
        const payload = object(section.payload)
        const name = String(object(payload.result).section)
        const linkedRaw = raw.find(item => item.id === payload.raw_artifact_id)
        expect(linkedRaw?.attemptId).toBe(attempts.find(item => item.step_key === `generate:${name}`)?.id)
        expect(linkedRaw).toBeDefined()
      }
      const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
      expect(response.status).toBe(200)
      const body = object(await response.json())
      expect(body).toMatchObject({
        status: 'failed',
        error_code: 'internal_error',
        usage: { attempts: 5, actualMicroUsd: actual, reservedMicroUsd: 0, uncertain: 0 },
        generation_progress: { current_section: null, sections: { positions: { status: 'not_started' } } },
      })
      expect(body.data).toBeUndefined()
      const summaries = object(body.provenance).artifacts as ArtifactSummary[]
      for (const item of [...raw, ...sections]) expect(summaries.some(summary => summary.id === item.id)).toBe(true)
      expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
      expect(recordedRequests).toHaveLength(5)
    } finally {
      save.mockRestore()
    }
  })

  it.each([
    { label: '寫入前的暫時儲存故障', lostAfterWrite: false },
    { label: '診斷已寫入但回應遺失', lostAfterWrite: true },
  ])('$label 可由銜接 step 重試恢復，不重付或重複完成事件', async ({ lostAfterWrite }) => {
    const originalSave = EvidenceStore.prototype.saveArtifact
    let injected = false
    let targetSaveCalls = 0
    const save = vi.spyOn(EvidenceStore.prototype, 'saveArtifact').mockImplementation(async function (this: EvidenceStore, input) {
      if (input.kind === 'diagnostics') {
        const event = object(input.payload)
        if (event.stage === 'generation' && event.phase === 'finished' && object(event.outcome).section === 'disputes') {
          targetSaveCalls++
          if (!injected) {
            injected = true
            if (lostAfterWrite) await originalSave.call(this, input)
            throw new Error('synthetic-private-detail')
          }
        }
      }
      return originalSave.call(this, input)
    })
    const workflow = retryingStep()
    try {
      auth.current = user('owner')
      const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
      expect(await runEvidenceWorkflow(env, created.job_id, workflow.step)).toEqual({ status: 'ai_draft' })
      expect(injected).toBe(true)
      expect(targetSaveCalls).toBe(lostAfterWrite ? 1 : 2)
      expect(workflow.attempts.get('finish-generation-disputes')).toBe(2)
      const observedFailures = workflow.failures.get('finish-generation-disputes')
      expect(observedFailures).toHaveLength(1)
      const observedError = observedFailures![0]
      expect(observedError).toBeInstanceOf(EvidenceStoreError)
      expect(observedError).toMatchObject({ code: 'storage_error', message: 'storage_error' })
      expect(object(observedError)).not.toHaveProperty('cause')
      expect(String(observedError)).not.toContain('synthetic-private-detail')
      expect(JSON.stringify(observedError)).not.toContain('synthetic-private-detail')
      for (const name of ['load-generation-state', 'prepare-generation-disputes', 'finish-generation-disputes']) {
        expect(workflow.configs.get(name)).toMatchObject({ retries: { limit: 3, delay: '1 second', backoff: 'exponential' }, timeout: '30 seconds' })
      }
      for (const [name, config] of workflow.configs) {
        if (/^(extract|compare|generate)-/.test(name)) expect(config).toMatchObject({ retries: { limit: 0 }, timeout: '10 minutes' })
      }
      const store = new EvidenceStore(local.asD1())
      const job = await store.getJob(created.job_id, 'owner')
      const raw = await store.listArtifacts(job!.executionId, 'raw')
      const sections = (await store.listArtifacts(job!.executionId, 'generation')).filter(item => object(item.payload).stage === 'generation_section')
      const events = (await store.listArtifacts(job!.executionId, 'diagnostics')).map(item => object(item.payload))
      expect(raw).toHaveLength(6)
      expect(sections).toHaveLength(3)
      for (const section of ['consensus', 'disputes', 'positions']) {
        expect(events.filter(event => event.stage === 'generation' && event.phase === 'finished' && object(event.outcome).section === section)).toHaveLength(1)
      }
      const usage = local.sqlite.prepare('SELECT step_key, state, actual_micro_usd FROM ct_ai_usage ORDER BY step_key').all() as Array<{
        step_key: string
        state: string
        actual_micro_usd: number | null
      }>
      expect(usage).toHaveLength(6)
      for (const attempt of usage) {
        expect(attempt.state).toBe('settled')
        expect(attempt.actual_micro_usd).not.toBeNull()
      }
      const actual = usage.reduce((sum, item) => sum + item.actual_micro_usd!, 0)
      expect(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()).toMatchObject({
        status: 'ai_draft',
        usage: { attempts: 6, actualMicroUsd: actual, reservedMicroUsd: 0, uncertain: 0 },
      })
      expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
      expect(recordedRequests).toHaveLength(6)
    } finally {
      save.mockRestore()
    }
  })

  it('爭點完成事件已保存但 finish checkpoint 遺失，重放不重付或重複事件', async () => {
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>()
    const { promise: paused, resolve: reached } = Promise.withResolvers<void>()
    const checkpoints = new Map<string, unknown>()
    let finishRuns = 0
    const replayableStep = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        if (checkpoints.has(name)) return checkpoints.get(name)
        const result = await callback()
        if (name === 'finish-generation-disputes' && ++finishRuns === 1) {
          reached()
          await waiting
        }
        checkpoints.set(name, result)
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const interrupted = runEvidenceWorkflow(env, created.job_id, replayableStep)
    await paused
    try {
      const store = new EvidenceStore(local.asD1())
      const job = await store.getJob(created.job_id, 'owner')
      const beforeRaw = await store.listArtifacts(job!.executionId, 'raw')
      const beforeSections = (await store.listArtifacts(job!.executionId, 'generation')).filter(item => object(item.payload).stage === 'generation_section')
      const beforeUsage = local.sqlite.prepare("SELECT id, step_key, state, actual_micro_usd FROM ct_ai_usage WHERE step_key IN ('generate:consensus', 'generate:disputes') ORDER BY step_key").all()
      expect(beforeRaw).toHaveLength(5)
      expect(beforeSections).toHaveLength(2)
      expect(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()).toMatchObject({
        status: 'generating',
        generation_progress: { sections: { consensus: { status: 'completed' }, disputes: { status: 'no_findings' } } },
      })
      expect(await runEvidenceWorkflow(env, created.job_id, replayableStep)).toEqual({ status: 'ai_draft' })
      expect(finishRuns).toBe(2)
      const afterRaw = await store.listArtifacts(job!.executionId, 'raw')
      const afterSections = (await store.listArtifacts(job!.executionId, 'generation')).filter(item => object(item.payload).stage === 'generation_section')
      expect(afterRaw).toHaveLength(6)
      expect(afterRaw.slice(0, beforeRaw.length)).toEqual(beforeRaw)
      expect(afterSections.slice(0, beforeSections.length)).toEqual(beforeSections)
      expect(local.sqlite.prepare("SELECT id, step_key, state, actual_micro_usd FROM ct_ai_usage WHERE step_key IN ('generate:consensus', 'generate:disputes') ORDER BY step_key").all()).toEqual(
        beforeUsage
      )
      const events = (await store.listArtifacts(job!.executionId, 'diagnostics')).map(item => object(item.payload))
      for (const section of ['consensus', 'disputes']) {
        expect(events.filter(event => event.stage === 'generation' && event.phase === 'finished' && object(event.outcome).section === section)).toHaveLength(1)
      }
      expect(recordedRequests).toHaveLength(6)
      expect(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()).toMatchObject({ status: 'ai_draft', usage: { attempts: 6, uncertain: 0 } })
    } finally {
      release()
      await interrupted
    }
  })

  it.each(['withdrawn', 'erased', 'suspended'] as const)('爭點驗證後遇 %s 防線即停止，不重試或啟動後續分項', async disposition => {
    const revokeAfterValidation = retryingStep(async (name, _attempt, callback) => {
      const result = await callback()
      if (name === 'validate-generation-disputes') {
        if (disposition === 'withdrawn') source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 2').run()
        else if (disposition === 'erased') await new EvidenceStore(local.asD1()).eraseSource({ namespace: SOURCE_NAMESPACE, kind: 'material', id: 2, reason: 'request' })
        else
          env.DB_AUTH = {
            prepare() {
              return {
                bind() {
                  return {
                    async first() {
                      return null
                    },
                  }
                },
              }
            },
          } as unknown as D1Database
      }
      return result
    })
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, revokeAfterValidation.step)).toEqual({ status: 'failed' })
    expect(revokeAfterValidation.configs.get('finish-generation-disputes')).toMatchObject({ retries: { limit: 3 }, timeout: '30 seconds' })
    expect(revokeAfterValidation.attempts.get('finish-generation-disputes')).toBe(1)
    expect(revokeAfterValidation.attempts.has('prepare-generation-positions')).toBe(false)
    const body = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    const expectedStatus = disposition === 'suspended' ? 'failed' : disposition
    expect(body).toMatchObject({ status: expectedStatus, usage: { attempts: 5, uncertain: 0 } })
    if (disposition === 'suspended') expect(body).toMatchObject({ error_code: 'account_suspended' })
    else for (const field of ['data', 'sources', 'evidence', 'generation_artifact', 'provenance', 'diagnostics']) expect(body).not.toHaveProperty(field)
    expect(body).not.toHaveProperty('data')
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: expectedStatus })
    expect(local.sqlite.prepare("SELECT step_key, state FROM ct_ai_usage WHERE step_key LIKE 'generate:%' ORDER BY step_key").all()).toEqual([
      { step_key: 'generate:consensus', state: 'settled' },
      { step_key: 'generate:disputes', state: 'settled' },
    ])
    if (disposition === 'erased') expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(recordedRequests).toHaveLength(5)
  })

  it('回應未保存的在途付費重放標不確定，絕不再次呼叫', async () => {
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>(resolve => {
      release = resolve
    })
    const called = new Promise<void>(resolve => {
      started = resolve
    })
    let calls = 0
    aiRun = async (modelName, input) => {
      calls++
      // 第一份沒有可抽取主張；第二份在途遺失時，整個工作仍無可交付證據。
      if (calls === 1) {
        const response = object(await model(modelName, input))
        return { ...response, answers: { claims: { type: 'list', value: [], spans: [] } } }
      }
      started()
      await waiting
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true, material_ids: [2, 4] })).json()) as { job_id: string }
    const interrupted = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    const store = new EvidenceStore(local.asD1())
    const uncertain = await store.getJob(created.job_id, 'owner')
    expect(uncertain).toMatchObject({ status: 'failed', errorCode: 'provider_uncertain', usage: { uncertain: 1 } })
    expect(uncertain!.usage.reservedMicroUsd).toBeGreaterThan(0)
    expect(calls).toBe(2)
    const savedRaw = await store.listArtifacts(uncertain!.executionId, 'raw')
    release()
    await interrupted
    expect(calls).toBe(2)
    expect(await store.listArtifacts(uncertain!.executionId, 'raw')).toEqual(savedRaw)
  })

  it('模型已啟動後本機清除，延遲回應不能回到任何工件或 checkpoint', async () => {
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>(resolve => {
      release = resolve
    })
    const called = new Promise<void>(resolve => {
      started = resolve
    })
    aiRun = async (modelName, input) => {
      started()
      await waiting
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const running = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    expect((await send('POST', '/api/evidence-maintenance/erase', { kind: 'material', id: 2 })).status).toBe(403)
    auth.current = user('admin', 'admin')
    expect((await send('POST', '/api/evidence-maintenance/erase', { kind: 'material', id: 2 })).status).toBe(200)
    auth.current = user('owner')
    release()
    await running
    const job = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as { status: string }
    expect(job.status).toBe('erased')
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_sources WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_revisions WHERE payload IS NOT NULL OR diff IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
    expect(local.sqlite.prepare('SELECT state FROM ct_ai_usage').get()).toMatchObject({ state: 'settled' })
  })

  it('爭點 provider 失敗保留其他兩段，失敗空段不冒充 no_findings', async () => {
    aiRun = async (modelName, input) => {
      if (generationPayload(modelName, input)?.section === 'disputes') throw new Error('private-provider-failure')
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const detail = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as DraftResponse
    expect(detail).toMatchObject({
      status: 'partial_draft',
      usage: { attempts: 6, uncertain: 1 },
      data: { disputes: { Overview: statusOverview('disputes', 'failed', 'zh-TW'), items: [] } },
      diagnostics: {
        partial: true,
        generation: {
          sections: {
            consensus: { status: 'completed' },
            disputes: { status: 'failed', reason: 'provider_error' },
            positions: { status: 'completed' },
          },
        },
      },
    })
    expect(detail.diagnostics.generation).toMatchObject({
      completion: { status: 'not_needed', targets: [] },
      status_overviews: [{ section: 'disputes', pointer: '/disputes/Overview', kind: 'status', status: 'failed', origin: 'program' }],
    })
    expect(detail.citation_map.some((entry: { pointer: string }) => entry.pointer === '/disputes/Overview')).toBe(false)
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: 0 })
    const requestsBefore = recordedRequests.length
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    expect(recordedRequests).toHaveLength(requestsBefore)
    expect(await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()).toMatchObject({ cache: 'hit', status: 'partial_draft' })
  })

  it('共識宣告來源只在標題引用仍拒收，其他分項可交付且不自動修復或重打', async () => {
    aiRun = async (modelName, input) => {
      const response = await model(modelName, input)
      if (generationPayload(modelName, input)?.section !== 'consensus') return response
      const message = responseMessage(response)
      const data = JSON.parse(String(message.content))
      data.items[0].description[0].evidence_ids = [data.items[0].evidence_ids[0]]
      message.content = JSON.stringify(data)
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const detail = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as DraftResponse
    expect(detail).toMatchObject({
      status: 'partial_draft',
      data: { consensus: { Overview: statusOverview('consensus', 'failed', 'zh-TW'), items: [] } },
      diagnostics: {
        generation: {
          sections: {
            consensus: { status: 'failed', reason: 'invalid_generation', validation_code: 'generation_insufficient_group_citations' },
            disputes: { status: 'no_findings' },
            positions: { status: 'completed' },
          },
        },
      },
    })
    const requestsBefore = recordedRequests.length
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    expect(recordedRequests).toHaveLength(requestsBefore)
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: 0 })
  })

  it.each(['zh-TW', 'en', 'ja'] as const)('三段皆無內容以 %s 狀態文字呈現，不呼叫補完或建立引用', async language => {
    aiRun = async (modelName, input) => {
      const response = await model(modelName, input)
      const body = generationPayload(modelName, input)
      if (!body) return response
      const data =
        body.section === 'consensus'
          ? {
              Overview: null,
              items: [],
              rejected_candidates: (object(body.comparison).consensus_groups as Array<{ candidate_id: string }>).map(group => ({ candidate_id: group.candidate_id, reason: 'no_shared_proposition' })),
            }
          : body.section === 'positions'
            ? { Overview: null, items: [], exclusions: (body.evidence as Array<{ id: string }>).map(item => ({ evidence_id: item.id, reason: 'insufficient_attribution' })) }
            : { Overview: null, items: [] }
      responseMessage(response).content = JSON.stringify(data)
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true, language })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const detail = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as DraftResponse
    expect(detail).toMatchObject({
      status: 'ai_draft',
      data: {
        consensus: { Overview: statusOverview('consensus', 'no_findings', language), items: [] },
        disputes: { Overview: statusOverview('disputes', 'no_findings', language), items: [] },
        positions: { Overview: statusOverview('positions', 'no_findings', language), items: [] },
      },
      diagnostics: {
        partial: false,
        generation: {
          sections: {
            consensus: { status: 'no_findings' },
            disputes: { status: 'no_findings' },
            positions: { status: 'no_findings' },
          },
        },
      },
    })
    expect(detail.citation_map).toEqual([])
    expect(detail.diagnostics.generation.completion).toMatchObject({ status: 'not_needed', targets: [] })
    expect(recordedRequests).toHaveLength(6)
  })

  it('第一段後預算耗盡，保留有效段且不啟動後兩段或重打第一段', async () => {
    const budgetStep = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        const result = await callback()
        if (name === 'validate-generation-consensus') {
          const others = local.sqlite.prepare("SELECT SUM(actual_micro_usd) AS n FROM ct_ai_usage WHERE step_key <> 'extract:2'").get() as { n: number }
          local.sqlite.prepare("UPDATE ct_ai_usage SET actual_micro_usd = ? WHERE step_key = 'extract:2'").run(5_000_000 - others.n)
        }
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, budgetStep)).toEqual({ status: 'partial_draft' })
    const detail = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as DraftResponse
    expect(detail).toMatchObject({
      status: 'partial_draft',
      usage: { attempts: 4, actualMicroUsd: 5_000_000 },
      diagnostics: {
        generation: {
          sections: {
            consensus: { status: 'completed' },
            disputes: { status: 'not_started', reason: 'budget_exhausted' },
            positions: { status: 'not_started', reason: 'budget_exhausted' },
          },
        },
      },
    })
    expect(detail.data.disputes.Overview).toBe(statusOverview('disputes', 'not_started', 'zh-TW'))
    expect(detail.data.positions.Overview).toBe(statusOverview('positions', 'not_started', 'zh-TW'))
    expect(detail.citation_map.some((entry: { pointer: string }) => entry.pointer === '/disputes/Overview' || entry.pointer === '/positions/Overview')).toBe(false)
    expect(detail.diagnostics.generation.completion).toMatchObject({ status: 'not_needed', targets: [] })
    expect(local.sqlite.prepare("SELECT step_key FROM ct_ai_usage WHERE step_key LIKE 'generate:%'").all()).toEqual([{ step_key: 'generate:consensus' }])
  })

  it('輪詢顯示目前專項，未完成段不冒充 no_findings', async () => {
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>()
    const { promise: called, resolve: started } = Promise.withResolvers<void>()
    aiRun = async (modelName, input) => {
      if (generationPayload(modelName, input)?.section === 'disputes') {
        started()
        await waiting
      }
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const running = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    try {
      const detail = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
      expect(detail).toMatchObject({
        status: 'generating',
        generation_progress: {
          current_section: 'disputes',
          sections: {
            consensus: { status: 'completed' },
            disputes: { status: 'running' },
            positions: { status: 'pending' },
          },
        },
      })
    } finally {
      release()
      await running
    }
  })

  it('已保存共識後來源清除，後段回應與成功分項均不可復活', async () => {
    let generationCalls = 0
    aiRun = async (modelName, input) => {
      if (modelName === GENERATION_MODEL) {
        generationCalls++
        if (generationPayload(modelName, input)?.section === 'disputes') {
          await new EvidenceStore(local.asD1()).eraseSource({ namespace: SOURCE_NAMESPACE, kind: 'material', id: 2, reason: 'request' })
        }
      }
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    expect(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()).toMatchObject({ status: 'erased' })
    expect(generationCalls).toBe(2)
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_sources WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
  })

  it('第一段完成後申請者被停權，不再啟動其他段或交付有效草稿', async () => {
    const suspendStep = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        const result = await callback()
        if (name === 'validate-generation-consensus') {
          env.DB_AUTH = {
            prepare() {
              return {
                bind() {
                  return {
                    async first() {
                      return null
                    },
                  }
                },
              }
            },
          } as unknown as D1Database
        }
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, suspendStep)).toEqual({ status: 'failed' })
    const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(detail).toMatchObject({ status: 'failed', error_code: 'account_suspended', usage: { attempts: 4 } })
    expect(detail.data).toBeUndefined()
  })

  it('單素材 provider 失敗可產生明示 partial，未知成本不退款', async () => {
    aiRun = async (modelName, input) => {
      if (modelName === '@cf/cloudflare/clairic' && object(input).state === '支持再生能源。') throw new Error('provider interruption')
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const result = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as {
      status: string
      diagnostics: { partial: boolean }
      usage: { uncertain: number; reservedMicroUsd: number }
    }
    expect(result.status).toBe('partial_draft')
    expect(result.diagnostics.partial).toBe(true)
    expect(result.usage.uncertain).toBe(1)
    expect(result.usage.reservedMicroUsd).toBeGreaterThan(0)
  })

  it('只補缺值一次，保留原文、順序與引文，額外嘗試仍屬同一工作', async () => {
    let nativeResponse: unknown
    aiRun = async (modelName, input) => {
      const response = await missingFieldsModel(modelName, input)
      if (generationPayload(modelName, input)?.operation === 'fill_missing_fields') nativeResponse = structuredClone(response)
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const workflow = retryingStep()
    expect(await runEvidenceWorkflow(env, created.job_id, workflow.step)).toEqual({ status: 'ai_draft' })
    expect(workflow.configs.get('complete-draft')).toMatchObject({ retries: { limit: 0 }, timeout: '10 minutes' })
    expect(workflow.attempts.get('complete-draft')).toBe(1)
    for (const name of ['plan-generation', 'validate-generation-disputes', 'assemble-generation']) {
      expect(workflow.configs.get(name)).toMatchObject({ retries: { limit: 0 }, timeout: '30 seconds' })
    }
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    const artifacts = await store.listArtifacts(job!.executionId, 'generation')
    const planned = artifacts.find(item => object(item.payload).stage === 'completion_plan')!
    const plan = object(planned.payload).plan as {
      base: {
        data: { consensus: { Overview: string | null }; disputes: { Overview: string | null }; positions: { Overview: string | null; items: Array<{ Core_concern: string | null }> } }
        citation_map: Array<{ pointer: string; evidence_ids: string[] }>
      }
      targets: Array<{ pointer: string; evidence_ids: string[] }>
    }
    const detail = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as {
      data: typeof plan.base.data
      citation_map: Array<{ pointer: string; evidence_ids: string[] }>
      diagnostics: { generation: { completion: { status: string; targets: string[]; artifact_id: string; raw_artifact_id: string } } }
      provenance: { completion_plan_artifact_id: string; completion_artifact_id: string; completion_raw_artifact_id: string; raw_artifact_ids: string[] }
      generation_progress: { current_section: string | null; completion: { status: string } }
      usage: { attempts: number; uncertain: number }
    }
    const expected = structuredClone(plan.base.data)
    expected.consensus.Overview = '補完欄位。'
    expected.disputes.Overview = '補完欄位。'
    expected.positions.items[0].Core_concern = '補完欄位。'
    expect(detail.data).toEqual(expected)
    expect(detail.data.positions.Overview).toBe('能源觀點的摘要。')
    expect(detail.citation_map.slice(0, plan.base.citation_map.length)).toEqual(plan.base.citation_map)
    const pointers = ['/consensus/Overview', '/disputes/Overview', '/positions/items/0/Core_concern']
    expect(plan.targets.map(target => target.pointer)).toEqual(pointers)
    for (const target of plan.targets) {
      const citations = detail.citation_map.filter(entry => entry.pointer === target.pointer)
      expect(citations.length).toBeGreaterThan(0)
      for (const citation of citations) expect(citation.evidence_ids.every(id => target.evidence_ids.includes(id))).toBe(true)
    }
    const completion = detail.diagnostics.generation.completion
    expect(completion).toMatchObject({ status: 'completed', targets: pointers })
    expect(detail.generation_progress).toMatchObject({ current_section: null, completion: { status: 'completed' } })
    expect(detail.provenance).toMatchObject({
      completion_plan_artifact_id: planned.id,
      completion_artifact_id: completion.artifact_id,
      completion_raw_artifact_id: completion.raw_artifact_id,
    })
    expect(detail.provenance.raw_artifact_ids).toContain(completion.raw_artifact_id)
    const raw = await store.getArtifact(job!.executionId, completion.raw_artifact_id)
    const rawPayload = object(raw!.payload)
    expect(rawPayload.response).toEqual(nativeResponse)
    const request = object(rawPayload.request)
    const requestBody = generationPayload(GENERATION_MODEL, request)!
    expect(requestBody).toMatchObject({ operation: 'fill_missing_fields', targets: plan.targets })
    expect(JSON.parse(String(responseMessage(rawPayload.response).content))).toMatchObject({ base_hash: requestBody.base_hash })
    expect(JSON.stringify(request)).not.toContain('private-author')
    expect(JSON.stringify(stepOutputs)).not.toContain('補完欄位。')
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
    expect(request.max_completion_tokens).toBe(8192)
    const inputBound = new TextEncoder().encode(JSON.stringify(request)).byteLength * 4 + 4096
    const estimate = Math.ceil((inputBound * 10 + Number(request.max_completion_tokens) * 30) / 100)
    expect(local.sqlite.prepare("SELECT state, estimate_micro_usd, actual_micro_usd FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({
      state: 'settled',
      estimate_micro_usd: estimate,
      actual_micro_usd: 44,
    })
    expect(detail.usage).toMatchObject({ attempts: 7, uncertain: 0 })
    expect(recordedRequests).toHaveLength(7)
    expect(await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()).toMatchObject({ job_id: created.job_id, cache: 'hit' })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_executions').get()).toMatchObject({ n: 1 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_jobs').get()).toMatchObject({ n: 1 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_usage').get()).toMatchObject({ n: 7 })
  })

  it('既有欄位完整及空段狀態免補完，進度和來源不冒充模型輸出', async () => {
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true, language: 'en' })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const detail = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as {
      data: { disputes: { Overview: string; items: unknown[] } }
      citation_map: Array<{ pointer: string }>
      diagnostics: { generation: { completion: { status: string; targets: string[]; raw_artifact_id: null }; status_overviews: unknown[] } }
      provenance: { completion_raw_artifact_id: null; raw_artifact_ids: string[] }
      generation_progress: { completion: { status: string } }
    }
    expect(detail.data.disputes).toEqual({ Overview: statusOverview('disputes', 'no_findings', 'en'), items: [] })
    expect(detail.citation_map.some(entry => entry.pointer === '/disputes/Overview')).toBe(false)
    expect(detail.diagnostics.generation).toMatchObject({
      completion: { status: 'not_needed', targets: [], raw_artifact_id: null },
      status_overviews: [{ section: 'disputes', pointer: '/disputes/Overview', kind: 'status', status: 'no_findings', origin: 'program' }],
    })
    expect(detail.generation_progress.completion.status).toBe('not_needed')
    expect(detail.provenance.completion_raw_artifact_id).toBeNull()
    expect(detail.provenance.raw_artifact_ids).toHaveLength(6)
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: 0 })
    expect(recordedRequests).toHaveLength(6)
  })

  it('有效分項有缺值且其他分項失敗時，補完後仍是標明失敗段的 partial', async () => {
    aiRun = async (modelName, input) => {
      if (generationPayload(modelName, input)?.section === 'disputes') throw new Error('private-provider-detail')
      return missingFieldsModel(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const detail = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as DraftResponse
    expect(detail).toMatchObject({
      status: 'partial_draft',
      usage: { attempts: 7, uncertain: 1 },
      data: {
        consensus: { Overview: '補完欄位。' },
        disputes: { Overview: statusOverview('disputes', 'failed', 'zh-TW'), items: [] },
        positions: { items: [{ Core_concern: '補完欄位。' }] },
      },
      diagnostics: {
        generation: {
          sections: { disputes: { status: 'failed', reason: 'provider_error' } },
          completion: { status: 'completed', targets: ['/consensus/Overview', '/positions/items/0/Core_concern'] },
          status_overviews: [{ section: 'disputes', pointer: '/disputes/Overview', kind: 'status', status: 'failed', origin: 'program' }],
        },
      },
    })
    expect(detail.citation_map.some((entry: { pointer: string }) => entry.pointer === '/disputes/Overview')).toBe(false)
    expect(JSON.stringify(detail)).not.toContain('private-provider-detail')
  })

  it.each(['wrong_base', 'missing', 'duplicate', 'unknown_pointer', 'overwrite', 'wrong_citation', 'extra_field', 'invalid_json'] as const)(
    '拒絕補完回應 %s，保留成功分項與原始回應但不交付不完整資料',
    async corruption => {
      aiRun = async (modelName, input) => {
        const response = await missingFieldsModel(modelName, input)
        if (generationPayload(modelName, input)?.operation !== 'fill_missing_fields') return response
        const message = responseMessage(response)
        const patch = object(JSON.parse(String(message.content)))
        const fills = patch.fills as Array<Record<string, unknown>>
        if (corruption === 'wrong_base') patch.base_hash = 'wrong'
        if (corruption === 'missing') fills.pop()
        if (corruption === 'duplicate') fills.push(structuredClone(fills[0]))
        if (corruption === 'unknown_pointer') fills[0].pointer = '/unknown/Overview'
        if (corruption === 'overwrite') fills[0].pointer = '/positions/Overview'
        if (corruption === 'wrong_citation') object((fills[0].sentences as unknown[])[0]).evidence_ids = ['not-an-evidence-id']
        if (corruption === 'extra_field') patch.data = { positions: 'not allowed' }
        message.content = corruption === 'invalid_json' ? '{"private_bad_patch"' : JSON.stringify(patch)
        return response
      }
      auth.current = user('owner')
      const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
      expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
      const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
      expect(detail).toMatchObject({
        status: 'failed',
        error_code: 'invalid_generation',
        usage: { attempts: 7 },
        generation_progress: { completion: { status: 'failed', reason: 'invalid_generation' } },
      })
      expect(detail.data).toBeUndefined()
      const events = detail.diagnostics as Array<Record<string, unknown>>
      const finished = events.find(event => event.stage === 'completion' && event.phase === 'finished')!
      const outcome = object(finished.outcome)
      expect(outcome.validation_code).toEqual(expect.stringMatching(/^generation_/))
      expect(outcome.raw_artifact_id).toEqual(expect.any(String))
      expect(JSON.stringify(events)).not.toContain('private_bad_patch')
      const job = await new EvidenceStore(local.asD1()).getJob(created.job_id, 'owner')
      const store = new EvidenceStore(local.asD1())
      expect((await store.listArtifacts(job!.executionId, 'generation')).filter(item => object(item.payload).stage === 'generation_section')).toHaveLength(3)
      expect(await store.getArtifact(job!.executionId, String(outcome.raw_artifact_id))).not.toBeNull()
      expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
      expect(recordedRequests).toHaveLength(7)
    }
  )

  it('補完核心關注不得引用其他立場群組的有效證據', async () => {
    aiRun = async (modelName, input) => {
      const response = await missingFieldsModel(modelName, input)
      const request = generationPayload(modelName, input)
      if (request?.section === 'positions') {
        const ids = (request.evidence as Array<{ id: string }>).map(item => item.id)
        const cite = (text: string, id: string) => [{ text, evidence_ids: [id] }]
        const message = responseMessage(response)
        const data = object(JSON.parse(String(message.content)))
        data.items = ids.map((id, index) => ({
          group_id: `group-${index}`,
          name: cite('群組。', id),
          Core_concern: index === 0 ? null : cite('既有關注。', id),
          opinions: [{ Title: cite('主張。', id), description: cite('敘述。', id) }],
        }))
        message.content = JSON.stringify(data)
      }
      if (request?.operation === 'fill_missing_fields') {
        const targets = request.targets as Array<{ pointer: string; evidence_ids: string[] }>
        const core = targets.find(target => target.pointer === '/positions/items/0/Core_concern')!
        const outside = targets.find(target => target.pointer === '/consensus/Overview')!.evidence_ids.find(id => !core.evidence_ids.includes(id))!
        const message = responseMessage(response)
        const patch = object(JSON.parse(String(message.content)))
        const fill = (patch.fills as Array<Record<string, unknown>>).find(item => item.pointer === core.pointer)!
        object((fill.sentences as unknown[])[0]).evidence_ids = [outside]
        message.content = JSON.stringify(patch)
      }
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(detail).toMatchObject({ status: 'failed', error_code: 'invalid_generation', usage: { attempts: 7 } })
    expect(detail.data).toBeUndefined()
    const events = detail.diagnostics as Array<Record<string, unknown>>
    const finished = events.find(event => event.stage === 'completion' && event.phase === 'finished')!
    expect(object(finished.outcome).validation_code).toBe('generation_cross_candidate_citation')
    expect(recordedRequests).toHaveLength(7)
  })

  it('補完預算不足即失敗，既有有效分項留存但不交付、不建立新嘗試', async () => {
    aiRun = missingFieldsModel
    const budgetStep = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        const result = await callback()
        if (name === 'plan-completion') {
          const others = local.sqlite.prepare("SELECT SUM(actual_micro_usd) AS n FROM ct_ai_usage WHERE step_key <> 'extract:2'").get() as { n: number }
          local.sqlite.prepare("UPDATE ct_ai_usage SET actual_micro_usd = ? WHERE step_key = 'extract:2'").run(5_000_000 - others.n)
        }
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, budgetStep)).toEqual({ status: 'failed' })
    const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(detail).toMatchObject({
      status: 'failed',
      error_code: 'budget_exhausted',
      usage: { attempts: 6 },
      generation_progress: {
        completion: { status: 'failed', reason: 'budget_exhausted' },
        sections: { consensus: { status: 'completed' }, disputes: { status: 'completed' }, positions: { status: 'completed' } },
      },
    })
    expect(detail.data).toBeUndefined()
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: 0 })
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    expect((await store.listArtifacts(job!.executionId, 'generation')).filter(item => object(item.payload).stage === 'generation_section')).toHaveLength(3)
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    expect(recordedRequests).toHaveLength(6)
  })

  it('補完請求超出 context 上限時不付費、不交付缺值結果', async () => {
    aiRun = async (modelName, input) => {
      const response = await missingFieldsModel(modelName, input)
      if (generationPayload(modelName, input)?.section === 'consensus') {
        const message = responseMessage(response)
        const data = object(JSON.parse(String(message.content)))
        object((object((data.items as unknown[])[0]).description as unknown[])[0]).text = 'x'.repeat(60_000)
        message.content = JSON.stringify(data)
      }
      return response
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(detail).toMatchObject({ status: 'failed', error_code: 'workflow_limit', usage: { attempts: 6 }, generation_progress: { completion: { status: 'failed', reason: 'workflow_limit' } } })
    expect(detail.data).toBeUndefined()
    expect(recordedRequests).toHaveLength(6)
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: 0 })
  })

  it('補完 provider 失敗保留未知成本，不重試、不洩漏例外或假裝完成', async () => {
    let completionCalls = 0
    aiRun = async (modelName, input) => {
      if (generationPayload(modelName, input)?.operation === 'fill_missing_fields') {
        completionCalls++
        throw new Error('private-completion-provider-detail')
      }
      return missingFieldsModel(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(detail).toMatchObject({
      status: 'failed',
      error_code: 'provider_error',
      usage: { attempts: 7, uncertain: 1 },
      generation_progress: { completion: { status: 'failed', reason: 'provider_error' } },
    })
    expect(detail.data).toBeUndefined()
    expect(JSON.stringify(detail)).not.toContain('private-completion-provider-detail')
    const attempt = local.sqlite.prepare("SELECT state, estimate_micro_usd, actual_micro_usd FROM ct_ai_usage WHERE step_key = 'complete:draft'").get() as {
      state: string
      estimate_micro_usd: number
      actual_micro_usd: number | null
    }
    expect(attempt).toMatchObject({ state: 'unknown', actual_micro_usd: null })
    expect(attempt.estimate_micro_usd).toBeGreaterThan(0)
    expect(object(detail.usage).reservedMicroUsd).toBe(attempt.estimate_micro_usd)
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    expect(completionCalls).toBe(1)
  })

  it('補完回應合法但缺用量時僅保留未知費用，不把預留當退款', async () => {
    aiRun = async (modelName, input) => {
      const response = object(await missingFieldsModel(modelName, input))
      if (generationPayload(modelName, input)?.operation !== 'fill_missing_fields') return response
      const { usage: _usage, ...withoutUsage } = response
      return withoutUsage
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(detail).toMatchObject({ status: 'ai_draft', usage: { attempts: 7, uncertain: 1 } })
    const attempt = local.sqlite.prepare("SELECT state, estimate_micro_usd, actual_micro_usd FROM ct_ai_usage WHERE step_key = 'complete:draft'").get() as {
      state: string
      estimate_micro_usd: number
      actual_micro_usd: number | null
    }
    expect(attempt).toMatchObject({ state: 'unknown', actual_micro_usd: null })
    expect(object(detail.usage).reservedMicroUsd).toBe(attempt.estimate_micro_usd)
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    expect(recordedRequests).toHaveLength(7)
    expect(local.sqlite.prepare("SELECT state, estimate_micro_usd, actual_micro_usd FROM ct_ai_usage WHERE step_key = 'complete:draft'").all()).toEqual([attempt])
  })

  it.each(['plan-completion', 'complete-draft', 'validate-completion'])('%s 工件已存但 checkpoint 遺失時重放復用，不重付或重做驗證結果', async pausedStep => {
    aiRun = missingFieldsModel
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>()
    const { promise: paused, resolve: reached } = Promise.withResolvers<void>()
    const stalled = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        const result = await callback()
        if (name === pausedStep) {
          reached()
          await waiting
        }
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const interrupted = runEvidenceWorkflow(env, created.job_id, stalled)
    await paused
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    const rawBefore = await store.listArtifacts(job!.executionId, 'raw')
    const resultBefore = (await store.listArtifacts(job!.executionId, 'generation')).filter(item => object(item.payload).stage === 'completion_result')
    expect(rawBefore).toHaveLength(pausedStep === 'plan-completion' ? 6 : 7)
    expect(resultBefore).toHaveLength(pausedStep === 'validate-completion' ? 1 : 0)
    try {
      expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
      const rawAfter = await store.listArtifacts(job!.executionId, 'raw')
      expect(rawAfter).toHaveLength(7)
      expect(rawAfter.slice(0, rawBefore.length).map(item => item.id)).toEqual(rawBefore.map(item => item.id))
      const artifacts = await store.listArtifacts(job!.executionId, 'generation')
      expect(artifacts.filter(item => object(item.payload).stage === 'completion_plan')).toHaveLength(1)
      const results = artifacts.filter(item => object(item.payload).stage === 'completion_result')
      expect(results).toHaveLength(1)
      if (resultBefore.length) expect(results[0].id).toBe(resultBefore[0].id)
      expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: 1 })
      expect(recordedRequests).toHaveLength(7)
    } finally {
      release()
      await interrupted
    }
    expect((await store.getJob(created.job_id, 'owner'))?.status).toBe('ai_draft')
  })

  it('補完進行中 GET 單獨呈現 completion，回應不保存到 checkpoint', async () => {
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>()
    const { promise: called, resolve: started } = Promise.withResolvers<void>()
    aiRun = async (modelName, input) => {
      if (generationPayload(modelName, input)?.operation === 'fill_missing_fields') {
        started()
        await waiting
      }
      return missingFieldsModel(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const running = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    try {
      const detail = (await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()) as { generation_progress: { sections: Record<string, unknown> }; data?: unknown }
      expect(detail).toMatchObject({
        status: 'generating',
        generation_progress: {
          current_section: 'completion',
          completion: { status: 'running' },
          sections: { consensus: { status: 'completed' }, disputes: { status: 'completed' }, positions: { status: 'completed' } },
        },
      })
      expect(Object.keys(detail.generation_progress.sections)).toEqual(['consensus', 'disputes', 'positions'])
      expect(detail.data).toBeUndefined()
    } finally {
      release()
      expect(await running).toEqual({ status: 'ai_draft' })
    }
    expect(JSON.stringify(stepOutputs)).not.toContain('補完欄位。')
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
  })

  it('補完進行中冷重放遇到無原始工件的嘗試，只標未知並失敗，不重打模型', async () => {
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>()
    const { promise: called, resolve: started } = Promise.withResolvers<void>()
    let calls = 0
    aiRun = async (modelName, input) => {
      if (generationPayload(modelName, input)?.operation === 'fill_missing_fields') {
        calls++
        started()
        await waiting
      }
      return missingFieldsModel(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const interrupted = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    try {
      expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
      const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
      expect(detail).toMatchObject({
        status: 'failed',
        error_code: 'provider_uncertain',
        usage: { attempts: 7, uncertain: 1 },
        generation_progress: { completion: { status: 'failed', reason: 'provider_uncertain' } },
      })
      expect(detail.data).toBeUndefined()
      expect(object(detail.usage).reservedMicroUsd).toBeGreaterThan(0)
      expect(calls).toBe(1)
    } finally {
      release()
      await interrupted
    }
    expect(calls).toBe(1)
    expect(
      local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_artifacts a JOIN ct_ai_usage u ON a.attempt_id = u.id WHERE u.step_key = 'complete:draft' AND a.payload IS NOT NULL").get()
    ).toMatchObject({ n: 0 })
  })

  it('規劃補完後來源已清除，不啟動額外付費或復活任何正文', async () => {
    aiRun = missingFieldsModel
    const eraseStep = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        const result = await callback()
        if (name === 'plan-completion') {
          await new EvidenceStore(local.asD1()).eraseSource({ namespace: SOURCE_NAMESPACE, kind: 'material', id: 2, reason: 'request' })
        }
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, eraseStep)).toEqual({ status: 'failed' })
    expect(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()).toMatchObject({ status: 'erased' })
    expect(recordedRequests).toHaveLength(6)
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: 0 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
  })

  it('補完呼叫中清除來源，延遲回應與已存計畫、分項均不得復活', async () => {
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>()
    const { promise: called, resolve: started } = Promise.withResolvers<void>()
    aiRun = async (modelName, input) => {
      if (generationPayload(modelName, input)?.operation === 'fill_missing_fields') {
        started()
        await waiting
      }
      return missingFieldsModel(modelName, input)
    }
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    const running = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    try {
      await new EvidenceStore(local.asD1()).eraseSource({ namespace: SOURCE_NAMESPACE, kind: 'material', id: 2, reason: 'request' })
    } finally {
      release()
      expect(await running).toEqual({ status: 'failed' })
    }
    const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(detail).toMatchObject({ status: 'erased' })
    expect(detail.data).toBeUndefined()
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_sources WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
    expect(JSON.stringify(stepOutputs)).not.toContain('補完欄位。')
  })

  it.each(['plan-completion', 'complete-draft'])('%s 後帳號停權，不繼續補完或交付資料', async suspendedAfter => {
    aiRun = missingFieldsModel
    const suspendStep = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        const result = await callback()
        if (name === suspendedAfter)
          env.DB_AUTH = {
            prepare() {
              return {
                bind() {
                  return {
                    async first() {
                      return null
                    },
                  }
                },
              }
            },
          } as unknown as D1Database
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = (await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json()) as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, suspendStep)).toEqual({ status: 'failed' })
    const detail = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(detail).toMatchObject({ status: 'failed', error_code: 'account_suspended', generation_progress: { completion: { status: 'failed', reason: 'account_suspended' } } })
    expect(detail.data).toBeUndefined()
    expect(recordedRequests).toHaveLength(suspendedAfter === 'plan-completion' ? 6 : 7)
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM ct_ai_usage WHERE step_key = 'complete:draft'").get()).toMatchObject({ n: suspendedAfter === 'plan-completion' ? 0 : 1 })
  })
})
