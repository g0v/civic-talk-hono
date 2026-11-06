import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { assertReviewProfile, configPath, persistPath, projectRoot } from './evidence-review-common.mjs'
import { fixtureInitialized, fixtureQuery } from './evidence-review-fixture.mjs'

function wrangler(args, json = false) {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  // 不讓外部環境選取其他 Wrangler environment。
  delete env.CLOUDFLARE_ENV
  const result = spawnSync('vp', ['exec', 'wrangler', ...args, '--local', '--config', configPath, '--persist-to', persistPath, ...(json ? ['--json'] : [])], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: json ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  })
  if (result.error || result.status !== 0) throw new Error('本機 Wrangler D1 指令失敗；檢查 vp、設定及上方訊息後重試')
  if (!json) return
  let response
  try { response = JSON.parse(result.stdout) } catch { throw new Error('無法解析本機 Wrangler D1 回應') }
  if (!Array.isArray(response) || response.length !== 1 || response[0].success !== true || !Array.isArray(response[0].results)) {
    throw new Error('本機 Wrangler D1 回應不完整')
  }
  return response[0].results
}

function query(sql) {
  return wrangler(['d1', 'execute', 'SOURCE_DB', '--command', sql], true)
}

function inspectFixture() {
  return fixtureInitialized(query('SELECT id, version FROM ct_evidence_review_fixture'), query(fixtureQuery))
}

function main() {
  if (process.argv.length !== 2) throw new Error('此命令不接受參數；拒絕自訂 config、路徑或遠端目標')
  assertReviewProfile()
  // 兩個 catalog 都使用同一套標準 business schema；DB 的 0017 直接使用原始 migration。
  for (const binding of ['DB', 'SOURCE_DB']) {
    console.log(`初始化隔離本機 ${binding} schema（只執行尚未套用的 migrations）`)
    wrangler(['d1', 'migrations', 'apply', binding])
  }
  wrangler(['d1', 'execute', 'SOURCE_DB', '--file', join(projectRoot, 'fixtures', 'evidence-review', 'marker.sql')])
  const alreadyInitialized = inspectFixture()
  if (!alreadyInitialized) {
    wrangler(['d1', 'execute', 'SOURCE_DB', '--file', join(projectRoot, 'fixtures', 'evidence-review', 'sources.sql')])
    if (!inspectFixture()) throw new Error('fixture 初始化未完成；未清除狀態，請人工檢查')
  }
  console.log(alreadyInitialized ? '本機審閱 fixture 已存在且一致；保留全部狀態、用量及 tombstone。' : '已建立本機合成 fixture 900013／900025／900026；保留全部狀態、用量及 tombstone。')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : '審閱環境初始化失敗')
  process.exitCode = 1
}
