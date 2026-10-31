/// <reference lib="es2024.promise" />
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Hono } from 'hono'
import type { WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { apiCsrf } from '../api/csrf'
import { registerApiRoutes } from '../api/routes'
import type { EvidenceBindings } from '../ai/env'
import { registerEvidenceRoutes } from '../ai/routes'
import { runEvidenceWorkflow } from '../ai/runner'
import { EvidenceStore, type ArtifactSummary } from '../ai/store'
import { sha256, SOURCE_NAMESPACE } from '../ai/source'

const auth = vi.hoisted(() => ({ current: null as null | { user: { id: string; name: string; email: string; image: null }; role: 'user' | 'admin'; banned: boolean; nameChangeCooldownDays: null } }))
vi.mock('../auth/authorization', () => ({
  tryGetAuthContext: async () => auth.current,
  hasDuplicateDisplayName: async () => false,
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
}))

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(':memory:')
  constructor(sql: string) { this.sqlite.exec('PRAGMA foreign_keys = ON'); this.sqlite.exec(sql) }
  prepare(sql: string) {
    const sqlite = this.sqlite
    class Statement {
      constructor(readonly values: SQLInputValue[] = []) {}
      bind(...values: SQLInputValue[]) { return new Statement(values) }
      execute() {
        const result = sqlite.prepare(sql).run(...this.values)
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      }
      async run() { return this.execute() }
      async first<T>() { return (sqlite.prepare(sql).get(...this.values) ?? null) as T | null }
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...this.values) as T[] } }
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
  asD1(): D1Database { return this as unknown as D1Database }
}

const user = (id: string, role: 'user' | 'admin' = 'user', banned = false) => ({ user: { id, name: id, email: `${id}@example.test`, image: null }, role, banned, nameChangeCooldownDays: null })
let local: SQLiteD1
let source: SQLiteD1
let app!: Hono<{ Bindings: EvidenceBindings }>
let env!: EvidenceBindings
let recordedRequests: unknown[]
let stepOutputs: unknown[]
let instances: Set<string>
let restarts: number
let aiRun: (model: string, input: unknown) => Promise<unknown>

const requestHeaders = { 'Content-Type': 'application/json', Origin: 'http://localhost' }
function send(method: string, path: string, body?: unknown) {
  return app.request(`http://localhost${path}`, { method, headers: requestHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
}
function testStep() {
  return {
    async do(_name: string, config: { retries: { limit: number } }, callback: () => Promise<unknown>) {
      expect(config.retries.limit).toBe(0)
      const result = await callback()
      stepOutputs.push(result)
      return result
    },
  } as unknown as WorkflowStep
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('invalid test input')
  return value as Record<string, unknown>
}

async function model(modelName: string, input: unknown): Promise<unknown> {
  recordedRequests.push(input)
  const request = object(input)
  if (modelName === '@cf/cloudflare/clairic') {
    const content = String(request.state)
    return { model: 'clairic', truncated: false, state_text: content, answers: { claims: { type: 'list', value: [content], spans: [[0, content.length]] } }, usage: { input_tokens: 100, output_tokens: 0 } }
  }
  if (modelName === '@cf/cloudflare/clef') {
    const questions = object(request.questions)
    return { model: 'clef', answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'choice', choice: 'agree', probabilities: { agree: 0.91, disagree: 0.03, unrelated: 0.03, uncertain: 0.03 }, confidence: 0.91 }])), usage: { input_tokens: 120, output_tokens: 0 } }
  }
  if (modelName === '@cf/google/gemma-4-26b-a4b-it') {
    // 參考 pocket-polis 的最小原生文字生成契約；不模擬 provider JSON Mode 保證。
    const allowed = ['messages', 'max_tokens', 'temperature', 'chat_template_kwargs']
    if (Object.keys(request).some(key => !allowed.includes(key)) || !Number.isSafeInteger(request.max_tokens) || Number(request.max_tokens) <= 0) {
      throw new Error('unsupported native Gemma request')
    }
    const messages = request.messages as Array<{ role: string; content: string }>
    const generatedInput = JSON.parse(messages.find(message => message.role === 'user')!.content) as {
      section: string
      evidence: Array<{ id: string }>
      comparison: { consensus_groups: Array<{ candidate_id: string; evidence_ids: string[] }> }
    }
    const cite = (text: string, ids: string[]) => [{ text, evidence_ids: ids }]
    const group = generatedInput.comparison.consensus_groups[0]
    const ids = generatedInput.evidence.map(item => item.id)
    const data = generatedInput.section === 'consensus'
      ? {
          Overview: null,
          items: group ? [{ candidate_id: group.candidate_id, evidence_ids: group.evidence_ids, Title: cite('相容主張。', group.evidence_ids), description: cite('材料呈現的主張。', group.evidence_ids) }] : [],
          rejected_candidates: generatedInput.comparison.consensus_groups.slice(1).map(candidate => ({ candidate_id: candidate.candidate_id, reason: 'not_selected' })),
        }
      : generatedInput.section === 'disputes'
        ? { Overview: null, items: [] }
        : {
            Overview: null,
            items: [{ group_id: 'energy', evidence_ids: ids, name: cite('能源觀點。', ids), Core_concern: null, opinions: [{ Title: cite('能源轉型。', ids), description: cite('素材呈現能源主張。', ids) }] }],
            exclusions: [],
          }
    return { model: 'gemma-4-26b-a4b-it', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(data) } }], usage: { prompt_tokens: 200, completion_tokens: 80 } }
  }
  throw new Error('unexpected model')
}

