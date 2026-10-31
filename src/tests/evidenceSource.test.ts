import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { inspectSource, MAX_MATERIAL_BYTES, readSourceInput, sha256, SourceInputError } from '../ai/source'

let sqlite: DatabaseSync
let db: D1Database

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE ct_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, abuse_flagged INTEGER, author_id TEXT, author_email TEXT);
    CREATE TABLE ct_materials (id INTEGER PRIMARY KEY, issue_id INTEGER, source_name TEXT, source_url TEXT, content TEXT, abuse_flagged INTEGER, author_id TEXT, author_email TEXT);
    INSERT INTO ct_issues VALUES (7, '議題', '說明', 0, 'private-id', 'private@example.test');
    INSERT INTO ct_materials VALUES (2, 7, '甲', 'https://example.test/', '第一句。\r\nEmoji😀條件！', 0, 'private-id', 'private@example.test');
    INSERT INTO ct_materials VALUES (3, 7, '乙', NULL, '已隱藏', 3, 'private-id', 'private@example.test');
    INSERT INTO ct_materials VALUES (4, 7, '丙', NULL, '第三句。', 0, 'private-id', 'private@example.test');
  `)
  db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      return {
        bind(...values: SQLInputValue[]) {
          return {
            async first<T>() { return (statement.get(...values) ?? null) as T | null },
            async all<T>() { return { results: statement.all(...values) as T[] } },
          }
        },
      }
    },
  } as unknown as D1Database
})

afterEach(() => sqlite.close())

describe('唯讀來源快照', () => {
  it('白名單投影、穩定排序、原始 UTF-8 hash 且不修改來源資料', async () => {
    const before = sqlite.prepare('SELECT * FROM ct_materials ORDER BY id').all()
    const input = await readSourceInput(db, 7, [4, 2])
    expect(input.materials.map(item => item.id)).toEqual([2, 4])
    expect(input.exclusions).toEqual([{ id: 3, reason: 'hidden' }])
    expect(input.materials[0].content).toBe('第一句。\r\nEmoji😀條件！')
    expect(input.materials[0].content_hash).toBe(await sha256('第一句。\r\nEmoji😀條件！'))
    expect(JSON.stringify(input)).not.toContain('private-id')
    expect(JSON.stringify(input)).not.toContain('private@example.test')
    expect(sqlite.prepare('SELECT * FROM ct_materials ORDER BY id').all()).toEqual(before)
  })

  it('對隱藏、刪除、變更及查核失敗不沿用舊內容', async () => {
    const input = await readSourceInput(db, 7, [2])
    const material = input.sources[1]
    expect(await inspectSource(db, 'material', 2, material.hash)).toEqual({ status: 'valid', hash: material.hash })
    sqlite.prepare('UPDATE ct_materials SET content = ? WHERE id = 2').run('變更後')
    expect((await inspectSource(db, 'material', 2, material.hash)).status).toBe('withdrawn')
    sqlite.prepare('UPDATE ct_materials SET abuse_flagged = 3 WHERE id = 2').run()
    expect(await inspectSource(db, 'material', 2, material.hash)).toEqual({ status: 'withdrawn', hash: null })
    sqlite.prepare('DELETE FROM ct_materials WHERE id = 2').run()
    expect(await inspectSource(db, 'material', 2, material.hash)).toEqual({ status: 'deleted', hash: null })
    await expect(inspectSource({ prepare() { throw new Error('offline') } } as unknown as D1Database, 'material', 2, material.hash)).rejects.toThrow()
  })

  it('不得選入隱藏素材，並在任何推論前拒絕單份過大', async () => {
    await expect(readSourceInput(db, 7, [3])).rejects.toMatchObject({ code: 'material_unavailable', status: 422 })
    sqlite.prepare('UPDATE ct_materials SET content = ? WHERE id = 2').run('a'.repeat(MAX_MATERIAL_BYTES + 1))
    await expect(readSourceInput(db, 7, [2])).rejects.toBeInstanceOf(SourceInputError)
    await expect(readSourceInput(db, 7, [2])).rejects.toMatchObject({ code: 'material_too_large' })
  })
})
