import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as db from '../db/queries'
import { registerApiRoutes } from '../api/routes'
import * as authorization from '../auth/authorization'
import * as moderation from '../moderation/service'

const moderationState = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1', name: 'User One', email: 'user@example.com', image: null },
    role: 'user' as const,
    banned: false,
    nameChangeCooldownDays: null,
    duplicateName: false,
  },
  reportCount: 0,
  issueCount: 0,
}))

vi.mock('../auth/authorization', () => ({
  hasDuplicateDisplayName: vi.fn(async () => moderationState.auth.duplicateName),
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
  tryGetAuthContext: vi.fn(async () => moderationState.auth),
}))

vi.mock('../auth/createAuth', () => ({ createAuth: vi.fn(() => ({ api: {} })) }))

vi.mock('../moderation/service', () => ({
  moderateSubmission: vi.fn(async () => ({ outcome: 'violation', policy_code: 'hate_speech', rationale: '針對特定個人的侮辱', confidence: 1 })),
  moderationReasonForPolicy: vi.fn(() => 'hate_speech'),
}))

vi.mock('../db/queries', () => ({
  createAiModerationReport: vi.fn(async () => ++moderationState.reportCount),
  createIssue: vi.fn(async () => ++moderationState.issueCount),
  createMaterial: vi.fn(async () => 1),
  createBriefing: vi.fn(async () => 1),
  getBriefingIdByVersion: vi.fn(async () => 1),
  createOpinion: vi.fn(async () => 1),
  getIssue: vi.fn(async () => ({ id: 1 })),
}))

function testApp() {
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  registerApiRoutes(app as never)
  return app
}

const env = {
  DB: {} as D1Database,
  DB_AUTH: {} as D1Database,
  OPEN_ROUTER_API_KEY: 'test-key',
  ASSETS: { fetch: vi.fn() },
  BETTER_AUTH_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: 'test-google-id',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  GITHUB_CLIENT_ID: 'test-github-id',
  GITHUB_CLIENT_SECRET: 'test-github-secret',
} as never

function issueBody(title = '公共政策討論'): string {
  return JSON.stringify({ title, description: '內容', terms_accepted: true, show_email: false })
}

