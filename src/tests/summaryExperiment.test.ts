import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vite-plus/test'
import { registerSummaryExperiment } from '../api/summary-experiment'

const summary = {
  consensus: { overview: '背景', items: [{ title: '共同點', description: '共同的事實' }] },
  disputes: { overview: '分歧', items: [] },
  positions: { overview: '立場', items: [{ name: '一方', sources: [{ title: '來源', href: 'https://example.org' }], core_concern: '關心', opinions: [] }] },
}

function setup(result: unknown = summary) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE ct_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, polis_id TEXT, created_at TEXT, last_activity_at TEXT, is_closed INTEGER DEFAULT 0, closure_reason TEXT, closure_changed_at TEXT, tags TEXT, abuse_flagged INTEGER, author_name TEXT, author_email TEXT, show_email INTEGER);
    CREATE TABLE ct_materials (id INTEGER PRIMARY KEY, issue_id INTEGER, source_name TEXT, source_url TEXT, stance TEXT, content TEXT, abuse_flagged INTEGER, created_at TEXT);
    INSERT INTO ct_issues (id, title, abuse_flagged) VALUES (1, '測試議題', 0), (2, '隱藏議題', 3), (3, '空議題', 0);
    INSERT INTO ct_materials VALUES (1, 1, '公開來源', 'https://example.org', 'support', '公開素材', 0, '2026-01-01'), (2, 1, '隱藏來源', '', 'oppose', '不可送出', 3, '2026-01-02');`)
  const db = {
    prepare(query: string) {
      return { bind(id: number) {
        const stmt = sqlite.prepare(query)
        return { first: async () => stmt.get(id) ?? null, all: async () => ({ results: stmt.all(id) }) }
      } }
    },
  }
  const run = vi.fn(async (_model: string, _input: object): Promise<unknown> => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }))
  const app = new Hono()
  registerSummaryExperiment(app as never)
  const request = (id: string) => app.request(`/api/dev/issues/${id}/summary`, { method: 'POST' }, { DB: db, AI: { run } } as never)
  return { sqlite, run, request }
}

describe('本機結構化彙整實驗', () => {
  it('只使用公開素材並回傳符合契約的彙整', async () => {
    const { sqlite, run, request } = setup()
    try {
      const res = await request('1')
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(await res.json()).toEqual(summary)
      const [model, input] = run.mock.calls[0]!
      expect(model).toBe('@cf/google/gemma-4-26b-a4b-it')
      const requestText = JSON.stringify(input)
      expect(requestText).toContain('公開素材')
      expect(requestText).not.toContain('不可送出')
    } finally { sqlite.close() }
  })

  it('不存在、隱藏或沒有素材時不呼叫模型', async () => {
    const { sqlite, run, request } = setup()
    try {
      expect((await request('0')).status).toBe(400)
      expect((await request('999')).status).toBe(404)
      expect((await request('2')).status).toBe(404)
      expect((await request('3')).status).toBe(400)
      expect(run).not.toHaveBeenCalled()
    } finally { sqlite.close() }
  })

  it('拒絕不符合巢狀結構與被截斷的模型回應', async () => {
    const { sqlite, run, request } = setup({ ...summary, positions: { overview: '立場', items: [{ name: '缺少來源' }] } })
    try {
      expect((await request('1')).status).toBe(502)
      run.mockResolvedValueOnce({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(summary) } }] })
      expect((await request('1')).status).toBe(502)
    } finally { sqlite.close() }
  })
})
