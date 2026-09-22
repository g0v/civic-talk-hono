import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as db from '../db/queries'
import { registerApiRoutes } from '../api/routes'

const auth = vi.hoisted(() => ({
  context: {
    user: { id: 'voter-1', name: 'Voter', email: 'voter@example.com', image: null },
    role: 'user' as const,
    banned: false,
    nameChangeCooldownDays: null,
  } as {
    user: { id: string; name: string; email: string; image: null }
    role: 'user' | 'admin'
    banned: boolean
    nameChangeCooldownDays: null
  } | null,
}))

vi.mock('../auth/authorization', () => ({
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
  tryGetAuthContext: vi.fn(async () => auth.context),
}))

vi.mock('../db/queries', () => ({
  // 票值判定用真的邏輯，別在測試裡放寬
  isVoteValue: (value: unknown) => value === 1 || value === 0 || value === -1,
  getOpinionVoteTarget: vi.fn(async () => ({ id: 5, issue_id: 1, author_id: 'author-1', abuse_flagged: 0 })),
  upsertOpinionVote: vi.fn(async () => undefined),
  deleteOpinionVote: vi.fn(async () => undefined),
  getOpinionVoteState: vi.fn(async () => ({ opinion_id: 5, my_vote: 1, is_author: false, tally: { agree: 2, disagree: 0, pass: 0 } })),
  listOpinionVoteStates: vi.fn(async () => []),
  getIssue: vi.fn(async () => ({ id: 1, title: 'Issue' })),
  listOpinionsForExport: vi.fn(async () => []),
  listVotesForExport: vi.fn(async () => []),
}))

function testApp() {
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  registerApiRoutes(app as never)
  return app
}

function vote(body: unknown, path = '/api/opinions/5/vote') {
  return testApp().request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: {} } as never)
}

const signedIn = {
  user: { id: 'voter-1', name: 'Voter', email: 'voter@example.com', image: null },
  role: 'user' as const,
  banned: false,
  nameChangeCooldownDays: null,
}

describe('POST /api/opinions/:id/vote 守門', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.context = signedIn
    vi.mocked(db.getOpinionVoteTarget).mockResolvedValue({ id: 5, issue_id: 1, author_id: 'author-1', abuse_flagged: 0 })
  })

  it('未登入回 401，且不寫入任何票', async () => {
    auth.context = null
    const res = await vote({ value: 1 })
    expect(res.status).toBe(401)
    expect(vi.mocked(db.upsertOpinionVote)).not.toHaveBeenCalled()
  })

  it('停權帳號回 403', async () => {
    auth.context = { ...signedIn, banned: true }
    const res = await vote({ value: 1 })
    expect(res.status).toBe(403)
    expect(vi.mocked(db.upsertOpinionVote)).not.toHaveBeenCalled()
  })

  it('提議者不得對自己的意見投票（已計為一票贊成）', async () => {
    auth.context = { ...signedIn, user: { ...signedIn.user, id: 'author-1' } }
    const res = await vote({ value: 1 })
    expect(res.status).toBe(403)
    expect(vi.mocked(db.upsertOpinionVote)).not.toHaveBeenCalled()
  })

  it('意見不存在回 404', async () => {
    vi.mocked(db.getOpinionVoteTarget).mockResolvedValue(null)
    expect((await vote({ value: 1 })).status).toBe(404)
  })

  it('已確認違規（2）與 AI 判定違規（3）不接受投票', async () => {
    for (const flag of [2, 3] as const) {
      vi.mocked(db.getOpinionVoteTarget).mockResolvedValue({ id: 5, issue_id: 1, author_id: 'author-1', abuse_flagged: flag })
      expect((await vote({ value: 1 })).status).toBe(403)
    }
    expect(vi.mocked(db.upsertOpinionVote)).not.toHaveBeenCalled()
  })

  it('使用者回報待審（1）仍可投票（#107 Bestian 裁示）', async () => {
    vi.mocked(db.getOpinionVoteTarget).mockResolvedValue({ id: 5, issue_id: 1, author_id: 'author-1', abuse_flagged: 1 })
    expect((await vote({ value: 1 })).status).toBe(200)
    expect(vi.mocked(db.upsertOpinionVote)).toHaveBeenCalledOnce()
  })
})

