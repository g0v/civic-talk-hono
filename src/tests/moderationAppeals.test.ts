import { describe, expect, it } from 'vite-plus/test'
import { createModerationAppeal, resolveModerationAppeal } from '../db/queries'

type FakeAppeal = {
  id: number
  user_id: string
  user_name: string | null
  user_email: string
  abuse_report_id: number | null
  appeal_type: 'rejected_submission' | 'account_ban'
  content_snapshot: string | null
  message: string
  status: 'pending' | 'upheld' | 'overturned'
}

function fakeDb() {
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
          if (sql.includes('abuse_report_id = ?')) {
            const count = appeals.filter(item => item.user_id === String(args[0]) && item.abuse_report_id === Number(args[1]) && item.status === 'pending').length
            return { cnt: count } as T
          }
          if (sql.includes('appeal_type = ?')) {
            const count = appeals.filter(item => item.user_id === String(args[0]) && item.appeal_type === args[1] && item.status === 'pending').length
            return { cnt: count } as T
          }
          return null
        },
        async run() {
          if (sql.startsWith('INSERT INTO ct_moderation_appeals')) {
            appeals.push({ id: nextId++, user_id: String(args[0]), user_name: (args[1] as string | null) ?? null, user_email: String(args[2]), abuse_report_id: (args[3] as number | null) ?? null, appeal_type: args[4] as FakeAppeal['appeal_type'], content_snapshot: (args[5] as string | null) ?? null, message: String(args[6]), status: 'pending' })
          } else if (sql.startsWith('UPDATE ct_moderation_appeals SET status')) {
            const appeal = appeals.find(item => item.id === Number(args[4]))
            if (appeal) appeal.status = args[0] as FakeAppeal['status']
          }
          return { meta: { last_row_id: nextId - 1 } }
        },
      }
      return statement
    },
    appeals,
  }
  return db as unknown as D1Database & { appeals: FakeAppeal[] }
}

describe('moderation appeals', () => {
  it('accepts an account-ban appeal and records the overturned result', async () => {
    const db = fakeDb()
    const appealId = await createModerationAppeal(db, {
      user_id: 'user-1',
      user_name: 'User One',
      user_email: 'user@example.com',
      abuse_report_id: null,
      appeal_type: 'account_ban',
      content_snapshot: null,
      message: '請複核帳號停權處置。',
    })
    expect(appealId).toBe(1)
    await resolveModerationAppeal(db, appealId, 'overturned', { id: 'admin-1', name: 'Admin' }, '確認為誤判')
    expect(db.appeals[0]?.status).toBe('overturned')
  })
})
