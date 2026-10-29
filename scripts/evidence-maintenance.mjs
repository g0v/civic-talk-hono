import { readdirSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { EvidenceStore } from '../src/ai/store.ts'

const root = resolve(fileURLToPath(new URL('../.wrangler/ai-experiment', import.meta.url)))
const namespace = 'vtaiwan-civic-talks'
const [command, ...args] = process.argv.slice(2)

function flags(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    if (!key?.startsWith('--') || !values[index + 1] || Object.hasOwn(result, key)) throw new Error('invalid_arguments')
    result[key] = values[index + 1]
  }
  return result
}

function localDatabase() {
  const realRoot = realpathSync(root)
  const candidates = []
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.sqlite')) candidates.push(path)
    }
  }
  walk(realRoot)
  const matches = []
  for (const candidate of candidates) {
    const real = realpathSync(candidate)
    if (!real.startsWith(`${realRoot}${sep}`)) continue
    let probe
    try {
      probe = new DatabaseSync(real, { readOnly: true })
      const found = probe.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('ct_ai_source_fences','ct_ai_executions','ct_ai_artifacts')").get()
      if (found?.n === 3) matches.push(real)
    } catch {
      // 非 SQLite 或尚未套用 migration 的檔案不是目標。
    } finally {
      probe?.close()
    }
  }
  if (matches.length !== 1) throw new Error('expected_one_isolated_evidence_database')
  const sqlite = new DatabaseSync(matches[0])
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000')
  const db = {
    prepare(sql) {
      class Statement {
        constructor(values = []) { this.values = values }
        bind(...values) { return new Statement(values) }
        execute() {
          const result = sqlite.prepare(sql).run(...this.values)
          return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
        }
        async run() { return this.execute() }
        async first() { return sqlite.prepare(sql).get(...this.values) ?? null }
        async all() { return { success: true, results: sqlite.prepare(sql).all(...this.values) } }
      }
      return new Statement()
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const result = statements.map(statement => statement.execute())
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { sqlite, db }
}

async function main() {
  const options = flags(args)
  if (command === 'reconcile') {
    if (Object.keys(options).sort().join(',') !== '--base,--cookie-jar') throw new Error('invalid_arguments')
    const base = new URL(options['--base'])
    if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('local_origin_required')
    const url = new URL('/api/evidence-maintenance/reconcile', base).href
    const result = spawnSync('curl', ['--disable', '--noproxy', '*', '--silent', '--fail', '--connect-timeout', '5', '--max-time', '120', '--output', '/dev/null', '--cookie', options['--cookie-jar'], '--request', 'POST', '--header', `Origin: ${base.origin}`, '--header', 'Content-Type: application/json', '--data', '{}', url], { stdio: 'ignore' })
    if (result.status !== 0) throw new Error('reconciliation_failed_check_local_session_and_source')
    process.stdout.write('{"ok":true,"action":"reconcile"}\n')
    return
  }
  if (command !== 'list' && command !== 'erase') throw new Error('invalid_arguments')
  if (command === 'list' && Object.keys(options).length !== 0) throw new Error('invalid_arguments')
  if (command === 'erase' && (Object.keys(options).sort().join(',') !== '--id,--kind' || !['issue', 'material'].includes(options['--kind']) || !/^[1-9]\d*$/.test(options['--id']) || !Number.isSafeInteger(Number(options['--id'])))) throw new Error('invalid_arguments')
  const { sqlite, db } = localDatabase()
  try {
    const store = new EvidenceStore(db)
    if (command === 'list') {
      const sources = await store.listSources()
      process.stdout.write(`${JSON.stringify({ sources: sources.map(({ kind, id, hash, checkedAt }) => ({ kind, id, hash, checked_at: checkedAt })) })}\n`)
    } else {
      await store.eraseSource({ namespace, kind: options['--kind'], id: Number(options['--id']), reason: 'request' })
      process.stdout.write(`${JSON.stringify({ ok: true, action: 'erase', kind: options['--kind'], id: Number(options['--id']) })}\n`)
    }
  } finally {
    sqlite.close()
  }
}

try {
  await main()
} catch (error) {
  const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'maintenance_failed'
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
}