describe('POST /api/opinions/:id/vote 票值驗證', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.context = signedIn
    vi.mocked(db.getOpinionVoteTarget).mockResolvedValue({ id: 5, issue_id: 1, author_id: 'author-1', abuse_flagged: 0 })
  })

  it.each([[1], [0], [-1]])('接受合法票值 %i（0 是 falsy，最容易被誤擋）', async value => {
    const res = await vote({ value })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.upsertOpinionVote)).toHaveBeenCalledWith({}, 5, 'voter-1', value)
  })

  it.each([[2], ['1'], [null], [undefined], [1.5]])('拒絕不合法票值 %s', async value => {
    const res = await vote({ value })
    expect(res.status).toBe(400)
    expect(vi.mocked(db.upsertOpinionVote)).not.toHaveBeenCalled()
  })

  it('body 不是合法 JSON 時回 400 而不是 500', async () => {
    const res = await testApp().request('/api/opinions/5/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' }, { DB: {} } as never)
    expect(res.status).toBe(400)
  })

  it('投票者一律取自 session，不吃請求裡自報的 id', async () => {
    await vote({ value: 1, voter_id: 'somebody-else' })
    expect(vi.mocked(db.upsertOpinionVote)).toHaveBeenCalledWith({}, 5, 'voter-1', 1)
  })
})

describe('DELETE /api/opinions/:id/vote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.context = signedIn
    vi.mocked(db.getOpinionVoteTarget).mockResolvedValue({ id: 5, issue_id: 1, author_id: 'author-1', abuse_flagged: 0 })
  })

  it('收回自己的票', async () => {
    const res = await testApp().request('/api/opinions/5/vote', { method: 'DELETE' }, { DB: {} } as never)
    expect(res.status).toBe(200)
    expect(vi.mocked(db.deleteOpinionVote)).toHaveBeenCalledWith({}, 5, 'voter-1')
  })

  it('提議者沒有票可以收回', async () => {
    auth.context = { ...signedIn, user: { ...signedIn.user, id: 'author-1' } }
    const res = await testApp().request('/api/opinions/5/vote', { method: 'DELETE' }, { DB: {} } as never)
    expect(res.status).toBe(403)
    expect(vi.mocked(db.deleteOpinionVote)).not.toHaveBeenCalled()
  })

  it('未登入回 401', async () => {
    auth.context = null
    const res = await testApp().request('/api/opinions/5/vote', { method: 'DELETE' }, { DB: {} } as never)
    expect(res.status).toBe(401)
  })
})

describe('GET /api/issues/:id/opinion-votes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.context = signedIn
  })

  it('未登入回 401：投票狀態因人而異，不做公開端點', async () => {
    auth.context = null
    const res = await testApp().request('/api/issues/1/opinion-votes', {}, { DB: {} } as never)
    expect(res.status).toBe(401)
  })

  it('已登入回自己的狀態，並標明不可快取', async () => {
    const res = await testApp().request('/api/issues/1/opinion-votes', {}, { DB: {} } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('Vary')).toBe('Cookie')
    expect(vi.mocked(db.listOpinionVoteStates)).toHaveBeenCalledWith({}, 1, 'voter-1')
  })
})

