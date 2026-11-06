import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { fixtureInitialized, fixtureQuery } from '../../scripts/evidence-review-fixture.mjs'

const root = new URL('../../', import.meta.url)
const sourceSql = readFileSync(new URL('../../fixtures/evidence-review/sources.sql', import.meta.url), 'utf8')
const markerSql = readFileSync(new URL('../../fixtures/evidence-review/marker.sql', import.meta.url), 'utf8')

function catalog() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync(new URL('../../migrations/', import.meta.url)).filter(name => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
  }
  return sqlite
}

function initialized(sqlite: DatabaseSync) {
  return fixtureInitialized(
    sqlite.prepare('SELECT id, version FROM ct_evidence_review_fixture').all(),
    sqlite.prepare(fixtureQuery).all(),
  )
}

describe('隔離審閱 fixture', () => {
  it('首次建立後重跑不覆寫資料，也不移除另一個 state catalog 的用量與 tombstone', () => {
    const source = catalog()
    const state = catalog()
    try {
      source.exec(markerSql)
      expect(initialized(source)).toBe(false)
      source.exec(sourceSql)
      expect(initialized(source)).toBe(true)
      state.exec(`INSERT INTO ct_ai_source_fences(namespace, kind, source_id, generation, erased_at, reason_code)
        VALUES ('vtaiwan-civic-talks', 'issue', 900013, 1, '2026-11-01T00:00:00Z', 'request')`)
      state.exec(`INSERT INTO ct_ai_executions(id, input_key, namespace, issue_id, charged_owner_id, language, status, created_at, updated_at, created_day)
        VALUES ('execution', 'key', 'vtaiwan-civic-talks', 900013, 'owner', 'zh-TW', 'failed', '2026-11-01', '2026-11-01', '2026-11-01')`)
      state.exec(`INSERT INTO ct_ai_usage(id, execution_id, step_key, started_at, started_day, estimate_micro_usd, state)
        VALUES ('usage', 'execution', 'extract', '2026-11-01', '2026-11-01', 300, 'unknown')`)
      const before = source.prepare(fixtureQuery).all()
      expect(initialized(source)).toBe(true)
      source.exec(sourceSql)
      expect(source.prepare(fixtureQuery).all()).toEqual(before)
      expect(state.prepare('SELECT generation, erased_at FROM ct_ai_source_fences WHERE source_id = 900013').get()).toMatchObject({ generation: 1, erased_at: '2026-11-01T00:00:00Z' })
      expect(state.prepare('SELECT estimate_micro_usd, state FROM ct_ai_usage WHERE id = ?').get('usage')).toMatchObject({ estimate_micro_usd: 300, state: 'unknown' })
    } finally {
      source.close()
      state.close()
    }
  })

  it('已初始化來源被更動或刪除時拒絕重建，首次碰撞亦不覆寫', () => {
    const source = catalog()
    try {
      source.exec(markerSql)
      source.exec(sourceSql)
      source.prepare('UPDATE ct_materials SET content = ? WHERE id = 900025').run('審閱者修改後的來源')
      expect(() => initialized(source)).toThrow('fixture 已變更')
      expect(source.prepare('SELECT content FROM ct_materials WHERE id = 900025').get()).toMatchObject({ content: '審閱者修改後的來源' })
      source.exec('DELETE FROM ct_evidence_review_fixture')
      expect(() => initialized(source)).toThrow('fixture 已變更')
      expect(source.prepare('SELECT content FROM ct_materials WHERE id = 900025').get()).toMatchObject({ content: '審閱者修改後的來源' })
      source.exec('DELETE FROM ct_materials WHERE id = 900025')
      source.exec('INSERT INTO ct_evidence_review_fixture(id, version) VALUES (1, 1)')
      expect(() => initialized(source)).toThrow('fixture 已缺失')
      expect(source.prepare('SELECT id FROM ct_materials WHERE id = 900025').get()).toBeUndefined()
    } finally {
      source.close()
    }
  })
})

describe('審閱 CLI 的本機目標限制', () => {
  it.each([
    ['scripts/evidence-review-setup.mjs', '--remote'],
    ['scripts/evidence-review-setup.mjs', '--config', 'wrangler.jsonc'],
    ['scripts/evidence-review-setup.mjs', '--persist-to', '.wrangler/ai-experiment'],
    ['scripts/evidence-review-smoke.mjs', 'create'],
    ['scripts/evidence-review-smoke.mjs', 'create', '--consent', '--base', 'https://example.invalid'],
    ['scripts/evidence-review-smoke.mjs', 'erase', '--confirm-irreversible', '--remote'],
    ['scripts/evidence-review-smoke.mjs', 'job', '../../api/auth/sign-out'],
  ])('在進行任何 D1 或 HTTP 操作前拒絕不支援的參數 %s', (...args) => {
    const [script, ...flags] = args
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, root)), ...flags], { cwd: fileURLToPath(root), encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })
})

