import { describe, expect, it } from 'vite-plus/test'
import { countRecentAiViolations, createModerationAppeal, createSuspensionRecommendation, hasPendingSuspensionRecommendation, resolveModerationAppeal, resolveSuspensionRecommendation } from '../db/queries'

type FakeReport = { userId: string; source: string; createdAt: string }
type FakeRecommendation = {
  id: number
  user_id: string
  user_name: string | null
  user_email: string
  violation_count: number
  window_started_at: string
  status: 'pending' | 'confirmed' | 'dismissed'
}
type FakeAppeal = {
  id: number
  user_id: string
  user_name: string | null
  user_email: string
  abuse_report_id: number | null
  appeal_type: 'rejected_submission' | 'automatic_ban'
  content_snapshot: string | null
  message: string
  status: 'pending' | 'upheld' | 'overturned'
}

function fakeDb() {
  const reports: FakeReport[] = []
  const recommendations: FakeRecommendation[] = []
  const appeals: FakeAppeal[] = []
  let nextId = 1

  const db = {
    prepare(sql: string) {
      let args: unknown[] = []
      const statement = {
        bind(...values: unknown[]) {
          args = values
          return statement
        },
        async first<T>() {
          if (sql.includes("source = 'ai'")) {
            const userId = String(args[0])
            const now = args.length >= 3 ? new Date(String(args[1])) : new Date('2026-08-16T10:00:00Z')
            const lower = now.getTime() - 60 * 60 * 1000
            const count = reports.filter(report => report.source === 'ai' && report.userId === userId && new Date(report.createdAt).getTime() >= lower && new Date(report.createdAt).getTime() <= now.getTime()).length
            return { cnt: count } as T
          }
          if (sql.includes('ct_moderation_suspension_recommendations') && sql.includes("status = 'pending'")) {
            const recommendation = recommendations.find(item => item.user_id === String(args[0]) && item.status === 'pending')
            if (sql.includes('SELECT 1 AS found')) return (recommendation ? { found: 1 } : null) as T
            return (recommendation ?? null) as T
          }
          if (sql.includes('ct_moderation_appeals') && sql.includes('abuse_report_id = ?')) {
            const count = appeals.filter(item => item.user_id === String(args[0]) && item.abuse_report_id === Number(args[1]) && item.status === 'pending').length
            return { cnt: count } as T
          }
          if (sql.includes('ct_moderation_appeals') && sql.includes('appeal_type = ?')) {
            const count = appeals.filter(item => item.user_id === String(args[0]) && item.appeal_type === args[1] && item.status === 'pending').length
            return { cnt: count } as T
          }
          return null
        },
        async run() {
          if (sql.startsWith('INSERT INTO ct_moderation_suspension_recommendations')) {
            recommendations.push({ id: nextId++, user_id: String(args[0]), user_name: (args[1] as string | null) ?? null, user_email: String(args[2]), violation_count: Number(args[3]), window_started_at: String(args[4]), status: 'pending' })
          } else if (sql.startsWith('INSERT INTO ct_moderation_appeals')) {
            appeals.push({ id: nextId++, user_id: String(args[0]), user_name: (args[1] as string | null) ?? null, user_email: String(args[2]), abuse_report_id: (args[3] as number | null) ?? null, appeal_type: args[4] as FakeAppeal['appeal_type'], content_snapshot: (args[5] as string | null) ?? null, message: String(args[6]), status: 'pending' })
          } else if (sql.startsWith('UPDATE ct_moderation_suspension_recommendations SET violation_count')) {
            const recommendation = recommendations.find(item => item.id === Number(args[1]))
            if (recommendation) recommendation.violation_count = Math.max(recommendation.violation_count, Number(args[0]))
          } else if (sql.startsWith('UPDATE ct_moderation_suspension_recommendations SET status')) {
            const recommendation = recommendations.find(item => item.id === Number(args[4]))
            if (recommendation) recommendation.status = args[0] as FakeRecommendation['status']
          } else if (sql.startsWith('UPDATE ct_moderation_appeals SET status')) {
            const appeal = appeals.find(item => item.id === Number(args[4]))
            if (appeal) appeal.status = args[0] as FakeAppeal['status']
          }
          return { meta: { last_row_id: nextId - 1 } }
        },
      }
      return statement
    },
    reports,
    recommendations,
    appeals,
  }
  return db as unknown as D1Database & { reports: FakeReport[]; recommendations: FakeRecommendation[]; appeals: FakeAppeal[] }
}

describe('AI moderation threshold and appeals', () => {
  it('counts the one-hour boundary correctly', async () => {
    const db = fakeDb()
    db.reports.push(
      { userId: 'user-1', source: 'ai', createdAt: '2026-08-16T09:01:00Z' },
      { userId: 'user-1', source: 'ai', createdAt: '2026-08-16T09:30:00Z' },
      { userId: 'user-1', source: 'ai', createdAt: '2026-08-16T09:00:00Z' }
    )

    expect(await countRecentAiViolations(db, 'user-1', '2026-08-16T10:00:00Z')).toBe(3)
    expect(await countRecentAiViolations(db, 'user-2', '2026-08-16T10:00:00Z')).toBe(0)
    db.reports[2].createdAt = '2026-08-16T08:59:00Z'
    expect(await countRecentAiViolations(db, 'user-1', '2026-08-16T10:00:00Z')).toBe(2)
  })

  it('freezes, accepts an appeal, and unfreezes after overturn', async () => {
    const db = fakeDb()
    const recommendationId = await createSuspensionRecommendation(db, {
      user_id: 'user-1',
      user_name: 'User One',
      user_email: 'user@example.com',
      violation_count: 3,
      window_started_at: '2026-08-16T09:00:00Z',
    })
    expect(recommendationId).toBe(1)
    expect(await hasPendingSuspensionRecommendation(db, 'user-1')).toBe(true)

    const appealId = await createModerationAppeal(db, {
      user_id: 'user-1',
      user_name: 'User One',
      user_email: 'user@example.com',
      abuse_report_id: null,
      appeal_type: 'automatic_ban',
      content_snapshot: null,
      message: '這些判定是誤判，請複核。',
    })
    expect(appealId).toBe(2)
    await resolveModerationAppeal(db, appealId, 'overturned', { id: 'admin-1', name: 'Admin' }, '確認為誤判')
    await resolveSuspensionRecommendation(db, recommendationId, 'dismissed', { id: 'admin-1', name: 'Admin' }, '解除凍結')

    // 下一次 requireSubmissionUser 會看到 false，因此使用者可以重新投稿。
    expect(await hasPendingSuspensionRecommendation(db, 'user-1')).toBe(false)
  })
})
