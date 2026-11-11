import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createEvidenceSummary } from '../client/evidenceSummary'

const issuePath = '/api/issues/7/evidence-summary'
const jobPath = '/api/evidence-jobs/job-1'
const usage = { attempts: 3, reservedMicroUsd: 0, actualMicroUsd: 12500, uncertain: 0 }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const context = (version: number, hasSummary: boolean, job: unknown = null, summary: unknown = null) => ({ version, has_summary: hasSummary, job, summary })
const job = (status: string) => ({ job_id: 'job-1', status, usage })
const savedSummary = (jobId = 'job-1') => ({ job_id: jobId, data: { consensus: ['result'] }, citation_map: {}, verification: 'ai_unverified', updated_at: '2026-11-11T00:00:00Z' })

afterEach(() => vi.useRealTimers())

function fixture(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: Array<{ url: string; method: string; body: string | null }> = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null })
    return handler(url, init)
  }
  const onResult = vi.fn()
  const onSessionExpired = vi.fn()
  const onBanned = vi.fn()
  const controller = createEvidenceSummary(7, { fetch: fetcher, onResult, onSessionExpired, onBanned, pollInterval: 60_000 })
  return { controller, calls, onResult, onSessionExpired, onBanned }
}

describe('一鍵彙整前端狀態', () => {
  it('進入志願者頁時只還原此議題與語言的授權工作，不送出新工作', async () => {
    const f = fixture(url => {
      if (url === `${issuePath}?language=zh-TW`) return response(context(3, false, job('queued')))
      if (url === jobPath) return response(job('extracting'))
      throw new Error(`unexpected ${url}`)
    })
    await f.controller.setScope('zh-TW')
    expect(f.calls.map(call => [call.method, call.url])).toEqual([
      ['GET', `${issuePath}?language=zh-TW`],
      ['GET', jobPath],
    ])
    expect(f.controller.state).toMatchObject({ language: 'zh-TW', phase: 'progress', jobId: 'job-1', status: 'extracting', version: 3, usage })
    expect(f.onResult).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('明確開始時傳送捕捉的語言與版本；HTTP 200 的部分結果不是成功', async () => {
    const data = { consensus: { Overview: '部分草稿', items: [] }, disputes: { Overview: '尚未完成', items: [] }, positions: { Overview: '尚未完成', items: [] } }
    const f = fixture((url, init) => {
      if (url === `${issuePath}?language=en`) return response(context(8, true))
      if (url === issuePath && init?.method === 'POST') return response({ job_id: 'job-1', status: 'partial_draft', cache: 'hit', input_coverage: {}, version: 9 })
      if (url === jobPath) return response({ ...job('partial_draft'), data })
      throw new Error(`unexpected ${url}`)
    })
    await f.controller.setScope('en')
    expect(await f.controller.prepare()).toBe(true)
    expect(f.controller.state.hasSummary).toBe(true)
    await f.controller.start()
    const posts = f.calls.filter(call => call.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0].body!)).toEqual({ consent: true, language: 'en', expected_version: 8 })
    expect(f.controller.state).toMatchObject({ phase: 'partial', status: 'partial_draft', hasSummary: true, usage })
    expect(f.onResult).toHaveBeenCalledExactlyOnceWith(data)
    f.controller.dispose()
  })

  it.each([
    { name: '同一版本與工作已存妥', finalContext: context(2, true, job('ai_draft'), savedSummary()), phase: 'saved', logged: true },
    { name: '同一工作尚未確認保存', finalContext: context(2, true, job('ai_draft'), savedSummary('older')), phase: 'unsaved', logged: false },
    { name: '較新版本即使保留舊結果也不能誤認為本次成功', finalContext: context(3, true, null, savedSummary()), phase: 'superseded', logged: false },
    { name: '最新工作不同時不得輸出舊工作結果', finalContext: context(2, true, { job_id: 'newer', status: 'queued' }, savedSummary()), phase: 'superseded', logged: false },
  ])('$name', async ({ finalContext, phase, logged }) => {
    let contextCount = 0
    const f = fixture((url, init) => {
      if (url === `${issuePath}?language=ja`) return response(++contextCount <= 2 ? context(1, false) : finalContext)
      if (url === issuePath && init?.method === 'POST') return response({ job_id: 'job-1', status: 'ai_draft', cache: 'hit', input_coverage: {}, version: 2 })
      if (url === jobPath) return response(job('ai_draft'))
      throw new Error(`unexpected ${url}`)
    })
    await f.controller.setScope('ja')
    expect(await f.controller.prepare()).toBe(true)
    await f.controller.start()
    expect(f.controller.state.phase).toBe(phase)
    if (logged) {
      expect(f.onResult).toHaveBeenCalledOnce()
      expect(f.onResult).toHaveBeenCalledWith({ consensus: ['result'] })
    } else expect(f.onResult).not.toHaveBeenCalled()
    if (phase === 'unsaved') expect(f.controller.state.canResume).toBe(true)
    f.controller.dispose()
  })

  it('非快取工作由 queued v1 完成並保存為 v2 時仍通知成功，且停止輪詢', async () => {
    vi.useFakeTimers()
    let contextCount = 0
    let jobChecks = 0
    const f = fixture((url, init) => {
      if (url === `${issuePath}?language=zh-TW`) return response(++contextCount <= 2 ? context(0, false) : context(2, true, job('ai_draft'), savedSummary()))
      if (url === issuePath && init?.method === 'POST') return response({ job_id: 'job-1', status: 'queued', cache: 'miss', input_coverage: {}, version: 1 })
      if (url === jobPath) return response(job(++jobChecks === 1 ? 'generating' : 'ai_draft'))
      throw new Error(`unexpected ${url}`)
    })
    await f.controller.setScope('zh-TW')
    expect(await f.controller.prepare()).toBe(true)
    await f.controller.start()
    expect(f.controller.state).toMatchObject({ phase: 'progress', version: 1, status: 'generating' })
    expect(f.onResult).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.controller.state).toMatchObject({ phase: 'saved', version: 2, status: 'ai_draft', jobId: 'job-1', hasSummary: true, canResume: false })
    expect(f.onResult).toHaveBeenCalledExactlyOnceWith({ consensus: ['result'] })

    await vi.advanceTimersByTimeAsync(180_000)
    expect(jobChecks).toBe(2)
    expect(f.onResult).toHaveBeenCalledOnce()
    expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
    f.controller.dispose()
  })

  it('送出失聯時不得重送；使用者手動查詢才還原可能已建立的工作', async () => {
    let contextCount = 0
    const f = fixture((url, init) => {
      if (url === `${issuePath}?language=zh-TW`) return response(++contextCount <= 2 ? context(0, false) : context(1, false, job('queued')))
      if (url === issuePath && init?.method === 'POST') throw new TypeError('network lost after sending')
      if (url === jobPath) return response(job('queued'))
      throw new Error(`unexpected ${url}`)
    })
    await f.controller.setScope('zh-TW')
    expect(await f.controller.prepare()).toBe(true)
    await f.controller.start()
    expect(f.controller.state).toMatchObject({ phase: 'error', error: 'post_unknown', canResume: true })
    expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
    await f.controller.resume()
    expect(f.controller.state).toMatchObject({ phase: 'progress', jobId: 'job-1', status: 'queued' })
    expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
    f.controller.dispose()
  })

  it('狀態查詢失敗停止輪詢，只透過明確動作恢復 GET', async () => {
    vi.useFakeTimers()
    let jobChecks = 0
    const f = fixture(url => {
      if (url === `${issuePath}?language=en`) return response(context(4, false, job('queued')))
      if (url === jobPath) {
        if (++jobChecks === 1) throw new TypeError('offline')
        return response({ ...job('failed'), usage: { ...usage, uncertain: 1 } })
      }
      throw new Error(`unexpected ${url}`)
    })
    await f.controller.setScope('en')
    expect(f.controller.state).toMatchObject({ phase: 'error', error: 'network_error', canResume: true, jobId: 'job-1' })
    await vi.advanceTimersByTimeAsync(180_000)
    expect(jobChecks).toBe(1)
    await f.controller.resume()
    expect(jobChecks).toBe(2)
    expect(f.controller.state).toMatchObject({ phase: 'failed', canResume: false, usage: { uncertain: 1 } })
    expect(f.calls.every(call => call.method === 'GET')).toBe(true)
    f.controller.dispose()
  })

  it('版本衝突先重新讀取，絕不自動重新提交', async () => {
    let contextCount = 0
    const f = fixture((url, init) => {
      if (url === `${issuePath}?language=zh-TW`) return response(context(++contextCount < 3 ? 7 : 8, true))
      if (url === issuePath && init?.method === 'POST') return response({ error: 'summary_conflict' }, 409)
      throw new Error(`unexpected ${url}`)
    })
    await f.controller.setScope('zh-TW')
    expect(await f.controller.prepare()).toBe(true)
    await f.controller.start()
    expect(f.controller.state).toMatchObject({ phase: 'error', error: 'summary_conflict', canResume: true })
    await f.controller.resume()
    expect(f.controller.state).toMatchObject({ phase: 'ready', version: 8, hasSummary: true })
    expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
    f.controller.dispose()
  })

  it('登入過期或停權停止查詢，分別通知畫面而不變更全站登入狀態', async () => {
    for (const status of [401, 403]) {
      const f = fixture(url => url === `${issuePath}?language=zh-TW` ? response(context(1, false, job('queued'))) : response({ error: 'denied' }, status))
      await f.controller.setScope('zh-TW')
      expect(f.controller.state).toMatchObject({ phase: 'error', canResume: false, error: status === 401 ? 'session_expired' : 'banned' })
      expect(f.onSessionExpired).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
      expect(f.onBanned).toHaveBeenCalledTimes(status === 403 ? 1 : 0)
      f.controller.dispose()
    }
  })

  it('切換語言後丟棄舊回應；停止與卸載後也不再套用在途結果', async () => {
    let resolveOld!: (response: Response) => void
    // 專案型別目標為 ES2022，尚未提供 Promise.withResolvers。
    const old = new Promise<Response>(resolve => { resolveOld = resolve })
    const f = fixture(url => {
      if (url === `${issuePath}?language=zh-TW`) return old
      if (url === `${issuePath}?language=en`) return response(context(11, false))
      throw new Error(`unexpected ${url}`)
    })
    const oldScope = f.controller.setScope('zh-TW')
    await f.controller.setScope('en')
    resolveOld(response(context(1, true, job('ai_draft'), savedSummary())))
    await oldScope
    expect(f.controller.state).toMatchObject({ language: 'en', phase: 'ready', version: 11, jobId: null })
    expect(f.calls.filter(call => call.url === jobPath)).toHaveLength(0)
    expect(f.onResult).not.toHaveBeenCalled()
    await f.controller.setScope(null)
    expect(f.controller.state).toMatchObject({ language: null, phase: 'idle' })
    f.controller.dispose()
  })

  it('同一確認不重入，切換語言後不套用或輪詢舊的 POST 回應', async () => {
    let resolvePost!: (response: Response) => void
    // 專案型別目標為 ES2022，尚未提供 Promise.withResolvers。
    const post = new Promise<Response>(resolve => { resolvePost = resolve })
    const f = fixture((url, init) => {
      if (url === `${issuePath}?language=zh-TW`) return response(context(4, false))
      if (url === `${issuePath}?language=en`) return response(context(9, false))
      if (url === issuePath && init?.method === 'POST') return post
      throw new Error(`unexpected ${url}`)
    })
    await f.controller.setScope('zh-TW')
    expect(await f.controller.prepare()).toBe(true)
    const first = f.controller.start()
    await f.controller.start()
    expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
    await f.controller.setScope('en')
    resolvePost(response({ job_id: 'job-1', status: 'ai_draft', version: 5, cache: 'hit', input_coverage: {} }))
    await first
    expect(f.controller.state).toMatchObject({ language: 'en', phase: 'ready', version: 9, jobId: null })
    expect(f.calls.filter(call => call.url === jobPath)).toHaveLength(0)
    expect(f.onResult).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('卸載時停止在途查詢，遲到的回應不會啟動輪詢或輸出內容', async () => {
    let resolveContext!: (response: Response) => void
    // 專案型別目標為 ES2022，尚未提供 Promise.withResolvers。
    const pending = new Promise<Response>(resolve => { resolveContext = resolve })
    const f = fixture(() => pending)
    const loading = f.controller.setScope('zh-TW')
    f.controller.dispose()
    resolveContext(response(context(1, true, job('ai_draft'), savedSummary())))
    await loading
    expect(f.controller.state.language).toBeNull()
    expect(f.calls).toHaveLength(1)
    expect(f.onResult).not.toHaveBeenCalled()
  })

  it('恢復部分草稿只輸出一次，不誤用舊保存結果，也不繼續輪詢或重送', async () => {
    vi.useFakeTimers()
    const data = { consensus: { Overview: '本次部分草稿', items: [] } }
    const f = fixture(url => url === `${issuePath}?language=en`
      ? response(context(9, true, job('partial_draft'), savedSummary('older')))
      : response({ ...job('partial_draft'), data }))
    await f.controller.setScope('en')
    await f.controller.setScope('en')
    await vi.advanceTimersByTimeAsync(180_000)
    expect(f.controller.state).toMatchObject({ phase: 'partial', hasSummary: true, version: 9, canResume: false })
    expect(f.onResult).toHaveBeenCalledExactlyOnceWith(data)
    expect(f.calls.map(call => [call.method, call.url])).toEqual([
      ['GET', `${issuePath}?language=en`], ['GET', jobPath],
      ['GET', `${issuePath}?language=en`], ['GET', jobPath],
    ])
    f.controller.dispose()
  })

  it.each(['language', 'dispose'])('部分草稿遲到時不洩漏已離開範圍的內容：%s', async action => {
    let resolveJob!: (response: Response) => void
    const pending = new Promise<Response>(resolve => { resolveJob = resolve })
    const f = fixture(url => {
      if (url === `${issuePath}?language=zh-TW`) return response(context(1, false, job('generating')))
      if (url === `${issuePath}?language=en`) return response(context(2, false))
      if (url === jobPath) return pending
      throw new Error(`unexpected ${url}`)
    })
    const loading = f.controller.setScope('zh-TW')
    await vi.waitFor(() => expect(f.calls.some(call => call.url === jobPath)).toBe(true))
    if (action === 'language') await f.controller.setScope('en')
    else f.controller.dispose()
    resolveJob(response({ ...job('partial_draft'), data: { consensus: '已離開的私人草稿' } }))
    await loading
    expect(f.controller.state).toMatchObject({ language: action === 'language' ? 'en' : null })
    expect(f.onResult).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it.each([
    { status: 'partial_draft', phase: 'partial' },
    { status: 'failed', phase: 'failed' },
    { status: 'withdrawn', phase: 'withdrawn' },
    { status: 'erased', phase: 'erased' },
  ])('$status 沒有可交付資料時停止輪詢且不輸出內容', async ({ status, phase }) => {
    const f = fixture(url => url === `${issuePath}?language=en` ? response(context(1, true, job(status))) : response(job(status)))
    await f.controller.setScope('en')
    expect(f.controller.state).toMatchObject({ phase, status, canResume: false })
    expect(f.calls).toHaveLength(2)
    expect(f.onResult).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('費用資料缺失時保留未知，不妨礙已確認保存的完整結果', async () => {
    const f = fixture(url => url === `${issuePath}?language=en`
      ? response(context(2, true, job('ai_draft'), savedSummary()))
      : response({ ...job('ai_draft'), usage: null }))
    await f.controller.setScope('en')
    expect(f.controller.state).toMatchObject({ phase: 'saved', usage: null })
    expect(f.onResult).toHaveBeenCalledWith({ consensus: ['result'] })
    f.controller.dispose()
  })

  it('無法辨識狀態時不能宣稱成功，並提供手動查詢', async () => {
    const f = fixture(url => url === `${issuePath}?language=en` ? response(context(1, false, job('queued'))) : response(job('future_status')))
    await f.controller.setScope('en')
    expect(f.controller.state).toMatchObject({ phase: 'unknown', status: 'future_status', canResume: true })
    expect(f.onResult).not.toHaveBeenCalled()
    f.controller.dispose()
  })
})