describe('CSV 匯出', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.context = null // 公開下載，不需登入
    vi.mocked(db.getIssue).mockResolvedValue({ id: 1, title: 'Issue' } as never)
    vi.mocked(db.listOpinionsForExport).mockResolvedValue([
      { id: 10, summary: '第一則意見', created_at: '2026-01-02 03:04:05', abuse_flagged: 0, author_id: 'author-a', agrees: 2, disagrees: 1 },
      { id: 11, summary: '舊資料沒有作者', created_at: '2026-01-02 04:04:05', abuse_flagged: 0, author_id: null, agrees: 0, disagrees: 0 },
    ])
    // 真實資料受 PRIMARY KEY (opinion_id, voter_id) 約束，同一人對同一則意見只會有一列
    vi.mocked(db.listVotesForExport).mockResolvedValue([
      { opinion_id: 10, voter_id: 'voter-x', value: 1, updated_at: '2026-01-03 00:00:00' },
      { opinion_id: 10, voter_id: 'voter-y', value: -1, updated_at: '2026-01-03 01:00:00' },
      { opinion_id: 11, voter_id: 'voter-x', value: 0, updated_at: '2026-01-03 02:00:00' },
    ])
  })

  it('comments.csv 未登入即可下載，並以附件回傳', async () => {
    const res = await testApp().request('/api/issues/1/export/comments.csv', {}, { DB: {} } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toContain('civic-talk-issue-1-comments.csv')
  })

  it('comments.csv 把提議者的當然贊成票算進 agrees', async () => {
    const csv = await (await testApp().request('/api/issues/1/export/comments.csv', {}, { DB: {} } as never)).text()
    // 意見 10 資料表有 2 票贊成，加提議者＝3；意見 11 沒有作者，維持 0
    expect(csv).toContain(',10,1,3,1,1,"第一則意見"')
    expect(csv).toContain(',11,0,0,0,1,"舊資料沒有作者"')
  })

  it('CSV 絕不輸出 Better Auth 的 user id', async () => {
    const comments = await (await testApp().request('/api/issues/1/export/comments.csv', {}, { DB: {} } as never)).text()
    const votes = await (await testApp().request('/api/issues/1/export/votes.csv', {}, { DB: {} } as never)).text()
    for (const id of ['author-a', 'voter-x', 'voter-y']) {
      expect(comments).not.toContain(id)
      expect(votes).not.toContain(id)
    }
  })

  it('votes.csv 逐位元組符合格式：pN 匿名、補上提議者票、依 (參與者, 意見) 排序', async () => {
    const votes = await (await testApp().request('/api/issues/1/export/votes.csv', {}, { DB: {} } as never)).text()
    expect(votes).toBe(
      'participant,statement_id,vote,updated_at\n' +
        // 提議者 author-a 在 comments 階段先編號為 p1；這一列是他的當然贊成票，
        // 資料表裡不存在，時間取投稿時間，好讓 votes.csv 加總與 comments.csv 的 agrees 一致
        'p1,10,1,2026-01-02T03:04:05.000Z\n' +
        'p2,10,1,2026-01-03T00:00:00.000Z\n' +
        'p2,11,0,2026-01-03T02:00:00.000Z\n' +
        'p3,10,-1,2026-01-03T01:00:00.000Z\n'
    )
  })

  it('同一個人在兩份 CSV 是同一個代號', async () => {
    const comments = await (await testApp().request('/api/issues/1/export/comments.csv', {}, { DB: {} } as never)).text()
    const votes = await (await testApp().request('/api/issues/1/export/votes.csv', {}, { DB: {} } as never)).text()
    // author-a 在 comments.csv 的 author-id 欄是 1，在 votes.csv 就是 p1
    expect(comments).toContain(',10,1,3,1,1,"第一則意見"')
    expect(votes).toContain('p1,10,1,')
  })

  it('議題不存在回 404', async () => {
    vi.mocked(db.getIssue).mockResolvedValue(null)
    expect((await testApp().request('/api/issues/999/export/comments.csv', {}, { DB: {} } as never)).status).toBe(404)
    expect((await testApp().request('/api/issues/999/export/votes.csv', {}, { DB: {} } as never)).status).toBe(404)
  })
})
