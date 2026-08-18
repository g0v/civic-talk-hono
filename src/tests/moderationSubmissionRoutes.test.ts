import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as db from '../db/queries'
import { registerApiRoutes } from '../api/routes'

const moderationState = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1', name: 'User One', email: 'user@example.com', image: null },
    role: 'user' as const,
    banned: false,
    nameChangeCooldownDays: null,
  },
  reportCount: 0,
  issueCount: 0,
}))

vi.mock('../auth/authorization', () => ({
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
  })
})