describe('moderation submission routes', () => {
  beforeEach(() => {
    moderationState.reportCount = 0
    moderationState.issueCount = 0
    moderationState.auth.duplicateName = false
    vi.mocked(authorization.hasDuplicateDisplayName).mockImplementation(async () => moderationState.auth.duplicateName)
    vi.clearAllMocks()
  })

  it('writes a violation as a hidden issue and returns the normal success shape plus moderation metadata', async () => {
    const response = await testApp().request('/api/issues', { method: 'POST', body: issueBody() }, env)

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id: 1,
      title: '公共政策討論',
      moderation: { hidden: true, policy_code: 'hate_speech', appeal_allowed: true, report_id: 1 },
    })
    expect(vi.mocked(db.createIssue)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: '公共政策討論' }), { moderationHidden: true })
    expect(vi.mocked(db.createAiModerationReport)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ issue_id: 1, material_id: null }))
    const duplicateChecks = vi.mocked(authorization.hasDuplicateDisplayName).mock.invocationCallOrder
    expect(duplicateChecks).toHaveLength(2)
    expect(duplicateChecks[0]).toBeLessThan(vi.mocked(moderation.moderateSubmission).mock.invocationCallOrder[0]!)
    expect(vi.mocked(moderation.moderateSubmission).mock.invocationCallOrder[0]).toBeLessThan(duplicateChecks[1]!)
    expect(duplicateChecks[1]).toBeLessThan(vi.mocked(db.createIssue).mock.invocationCallOrder[0]!)
  })

  it('同名投稿未明確同意公開 email 時，四個入口都回 409 且不寫入', async () => {
    moderationState.auth.duplicateName = true
    const headers = { 'Content-Type': 'application/json' }
    const responses = [
      await testApp().request('/api/issues', { method: 'POST', headers, body: issueBody() }, env),
      await testApp().request('/api/issues/1/materials', { method: 'POST', headers, body: JSON.stringify({ content: '足夠長的素材內容', terms_accepted: true, show_email: false }) }, env),
      await testApp().request('/api/issues/1/briefing', { method: 'POST', headers, body: JSON.stringify({ consensus: '共識', show_email: false }) }, env),
      await testApp().request('/api/issues/1/opinions', { method: 'POST', headers, body: JSON.stringify({ summary: '這是一段意見摘要', terms_accepted: true, show_email: false }) }, env),
    ]

    expect(responses.map(response => response.status)).toEqual([409, 409, 409, 409])
    await Promise.all(responses.map(response => expect(response.json()).resolves.toEqual({ code: 'DUPLICATE_NAME_EMAIL_REQUIRED' })))
    expect(db.createIssue).not.toHaveBeenCalled()
    expect(db.createMaterial).not.toHaveBeenCalled()
    expect(db.createBriefing).not.toHaveBeenCalled()
    expect(db.createOpinion).not.toHaveBeenCalled()
    expect(moderation.moderateSubmission).not.toHaveBeenCalled()
    expect(authorization.hasDuplicateDisplayName).toHaveBeenCalledTimes(4)
  })

  it('預檢後才出現同名時，四個入口都在寫入前的最終重查擋下', async () => {
    let checkCount = 0
    vi.mocked(authorization.hasDuplicateDisplayName).mockImplementation(async () => ++checkCount % 2 === 0)
    const headers = { 'Content-Type': 'application/json' }
    const responses = [
      await testApp().request('/api/issues', { method: 'POST', headers, body: issueBody() }, env),
      await testApp().request('/api/issues/1/materials', { method: 'POST', headers, body: JSON.stringify({ content: '足夠長的素材內容', terms_accepted: true, show_email: false }) }, env),
      await testApp().request('/api/issues/1/briefing', { method: 'POST', headers, body: JSON.stringify({ consensus: '共識', show_email: false }) }, env),
      await testApp().request('/api/issues/1/opinions', { method: 'POST', headers, body: JSON.stringify({ summary: '這是一段意見摘要', terms_accepted: true, show_email: false }) }, env),
    ]

    expect(responses.map(response => response.status)).toEqual([409, 409, 409, 409])
    expect(authorization.hasDuplicateDisplayName).toHaveBeenCalledTimes(8)
    expect(moderation.moderateSubmission).toHaveBeenCalledTimes(4)
    expect(db.createIssue).not.toHaveBeenCalled()
    expect(db.createMaterial).not.toHaveBeenCalled()
    expect(db.createBriefing).not.toHaveBeenCalled()
    expect(db.createOpinion).not.toHaveBeenCalled()
  })

  it('同名投稿明確指定公開 email 後，四個入口都正常寫入公開快照', async () => {
    moderationState.auth.duplicateName = true
    const headers = { 'Content-Type': 'application/json' }
    const responses = [
      await testApp().request('/api/issues', { method: 'POST', headers, body: JSON.stringify({ title: '公共政策討論', description: '內容', terms_accepted: true, show_email: true }) }, env),
      await testApp().request('/api/issues/1/materials', { method: 'POST', headers, body: JSON.stringify({ content: '足夠長的素材內容', terms_accepted: true, show_email: true }) }, env),
      await testApp().request('/api/issues/1/briefing', { method: 'POST', headers, body: JSON.stringify({ consensus: '共識', show_email: true }) }, env),
      await testApp().request('/api/issues/1/opinions', { method: 'POST', headers, body: JSON.stringify({ summary: '這是一段意見摘要', terms_accepted: true, show_email: true }) }, env),
    ]

    expect(responses.map(response => response.status)).toEqual([201, 201, 201, 201])
    expect(vi.mocked(db.createIssue).mock.calls[0]?.[1]).toEqual(expect.objectContaining({ show_email: true }))
    expect(vi.mocked(db.createMaterial).mock.calls[0]?.[2]).toEqual(expect.objectContaining({ show_email: true }))
    expect(vi.mocked(db.createBriefing).mock.calls[0]?.[2]).toEqual(expect.objectContaining({ show_email: true }))
    expect(vi.mocked(db.createOpinion).mock.calls[0]?.[2]).toEqual(expect.objectContaining({ show_email: true }))
    expect(authorization.hasDuplicateDisplayName).not.toHaveBeenCalled()
  })
})
