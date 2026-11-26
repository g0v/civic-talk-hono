import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { buildClairicCandidateRequest } from '../ai/extractionCandidate'
import { MODEL_SELECTORS } from '../ai/models'
import { estimateCall } from '../ai/pricing'
import { sha256 } from '../ai/source'
import { P1AcceptanceError, parseP1AcceptanceInput, runP1Acceptance, type P1AcceptanceInput } from '../ai/p1Acceptance'

const content = '自學團體籲補助國中小自學生 全教總：對「偽自學」產生巨大誘因'
const account = '1234567890abcdef1234567890abcdef'
const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true })
})

async function setup(): Promise<{ directory: string; input: P1AcceptanceInput }> {
  const directory = await mkdtemp(join(tmpdir(), 'p1-acceptance-test-'))
  directories.push(directory)
  const request = buildClairicCandidateRequest(content)
  const input: P1AcceptanceInput = {
    content,
    operator: { account_id: account, ai_write: true },
    grant: {
      id: 'explicit-test-grant',
      account_id: account,
      source: `source:${await sha256(content)}`,
      request: `request:${await sha256(JSON.stringify(request))}`,
      estimate_micro_usd: estimateCall(MODEL_SELECTORS.clairic, request.input),
      authorized_at: '2026-11-18T00:00:00.000Z',
    },
  }
  return {
    directory,
    input: parseP1AcceptanceInput(JSON.parse(JSON.stringify(input))),
  }
}

describe('P1 操作者單次驗收', () => {
  it('JSON權限字串不能冒充已核對的布林權限', async () => {
    const { input } = await setup()

    expect(() => parseP1AcceptanceInput({ ...input, operator: { account_id: account, ai_write: 'true' } })).toThrow(P1AcceptanceError)
  })

  it('併發與後續重入都只dispatch一次，並以私人檔案保留收到的結果', async () => {
    const { directory, input } = await setup()
    let calls = 0
    const provider = async () => {
      calls++
      return { model: 'clairic', usage: { input_tokens: 100, output_tokens: 0 } }
    }

    const results = await Promise.allSettled([runP1Acceptance(input, directory, provider), runP1Acceptance(input, directory, provider)])

    expect(calls).toBe(1)
    expect(results).toEqual(expect.arrayContaining([
      { status: 'fulfilled', value: { status: 'already_attempted' } },
      { status: 'fulfilled', value: expect.objectContaining({ status: 'received' }) },
    ]))
    await expect(runP1Acceptance(input, directory, provider)).resolves.toEqual({ status: 'already_attempted' })
    expect(calls).toBe(1)
    const received = JSON.parse(await readFile(join(directory, 'response.json'), 'utf8'))
    expect(received.usage_state).toBe('settled')
    expect(received.reserved_micro_usd).toBe(0)
    expect((await stat(join(directory, 'attempt.json'))).mode & 0o777).toBe(0o600)
  })

  it('provider例外保留unknown預留，重新進入不能重打', async () => {
    const { directory, input } = await setup()
    let calls = 0
    const provider = async () => {
      calls++
      throw new TypeError('transport failed')
    }

    const result = await runP1Acceptance(input, directory, provider)
    const resumed = await runP1Acceptance(input, directory, provider)

    expect(result).toEqual({ status: 'provider_uncertain' })
    expect(resumed).toEqual({ status: 'already_attempted' })
    expect(calls).toBe(1)
    const receipt = JSON.parse(await readFile(join(directory, 'uncertain.json'), 'utf8'))
    expect({ state: receipt.state, reserved: receipt.reserved_micro_usd, actual: receipt.actual_micro_usd }).toEqual({
      state: 'unknown', reserved: input.grant.estimate_micro_usd, actual: null,
    })
  })

  it('缺usage仍保存原回應並保留unknown預留', async () => {
    const { directory, input } = await setup()

    const result = await runP1Acceptance(input, directory, async () => ({ model: 'clairic' }))

    expect(result).toEqual({ status: 'received', actual_micro_usd: null })
    const receipt = JSON.parse(await readFile(join(directory, 'response.json'), 'utf8'))
    expect({ state: receipt.usage_state, reserved: receipt.reserved_micro_usd }).toEqual({
      state: 'unknown', reserved: input.grant.estimate_micro_usd,
    })
  })

  it.each([
    { name: '來源', change: (input: P1AcceptanceInput) => ({ ...input, content: content + '改動' }), code: 'request_changed' },
    { name: '帳號', change: (input: P1AcceptanceInput) => ({ ...input, operator: { account_id: 'f'.repeat(32), ai_write: true } }), code: 'authorization_mismatch' },
    { name: 'AI權限', change: (input: P1AcceptanceInput) => ({ ...input, operator: { account_id: account, ai_write: false } }), code: 'authorization_mismatch' },
    { name: '請求指紋', change: (input: P1AcceptanceInput) => ({ ...input, grant: { ...input.grant, request: 'request:changed' as const } }), code: 'request_changed' },
  ])('$name 與核可grant不符時不dispatch，也不消耗grant', async ({ change, code }) => {
    const { directory, input } = await setup()
    let calls = 0

    await expect(runP1Acceptance(change(input), directory, async () => { calls++; return null })).rejects.toMatchObject({ code })

    expect(calls).toBe(0)
    await expect(readFile(join(directory, 'attempt.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
