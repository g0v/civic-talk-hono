import { lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const configPath = join(projectRoot, 'wrangler.evidence-review.jsonc')
export const persistPath = join(projectRoot, '.wrangler', 'evidence-review')
export const cookiePath = join(persistPath, 'session.cookies')
export const revisionPath = join(persistPath, 'revision.json')
export const origin = 'http://localhost:5173'

function requirePlainFile(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('拒絕連結或非一般檔案：檢查審閱環境路徑')
}

function ensureDirectory(path) {
  try {
    mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('拒絕連結或非目錄：檢查審閱環境路徑')
}

// 避免本機 D1、fixture、cookie 或 migration 經連結落到其他狀態目錄。
function requireDirectory(path) {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('拒絕連結或非目錄：檢查審閱環境路徑')
}

function rejectLinks(path) {
  requireDirectory(path)
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const item = join(path, entry.name)
    const stat = lstatSync(item)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) {
      throw new Error('拒絕審閱狀態、migration 或 fixture 中的連結與特殊檔案')
    }
    if (stat.isDirectory()) rejectLinks(item)
  }
}

function same(actual, expected) {
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
  const a = Object.keys(actual).sort()
  const b = Object.keys(expected).sort()
  return a.length === b.length && a.every((key, index) => key === b[index] && actual[key] === expected[key])
}

export function assertReviewProfile() {
  if (process.env.CIVIC_AI_EXPERIMENT === '1') throw new Error('不可同時啟用實驗與審閱設定')
  requirePlainFile(configPath)
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const allowedKeys = ['$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls', 'assets', 'vars', 'secrets', 'd1_databases', 'ai', 'workflows']
  if (Object.keys(config).sort().join(',') !== allowedKeys.sort().join(',') ||
      config.name !== 'civic-talk-evidence-review-local-only' || config.main !== 'src/worker.ts' ||
      config['$schema'] !== 'node_modules/wrangler/config-schema.json' || config.compatibility_date !== '2026-04-17' ||
      !Array.isArray(config.compatibility_flags) || config.compatibility_flags.length !== 1 || config.compatibility_flags[0] !== 'nodejs_compat' ||
      !same(config.assets, { directory: './public/', binding: 'ASSETS' }) ||
      !config.secrets || Object.keys(config.secrets).join(',') !== 'required' || !Array.isArray(config.secrets.required) ||
      config.secrets.required.join(',') !== 'BETTER_AUTH_URL,BETTER_AUTH_SECRET,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET' ||
      config.workers_dev !== false || config.preview_urls !== false ||
      !same(config.vars, { CIVIC_AI_REVIEW: '1', EVIDENCE_API_ENABLED: '1' }) ||
      !same(config.ai, { binding: 'AI', remote: true }) ||
      !Array.isArray(config.d1_databases) || config.d1_databases.length !== 3 ||
      !same(config.d1_databases[0], { binding: 'DB', database_name: 'evidence-review-state-local-only', database_id: '00000000-0000-4000-8000-000000090013', remote: false, migrations_dir: './migrations' }) ||
      !same(config.d1_databases[1], { binding: 'SOURCE_DB', database_name: 'evidence-review-source-local-only', database_id: '00000000-0000-4000-8000-000000090025', remote: false, migrations_dir: './migrations' }) ||
      !same(config.d1_databases[2], { binding: 'DB_AUTH', database_name: 'vtaiwan-auth', database_id: 'e26edd14-d163-427d-8630-9304f815e9fa', remote: true }) ||
      !Array.isArray(config.workflows) || config.workflows.length !== 1 ||
      !same(config.workflows[0], { binding: 'EVIDENCE_WORKFLOW', name: 'civic-talk-evidence-review-local', class_name: 'EvidenceWorkflow' })) {
    throw new Error('審閱設定不符固定本機 profile；拒絕執行')
  }
  ensureDirectory(join(projectRoot, '.wrangler'))
  ensureDirectory(persistPath)
  rejectLinks(persistPath)
  rejectLinks(join(projectRoot, 'migrations'))
  requireDirectory(join(projectRoot, 'fixtures'))
  rejectLinks(join(projectRoot, 'fixtures', 'evidence-review'))
}

export function requirePrivateFile(path) {
  requirePlainFile(path)
  const stat = lstatSync(path)
  if ((stat.mode & 0o077) !== 0) throw new Error('審閱私有檔案權限須為 600 或更嚴格')
}
