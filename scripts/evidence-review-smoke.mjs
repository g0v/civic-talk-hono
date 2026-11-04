import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { assertReviewProfile, cookiePath, origin, persistPath, projectRoot, requirePrivateFile, revisionPath } from './evidence-review-common.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const [command, ...args] = process.argv.slice(2)

function parseCommand() {
  if (command === 'create' && args.length === 1 && args[0] === '--consent') {
    return { method: 'POST', path: '/api/issues/900013/evidence-jobs', body: { material_ids: [900025, 900026], language: 'zh-TW', consent: true } }
  }
  if (command === 'reconcile' && args.length === 0) return { method: 'POST', path: '/api/evidence-maintenance/reconcile', body: {} }
  if (command === 'erase' && args.length === 1 && args[0] === '--confirm-irreversible') {
    return { method: 'POST', path: '/api/evidence-maintenance/erase', body: { kind: 'issue', id: 900013 } }
  }
  if (['job', 'revisions', 'prepare-revision', 'revise'].includes(command) && args.length === 1 && uuid.test(args[0])) {
    const root = `/api/evidence-jobs/${args[0]}`
    return { method: command === 'revise' ? 'POST' : 'GET', path: command === 'job' ? root : `${root}/revisions` }
  }
  throw new Error('用法：create --consent | job <job-id> | revisions <job-id> | prepare-revision <job-id> | revise <job-id> | reconcile | erase --confirm-irreversible；不接受 config、遠端或路徑參數')
}

function curl(args, input) {
  const result = spawnSync('curl', ['--disable', '--noproxy', '*', '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '120', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
  })
  // 不輸出 curl 錯誤明細，避免意外洩漏私人路徑或 session 內容。
  if (result.error || result.status !== 0) throw new Error('本機 HTTP 請求失敗；確認 canonical localhost:5173 審閱服務正在運作')
  return result.stdout
}

function preflight() {
  const text = curl(['--dump-header', '-', '--output', '/dev/null', '--write-out', '\n%{http_code}', `${origin}/api/evidence-jobs/00000000-0000-0000-0000-000000000000`])
  const match = text.match(/\n(\d{3})$/u)
  if (!match || match[1] !== '401' || !/^x-civic-evidence-review:\s*1\s*$/imu.test(text.slice(0, match.index))) {
    throw new Error('無法確認審閱 Worker；未傳送 cookie 或有副作用的請求')
  }
}

function request(spec) {
  requirePrivateFile(cookiePath)
  const options = ['--cookie', cookiePath, '--request', spec.method, '--write-out', '\n%{http_code}']
  let input
  if (spec.method === 'POST') {
    options.push('--header', `Origin: ${origin}`, '--header', 'Content-Type: application/json', '--data-binary', '@-')
    input = JSON.stringify(spec.body)
  }
  const text = curl([...options, `${origin}${spec.path}`], input)
  const match = text.match(/\n(\d{3})$/u)
  if (!match) throw new Error('本機 HTTP 回應沒有狀態碼')
  const status = Number(match[1])
  const body = text.slice(0, match.index)
  const responsePath = join(persistPath, `response-${command}-${randomUUID()}.json`)
  writeFileSync(responsePath, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  let parsed
  try { parsed = JSON.parse(body) } catch { parsed = null }
  const summary = { http_status: status, response_file: relative(projectRoot, responsePath) }
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.job_id === 'string' && uuid.test(parsed.job_id)) summary.job_id = parsed.job_id
    for (const key of ['status', 'cache', 'error']) {
      if (typeof parsed[key] === 'string' && /^[a-z_]+$/u.test(parsed[key])) summary[key] = parsed[key]
    }
  }
  console.log(JSON.stringify(summary))
  if (status < 200 || status >= 300) throw new Error('API 回應非成功狀態；請在私人 response_file 檢查錯誤')
  return parsed
}

function main() {
  const spec = parseCommand()
  assertReviewProfile()
  if (command === 'prepare-revision' && existsSync(revisionPath)) throw new Error('revision.json 已存在；不覆寫，請先自行處理該私人檔案')
  if (command === 'revise') {
    requirePrivateFile(revisionPath)
    const contents = readFileSync(revisionPath, 'utf8')
    if (Buffer.byteLength(contents) > 512 * 1024) throw new Error('revision.json 超過大小限制')
    try { spec.body = JSON.parse(contents) } catch { throw new Error('revision.json 不是有效 JSON') }
  }
  preflight()
  if (command === 'create') console.error('此請求可能呼叫真實 Workers AI 並產生費用；同一請求也不保證快取命中。')
  if (command === 'erase') console.error('即將不可逆清除虛構議題 900013 的證據並建立 tombstone；不會重設資料庫。')
  const result = request(spec)
  if (command === 'prepare-revision') {
    if (!result?.ai_base || !Object.hasOwn(result.ai_base, 'data')) throw new Error('回應不含可供編輯的 AI 原稿')
    writeFileSync(revisionPath, `${JSON.stringify({ parent_revision_id: 'ai', data: result.ai_base.data }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ revision_file: relative(projectRoot, revisionPath), next: 'edit_before_revise' }))
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : '審閱 API 命令失敗')
  process.exitCode = 1
}
