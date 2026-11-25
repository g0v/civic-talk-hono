import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vite-plus/test'

const migrations = new URL('../../migrations/', import.meta.url)
const germanMigration = '0021_opinion_synthesis_german.sql'
const previousAttempt = {
  issue_id: 24001,
  language: 'ja',
  revision: 'existing',
  started_at: 10,
  reserved_micro_usd: 20,
  dispatched_at: 11,
  model_started_at: 12,
  generated_at: 13,
  report: '{"sections":[]}',
}

function migrateExistingDatabase(db: DatabaseSync) {
  for (const name of readdirSync(migrations)
    .filter(name => name.endsWith('.sql') && name < germanMigration)
    .sort()) {
    db.exec(readFileSync(new URL(name, migrations), 'utf8'))
  }
  db.exec("INSERT INTO ct_issues (id, title) VALUES (24001, 'Fixture'); INSERT INTO ct_opinions (id, issue_id, summary) VALUES (24001, 24001, 'Source');")
  db.prepare(`INSERT INTO ct_opinion_synthesis_attempts
    (issue_id, language, revision, started_at, reserved_micro_usd, dispatched_at, model_started_at, generated_at, report)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(previousAttempt))
  db.exec('INSERT INTO ct_opinion_synthesis_sources (issue_id, version) VALUES (24001, 7)')
  db.exec(readFileSync(new URL(germanMigration, migrations), 'utf8'))
}

describe('德文意見綜整 migration', () => {
  it('保留既有報告、工作紀錄與來源版本，德文可使用獨立快取鍵', () => {
    const db = new DatabaseSync(':memory:')
    try {
      migrateExistingDatabase(db)

      expect(db.prepare('SELECT * FROM ct_opinion_synthesis_attempts WHERE language = ?').get('ja')).toEqual(previousAttempt)
      expect(db.prepare('SELECT version FROM ct_opinion_synthesis_sources WHERE issue_id = 24001').get()).toEqual({ version: 7 })
      const insert = db.prepare(`INSERT INTO ct_opinion_synthesis_attempts
        (issue_id, language, revision, started_at, reserved_micro_usd) VALUES (24001, ?, 'existing', 30, 20)`)
      expect(insert.run('de').changes).toBe(1)
      expect(() => insert.run('de')).toThrow(/UNIQUE constraint/)
      expect(() => insert.run('fr')).toThrow(/CHECK constraint/)
    } finally {
      db.close()
    }
  })

  it.each([
    ['修改意見', "UPDATE ct_opinions SET summary = 'Changed' WHERE id = 24001"],
    ['移除意見', 'DELETE FROM ct_opinions WHERE id = 24001'],
    ['隱藏議題', 'UPDATE ct_issues SET abuse_flagged = 3 WHERE id = 24001'],
    ['移除議題', 'DELETE FROM ct_issues WHERE id = 24001'],
  ])('%s 時清除所有相關語言的報告，但保留預留紀錄', (_action, sql) => {
    const db = new DatabaseSync(':memory:')
    try {
      migrateExistingDatabase(db)
      db.prepare(`INSERT INTO ct_opinion_synthesis_attempts
        (issue_id, language, revision, started_at, reserved_micro_usd, report)
        VALUES (24001, 'de', 'new', 30, 40, ?), (24002, 'de', 'unrelated', 31, 50, ?)`).run('german', 'unrelated')

      db.exec(sql)

      expect(db.prepare('SELECT issue_id, language, report, reserved_micro_usd FROM ct_opinion_synthesis_attempts ORDER BY issue_id, language').all()).toEqual([
        { issue_id: 24001, language: 'de', report: null, reserved_micro_usd: 40 },
        { issue_id: 24001, language: 'ja', report: null, reserved_micro_usd: 20 },
        { issue_id: 24002, language: 'de', report: 'unrelated', reserved_micro_usd: 50 },
      ])
      // 議題刪除可能同時級聯刪除意見；來源版本只要求前進，不依賴觸發順序。
      expect(db.prepare('SELECT version FROM ct_opinion_synthesis_sources WHERE issue_id = 24001').get()?.version).toBeGreaterThan(7)
    } finally {
      db.close()
    }
  })
})
