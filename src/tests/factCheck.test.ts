import { describe, expect, it } from 'vite-plus/test'
import { buildFactCheckRequestBody, factCheckAllowsPosting, factCheckBlockReason, factCheckErrorKind, factCheckInputKey, parseFactCheckResult, type FactCheckResult } from '../lib/factCheck'

const allowed: FactCheckResult = {
  status: 'completed',
  moderation: { decision: 'allow' },
  verdict: 'mostly_supported',
  factuality: 0.5,
  confidence: 0.5,
  feedback: 'feedback',
}

describe('事實查核請求 body', () => {
  it('trim 文字，且只有非空來源網址才加入 url', () => {
    expect(buildFactCheckRequestBody('  主張內容  ', '  https://example.com/a?x=1  ')).toEqual({
      text: '主張內容',
      url: 'https://example.com/a?x=1',
    })
    expect(buildFactCheckRequestBody('  主張內容  ', '   ')).toEqual({ text: '主張內容' })
  })

  it('有效性 key 永不為空字串，並跟著內容與來源網址變動', () => {
    expect(factCheckInputKey('', '')).not.toBe('')
    expect(factCheckInputKey('主張內容', 'https://example.com/a')).not.toBe(factCheckInputKey('主張內容', 'https://example.com/b'))
    expect(factCheckInputKey('主張內容', 'https://example.com/a')).not.toBe(factCheckInputKey('另一個主張', 'https://example.com/a'))
    expect(factCheckInputKey('  主張內容  ', '  https://example.com/a  ')).toBe(factCheckInputKey('主張內容', 'https://example.com/a'))
  })
})

describe('事實查核張貼判斷', () => {
  it('只在明確通過時允許，且保留邊界 0.5/0.5 的允許行為', () => {
    expect(factCheckAllowsPosting(allowed)).toBe(true)
    expect(factCheckAllowsPosting({ ...allowed, factuality: 0.49, confidence: 0.51 })).toBe(false)
    expect(factCheckAllowsPosting({ ...allowed, factuality: 0.49, confidence: 0.5 })).toBe(true)
    expect(factCheckAllowsPosting({ ...allowed, factuality: 0 })).toBe(false)
  })

  it('partial 可繼續判斷，error/blocked/未知狀態一律不能張貼', () => {
    expect(factCheckAllowsPosting({ ...allowed, status: 'partial' })).toBe(true)
    expect(factCheckAllowsPosting({ ...allowed, status: 'blocked' })).toBe(false)
    expect(parseFactCheckResult({ ...allowed, status: 'error' })).toBeNull()
    expect(parseFactCheckResult({ ...allowed, status: 'unknown' })).toBeNull()
    expect(factCheckAllowsPosting({ ...allowed, moderation: { decision: 'block' } })).toBe(false)
    expect(factCheckAllowsPosting({ ...allowed, verdict: null })).toBe(false)
    expect(factCheckAllowsPosting({ ...allowed, factuality: null })).toBe(false)
    expect(factCheckAllowsPosting({ ...allowed, confidence: null })).toBe(false)
  })
  it('將社群守則封鎖與事實性不足分開分類', () => {
    expect(factCheckBlockReason({ ...allowed, status: 'blocked' })).toBe('community_guidelines')
    expect(factCheckBlockReason({ ...allowed, factuality: null })).toBe('community_guidelines')
    expect(factCheckBlockReason({ ...allowed, factuality: 0.49, confidence: 0.51 })).toBe('factuality')
  })

  it('拒絕缺漏或未知的 response 欄位，避免錯誤回應開放張貼', () => {
    expect(parseFactCheckResult({ status: 'completed', verdict: 'supported', factuality: 0.9, confidence: 0.9, feedback: 'ok' })).toBeNull()
    expect(parseFactCheckResult({ status: 'completed', moderation: { decision: 'weird' }, verdict: 'supported', factuality: 0.9, confidence: 0.9, feedback: 'ok' })).toBeNull()
    expect(parseFactCheckResult({ status: 'completed', moderation: { decision: 'allow' }, verdict: 'weird', factuality: 0.9, confidence: 0.9, feedback: 'ok' })).toBeNull()
    expect(parseFactCheckResult({ status: 'completed', moderation: { decision: 'allow' }, verdict: 'supported', factuality: 1.1, confidence: 0.9, feedback: 'ok' })).toBeNull()
    expect(parseFactCheckResult({ status: 'completed', moderation: { decision: 'allow' }, verdict: 'supported', factuality: 0.9, confidence: Number.NaN, feedback: 'ok' })).toBeNull()
    expect(parseFactCheckResult({ status: 'completed', moderation: { decision: 'allow' }, verdict: 'supported', factuality: 0.9, confidence: 0.9 })).toBeNull()
  })
  it('接受權威 response 的完整欄位與 null blocked 分數', () => {
    expect(parseFactCheckResult({ ...allowed })).toMatchObject({ status: 'completed', verdict: 'mostly_supported' })
    expect(parseFactCheckResult({ status: 'blocked', moderation: { decision: 'block' }, verdict: null, factuality: null, confidence: null, feedback: 'blocked' })).toMatchObject({
      status: 'blocked',
      verdict: null,
    })
  })
})
describe('事實查核錯誤分類', () => {
  const upstreamBody = { status: 'error', error: 'UPSTREAM_UNAVAILABLE', message: '上游訊息' }
  it('200 與 503 的相同 JSON body 都分類為上游故障', async () => {
    const responses = [
      new Response(JSON.stringify(upstreamBody), { status: 200 }),
      new Response(JSON.stringify(upstreamBody), { status: 503 }),
    ]
    for (const response of responses) {
      expect(factCheckErrorKind(await response.json())).toBe('upstream_unavailable')
    }
  })
  it('普通 error 與非 JSON 維持 generic', () => {
    expect(factCheckErrorKind({ status: 'error', error: 'INVALID_INPUT' })).toBe('generic')
    expect(factCheckErrorKind('<html>bad gateway</html>')).toBe('generic')
  })
})
