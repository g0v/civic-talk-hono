import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { EvidenceStore, type ClaimInput, type ClaimResult, type SourceGeneration, type SourceInput } from '../ai/store'
import { sha256 } from '../ai/source'

// 實際使用 SQLite 與交易；可暫停單一寫入以重現模型回應／清除競態。
class SQLiteD1 {
  readonly sqlite = new DatabaseSync(':memory:')
  private gate: { fragment: string; reached: () => void; wait: Promise<void> } | null = null

  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    this.sqlite.exec(readFileSync(new URL('../../migrations/0017_evidence_pipeline.sql', import.meta.url), 'utf8'))
  }

  pauseOnce(fragment: string) {
    let reached!: () => void
    let release!: () => void
    const paused = new Promise<void>(resolve => { reached = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    this.gate = { fragment, reached, wait }
    return { paused, release }
  }

  prepare(sql: string) {
    const database = this
    class Statement {
      constructor(readonly values: SQLInputValue[] = []) {}
      bind(...values: SQLInputValue[]) { return new Statement(values) }
      execute() {
        const result = database.sqlite.prepare(sql).run(...this.values)
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      }
      async run() {
        const gate = database.gate
        if (gate && sql.includes(gate.fragment)) {
          database.gate = null
          gate.reached()
          await gate.wait
        }
        return this.execute()
      }
      async first<T>() { return (database.sqlite.prepare(sql).get(...this.values) ?? null) as T | null }
      async all<T>() { return { success: true, results: database.sqlite.prepare(sql).all(...this.values) as T[] } }
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

const DAY = '2026-10-29T09:00:00.000Z'
const DAY_NEXT = '2026-10-30T09:00:00.000Z'
const NAMESPACE = 'vtaiwan-civic-talks'
let adapter: SQLiteD1
let store: EvidenceStore

async function input(issueId: number, ownerId: string, options: { now?: string; content?: string; setting?: string; estimate?: number } = {}): Promise<ClaimInput> {
  const issue = { id: issueId, title: `議題 ${issueId}`, description: '說明' }
  const content = options.content ?? '這是來源的私人原文。'
  const material = { id: issueId * 100 + 1, issue_id: issueId, source_name: '來源', source_url: null, content, content_hash: await sha256(content) }
  const issueHash = await sha256(JSON.stringify(issue))
  const materialHash = await sha256(JSON.stringify(material))
  const sources: SourceInput[] = [
    { kind: 'issue', id: issue.id, hash: issueHash, payload: issue },
    { kind: 'material', id: material.id, hash: materialHash, payload: material },
  ]
  const manifest = { namespace: NAMESPACE, issue: { id: issue.id, hash: issueHash }, materials: [{ id: material.id, hash: materialHash, content_hash: material.content_hash }], language: 'zh-TW', settings: { version: options.setting ?? 'v1' } }
  return { ownerId, issueId, inputKey: await sha256(JSON.stringify(manifest)), manifest, sources, initialEstimateMicroUsd: options.estimate ?? 1_000, consentVersion: 'v1', consentAt: options.now ?? DAY, now: options.now ?? DAY }
}

async function created(claim: ClaimInput) {
  const result = await store.claimJob(claim)
  if (result.outcome !== 'created') throw new Error(`unexpected claim outcome: ${result.outcome}`)
  const snapshot = await store.getSnapshot(result.executionId)
  if (!snapshot) throw new Error('missing snapshot')
  return { ...result, generations: snapshot.generations }
}

async function draft(claim: ClaimInput) {
  const job = await created(claim)
  const { executionId, generations } = job
  expect(await store.setStatus({ executionId, generations, expected: 'queued', next: 'extracting', now: claim.now })).toBe(true)
  const attempt = await store.beginAttempt({ executionId, generations, stepKey: 'extract:1', estimateMicroUsd: 2_000, now: claim.now })
  if (attempt.outcome !== 'started') throw new Error('attempt did not start')
  const raw = await store.saveArtifact({ executionId, attemptId: attempt.attemptId, kind: 'raw', payload: { response: '私人引文 payload' }, generations, now: claim.now })
  if (raw.outcome !== 'saved') throw new Error('raw not saved')
  await store.settleAttempt(attempt.attemptId, 1_500, claim.now)
  expect(await store.setStatus({ executionId, generations, expected: 'extracting', next: 'comparing', now: claim.now })).toBe(true)
  expect(await store.setStatus({ executionId, generations, expected: 'comparing', next: 'generating', now: claim.now })).toBe(true)
  const artifact = await store.saveArtifact({ executionId, kind: 'generation', payload: { data: { title: 'AI 原稿', items: ['原本結論'] }, citation_map: ['私人引文'] }, generations, now: claim.now })
  if (artifact.outcome !== 'saved') throw new Error('generation not saved')
  expect(await store.completeExecution({ executionId, artifactId: artifact.artifactId, generations, now: claim.now })).toBe(true)
  return { ...job, rawId: raw.artifactId, artifactId: artifact.artifactId, attemptId: attempt.attemptId }
}

beforeEach(() => {
  adapter = new SQLiteD1()
  store = new EvidenceStore(adapter.asD1())
})
afterEach(() => adapter.sqlite.close())

describe('evidence D1 repository', () => {
  it('同輸入並發只建一個執行及預留，並給每帳號獨立私人 job', async () => {
    const original = await input(1, 'u0')
    const claims = await Promise.all(Array.from({ length: 32 }, (_, index) => store.claimJob({ ...original, ownerId: `u${index}` })))
    const successes = claims.filter((result): result is Extract<ClaimResult, { jobId: string }> => 'jobId' in result)
    expect(successes).toHaveLength(32)
    expect(successes.filter(result => result.outcome === 'created')).toHaveLength(1)
    expect(new Set(successes.map(result => result.executionId)).size).toBe(1)
    expect(new Set(successes.map(result => result.jobId)).size).toBe(32)
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_executions').get()).toMatchObject({ n: 1 })
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_usage').get()).toMatchObject({ n: 1 })
    const first = successes[0]
    expect(await store.getJob(first.jobId, 'not-the-owner')).toBeNull()
    expect((await store.getJob(first.jobId, 'admin', true))?.executionId).toBe(first.executionId)
    expect((await store.budget(DAY)).committedMicroUsd).toBe(1_000)
  })

  it('重新雜湊白名單來源，丟棄作者資訊並以不含正文的錯誤拒絕偽造', async () => {
    const claim = await input(1, 'owner')
    Object.assign(claim.sources[1].payload, { author_email: 'private@example.com', author_id: 'private-user' })
    const job = await created(claim)
    const snapshot = await store.getSnapshot(job.executionId)
    expect(JSON.stringify(snapshot)).not.toContain('private@example.com')
    expect(JSON.stringify(snapshot)).not.toContain('private-user')
    const forged = await input(2, 'owner')
    forged.inputKey = '0'.repeat(64)
    await expect(store.claimJob(forged)).rejects.toThrow('invalid_input')
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_executions').get()).toMatchObject({ n: 1 })
  })

  it('同帳號並發不同輸入時不可穿透每日 20 次', async () => {
    const inputs = await Promise.all(Array.from({ length: 30 }, (_, index) => input(index + 1, 'one-owner')))
    const results = await Promise.all(inputs.map(claim => store.claimJob(claim)))
    expect(results.filter(result => result.outcome === 'created')).toHaveLength(20)
    expect(results.filter(result => result.outcome === 'quota')).toHaveLength(10)
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_executions').get()).toMatchObject({ n: 20 })
  })

  it('UTC 20 次、議題五分鐘冷卻、重用不計額度及午夜重置', async () => {
    const first = await input(1, 'owner')
    await created(first)
    const cooldown = await store.claimJob(await input(1, 'other', { setting: 'v2' }))
    expect(cooldown).toEqual({ outcome: 'cooldown', retryAt: '2026-10-29T09:05:00.000Z' })
    expect((await store.claimJob({ ...first, ownerId: 'other' })).outcome).toBe('joined')
    expect((await store.claimJob(await input(1, 'other', { setting: 'v2', now: '2026-10-29T09:05:00.000Z' }))).outcome).toBe('created')
    for (let issue = 2; issue <= 20; issue++) await created(await input(issue, 'owner'))
    expect((await store.claimJob(await input(21, 'owner'))).outcome).toBe('quota')
    expect((await store.claimJob(first)).outcome).toBe('joined')
    expect((await store.claimJob(await input(21, 'owner', { now: DAY_NEXT }))).outcome).toBe('created')
  })

  it('付費啟動前終止釋放名額與冷卻，啟動後失敗仍計入名額與冷卻', async () => {
    const beforeCall = await created(await input(1, 'owner'))
    for (let issue = 2; issue <= 20; issue++) await created(await input(issue, 'owner'))
    expect((await store.claimJob(await input(21, 'owner'))).outcome).toBe('quota')
    expect(await store.setStatus({ executionId: beforeCall.executionId, generations: beforeCall.generations, expected: 'queued', next: 'failed', errorCode: 'source_unavailable', now: DAY })).toBe(true)
    // 原本的失敗輸入不重打；可用不同有效設定的新輸入，且未付費冷卻已釋放。
    expect((await store.claimJob(await input(1, 'owner'))).outcome).toBe('joined')
    const replacement = await created(await input(1, 'owner', { setting: 'different' }))
    expect((await store.claimJob(await input(21, 'owner'))).outcome).toBe('quota')
    const started = await store.beginAttempt({ executionId: replacement.executionId, stepKey: 'extract:1', estimateMicroUsd: 1000, generations: replacement.generations, now: DAY })
    expect(started.outcome).toBe('started')
    expect(await store.setStatus({ executionId: replacement.executionId, generations: replacement.generations, expected: 'queued', next: 'failed', errorCode: 'provider_uncertain', now: DAY })).toBe(true)
    expect((await store.claimJob(await input(21, 'owner'))).outcome).toBe('quota')
    expect((await store.claimJob(await input(1, 'another', { setting: 'third' }))).outcome).toBe('cooldown')
  })

  it('來源撤下或清除未付費工作時釋放 quota 與同議題冷卻', async () => {
    const first = await created(await input(1, 'owner'))
    await store.reconcileSource({ namespace: NAMESPACE, kind: 'material', id: 101, status: 'withdrawn', currentHash: null, now: DAY })
    // 避免以被撤下素材重開；更換素材內容後仍可建立新的有效快照。
    const next = await created(await input(1, 'owner', { content: '新的有效內容' }))
    await store.eraseSource({ namespace: NAMESPACE, kind: 'material', id: 101, reason: 'request', now: DAY })
    expect((await store.getJob(first.jobId, 'owner'))?.status).toBe('erased')
    expect((await store.getJob(next.jobId, 'owner'))?.status).toBe('erased')
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_issue_cooldowns').get()).toMatchObject({ n: 0 })
    for (let issue = 2; issue <= 21; issue++) await created(await input(issue, 'owner'))
    expect((await store.claimJob(await input(22, 'owner'))).outcome).toBe('quota')
  })

  it('併發新工作預留及後續付費步驟不穿透預算，未知費用跨日不退款、不重打', async () => {
    const [a, b] = await Promise.all([input(1, 'a', { estimate: 2_600_000 }), input(2, 'b', { estimate: 2_600_000 })])
    const results = await Promise.all([store.claimJob(a), store.claimJob(b)])
    const winner = results.find(result => result.outcome === 'created')
    expect(results.filter(result => result.outcome === 'created')).toHaveLength(1)
    expect(results.filter(result => result.outcome === 'budget')).toHaveLength(1)
    if (!winner || winner.outcome !== 'created') throw new Error('missing winner')
    const snapshot = await store.getSnapshot(winner.executionId)
    if (!snapshot) throw new Error('missing snapshot')
    const started = await store.beginAttempt({ executionId: winner.executionId, stepKey: 'extract:1', estimateMicroUsd: 3_000_000, generations: snapshot.generations, now: DAY })
    if (started.outcome !== 'started') throw new Error('missing attempt')
    expect((await store.budget(DAY)).committedMicroUsd).toBe(3_000_000)
    expect((await store.beginAttempt({ executionId: winner.executionId, stepKey: 'extract:2', estimateMicroUsd: 2_000_001, generations: snapshot.generations, now: DAY })).outcome).toBe('budget')
    expect(await store.settleAttempt(started.attemptId, null, DAY)).toBe('unknown')
    expect((await store.budget(DAY_NEXT)).committedMicroUsd).toBe(3_000_000)
    expect(await store.beginAttempt({ executionId: winner.executionId, stepKey: 'extract:1', estimateMicroUsd: 3_000_000, generations: snapshot.generations, now: DAY_NEXT })).toMatchObject({ outcome: 'existing', attemptId: started.attemptId, state: 'unknown', artifactId: null })
    expect(await store.settleAttempt(started.attemptId, 5_100_000, DAY_NEXT)).toBe('settled')
    expect((await store.budget(DAY)).committedMicroUsd).toBe(5_100_000)
    expect((await store.claimJob(await input(3, 'c', { now: DAY, estimate: 1 }))).outcome).toBe('budget')
    const winningIssue = (await store.getJob(winner.jobId, 'admin', true))?.issueId
    const cachedInput = winningIssue === a.issueId ? a : b
    expect((await store.claimJob({ ...cachedInput, ownerId: 'new-reader' })).outcome).toBe('joined')
  })

  it('並發不同付費步驟只允許餘額足夠者取得預留', async () => {
    const job = await created(await input(1, 'owner', { estimate: 3_000_000 }))
    const first = await store.beginAttempt({ executionId: job.executionId, stepKey: 'extract:1', estimateMicroUsd: 3_000_000, generations: job.generations, now: DAY })
    expect(first.outcome).toBe('started')
    const results = await Promise.all(['compare:1', 'compare:2'].map(stepKey => store.beginAttempt({ executionId: job.executionId, stepKey, estimateMicroUsd: 1_200_000, generations: job.generations, now: DAY })))
    expect(results.filter(result => result.outcome === 'started')).toHaveLength(1)
    expect(results.filter(result => result.outcome === 'budget')).toHaveLength(1)
    expect((await store.budget(DAY)).committedMicroUsd).toBe(4_200_000)
  })

  it('完整來源 generation 才能啟動，復原清單與失敗診斷不含其他工作', async () => {
    const job = await created(await input(1, 'owner'))
    expect(await store.listActiveWorkflowJobs()).toEqual([{ id: job.jobId, executionId: job.executionId, status: 'queued' }])
    expect(await store.getWorkflowJob(job.jobId)).toMatchObject({ ownerId: 'owner', executionId: job.executionId })
    expect(await store.touchSources(job.executionId, job.generations.slice(0, 1), DAY_NEXT)).toBe(false)
    expect((await store.getJob(job.jobId, 'owner'))?.sourceCheckedAt).toBe(DAY)
    expect(await store.touchSources(job.executionId, job.generations, DAY_NEXT)).toBe(true)
    expect((await store.getJob(job.jobId, 'owner'))?.sourceCheckedAt).toBe(DAY_NEXT)
    expect((await store.beginAttempt({ executionId: job.executionId, stepKey: 'extract:1', estimateMicroUsd: 1_000, generations: job.generations.slice(0, 1), now: DAY })).outcome).toBe('fenced')
    const diagnostic = await store.saveArtifact({ executionId: job.executionId, kind: 'diagnostics', payload: { code: 'too_many_evidence', count: 65 }, generations: job.generations })
    expect(diagnostic.outcome).toBe('saved')
    expect(await store.setStatus({ executionId: job.executionId, expected: 'queued', next: 'failed', errorCode: 'too_many_evidence', generations: job.generations })).toBe(true)
    expect(await store.listActiveWorkflowJobs()).toEqual([])
    expect((await store.listArtifacts(job.executionId, 'diagnostics'))[0].payload).toEqual({ code: 'too_many_evidence', count: 65 })
    expect((await store.budget(DAY)).committedMicroUsd).toBe(0)
  })

  it('raw 工件不可覆寫；已保存回應可由重放安全找回', async () => {
    const job = await created(await input(1, 'owner'))
    const attempt = await store.beginAttempt({ executionId: job.executionId, stepKey: 'extract:1', estimateMicroUsd: 1_000, generations: job.generations, now: DAY })
    if (attempt.outcome !== 'started') throw new Error('missing attempt')
    const raw = await store.saveArtifact({ executionId: job.executionId, attemptId: attempt.attemptId, kind: 'raw', payload: { text: '原始回應' }, generations: job.generations })
    if (raw.outcome !== 'saved') throw new Error('missing raw')
    expect((await store.saveArtifact({ executionId: job.executionId, attemptId: attempt.attemptId, kind: 'raw', payload: { text: '覆寫' }, generations: job.generations })).outcome).toBe('conflict')
    expect(await store.beginAttempt({ executionId: job.executionId, stepKey: 'extract:1', estimateMicroUsd: 1_000, generations: job.generations, now: DAY })).toMatchObject({ outcome: 'existing', artifactId: raw.artifactId })
    expect((await store.getArtifact(job.executionId, raw.artifactId))?.payload).toEqual({ text: '原始回應' })
  })

  it('快取私人的人改歷史隔離、AI 原稿不變、parent 衝突且不可冒用管理員', async () => {
    const claim = await input(1, 'owner')
    const job = await draft(claim)
    const second = await store.claimJob({ ...claim, ownerId: 'other' })
    if (second.outcome !== 'cached') throw new Error('missing cached job')
    expect(second.jobId).not.toBe(job.jobId)
    const revised = { title: '人改標題', items: ['原本結論'] }
    const two = await Promise.all([
      store.createRevision({ jobId: job.jobId, ownerId: 'owner', parentId: 'ai', payload: revised, generations: job.generations }),
      store.createRevision({ jobId: job.jobId, ownerId: 'owner', parentId: 'ai', payload: { ...revised, title: '並發版本' }, generations: job.generations }),
    ])
    expect(two.filter(result => result.outcome === 'created')).toHaveLength(1)
    expect(two.filter(result => result.outcome === 'conflict')).toHaveLength(1)
    const history = await store.listRevisions(job.jobId, 'owner')
    expect(history).toHaveLength(1)
    expect(history?.[0].verification).toBe('human_unverified')
    expect(history?.[0].diff).toEqual([expect.objectContaining({ path: '/title', before: 'AI 原稿' })])
    expect(await store.listRevisions(second.jobId, 'other')).toEqual([])
    expect(await store.listRevisions(job.jobId, 'other')).toBeNull()
    expect(await store.createRevision({ jobId: job.jobId, ownerId: 'admin', parentId: 'ai', payload: revised, generations: job.generations })).toEqual({ outcome: 'unavailable' })
    expect(await store.createRevision({ jobId: job.jobId, ownerId: 'owner', parentId: 'missing-revision', payload: revised, generations: job.generations })).toEqual({ outcome: 'conflict' })
    expect((await store.getArtifact(job.executionId, job.artifactId))?.payload).toEqual({ data: { title: 'AI 原稿', items: ['原本結論'] }, citation_map: ['私人引文'] })
  })

  it('相同來源有不同 hash 時僅撤下舊快照，隱藏時撤下所有版本且不洩漏內容', async () => {
    const old = await created(await input(1, 'owner', { content: '舊內容' }))
    const currentInput = await input(1, 'owner', { content: '新內容', now: '2026-10-29T09:05:00.000Z' })
    const current = await created(currentInput)
    const source = currentInput.sources[1]
    await store.reconcileSource({ namespace: NAMESPACE, kind: 'material', id: source.id, status: 'withdrawn', currentHash: source.hash, now: DAY_NEXT })
    expect(await store.getJob(old.jobId, 'owner')).toMatchObject({ status: 'withdrawn', errorCode: 'source_stale' })
    expect(await store.getSnapshot(old.executionId)).toBeNull()
    expect((await store.getJob(current.jobId, 'owner'))?.status).toBe('queued')
    expect(await store.getSnapshot(current.executionId)).not.toBeNull()
    await store.reconcileSource({ namespace: NAMESPACE, kind: 'material', id: source.id, status: 'withdrawn', currentHash: null, now: DAY_NEXT })
    expect(await store.getJob(current.jobId, 'owner')).toMatchObject({ status: 'withdrawn', errorCode: 'source_withdrawn' })
    expect(await store.getSnapshot(current.executionId)).toBeNull()
    expect((await store.budget(DAY_NEXT)).committedMicroUsd).toBe(0)
  })

  it('已保存結果再清除時抹去所有來源快照、原始回應、生成、人改及 diff', async () => {
    const claim = await input(1, 'owner')
    const job = await draft(claim)
    const revision = await store.createRevision({ jobId: job.jobId, ownerId: 'owner', parentId: 'ai', payload: { title: '人工私人內容', items: [] }, generations: job.generations })
    expect(revision.outcome).toBe('created')
    await store.eraseSource({ namespace: NAMESPACE, kind: 'material', id: claim.sources[1].id, reason: 'request', now: DAY_NEXT })
    expect((await store.getJob(job.jobId, 'owner'))?.status).toBe('erased')
    expect(await store.getArtifact(job.executionId, job.artifactId)).toBeNull()
    expect(await store.listRevisions(job.jobId, 'owner')).toBeNull()
    expect(await store.listSources()).toEqual([])
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_sources WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_revisions WHERE payload IS NOT NULL OR diff IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(adapter.sqlite.prepare('SELECT manifest FROM ct_ai_executions WHERE id = ?').get(job.executionId)).toMatchObject({ manifest: null })
    expect((await store.claimJob(claim)).outcome).toBe('erased')
    expect((await store.claimJob(await input(1, 'owner', { content: '重新匯入後內容', now: DAY_NEXT }))).outcome).toBe('erased')
  })

  it('清除同來源會一次覆蓋不同輸入執行與其各自私人修訂', async () => {
    const firstInput = await input(1, 'one', { content: '第一版正文' })
    const secondInput = await input(1, 'two', { content: '第二版正文', now: '2026-10-29T09:05:00.000Z' })
    const first = await draft(firstInput)
    const second = await draft(secondInput)
    expect((await store.createRevision({ jobId: first.jobId, ownerId: 'one', parentId: 'ai', payload: { title: '甲修訂' }, generations: first.generations })).outcome).toBe('created')
    expect((await store.createRevision({ jobId: second.jobId, ownerId: 'two', parentId: 'ai', payload: { title: '乙修訂' }, generations: second.generations })).outcome).toBe('created')
    await store.eraseSource({ namespace: NAMESPACE, kind: 'material', id: firstInput.sources[1].id, reason: 'deleted' })
    expect((await store.getJob(first.jobId, 'one'))?.status).toBe('erased')
    expect((await store.getJob(second.jobId, 'two'))?.status).toBe('erased')
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_sources WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_revisions WHERE payload IS NOT NULL OR diff IS NOT NULL').get()).toMatchObject({ n: 0 })
  })

  it('模型已開始、清除先完成時，遲到 raw／工件／完成均被 fence 擋下', async () => {
    const claim = await input(1, 'owner')
    const job = await created(claim)
    const attempt = await store.beginAttempt({ executionId: job.executionId, stepKey: 'extract:1', estimateMicroUsd: 1_000, generations: job.generations, now: DAY })
    if (attempt.outcome !== 'started') throw new Error('missing attempt')
    const gate = adapter.pauseOnce('INSERT OR IGNORE INTO ct_ai_artifacts')
    const delayed = store.saveArtifact({ executionId: job.executionId, attemptId: attempt.attemptId, kind: 'raw', payload: { text: '遲到私人正文' }, generations: job.generations })
    await gate.paused
    await store.eraseSource({ namespace: NAMESPACE, kind: 'material', id: claim.sources[1].id, reason: 'deleted' })
    gate.release()
    expect((await delayed).outcome).toBe('fenced')
    expect(await store.completeExecution({ executionId: job.executionId, artifactId: 'not-a-valid-artifact', generations: job.generations })).toBe(false)
    expect(await store.settleAttempt(attempt.attemptId, null)).toBe('unknown')
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_artifacts WHERE payload IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect((await store.beginAttempt({ executionId: job.executionId, stepKey: 'extract:2', estimateMicroUsd: 1, generations: job.generations })).outcome).toBe('fenced')
  })

  it('清除與人改及 cache 完成並發時，交易條件阻止舊 generation 落地', async () => {
    const claim = await input(1, 'owner')
    const job = await draft(claim)
    const gate = adapter.pauseOnce('INSERT OR IGNORE INTO ct_ai_revisions')
    const delayed = store.createRevision({ jobId: job.jobId, ownerId: 'owner', parentId: 'ai', payload: { title: '不得殘留', items: [] }, generations: job.generations })
    await gate.paused
    await store.eraseSource({ namespace: NAMESPACE, kind: 'issue', id: claim.issueId, reason: 'request' })
    gate.release()
    expect((await delayed).outcome).toBe('unavailable')
    expect(adapter.sqlite.prepare('SELECT COUNT(*) AS n FROM ct_ai_revisions WHERE payload IS NOT NULL OR diff IS NOT NULL').get()).toMatchObject({ n: 0 })

    const claim2 = await input(2, 'owner')
    const next = await created(claim2)
    const generations: SourceGeneration[] = next.generations
    await store.setStatus({ executionId: next.executionId, expected: 'queued', next: 'extracting', generations })
    await store.setStatus({ executionId: next.executionId, expected: 'extracting', next: 'comparing', generations })
    await store.setStatus({ executionId: next.executionId, expected: 'comparing', next: 'generating', generations })
    const artifact = await store.saveArtifact({ executionId: next.executionId, kind: 'generation', payload: { data: { title: '清除前候選' } }, generations })
    if (artifact.outcome !== 'saved') throw new Error('missing artifact')
    const finishGate = adapter.pauseOnce('UPDATE ct_ai_executions AS e SET status = ?, artifact_id')
    const finish = store.completeExecution({ executionId: next.executionId, artifactId: artifact.artifactId, generations })
    await finishGate.paused
    await store.eraseSource({ namespace: NAMESPACE, kind: 'material', id: claim2.sources[1].id, reason: 'deleted' })
    finishGate.release()
    expect(await finish).toBe(false)
    expect((await store.getJob(next.jobId, 'owner'))?.status).toBe('erased')
    expect(await store.getArtifact(next.executionId, artifact.artifactId)).toBeNull()
  })
})
