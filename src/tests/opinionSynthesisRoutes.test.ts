import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { apiCsrf } from '../api/csrf'
import { registerApiRoutes } from '../api/routes'
import type { AppBindings } from '../api/types'
import { registerOpinionSynthesisRoute, runOpinionSynthesisJob, type OpinionSynthesisJob } from '../opinions/synthesis'

vi.mock('../auth/authorization', async importOriginal => ({
  ...(await importOriginal<typeof import('../auth/authorization')>()),
  tryGetAuthContext: async (_env: unknown, headers: Headers) => {
    const id = headers.get('x-fixture-session')
    return id ? { user: { id, name: 'Synthetic User', email: 'account@example.test', image: null }, role: 'user', banned: id === 'blocked', nameChangeCooldownDays: null } : null
  },
}))

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(':memory:')

  constructor() {
    const migrations = new URL('../../migrations/', import.meta.url)
    for (const name of readdirSync(migrations)
      .filter(name => name.endsWith('.sql'))
      .sort())
      this.sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'))
  }

  prepare(sql: string) {
    const sqlite = this.sqlite
    return {
      bind(...values: SQLInputValue[]) {
        const rows = () => ({ results: sqlite.prepare(sql).all(...values) })
        return {
          rows,
          async all() {
            return rows()
          },
          async first() {
            return sqlite.prepare(sql).get(...values) ?? null
          },
          async run() {
            return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }
          },
        }
      },
    }
  }

  async batch(statements: { rows(): unknown }[]) {
    return statements.map(statement => statement.rows())
  }
}

const T0 = new Date('2026-11-23T04:00:00Z')
const SYNTHESIS_PATH = '/api/issues/10/opinions/synthesis?language=zh-TW'
const GERMAN_SYNTHESIS_PATH = '/api/issues/10/opinions/synthesis?language=de'
const CASE_TITLE = '合成議題'
const PAPER = [
  { kind: 'common_ground', text: '兩群均支持完善轉乘。', opinionIds: [11] },
  { kind: 'tensions', text: '兩群對公車班距優先次序不同。', opinionIds: [12] },
]
const opened: SQLiteD1[] = []

function modelReply(sections = PAPER, finishReason = 'stop') {
  return {
    model: 'synthetic-gemma-boundary-double',
    choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content: JSON.stringify({ sections }) } }],
  }
}

function scenario(participants = 8) {
  vi.setSystemTime(T0)
  const db = new SQLiteD1()
  opened.push(db)
  db.sqlite.exec(`
    INSERT INTO ct_issues (id,title) VALUES (10,'${CASE_TITLE}'),(20,'別的議題');
    INSERT INTO ct_opinions (id,issue_id,summary,abuse_flagged,author_email) VALUES
      (11,10,'完善轉乘',0,'not-for-ai@example.test'),(12,10,'縮短公車班距',0,NULL),(13,10,'提高夜車密度',0,NULL),
      (14,10,'待審內容',1,NULL),(15,10,'隱藏正文',3,NULL),(21,20,'別的議題正文',0,NULL);
  `)
  const vote = db.sqlite.prepare('INSERT INTO ct_opinion_votes (opinion_id,voter_id,value) VALUES (?,?,?)')
  for (let i = 0; i < participants; i++) {
    const participant = `synthetic-voter-${i}`
    vote.run(11, participant, 1)
    vote.run(12, participant, i < 4 ? 1 : -1)
    vote.run(13, participant, i < 4 ? -1 : 1)
    vote.run(14, participant, 1)
    vote.run(15, participant, 1)
    vote.run(21, participant, 1)
  }
  const jobs = new Map<string, OpinionSynthesisJob>()
  const run = vi.fn(async (_model: string, _input: unknown) => modelReply())
  const env = {
    DB: db as unknown as D1Database,
    AI: { run } as unknown as Ai,
    OPINION_SYNTHESIS_ENABLED: '1',
    OPINION_SYNTHESIS_AI_POLICY: 'opinion-synthesis-v1',
    OPINION_SYNTHESIS_WORKFLOW: {
      async create({ id, params }: { id: string; params: OpinionSynthesisJob }) {
        if (jobs.has(id)) throw new Error('already exists')
        jobs.set(id, params)
      },
      async get(id: string) {
        return { status: async () => ({ status: jobs.has(id) ? 'queued' : 'unknown' }) }
      },
    } as unknown as Workflow<OpinionSynthesisJob>,
  } satisfies Partial<AppBindings>
  const app = new Hono<{ Bindings: AppBindings }>()
  app.use('/api/*', apiCsrf)
  registerOpinionSynthesisRoute(app)
  registerApiRoutes(app)
  const waiting: Promise<unknown>[] = []
  const request = (path = SYNTHESIS_PATH, init?: RequestInit) =>
    app.request(`https://civic.local${path}`, init, env, {
      waitUntil: (task: Promise<unknown>) => {
        waiting.push(task)
      },
      passThroughOnException: () => undefined,
      props: {},
    })
  const read = (viewer?: string, path = SYNTHESIS_PATH) => request(path, viewer ? { headers: { Cookie: 'fixture=1', 'x-fixture-session': viewer } } : undefined)
  const visit = (path = SYNTHESIS_PATH) => request(path, { headers: { 'Sec-Fetch-Site': 'same-origin' } })
  const execute = async () => Promise.all([...jobs.values()].map(job => runOpinionSynthesisJob(env as AppBindings, job)))
  return { db: db.sqlite, env, run, jobs, request, read, visit, execute, waiting }
}

