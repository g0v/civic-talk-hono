import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { postSubmissionWithDuplicateNameCheck } from '../client/submission'

type FetchMockCalls = { mock: { calls: unknown[][] } }

function requestBodyAt(fetchMock: FetchMockCalls, index: number): unknown {
  const init = fetchMock.mock.calls[index]?.[1]
  if (!init || typeof init !== 'object' || !('body' in init) || typeof init.body !== 'string') throw new Error('missing JSON request body')
  return JSON.parse(init.body)
}

describe('投稿當下的同名 email 確認', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('使用者取消時不重送，也不會靜默公開 email', async () => {
    const fetchMock = vi.fn(async () => Response.json({ code: 'DUPLICATE_NAME_EMAIL_REQUIRED' }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await postSubmissionWithDuplicateNameCheck('/api/issues', { title: '議題', show_email: false }, () => false)

    expect(result).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(requestBodyAt(fetchMock, 0)).toEqual({ title: '議題', show_email: false })
  })

  it('使用者確認後才以 show_email=true 重送', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: 'DUPLICATE_NAME_EMAIL_REQUIRED' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ id: 1 }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const body = { title: '議題', show_email: false }
    const result = await postSubmissionWithDuplicateNameCheck('/api/issues', body, () => true)

    expect(result?.status).toBe(201)
    expect(body.show_email).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestBodyAt(fetchMock, 0)).toEqual({ title: '議題', show_email: false })
    expect(requestBodyAt(fetchMock, 1)).toEqual({ title: '議題', show_email: true })
  })
})
