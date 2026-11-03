import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const noticeAssetPath = target => `licenses/${target}.txt`

function moduleFilePath(id, root) {
  if (typeof id !== 'string') return null
  let file = id
  while (file.charCodeAt(0) === 0) file = file.slice(1)
  if (file.startsWith('file://')) {
    try {
      const parsed = new URL(file)
      parsed.search = ''
      parsed.hash = ''
      file = fileURLToPath(parsed)
    } catch {
      return null
    }
  }
  file = file.split(/[?#]/, 1)[0]
  if (file.startsWith('/@fs/')) file = file.slice('/@fs'.length)
  if (!file || file.startsWith('\0')) return null
  return path.resolve(root, file)
}

async function installedPackageRoot(id, root) {
  const file = moduleFilePath(id, root)
  if (!file) return null

  let resolved = file
  try {
    resolved = await realpath(file)
  } catch {
    // 有些 bundler ID 不再指向可讀的原始檔；仍用其絕對路徑判斷 package root。
  }

  const parts = path.resolve(resolved).split(path.sep)
  let index = parts.length - 1
  while (index >= 0 && parts[index] !== 'node_modules') index -= 1
  if (index < 0) return null

  const packageStart = index + 1
  if (packageStart >= parts.length) throw new Error(`已打包 module ID 缺少套件名稱：${id}`)
  const packageEnd = parts[packageStart].startsWith('@') ? packageStart + 1 : packageStart
  if (packageEnd >= parts.length) throw new Error(`已打包 module ID 的 scoped 套件名稱不完整：${id}`)
  const rootPath = parts.slice(0, index).join(path.sep) || path.parse(path.resolve(resolved)).root
  const packageRoot = path.resolve(rootPath, 'node_modules', ...parts.slice(packageStart, packageEnd + 1))
  try {
    const metadata = await readFile(path.join(packageRoot, 'package.json'))
    if (metadata.length > 0) return packageRoot
    throw new Error('package.json 是空檔。')
  } catch (error) {
    throw new Error(`無法從已打包 module ID 取得已安裝套件 package.json：${id}（${error.message}）`)
  }
}

function isNoticeFilename(filename) {
  return /^(?:licen[cs]es?|copying|notice)(?:$|[._ -].*)/i.test(filename) || /^(?:third[._ -]party[._ -](?:licen[cs]es?|notice)s?)(?:$|[._ -].*)/i.test(filename)
}

function isTextDocument(filename) {
  return !/\.(?:pdf|docx?|odt|rtf|png|jpe?g|gif|svgz?|zip)$/i.test(filename)
}

async function noticeFiles(packageRoot) {
  const files = []
  const visit = async (directory, relativeDirectory = '') => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === '.git') continue
      const absolute = path.join(directory, entry.name)
      const relative = path.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute, relative)
        continue
      }
      if (!entry.isFile()) continue
      const inLicenseDirectory = relative
        .split(path.sep)
        .slice(0, -1)
        .some(part => /^licenses?$/i.test(part))
      if (isNoticeFilename(entry.name) || (inLicenseDirectory && isTextDocument(entry.name))) {
        files.push({ absolute, relative: relative.split(path.sep).join('/') })
      }
    }
  }
  await visit(packageRoot)
  return files
}

function metadataText(license) {
  if (license === undefined || license === null || license === '') return 'UNSPECIFIED'
  if (typeof license === 'string') return license.replace(/[\t\r\n]+/g, ' ')
  return JSON.stringify(license)
}

function describePackageRoot(root, packageRoot) {
  const relative = path.relative(root, packageRoot).split(path.sep).join('/')
  return relative && !relative.startsWith('../') ? relative : packageRoot.split(path.sep).slice(-3).join('/')
}