afterEach(() => {
  for (const db of opened.splice(0)) db.sqlite.close()
  vi.useRealTimers()
})

describe('公民意見綜整 API 與背景工作', () => {
  it('正式開關關閉時不回綜整，即使聚集足量票且模型政策已設定', async () => {
    const s = scenario()
    s.env.OPINION_SYNTHESIS_ENABLED = '0'
    expect((await s.visit()).status).toBe(404)
    expect(s.jobs.size).toBe(0)
  })

  it('三人及待審／隱藏／跨議題的表決不能排程', async () => {
    const s = scenario(3)
    const response = await s.visit()
    expect(await response.json()).toMatchObject({ status: 'insufficient', qualifiedParticipants: 3, votesRequired: 3, report: null })
    expect(s.jobs.size).toBe(0)
  })

  it('從 session 只取得自己的群，不接收別人的識別碼，且回應不可共用快取', async () => {
    const s = scenario()
    const first = await s.read('synthetic-voter-0')
    const second = await s.read('synthetic-voter-7')
    const anonymous = await s.read()
    expect(first.headers.get('Cache-Control')).toBe('private, no-store')
    expect(first.headers.get('Vary')).toBe('Cookie')
    expect(await first.json()).toMatchObject({ myGroup: 1 })
    expect(await second.json()).toMatchObject({ myGroup: 2 })
    const json = await anonymous.text()
    expect(JSON.parse(json)).toMatchObject({ myGroup: null })
    expect(json).not.toMatch(/synthetic-voter-|@example\.test|待審內容|隱藏正文|別的議題正文/)
    expect((await s.read('synthetic-voter-0', `${SYNTHESIS_PATH}&viewer=synthetic-voter-7`)).status).toBe(400)
    expect((await s.read(undefined, `${SYNTHESIS_PATH}&language=ja`)).status).toBe(400)
  })

  it('有效投票自動排隊；並行瀏覽與重播工作不重複呼叫模型', async () => {
    const s = scenario()
    const vote = await s.request('/api/opinions/13/vote', {
      method: 'POST',
      headers: { Origin: 'https://civic.local', 'Content-Type': 'application/json', 'x-fixture-session': 'synthetic-voter-0' },
      body: '{"value":-1}',
    })
    expect(vote.status).toBe(200)
    await Promise.all(s.waiting)
    expect(s.jobs.size).toBe(1)
    const responses = await Promise.all([s.visit(), s.visit()])
    for (const response of responses) expect(await response.json()).toMatchObject({ reportStatus: 'pending', report: null })
    await Promise.all([s.execute(), s.execute()])
    expect(s.run).toHaveBeenCalledTimes(1)
    const input = JSON.stringify(s.run.mock.calls[0]?.[1])
    expect(input).toContain('完善轉乘')
    expect(input).not.toMatch(/synthetic-voter-|not-for-ai|待審內容|隱藏正文|別的議題正文/)
    expect(await (await s.read()).json()).toMatchObject({ reportStatus: 'ready', report: { sections: PAPER } })
  })

  it('議題 19 型態：四位達標無法拆群時，只用有足夠實票支持的公開意見綜整', async () => {
    const s = scenario(4)
    s.db.exec(`
      UPDATE ct_opinions SET author_id = 'synthetic-voter-' || (id - 11) WHERE id BETWEEN 11 AND 13;
      DELETE FROM ct_opinion_votes WHERE opinion_id BETWEEN 11 AND 13 AND voter_id = (
        SELECT author_id FROM ct_opinions WHERE id = opinion_id
      );
      UPDATE ct_opinion_votes SET value = CASE
        WHEN opinion_id = 11 AND voter_id = 'synthetic-voter-1' THEN 0
        WHEN opinion_id = 12 AND voter_id = 'synthetic-voter-0' THEN -1
        ELSE 1 END WHERE opinion_id BETWEEN 11 AND 13;
    `)
    const sections = [{ kind: 'common_ground', text: '達標參與者傾向支持提高夜車密度。', opinionIds: [13] }]
    s.run.mockResolvedValueOnce(modelReply(sections))

    expect(await (await s.read()).json()).toMatchObject({ reportStatus: 'unavailable' })
    expect(s.jobs.size).toBe(0)
    expect(await (await s.visit()).json()).toEqual({
      qualifiedParticipants: 4,
      votesRequired: 3,
      status: 'unclustered',
      groups: [{ id: 1, size: 4, x: 0, y: 0 }],
      myGroup: null,
      statistics: [{ opinionId: 13, body: '提高夜車密度', kind: 'common_agree', groups: [{ id: 1, direction: 'agree' }] }],
      reportStatus: 'pending',
      report: null,
    })
    await s.execute()
    expect(await (await s.read()).json()).toMatchObject({ reportStatus: 'ready', report: { sections } })
  })

  it('同一份聚合證據跨日重用；證據變了，24 小時後才允許刷新', async () => {
    const s = scenario()
    await s.visit()
    await s.execute()
    vi.setSystemTime(new Date(T0.getTime() + 60_000))
    s.db.exec("UPDATE ct_opinion_votes SET value = 0 WHERE opinion_id = 13 AND voter_id IN ('synthetic-voter-4','synthetic-voter-5')")
    expect(await (await s.visit()).json()).toMatchObject({ reportStatus: 'unavailable', report: null })
    expect(s.jobs.size).toBe(1)
    vi.setSystemTime(new Date(T0.getTime() + 86_400_000))
    expect(await (await s.visit()).json()).toMatchObject({ reportStatus: 'pending', report: null })
    await s.execute()
    vi.setSystemTime(new Date(T0.getTime() + 172_800_000))
    expect(await (await s.visit()).json()).toMatchObject({ reportStatus: 'ready', report: { sections: PAPER } })
    expect(s.run).toHaveBeenCalledTimes(2)
  })

  it('德文綜整以德文呼叫模型，且報告只在該語言的快取回傳', async () => {
    const s = scenario()
    const sections = [{ kind: 'common_ground', text: 'Beide Gruppen befürworten bessere Umsteigemöglichkeiten.', opinionIds: [11] }]
    s.run.mockResolvedValueOnce(modelReply(sections))

    const response = await s.visit(GERMAN_SYNTHESIS_PATH)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ reportStatus: 'pending', report: null })
    await s.execute()

    expect(s.run).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(s.run.mock.calls[0]?.[1])).toMatch(/\bGerman\b/)
    expect(await (await s.read(undefined, GERMAN_SYNTHESIS_PATH)).json()).toMatchObject({ reportStatus: 'ready', report: { sections } })
    expect(await (await s.read()).json()).toMatchObject({ reportStatus: 'unavailable', report: null })
    expect((await s.read(undefined, GERMAN_SYNTHESIS_PATH.replace('language=de', 'language=toString'))).status).toBe(400)
  })

  it('被撤下的來源即時撤回既有報告，不能以舊工作重寫', async () => {
    const s = scenario()
    await s.visit()
    await s.execute()
    s.db.exec('UPDATE ct_opinions SET abuse_flagged=3 WHERE id=12')
    await s.execute()
    const response = await s.read()
    expect(await response.text()).not.toMatch(/公車班距|common_ground|group_perspectives/)
    expect(s.db.prepare('SELECT report FROM ct_opinion_synthesis_attempts').get()).toMatchObject({ report: null })
  })

  it('模型回應途中隱藏來源，工作完成時仍不能儲存舊正文', async () => {
    const s = scenario()
    await s.visit()
    s.run.mockImplementationOnce(async () => {
      s.db.exec('UPDATE ct_opinions SET abuse_flagged=3 WHERE id=12')
      return modelReply()
    })
    await s.execute()
    expect(s.db.prepare('SELECT report FROM ct_opinion_synthesis_attempts').get()).toMatchObject({ report: null })
  })

  it.each([
    ['引用不可見意見', modelReply([{ kind: 'tensions', text: '有人持不同看法。', opinionIds: [15] }])],
    ['模型回覆截斷', modelReply(PAPER, 'length')],
    ['輸出包含聯絡資料', modelReply([{ kind: 'tensions', text: '聯絡 private@example.test。', opinionIds: [12] }])],
  ])('%s 時不發布報告、重讀不重試該版', async (_case, reply) => {
    const s = scenario()
    s.run.mockResolvedValueOnce(reply)
    await s.visit()
    await s.execute()
    expect(await (await s.visit()).json()).toMatchObject({ reportStatus: 'failed', report: null })
    await s.execute()
    expect(s.run).toHaveBeenCalledTimes(1)
  })

  it('跨議題達全站用量上限時不再建立模型工作', async () => {
    const s = scenario()
    s.db.prepare('INSERT INTO ct_opinion_synthesis_attempts (issue_id,language,revision,started_at,reserved_micro_usd) VALUES (?,?,?,?,?)').run(20, 'zh-TW', 'previous', T0.getTime(), 100_000)
    expect(await (await s.visit()).json()).toMatchObject({ reportStatus: 'unavailable', report: null })
    expect(s.jobs.size).toBe(0)
  })

  it('跨站或未開啟模型政策只讀，不能預留模型費用', async () => {
    const s = scenario()
    expect((await s.request(SYNTHESIS_PATH, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(200)
    s.env.OPINION_SYNTHESIS_AI_POLICY = ''
    expect((await s.visit()).status).toBe(200)
    expect(s.jobs.size).toBe(0)
  })
})
