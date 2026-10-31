import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vite-plus/test'

const importer = fileURLToPath(new URL('../../scripts/session-cookie-jar.mjs', import.meta.url))

type ChildResult = { code: number | null; stdout: string; stderr: string }
function run(command: string, args: string[], input = '', cwd?: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => resolve({ code, stdout, stderr }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Local test server did not bind a TCP port'))
        return
      }
      resolve(address.port)
    })
  })
}

it('imports a private Netscape jar and authenticates repeated curl requests without Set-Cookie', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-cookie-jar-'))
  const jarPath = join(directory, 'session.cookies')
  const tokenPair = 'better-auth.session_token=token%2Bvalue%2F%3D=='
  const hostPair = '__Host-session=synthetic-host-token=='
  const securePair = '__Secure-session=synthetic-secure-token=='
  const cookieHeader = `${tokenPair}; ${hostPair}; ${securePair}`
  const authenticated: boolean[] = []
  const server = createServer((request, response) => {
    const pairs = (request.headers.cookie ?? '').split(/;\s*/u)
    const ok = request.method === 'GET' && request.url === '/api/auth/get-session' && pairs.includes(tokenPair) && pairs.includes(hostPair) && pairs.includes(securePair)
    authenticated.push(ok)
    response.statusCode = ok ? 200 : 401
    response.setHeader('content-type', 'application/json')
    response.end(ok ? '{"user":{"id":"synthetic-user"}}' : '{}')
  })

  try {
    const port = await listen(server)
    const origin = `http://localhost:${port}`
    await writeFile(jarPath, 'stale cookie jar')
    await chmod(jarPath, 0o644)

    const imported = await run(process.execPath, [importer, origin, jarPath], cookieHeader)
    expect(imported.code).toBe(0)
    for (const secret of ['token%2Bvalue%2F%3D==', 'synthetic-host-token==', 'synthetic-secure-token==']) {
      expect(imported.stdout).not.toContain(secret)
      expect(imported.stderr).not.toContain(secret)
    }
    expect((await lstat(jarPath)).mode & 0o777).toBe(0o600)

    for (let index = 0; index < 2; index += 1) {
      const response = await run('curl', [
        '--disable', '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}',
        '--cookie', 'session.cookies',
        ...(index === 0 ? ['--cookie-jar', 'session.cookies'] : []),
        '--noproxy', '*', '--connect-timeout', '2', '--max-time', '5',
        '--resolve', `localhost:${port}:127.0.0.1`,
        `${origin}/api/auth/get-session`,
      ], '', directory)
      expect(response.code).toBe(0)
      expect(response.stdout).toBe('200')
    }
    expect(authenticated).toEqual([true, true])
    const jarContents = await readFile(jarPath, 'utf8')

    for (const malformed of ['session=first\tvalue', 'session=first\nsession=second', 'session=first; session=second', 'session=first,other=second']) {
      const rejected = await run(process.execPath, [importer, origin, jarPath], malformed)
      expect(rejected.code).not.toBe(0)
      expect(await readFile(jarPath, 'utf8')).toBe(jarContents)
      expect((await lstat(jarPath)).mode & 0o777).toBe(0o600)
    }

    const rejectedOrigin = await run(process.execPath, [importer, `http://127.0.0.1:${port}`, jarPath], cookieHeader)
    expect(rejectedOrigin.code).not.toBe(0)
    expect(await readFile(jarPath, 'utf8')).toBe(jarContents)

    const targetPath = join(directory, 'symlink-target')
    const aliasPath = join(directory, 'session-alias.cookies')
    await writeFile(targetPath, 'must not be followed')
    await symlink(targetPath, aliasPath)
    const aliasedImport = await run(process.execPath, [importer, origin, aliasPath], cookieHeader)
    expect(aliasedImport.code).toBe(0)
    expect((await lstat(aliasPath)).isSymbolicLink()).toBe(false)
    expect(await readFile(targetPath, 'utf8')).toBe('must not be followed')
    expect((await lstat(aliasPath)).mode & 0o777).toBe(0o600)
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    await rm(directory, { recursive: true, force: true })
  }
})
