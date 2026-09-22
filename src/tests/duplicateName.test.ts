import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { registerAuthRoutes } from '../api/auth'
import { hasDuplicateDisplayName } from '../auth/authorization'

const authState = vi.hoisted(() => ({
  session: {
    user: {
      id: 'user-1',
      name: '原名稱',
      email: 'user@example.com',
      image: null,
      role: 'user',
      banned: false,
    },
  },
  handler: vi.fn(async (request: Request) => Response.json({ body: await request.json() })),
}))

vi.mock('../auth/createAuth', () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: vi.fn(async () => authState.session) },
    handler: authState.handler,
  })),
}))

function testApp() {
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  registerAuthRoutes(app as never)
  return app
}

function testEnv(duplicate = true) {
  return {
    DB_AUTH: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (sql.includes('SELECT "name", "nameChangedAt"')) return { name: '原名稱', nameChangedAt: null }
            if (sql.includes('SELECT "nameChangedAt"')) return { nameChangedAt: null }
            return { hasDuplicateDisplayName: duplicate ? 1 : 0 }
          }),
        })),
      })),
    },
  } as never
}

type AuthUserRow = {
  id: string
  name: string
  banned: number | null
  banExpires: string | null
}

function sqliteAuthDb(users: AuthUserRow[]) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "banned" INTEGER, "banExpires" TEXT)')
  const insert = sqlite.prepare('INSERT INTO "user" ("id", "name", "banned", "banExpires") VALUES (?, ?, ?, ?)')
  for (const user of users) insert.run(user.id, user.name, user.banned, user.banExpires)

  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              return sqlite.prepare(query).get(...(values as (string | number | null)[]))
            },
          }
        },
      }
    },
  } as unknown as D1Database
  return { db, sqlite }
}

const requestInit = (confirmDuplicateName = false) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '  王小明  ', confirm_duplicate_name: confirmDuplicateName }),
})

describe('同名顯示名稱', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('/api/me 公開目前的同名狀態，供投稿表單說明 email 公開規則', async () => {
    const response = await testApp().request('/api/me', undefined, testEnv())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ hasDuplicateDisplayName: true })
  })

  it('每次查詢都使用 auth DB 當下名稱，不依賴本人是否改名', async () => {
    const { db, sqlite } = sqliteAuthDb([
      { id: 'user-1', name: '王小明', banned: 0, banExpires: null },
      { id: 'user-2', name: '其他名稱', banned: 0, banExpires: null },
    ])

    await expect(hasDuplicateDisplayName(db, 'user-1', '王小明')).resolves.toBe(false)
    sqlite.prepare('UPDATE "user" SET "name" = ? WHERE "id" = ?').run('王小明', 'user-2')
    await expect(hasDuplicateDisplayName(db, 'user-1', '王小明')).resolves.toBe(true)
  })

  it('永久停權與有效暫時停權不占位，已過期暫時停權重新占位', async () => {
    const self = { id: 'user-1', name: '王小明', banned: 0, banExpires: null }
    const permanent = sqliteAuthDb([self, { id: 'user-2', name: '王小明', banned: 1, banExpires: null }])
    const activeTemporary = sqliteAuthDb([self, { id: 'user-2', name: '王小明', banned: 1, banExpires: '2099-01-01T00:00:00.000Z' }])
    const expiredTemporary = sqliteAuthDb([self, { id: 'user-2', name: '王小明', banned: 1, banExpires: '2000-01-01T00:00:00.000Z' }])

    await expect(hasDuplicateDisplayName(permanent.db, 'user-1', '王小明')).resolves.toBe(false)
    await expect(hasDuplicateDisplayName(activeTemporary.db, 'user-1', '王小明')).resolves.toBe(false)
    await expect(hasDuplicateDisplayName(expiredTemporary.db, 'user-1', '王小明')).resolves.toBe(true)
  })

  it('改成已使用的名稱時先回 409，未確認前不寫入', async () => {
    const response = await testApp().request('/api/auth/update-user', requestInit(), testEnv())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'DUPLICATE_DISPLAY_NAME' })
    expect(authState.handler).not.toHaveBeenCalled()
  })

  it('使用者確認後允許同名，並只把正規化名稱交給 Better Auth', async () => {
    const response = await testApp().request('/api/auth/update-user', requestInit(true), testEnv())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ body: { name: '王小明' } })
    expect(authState.handler).toHaveBeenCalledOnce()
  })
})