beforeEach(() => {
  auth.current = null
  recordedRequests = []
  stepOutputs = []
  instances = new Set()
  restarts = 0
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
          return { async first() { return { id } } }
        },
      }
    },
  } as unknown as D1Database
  const workflow = {
    async get(id: string) { return { async status() { if (!instances.has(id)) throw new Error('not found'); return { status: 'running' } }, async restart() { restarts++ } } },
    async create({ id }: { id: string }) { instances.add(id); return { id } },
  }
  env = { DB: local.asD1(), SOURCE_DB: source.asD1(), DB_AUTH: dbAuth, AI: { run: (modelName: string, input: unknown) => aiRun(modelName, input) }, EVIDENCE_WORKFLOW: workflow } as unknown as EvidenceBindings
  app = new Hono<{ Bindings: EvidenceBindings }>()
  app.use('/api/*', apiCsrf)
  registerEvidenceRoutes(app)
})

afterEach(() => { local.sqlite.close(); source.sqlite.close() })

describe('evidence API 與實際 SQLite 工作流', () => {
  it('一般入口不註冊實驗與維護端點', async () => {
    const production = new Hono()
    production.use('/api/*', apiCsrf)
    registerApiRoutes(production as never)
    for (const [method, path] of [
      ['POST', '/api/issues/7/evidence-jobs'],
      ['GET', '/api/evidence-jobs/00000000-0000-4000-8000-000000000000'],
      ['GET', '/api/evidence-jobs/00000000-0000-4000-8000-000000000000/revisions'],
      ['POST', '/api/evidence-jobs/00000000-0000-4000-8000-000000000000/revisions'],
      ['POST', '/api/evidence-maintenance/reconcile'],
      ['POST', '/api/evidence-maintenance/erase'],
    ]) {
      const response = await production.request(`http://localhost${path}`, { method, headers: requestHeaders }, env)
      expect(response.status).toBe(404)
    }
  })
  it('來源查核失聯、隱藏及變更時不得交付任何舊快照', async () => {
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const liveSource = env.SOURCE_DB
    env.SOURCE_DB = { prepare() { throw new Error('offline') } } as unknown as D1Database
    const unavailable = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('支持再生能源')
    env.SOURCE_DB = liveSource
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 2').run()
    const hidden = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    const payload = await hidden.json() as { status: string; error_code: string }
    expect(payload).toMatchObject({ status: 'withdrawn', error_code: 'source_withdrawn' })
    expect(JSON.stringify(payload)).not.toContain('支持再生能源')
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 0, content = ? WHERE id = 2').run('來源內容已變更。')
    auth.current = user('admin', 'admin')
    expect((await send('POST', '/api/evidence-maintenance/reconcile', {})).status).toBe(200)
    auth.current = user('owner')
    const stale = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json() as { status: string; error_code: string }
    expect(stale).toMatchObject({ status: 'withdrawn', error_code: 'source_stale' })
    expect(JSON.stringify(stale)).not.toContain('支持再生能源')
    source.sqlite.prepare('DELETE FROM ct_materials WHERE id = 2').run()
    const erased = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json() as { status: string }
    expect(erased.status).toBe('erased')
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
  })

  it.each(['erased', 'withdrawn'] as const)('最後一次快照讀取後觀察到 %s 時不交付舊正文', async disposition => {
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const store = new EvidenceStore(local.asD1())
    const job = await store.getJob(created.job_id, 'owner')
    const original = await store.getSnapshot(job!.executionId)
    const material = original!.sources.find(item => item.kind === 'material')
    if (!material || material.kind !== 'material') throw new Error('missing material')

    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const paused = new Promise<void>(resolve => { reached = resolve })
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
    const pending = Promise.resolve(send('GET', `/api/evidence-jobs/${created.job_id}`))
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
      expect(response.status).toBe(200)
      const bodyText = await response.text()
      const body = JSON.parse(bodyText) as Record<string, unknown>
      expect(body).toMatchObject({ status: disposition, error_code: latest!.errorCode, updated_at: latest!.updatedAt, usage: latest!.usage })
      for (const field of ['data', 'sources', 'evidence', 'citation_map', 'provenance', 'generation_artifact', 'input_manifest', 'diagnostics']) expect(body).not.toHaveProperty(field)
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
    `)
    auth.current = user('owner')
    const first = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, first.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const second = await (await send('POST', '/api/issues/8/evidence-jobs', { consent: true })).json() as { job_id: string }
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

  it('冷啟只安全重放一次，後續一般輪詢不反覆重啟', async () => {
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    app = new Hono<{ Bindings: EvidenceBindings }>()
    app.use('/api/*', apiCsrf)
    registerEvidenceRoutes(app)
    expect((await send('GET', `/api/evidence-jobs/${created.job_id}`)).status).toBe(200)
    expect((await send('GET', `/api/evidence-jobs/${created.job_id}`)).status).toBe(200)
    expect(restarts).toBe(1)
  })

  it('設定指紋改變後舊工作不混入新 prompt，未付費預留得釋放', async () => {
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
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
    auth.current = user('owner')
    const body = { consent: true, material_ids: [2] }
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', body)).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    expect(recordedRequests).toHaveLength(4)
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 4').run()
    const hidden = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(hidden.status).toBe(200)
    expect(await hidden.json()).toMatchObject({ job_id: created.job_id, cache: 'hit', input_coverage: { selection: 'selected', material_ids: [2], exclusions: [] } })
    const detail = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
    expect(detail).toMatchObject({ current_issue_exclusions: [{ id: 4, reason: 'hidden' }], initial_input_diagnostics: [{ stage: 'input', initial_issue_exclusions: [] }] })
    source.sqlite.prepare('DELETE FROM ct_materials WHERE id = 4').run()
    const deleted = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toMatchObject({ job_id: created.job_id, cache: 'hit' })
    expect(recordedRequests).toHaveLength(4)
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_executions').get()).toMatchObject({ n: 1 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_usage').get()).toMatchObject({ n: 4 })
  })

  it('全量合格素材集合變更必須使用新快取鍵；未選隱藏素材後續刪除不影響新工作', async () => {
    auth.current = user('owner')
    const body = { consent: true }
    const first = await (await send('POST', '/api/issues/7/evidence-jobs', body)).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, first.job_id, testStep())).toEqual({ status: 'ai_draft' })
    source.sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 4').run()
    expect((await send('POST', '/api/issues/7/evidence-jobs', body)).status).toBe(429)
    // 模擬冷卻期限已過，不修改來源庫或已保存的工作。
    local.sqlite.prepare('UPDATE ct_ai_issue_cooldowns SET claimed_at = ? WHERE issue_id = ?').run('2000-01-01T00:00:00.000Z', 7)
    const next = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(next.status).toBe(202)
    const nextBody = await next.json() as { job_id: string; input_coverage: unknown }
    expect(nextBody.job_id).not.toBe(first.job_id)
    expect(nextBody.input_coverage).toMatchObject({ selection: 'all_eligible', material_ids: [2], exclusions: [{ id: 4, reason: 'hidden' }] })
    source.sqlite.prepare('DELETE FROM ct_materials WHERE id = 4').run()
    const joined = await send('POST', '/api/issues/7/evidence-jobs', body)
    expect(joined.status).toBe(202)
    expect(await joined.json()).toMatchObject({ job_id: nextBody.job_id, cache: 'joined', input_coverage: { exclusions: [] } })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_executions').get()).toMatchObject({ n: 2 })
  })

  it('工作擁有者及管理員取得正確工件雜湊與白名單 provenance，其他人不可讀取', async () => {
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(response.status).toBe(200)
    const audit = await response.json() as {
      input_key: string
      input_manifest: unknown
      generation_artifact: { id: string; sha256: string }
      provenance: { artifacts: ArtifactSummary[] }
    }
    expect(audit.input_key).toBe(await sha256(JSON.stringify(audit.input_manifest)))
    const generation = local.sqlite.prepare('SELECT payload_hash, payload FROM ct_ai_artifacts WHERE id = ? AND kind = ?').get(audit.generation_artifact.id, 'generation') as { payload_hash: string; payload: string }
    expect(audit.generation_artifact.sha256).toBe(generation.payload_hash)
    expect(audit.generation_artifact.sha256).toBe(await sha256(generation.payload))
    const raw = audit.provenance.artifacts.filter(item => item.kind === 'raw')
    expect(raw).toHaveLength(6)
    expect(new Set(raw.map(item => item.model?.selector))).toEqual(new Set(['@cf/cloudflare/clairic', '@cf/cloudflare/clef', '@cf/google/gemma-4-26b-a4b-it']))
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

  it('共識候選無效只拒收該段，其他有效分項仍可檢視且有固定驗證子碼', async () => {
    aiRun = async (modelName, input) => {
      const response = await model(modelName, input)
      if (modelName !== '@cf/google/gemma-4-26b-a4b-it') return response
      const messages = object(input).messages as Array<{ role: string; content: string }>
      const generationInput = JSON.parse(messages.find(item => item.role === 'user')!.content)
      if (generationInput.section !== 'consensus') return response
      const message = object(object((object(response).choices as unknown[])[0]).message)
      const content = JSON.parse(String(message.content))
      content.items[0].candidate_id = 'unknown-candidate'
      message.content = JSON.stringify(content)
      return response
    }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const body = object(await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json())
    expect(body).toMatchObject({
      status: 'partial_draft', error_code: null, usage: { attempts: 6, uncertain: 0, reservedMicroUsd: 0 },
      data: { consensus: { Overview: null, items: [] } },
      diagnostics: { generation: { sections: {
        consensus: { status: 'failed', reason: 'invalid_generation', validation_code: 'generation_invalid_candidate' },
        disputes: { status: 'no_findings' },
        positions: { status: 'completed' },
      } } },
    })
  })

  it('Gemma 費用預留包含原生請求宣告的最大輸出 token，不只計入輸入', async () => {
    const generationInputs: Record<string, unknown>[] = []
    aiRun = async (modelName, input) => {
      if (modelName === '@cf/google/gemma-4-26b-a4b-it') generationInputs.push(object(input))
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    expect(generationInputs).toHaveLength(3)
    for (const request of generationInputs) {
      if (typeof request.max_tokens !== 'number') throw new Error('missing native output limit')
      const inputBound = new TextEncoder().encode(JSON.stringify(request)).byteLength * 4 + 4096
      const expectedMicroUsd = Math.ceil((inputBound * 10 + request.max_tokens * 30) / 100)
      const messages = request.messages as Array<{ role: string; content: string }>
      const { section } = JSON.parse(messages.find(item => item.role === 'user')!.content)
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
      if (modelName !== '@cf/google/gemma-4-26b-a4b-it') return model(modelName, input)
      generationCalls++
      throw error
    }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    const response = await send('GET', `/api/evidence-jobs/${created.job_id}`)
    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; error_code: string; diagnostics: unknown[]; usage: { attempts: number; uncertain: number; reservedMicroUsd: number } }
    expect(body).toMatchObject({ status: 'failed', error_code: 'provider_error', usage: { attempts: 6, uncertain: 3 } })
    for (const section of ['consensus', 'disputes', 'positions']) {
      expect(body.diagnostics).toContainEqual({
        stage: 'provider', code: 'provider_error', step_key: `generate:${section}`, model_selector: '@cf/google/gemma-4-26b-a4b-it', ...expected,
      })
    }
    expect(JSON.stringify(body)).not.toContain('private-provider-detail')
    const stored = local.sqlite.prepare("SELECT payload FROM ct_ai_artifacts WHERE kind = 'diagnostics'").all()
    expect(JSON.stringify(stored)).not.toContain('private-provider-detail')
    const attempts = local.sqlite.prepare("SELECT state, actual_micro_usd, estimate_micro_usd FROM ct_ai_usage WHERE step_key LIKE 'generate:%'").all() as Array<{ state: string; actual_micro_usd: number | null; estimate_micro_usd: number }>
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
      if (modelName !== '@cf/google/gemma-4-26b-a4b-it') return model(modelName, input)
      throw new Error('private-provider-detail')
    }
    try {
      auth.current = user('owner')
      const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
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
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const audit = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json() as { provenance: { artifacts: ArtifactSummary[] }; usage: { uncertain: number; reservedMicroUsd: number } }
    const clairic = audit.provenance.artifacts.filter(item => item.kind === 'raw' && item.model?.selector === '@cf/cloudflare/clairic')
    expect(clairic.map(item => item.model?.usage_status).sort()).toEqual(['malformed', 'missing'])
    for (const summary of clairic) {
      expect(summary.attempt).toMatchObject({ state: 'unknown', actual_micro_usd: null })
      expect(summary.attempt!.estimated_micro_usd).toBeGreaterThan(0)
    }
    expect(audit.usage.uncertain).toBe(2)
    expect(audit.usage.reservedMicroUsd).toBeGreaterThan(0)
  })


  it('登入守門、CSRF、完整流水線、跨帳號快取及私人修訂', async () => {
    const payload = { consent: true, language: 'zh-TW' }
    expect((await send('POST', '/api/issues/7/evidence-jobs', payload)).status).toBe(401)
    auth.current = user('banned', 'user', true)
    expect((await send('POST', '/api/issues/7/evidence-jobs', payload)).status).toBe(403)
    auth.current = user('owner')
    const cross = await app.request('http://localhost/api/issues/7/evidence-jobs', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'consent=true' }, env)
    expect(cross.status).toBe(403)
    const before = source.sqlite.prepare('SELECT * FROM ct_materials ORDER BY id').all()
    const created = await send('POST', '/api/issues/7/evidence-jobs', payload)
    expect(created.status).toBe(202)
    const createdJson = await created.json() as { job_id: string; cache: string }
    expect(createdJson.cache).toBe('miss')
    expect(await runEvidenceWorkflow(env, createdJson.job_id, testStep())).toEqual({ status: 'ai_draft' })
    expect(source.sqlite.prepare('SELECT * FROM ct_materials ORDER BY id').all()).toEqual(before)
    expect(JSON.stringify(recordedRequests)).not.toContain('private-author')
    expect(JSON.stringify(recordedRequests)).not.toContain('private@example.test')
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
    expect(recordedRequests).toHaveLength(6)

    const result = await send('GET', `/api/evidence-jobs/${createdJson.job_id}`)
    expect(result.status).toBe(200)
    const draft = await result.json() as { data: { consensus: { items: Array<{ description: string }> } }; citation_map: unknown[]; diagnostics: { comparisons: { diagnostics: { direct_judgments: number } } }; usage: { attempts: number } }
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
    const history = await (await send('GET', `/api/evidence-jobs/${createdJson.job_id}/revisions`)).json() as { ai_base: { data: unknown }; revisions: Array<{ verification: string; diff: unknown[] }> }
    expect(JSON.stringify(history.ai_base.data)).toBe(original)
    expect(history.revisions[0].verification).toBe('human_unverified')
    expect(history.revisions[0].diff).toContainEqual({ path: '/consensus/items/0/description', before: '材料呈現的主張。', after: '人工修改。' })

    auth.current = user('other')
    expect((await send('GET', `/api/evidence-jobs/${createdJson.job_id}`)).status).toBe(404)
    const cached = await send('POST', '/api/issues/7/evidence-jobs', payload)
    expect(cached.status).toBe(200)
    const otherJob = await cached.json() as { job_id: string; cache: string }
    expect(otherJob).toMatchObject({ cache: 'hit' })
    expect(otherJob.job_id).not.toBe(createdJson.job_id)
    const otherHistory = await (await send('GET', `/api/evidence-jobs/${otherJob.job_id}/revisions`)).json() as { revisions: unknown[] }
    expect(otherHistory.revisions).toEqual([])
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_usage').get()).toMatchObject({ n: 6 })
    auth.current = user('admin', 'admin')
    expect((await send('GET', `/api/evidence-jobs/${createdJson.job_id}`)).status).toBe(200)
    expect((await send('POST', `/api/evidence-jobs/${createdJson.job_id}/revisions`, { parent_revision_id: 'ai', data: changed })).status).toBe(404)
  })

  it.each(['compare-0', 'generate-consensus', 'validate-generation-consensus'])('%s 的工件已保存但 checkpoint 未提交，重放只完成剩餘分項而不重付', async pausedStep => {
    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const paused = new Promise<void>(resolve => { reached = resolve })
    const stalledStep = {
      async do(name: string, _config: unknown, callback: () => Promise<unknown>) {
        const result = await callback()
        if (name === pausedStep) { reached(); await waiting }
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
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

  it('回應未保存的在途付費重放標不確定，絕不再次呼叫', async () => {
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const called = new Promise<void>(resolve => { started = resolve })
    let calls = 0
    aiRun = async (modelName, input) => { calls++; started(); await waiting; return model(modelName, input) }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true, material_ids: [2] })).json() as { job_id: string }
    const interrupted = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'failed' })
    const store = new EvidenceStore(local.asD1())
    const uncertain = await store.getJob(created.job_id, 'owner')
    expect(uncertain).toMatchObject({ status: 'failed', errorCode: 'provider_uncertain', usage: { uncertain: 1 } })
    expect(uncertain!.usage.reservedMicroUsd).toBeGreaterThan(0)
    expect(calls).toBe(1)
    release()
    await interrupted
    expect(calls).toBe(1)
    expect(await store.listArtifacts(uncertain!.executionId, 'raw')).toEqual([])
  })

  it('模型已啟動後本機清除，延遲回應不能回到任何工件或 checkpoint', async () => {
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const called = new Promise<void>(resolve => { started = resolve })
    aiRun = async (modelName, input) => { started(); await waiting; return model(modelName, input) }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    const running = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    expect((await send('POST', '/api/evidence-maintenance/erase', { kind: 'material', id: 2 })).status).toBe(403)
    auth.current = user('admin', 'admin')
    expect((await send('POST', '/api/evidence-maintenance/erase', { kind: 'material', id: 2 })).status).toBe(200)
    auth.current = user('owner')
    release()
    await running
    const job = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json() as { status: string }
    expect(job.status).toBe('erased')
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_sources WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_revisions WHERE payload IS NOT NULL OR diff IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(JSON.stringify(stepOutputs)).not.toContain('支持再生能源')
    expect(local.sqlite.prepare('SELECT state FROM ct_ai_usage').get()).toMatchObject({ state: 'settled' })
  })

  it('爭點 provider 失敗保留其他兩段，失敗空段不冒充 no_findings', async () => {
    aiRun = async (modelName, input) => {
      if (modelName === '@cf/google/gemma-4-26b-a4b-it') {
        const messages = object(input).messages as Array<{ role: string; content: string }>
        if (JSON.parse(messages.find(item => item.role === 'user')!.content).section === 'disputes') throw new Error('private-provider-failure')
      }
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const detail = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
    expect(detail).toMatchObject({
      status: 'partial_draft', usage: { attempts: 6, uncertain: 1 },
      data: { disputes: { Overview: null, items: [] } },
      diagnostics: { partial: true, generation: { sections: {
        consensus: { status: 'completed' }, disputes: { status: 'failed', reason: 'provider_error' }, positions: { status: 'completed' },
      } } },
    })
    const requestsBefore = recordedRequests.length
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    expect(recordedRequests).toHaveLength(requestsBefore)
    expect((await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json())).toMatchObject({ cache: 'hit', status: 'partial_draft' })
  })

  it('三段皆驗證通過但無可整理內容，與三段呼叫失敗可區分', async () => {
    aiRun = async (modelName, input) => {
      const response = await model(modelName, input)
      if (modelName !== '@cf/google/gemma-4-26b-a4b-it') return response
      const messages = object(input).messages as Array<{ role: string; content: string }>
      const body = JSON.parse(messages.find(item => item.role === 'user')!.content)
      const data = body.section === 'consensus'
        ? { Overview: null, items: [], rejected_candidates: body.comparison.consensus_groups.map((group: { candidate_id: string }) => ({ candidate_id: group.candidate_id, reason: 'no_shared_proposition' })) }
        : body.section === 'positions'
          ? { Overview: null, items: [], exclusions: body.evidence.map((item: { id: string }) => ({ evidence_id: item.id, reason: 'insufficient_attribution' })) }
          : { Overview: null, items: [] }
      object(object((object(response).choices as unknown[])[0]).message).content = JSON.stringify(data)
      return response
    }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'ai_draft' })
    const detail = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
    expect(detail).toMatchObject({
      status: 'ai_draft', data: {
        consensus: { Overview: null, items: [] }, disputes: { Overview: null, items: [] }, positions: { Overview: null, items: [] },
      },
      diagnostics: { partial: false, generation: { sections: {
        consensus: { status: 'no_findings' }, disputes: { status: 'no_findings' }, positions: { status: 'no_findings' },
      } } },
    })
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
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, budgetStep)).toEqual({ status: 'partial_draft' })
    const detail = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
    expect(detail).toMatchObject({
      status: 'partial_draft', usage: { attempts: 4, actualMicroUsd: 5_000_000 },
      diagnostics: { generation: { sections: {
        consensus: { status: 'completed' },
        disputes: { status: 'not_started', reason: 'budget_exhausted' },
        positions: { status: 'not_started', reason: 'budget_exhausted' },
      } } },
    })
    expect(local.sqlite.prepare("SELECT step_key FROM ct_ai_usage WHERE step_key LIKE 'generate:%'").all()).toEqual([{ step_key: 'generate:consensus' }])
  })

  it('輪詢顯示目前專項，未完成段不冒充 no_findings', async () => {
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>()
    const { promise: called, resolve: started } = Promise.withResolvers<void>()
    aiRun = async (modelName, input) => {
      if (modelName === '@cf/google/gemma-4-26b-a4b-it') {
        const messages = object(input).messages as Array<{ role: string; content: string }>
        if (JSON.parse(messages.find(item => item.role === 'user')!.content).section === 'disputes') { started(); await waiting }
      }
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    const running = runEvidenceWorkflow(env, created.job_id, testStep())
    await called
    try {
      const detail = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json()
      expect(detail).toMatchObject({ status: 'generating', generation_progress: {
        current_section: 'disputes', sections: {
          consensus: { status: 'completed' }, disputes: { status: 'running' }, positions: { status: 'pending' },
        },
      } })
    } finally {
      release()
      await running
    }
  })

  it('已保存共識後來源清除，後段回應與成功分項均不可復活', async () => {
    let generationCalls = 0
    aiRun = async (modelName, input) => {
      if (modelName === '@cf/google/gemma-4-26b-a4b-it') {
        generationCalls++
        const messages = object(input).messages as Array<{ role: string; content: string }>
        if (JSON.parse(messages.find(item => item.role === 'user')!.content).section === 'disputes') {
          await new EvidenceStore(local.asD1()).eraseSource({ namespace: SOURCE_NAMESPACE, kind: 'material', id: 2, reason: 'request' })
        }
      }
      return model(modelName, input)
    }
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
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
          env.DB_AUTH = { prepare() { return { bind() { return { async first() { return null } } } } } } as unknown as D1Database
        }
        return result
      },
    } as unknown as WorkflowStep
    auth.current = user('owner')
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
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
    const created = await (await send('POST', '/api/issues/7/evidence-jobs', { consent: true })).json() as { job_id: string }
    expect(await runEvidenceWorkflow(env, created.job_id, testStep())).toEqual({ status: 'partial_draft' })
    const result = await (await send('GET', `/api/evidence-jobs/${created.job_id}`)).json() as { status: string; diagnostics: { partial: boolean }; usage: { uncertain: number; reservedMicroUsd: number } }
    expect(result.status).toBe('partial_draft')
    expect(result.diagnostics.partial).toBe(true)
    expect(result.usage.uncertain).toBe(1)
    expect(result.usage.reservedMicroUsd).toBeGreaterThan(0)
  })
})
