import { describe, expect, it } from 'vite-plus/test'
import { buildAuthorSnapshot, canReadAdminSnapshots, validateSubmissionOptions } from '../api/routes'
import type { AuthContext } from '../auth/authorization'
import { getLatestBriefing, getLatestBriefingWithAuthor, listIssues, listIssuesWithAuthor, listMaterials, listOpinions } from '../db/queries'

function recordingDb() {
  const sql: string[] = []
  const statement = {
    bind() {
      return statement
    },
    async all() {
      return { results: [] }
    },
    async first() {
      return null
    },
  }
  return {
    sql,
    db: {
      prepare(query: string) {
        sql.push(query)
        return statement
      },
    } as unknown as D1Database,
  }
}

describe('作者資料隱私守護', () => {
  it('只有未停權的管理員可讀取完整作者快照', () => {
    const admin = {
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com', image: null },
      role: 'admin',
      banned: false,
      nameChangeCooldownDays: null,
    } satisfies AuthContext
    const bannedAdmin = { ...admin, banned: true }

    expect(canReadAdminSnapshots(admin)).toBe(true)
    expect(canReadAdminSnapshots(bannedAdmin)).toBe(false)
    expect(canReadAdminSnapshots({ ...admin, role: 'user' })).toBe(false)
    expect(canReadAdminSnapshots(null)).toBe(false)
  })

  it('名稱缺漏時不以 email 代替公開名稱', () => {
    const user = {
      id: 'user-1',
      name: '   ',
      email: 'private@example.com',
    } as AuthContext['user']

    expect(buildAuthorSnapshot(user, false)).toEqual({
      author_id: 'user-1',
      author_name: null,
      author_email: 'private@example.com',
      show_email: false,
    })
  })

  it('伺服器端要求條款同意並嚴格驗證 show_email', async () => {
    const missingConsent = validateSubmissionOptions({ show_email: false })
    expect(missingConsent?.status).toBe(400)
    await expect(missingConsent?.json()).resolves.toEqual({ error: 'terms_accepted must be true' })

    const invalidVisibility = validateSubmissionOptions({ terms_accepted: true, show_email: 1 })
    expect(invalidVisibility?.status).toBe(400)
    await expect(invalidVisibility?.json()).resolves.toEqual({ error: 'show_email must be a boolean' })

    expect(validateSubmissionOptions({ terms_accepted: true, show_email: true })).toBeNull()
  })

  it('公開查詢只透過 show_email 條件投影 email，且不讀取 author_id', async () => {
    const { db, sql } = recordingDb()

    await listIssues(db)
    await listMaterials(db, 1)
    await listOpinions(db, 1)
    await getLatestBriefing(db, 1)

    expect(sql).toHaveLength(4)
    for (const query of sql) {
      expect(query).toContain('CASE WHEN show_email = 1 THEN author_email ELSE NULL END AS author_email')
      expect(query).not.toContain('author_id')
      expect(query).not.toMatch(/SELECT\s+\*/i)
    }
  })

  it('管理端查詢取得完整作者快照', async () => {
    const { db, sql } = recordingDb()

    await listIssuesWithAuthor(db)

    expect(sql[0]).toContain('author_id, author_name, author_email, show_email')
    expect(sql[0]).toContain('terms_version, terms_accepted_at')
  })

  it('briefing 公開查詢只投影名稱與 opt-in email，管理端才取得完整快照', async () => {
    const { db, sql } = recordingDb()

    await getLatestBriefing(db, 1)
    await getLatestBriefingWithAuthor(db, 1)

    expect(sql[0]).toContain('CASE WHEN show_email = 1 THEN author_email ELSE NULL END AS author_email')
    expect(sql[0]).not.toContain('author_id')
    expect(sql[1]).toContain('author_id, author_name, author_email, show_email')
  })
})