async function readPackageNotices(packageRoot, root) {
  let packageJson
  try {
    packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  } catch (error) {
    throw new Error(`無法讀取已打包套件的 package.json：${packageRoot}（${error.message}）`)
  }

  const name = typeof packageJson.name === 'string' && packageJson.name ? packageJson.name : path.basename(packageRoot)
  const version = typeof packageJson.version === 'string' && packageJson.version ? packageJson.version : 'UNSPECIFIED'
  const files = await noticeFiles(packageRoot)
  if (files.length === 0) {
    throw new Error(
      `已打包套件 ${name}@${version}（${describePackageRoot(root, packageRoot)}）沒有可取得的 LICENSE、LICENCE、COPYING 或 NOTICE 全文；package.json license metadata 為「${metadataText(packageJson.license)}」。請補足該套件實際許可全文後再建置。`
    )
  }

  const contents = []
  for (const file of files) {
    const bytes = await readFile(file.absolute)
    const text = bytes.toString('utf8')
    if (!text.trim() || !Buffer.from(text, 'utf8').equals(bytes)) {
      throw new Error(`已打包套件 ${name}@${version} 的授權檔不是非空 UTF-8 全文：${file.relative}`)
    }
    contents.push({ path: file.relative, text })
  }

  return {
    name,
    version,
    license: metadataText(packageJson.license),
    location: describePackageRoot(root, packageRoot),
    files: contents,
  }
}

async function bundledPackages(bundle, root) {
  const packageRoots = new Set()
  for (const output of Object.values(bundle)) {
    if (output?.type !== 'chunk' || !output.modules) continue
    for (const moduleId of Object.keys(output.modules)) {
      const packageRoot = await installedPackageRoot(moduleId, root)
      if (packageRoot) packageRoots.add(packageRoot)
    }
  }

  const packages = []
  const failures = []
  for (const packageRoot of packageRoots) {
    try {
      packages.push(await readPackageNotices(packageRoot, root))
    } catch (error) {
      failures.push(error.message)
    }
  }
  if (failures.length) throw new Error(failures.join('\n'))
  packages.sort((left, right) => {
    const a = `${left.name}\0${left.version}\0${left.location}`
    const b = `${right.name}\0${right.version}\0${right.location}`
    return a < b ? -1 : a > b ? 1 : 0
  })
  return packages
}

function formatNotices(target, packages) {
  const sections = [
    `第三方套件授權聲明（${target} bundle）`,
    '本文件依實際 bundle modules 產生。套件授權 metadata 與原始 LICENSE／NOTICE 全文來自實際已安裝套件。',
  ]

  if (packages.length === 0) sections.push('本 bundle 未包含可辨識的 node_modules 套件。')
  for (const item of packages) {
    sections.push('='.repeat(78))
    sections.push(`套件：${item.name}@${item.version}`)
    sections.push(`授權 metadata：${item.license}`)
    sections.push(`安裝路徑：${item.location}`)
    for (const file of item.files) {
      sections.push(`--- 原始檔案：${file.path} ---`)
      sections.push(file.text)
    }
  }
  sections.push('='.repeat(78))
  return `${sections.join('\n\n')}\n`
}

/**
 * 從實際輸出 chunk 的 module IDs 收集套件授權；不讀取 lockfile 來推測 bundle 內容。
 * @param {{ target: 'client' | 'worker', root?: string }} options
 */
export function bundleNotices({ target, root = projectRoot } = {}) {
  if (target !== 'client' && target !== 'worker') throw new TypeError('bundleNotices 的 target 必須是 client 或 worker。')

  const project = path.resolve(root)
  return {
    name: `civic-talk-${target}-bundle-notices`,
    // Cloudflare 另建 client fallback environment；它不能覆蓋 Worker notices。
    applyToEnvironment: environment => target === 'client' || environment.name !== 'client',
    configureServer(server) {
      // Vite dev 不套用 _headers；直接送出 notices bytes 並明確指定 UTF-8。
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?', 1)[0]
        if ((request.method !== 'GET' && request.method !== 'HEAD') || !/^\/licenses\/(?:client|worker)\.txt$/.test(pathname ?? '')) {
          next()
          return
        }
        try {
          const bytes = await readFile(path.join(project, 'public', pathname.slice(1)))
          response.statusCode = 200
          response.setHeader('Content-Type', 'text/plain; charset=utf-8')
          response.setHeader('Content-Length', bytes.length)
          response.end(request.method === 'HEAD' ? undefined : bytes)
        } catch (error) {
          next(error.code === 'ENOENT' ? undefined : error)
        }
      })
    },
    generateBundle: {
      order: 'pre',
      handler: async function (_outputOptions, bundle) {
        const packages = await bundledPackages(bundle, project)
        this.emitFile({ type: 'asset', fileName: noticeAssetPath(target), source: formatNotices(target, packages) })
      },
    },
  }
}
