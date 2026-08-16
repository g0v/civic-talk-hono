import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as db from '../db/queries'
import { registerApiRoutes } from '../api/routes'
import { moderateSubmission } from '../moderation/service'

const moderationState = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1', name: 'User One', email: 'user@example.com', image: null },
    role: 'user' as const,
    banned: false,
    nameChangeCooldownDays: null,
  },
  pendingFreeze: false,
  violationCount: 1,
  reportCount: 0,
  recommendationCount: 0,
  publicIssueRows: 0,
}))

vi.mock('../auth/authorization', () => ({
  isAdminRole: (role: string) => role === 'admin' || role === 'super-admin',
  tryGetAuthContext: vi.fn(async () => moderationState.auth),
}))

vi.mock('../auth/createAuth', () => ({
  createAuth: vi.fn(() => ({ api: {} })),
}))

vi.mock('../moderation/service', () => ({
  moderateSubmission: vi.fn(async () => ({
    outcome: 'violation',
    policy_code: 'hate_speech',
    rationale: '針對特定個人的侮辱',
    confidence: 1,
  })),
  moderationReasonForPolicy: vi.fn(() => 'hate_speech'),
}))

vi.mock('../db/queries', () => ({
  hasPendingSuspensionRecommendation: vi.fn(async () => moderationState.pendingFreeze),
  createAiModerationReport: vi.fn(async () => {
    moderationState.reportCount += 1
    return moderationState.reportCount
  }),
  countRecentAiViolations: vi.fn(async () => moderationState.violationCount),
  createSuspensionRecommendation: vi.fn(async () => {
    moderationState.recommendationCount += 1
    moderationState.pendingFreeze = true
    return moderationState.recommendationCount
  }),
  createIssue: vi.fn(async () => {
    moderationState.publicIssueRows += 1
    return moderationState.publicIssueRows
  }),
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
    moderationState.pendingFreeze = false
    moderationState.violationCount = 1
    moderationState.reportCount = 0
    moderationState.recommendationCount = 0
    moderationState.publicIssueRows = 0
    vi.clearAllMocks()
  })

  it('returns 422 for a violation without writing a public issue row', async () => {
    const response = await testApp().request('/api/issues', { method: 'POST', body: issueBody() }, env)

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: 'Submission rejected by community guidelines',
      moderation: { policy_code: 'hate_speech' },
      appeal_allowed: true,
    })
    expect(vi.mocked(db.createIssue)).not.toHaveBeenCalled()
    expect(moderationState.publicIssueRows).toBe(0)
  })

  it('creates a suspension recommendation on the third violation and blocks the next submission with 403', async () => {
    const app = testApp()
    const submit = () => app.request('/api/issues', { method: 'POST', body: issueBody() }, env)

    expect((await submit()).status).toBe(422)
    moderationState.violationCount = 2
    expect((await submit()).status).toBe(422)
    moderationState.violationCount = 3
    expect((await submit()).status).toBe(422)
    expect(moderationState.recommendationCount).toBe(1)

    const nextSubmission = await submit()
    expect(nextSubmission.status).toBe(403)
    expect(await nextSubmission.json()).toEqual({ error: 'Forbidden: submissions are suspended pending moderation review' })
    expect(vi.mocked(db.createSuspensionRecommendation)).toHaveBeenCalledTimes(1)
  })
})
