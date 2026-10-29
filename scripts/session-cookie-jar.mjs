import { randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

function configuredOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Origin must be an explicit localhost URL')
  }
  if (
    url.hostname !== 'localhost' ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('Origin must be an explicit localhost URL without a path')
  }
  return { hostname: url.hostname, secureTransport: url.protocol === 'https:' }
}

const cookieValuePattern = /^(?:[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*|"(?:[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*)")$/u

function parseCookieHeader(header) {
  if (!header || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(header)) {
    throw new Error('Cookie header must be non-empty and contain no control characters')
  }
  const seen = new Set()
  return header.split(';').map((part) => {
    const pair = part.replace(/^ +/u, '')
    const separator = pair.indexOf('=')
    if (separator < 1) throw new Error('Cookie header contains a malformed pair')
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)) throw new Error('Cookie header contains an invalid cookie name')
    if (!cookieValuePattern.test(value)) throw new Error('Cookie header contains an invalid cookie value')
    if (seen.has(name)) throw new Error('Cookie header contains duplicate cookie names')
    seen.add(name)
    return { name, value }
  })
}

async function writeCookieJar(jarPath, origin, cookies) {
  const target = resolve(jarPath)
  const temporary = resolve(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`)
  const rows = cookies.map(({ name, value }) => {
    const secure = origin.secureTransport || name.startsWith('__Secure-') || name.startsWith('__Host-')
    return `${origin.hostname}\tFALSE\t/\t${secure ? 'TRUE' : 'FALSE'}\t0\t${name}\t${value}`
  })
  const content = `# Netscape HTTP Cookie File\n${rows.join('\n')}\n`
  let file
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.chmod(0o600)
    await file.writeFile(content, 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await rename(temporary, target)
  } catch (error) {
    if (file) await file.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
}

async function main() {
  const [originValue, jarPath, ...extra] = process.argv.slice(2)
  if (!originValue || !jarPath || extra.length) {
    throw new Error('Usage: node scripts/session-cookie-jar.mjs <localhost-origin> <cookie-jar-path>')
  }
  const origin = configuredOrigin(originValue)
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const cookies = parseCookieHeader(Buffer.concat(chunks).toString('utf8'))
  await writeCookieJar(jarPath, origin, cookies)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Cookie jar import failed')
  process.exitCode = 1
})