it('CLI 先匿名辨識 review 服務，再以私有 jar 操作；非審閱服務不收到 cookie', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-review-cli-'))
  const curlPath = join(directory, 'bin', 'curl')
  const reviewDir = join(directory, '.wrangler', 'evidence-review')
  const jobId = '22222222-2222-4222-8222-222222222222'
  const requests: Array<{ path: string; cookie: string | undefined; origin: string | undefined; body: string }> = []
  let reviewHeader = false
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const path = req.url ?? ''
      requests.push({ path, cookie: req.headers.cookie, origin: req.headers.origin, body })
      res.setHeader('Content-Type', 'application/json')
      if (reviewHeader) res.setHeader('X-Civic-Evidence-Review', '1')
      if (path === '/api/evidence-jobs/00000000-0000-0000-0000-000000000000') {
        res.statusCode = 401
        res.end('{"error":"Unauthorized"}')
      } else if (path === '/api/issues/900013/evidence-jobs') {
        res.statusCode = 202
        res.end(JSON.stringify({ job_id: jobId, status: 'queued', cache: 'miss' }))
      } else if (path.endsWith('/revisions') && req.method === 'GET') {
        res.end(JSON.stringify({ ai_base: { id: 'ai', data: { example: '原稿' } }, revisions: [] }))
      } else if (path.endsWith('/revisions')) {
        res.statusCode = 201
        res.end('{"revision_id":"33333333-3333-4333-8333-333333333333","verification":"human_unverified"}')
      } else {
        res.end('{"ok":true}')
      }
    })
  })
  try {
    await Promise.all([
      mkdir(join(directory, 'scripts'), { recursive: true }),
      mkdir(join(directory, 'migrations'), { recursive: true }),
      mkdir(join(directory, 'fixtures', 'evidence-review'), { recursive: true }),
      mkdir(join(directory, 'bin'), { recursive: true }),
      mkdir(reviewDir, { recursive: true }),
    ])
    for (const file of ['wrangler.evidence-review.jsonc', 'scripts/evidence-review-common.mjs', 'scripts/evidence-review-smoke.mjs']) {
      await writeFile(join(directory, file), await readFile(new URL(file, root)))
    }
    const token = 'synthetic-private-session-value'
    await writeFile(join(reviewDir, 'session.cookies'), `# Netscape HTTP Cookie File\nlocalhost\tFALSE\t/\tFALSE\t0\tbetter-auth.session_token\t${token}\n`, { mode: 0o600 })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('listener not available')
    // 只有測試程序的 curl 被導向 ephemeral loopback；正式 CLI 沒有可覆寫 origin 的選項。
    await writeFile(curlPath, `#!/bin/sh\nexec /usr/bin/curl --disable --connect-to localhost:5173:127.0.0.1:${address.port} "$@"\n`)
    await chmod(curlPath, 0o700)
    const run = async (args: string[]) => {
      const child = spawn(process.execPath, [join(directory, 'scripts', 'evidence-review-smoke.mjs'), ...args], {
        cwd: directory,
        env: { ...process.env, CIVIC_AI_EXPERIMENT: '0', PATH: `${join(directory, 'bin')}:${process.env.PATH ?? ''}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
      const [code] = await once(child, 'close') as [number | null]
      return { code, stdout, stderr }
    }

    const rejected = await run(['create', '--consent'])
    expect(rejected.code).toBe(1)
    expect(requests).toHaveLength(1)
    expect(requests[0].cookie).toBeUndefined()
    expect(rejected.stdout + rejected.stderr).not.toContain(token)

    reviewHeader = true
    const created = await run(['create', '--consent'])
    expect(created.code).toBe(0)
    expect(created.stdout + created.stderr).not.toContain(token)
    const createdResult = JSON.parse(created.stdout.trim()) as { response_file: string; job_id: string; http_status: number }
    expect(createdResult).toMatchObject({ job_id: jobId, http_status: 202 })
    expect((await stat(join(directory, createdResult.response_file))).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(join(directory, createdResult.response_file), 'utf8'))).toMatchObject({ cache: 'miss' })
    expect(JSON.parse(requests[2].body)).toEqual({ material_ids: [900025, 900026], language: 'zh-TW', consent: true })
    expect((await run(['job', jobId])).code).toBe(0)
    expect((await run(['revisions', jobId])).code).toBe(0)

    const prepared = await run(['prepare-revision', jobId])
    expect(prepared.code).toBe(0)
    const revisionPath = join(reviewDir, 'revision.json')
    expect((await stat(revisionPath)).mode & 0o777).toBe(0o600)
    const revision = JSON.parse(await readFile(revisionPath, 'utf8')) as { parent_revision_id: string; data: { example: string } }
    revision.data.example = '審閱者的編輯'
    await writeFile(revisionPath, JSON.stringify(revision))
    const countBeforeRepeat = requests.length
    expect((await run(['prepare-revision', jobId])).code).toBe(1)
    expect(requests).toHaveLength(countBeforeRepeat)
    expect((await run(['revise', jobId])).code).toBe(0)
    expect((await run(['reconcile'])).code).toBe(0)
    expect((await run(['erase', '--confirm-irreversible'])).code).toBe(0)
    const authenticated = requests.filter(item => item.cookie)
    expect(authenticated.some(item => item.path === `/api/evidence-jobs/${jobId}` && !item.body)).toBe(true)
    expect(authenticated.some(item => item.path === `/api/evidence-jobs/${jobId}/revisions` && !item.body)).toBe(true)
    expect(authenticated.every(item => item.cookie === `better-auth.session_token=${token}`)).toBe(true)
    const sentRevision = authenticated.find(item => item.path.endsWith('/revisions') && item.body)
    expect(JSON.parse(sentRevision?.body ?? 'null')).toEqual(revision)
    const reconcile = authenticated.find(item => item.path.endsWith('/reconcile'))
    expect(JSON.parse(reconcile?.body ?? 'null')).toEqual({})
    const erase = authenticated.find(item => item.path.endsWith('/erase'))
    expect(JSON.parse(erase?.body ?? 'null')).toEqual({ kind: 'issue', id: 900013 })
    expect(authenticated.filter(item => item.body).every(item => item.origin === 'http://localhost:5173')).toBe(true)
    expect(requests.filter(item => item.path.includes('00000000-0000-0000-0000-000000000000')).every(item => !item.cookie)).toBe(true)
  } finally {
    if (server.listening) {
      server.close()
      await once(server, 'close')
    }
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
