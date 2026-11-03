import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createServer } from 'vite'
import { bundleNotices } from '../../scripts/bundle-notices.mjs'
import { licensingDependenciesMatchLockfile, renderLicensingDependencies } from '../../scripts/licensing-dependencies.mjs'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'civic-talk-licenses-'))
  temporaryRoots.push(root)
  return root
}

function writePackage(root: string, packagePath: string, metadata: Record<string, unknown>, files: Record<string, string>) {
  const directory = join(root, packagePath)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = join(directory, relativePath)
    mkdirSync(dirname(filename), { recursive: true })
    writeFileSync(filename, content)
  }
  return directory
}

type GeneratedAsset = { type: 'asset'; fileName: string; source: string }

function pluginHook(plugin: unknown, name: 'generateBundle' | 'writeBundle') {
  const hook = (plugin as Record<string, unknown>)[name] as { handler: (this: never, ...args: never[]) => Promise<void> }
  return hook.handler
}

describe('bundle 第三方授權聲明', () => {
  it('dev notices 的 GET／HEAD 明示 UTF-8，且不改其他資產的 MIME', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'public/licenses'), { recursive: true })
    writeFileSync(join(root, 'public/licenses/client.txt'), '第三方套件授權聲明（client bundle）\n')
    writeFileSync(join(root, 'public/licenses/worker.txt'), '第三方套件授權聲明（worker bundle）\n')
    writeFileSync(join(root, 'public/example.json'), '{}\n')
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [bundleNotices({ target: 'worker', root })],
      server: { host: '127.0.0.1', port: 0 },
    })
    try {
      await server.listen()
      const address = server.httpServer?.address()
      if (!address || typeof address === 'string') throw new Error('Vite dev server 沒有 TCP 位址。')
      const origin = `http://127.0.0.1:${address.port}`
      for (const target of ['client', 'worker']) {
        const response = await fetch(`${origin}/licenses/${target}.txt?view=1`)
        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
        const head = await fetch(`${origin}/licenses/${target}.txt`, { method: 'HEAD' })
        expect(head.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
        expect(await head.text()).toBe('')
      }
      const json = await fetch(`${origin}/example.json`)
      expect(json.headers.get('Content-Type')).toContain('application/json')
      const missing = await fetch(`${origin}/licenses/missing.txt`)
      expect(missing.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('依 scoped 與巢狀 node_modules 的實際 chunk module IDs 收集原始 notices', async () => {
    const root = makeRoot()
    const main = writePackage(
      root,
      'node_modules/@fixture/main',
      { name: '@fixture/main', version: '1.2.3', license: 'MIT' },
      {
        COPYING: 'main license body\n',
        'vendor/NOTICE.txt': 'vendor attribution notice\n',
      }
    )
    const nested = writePackage(
      main,
      'node_modules/@fixture/nested',
      { name: '@fixture/nested', version: '4.5.6', license: 'Apache-2.0' },
      {
        'LICENSES/Apache-2.0': 'nested Apache license body\n',
      }
    )
    const unused = writePackage(
      root,
      'node_modules/dev-only',
      { name: 'dev-only', version: '99.0.0', license: 'MIT' },
      {
        LICENSE: 'not part of this bundle\n',
      }
    )
    const mainModule = join(main, 'index.js')
    const nestedModule = join(nested, 'index.js')
    const unusedModule = join(unused, 'index.js')
    for (const filename of [mainModule, nestedModule, unusedModule]) writeFileSync(filename, 'export const value = 1\n')

    const plugin = bundleNotices({ target: 'client', root })
    const emitted: GeneratedAsset[] = []
    const context = { emitFile: (asset: GeneratedAsset) => emitted.push(asset) }
    const bundle = {
      'entry.js': { type: 'chunk', modules: { [`\0${mainModule}`]: {}, [`${nestedModule}?commonjs-proxy`]: {} } },
      'unused-chunk.js': { type: 'chunk', modules: { '/src/application.js': {} } },
    }
    await pluginHook(plugin, 'generateBundle').call(context as never, {} as never, bundle as never)

    expect(emitted).toHaveLength(1)
    expect(emitted[0].fileName).toBe('licenses/client.txt')
    expect(emitted[0].source).toMatch(/套件：@fixture\/main@1\.2\.3/)
    expect(emitted[0].source).toMatch(/原始檔案：COPYING[\s\S]*main license body/)
    expect(emitted[0].source).toMatch(/原始檔案：vendor\/NOTICE\.txt[\s\S]*vendor attribution notice/)
    expect(emitted[0].source).toMatch(/原始檔案：LICENSES\/Apache-2\.0[\s\S]*nested Apache license body/)
    expect(emitted[0].source).not.toMatch(/dev-only|not part of this bundle/)
  })

  it('實際打包套件缺少可讀許可全文時中止建置並指出套件', async () => {
    const root = makeRoot()
    const packageRoot = writePackage(root, 'node_modules/no-license-text', { name: 'no-license-text', version: '1.0.0', license: 'MIT' }, {})
    const moduleId = join(packageRoot, 'index.js')
    writeFileSync(moduleId, 'export const value = 1\n')
    const plugin = bundleNotices({ target: 'client', root })
    const context = { emitFile: (_asset: GeneratedAsset) => undefined }
    const bundle = { 'entry.js': { type: 'chunk', modules: { [moduleId]: {} } } }

    await expect(pluginHook(plugin, 'generateBundle').call(context as never, {} as never, bundle as never)).rejects.toThrow(/no-license-text@1\.0\.0[\s\S]*沒有可取得的 LICENSE/)
  })

})

describe('依賴授權 TSV 產生器', () => {
  it('穩定排序 lockfile entries 並以相同內容執行 check', () => {
    const lockfile = {
      packages: {
        '': { license: 'AGPL-3.0-only' },
        'node_modules/z-last': { version: '3.0.0', license: 'ISC', resolved: 'https://example.test/z.tgz' },
        'node_modules/@scope/first': { version: '1.0.0', license: { type: 'MIT' }, devOptional: true },
        'node_modules/a-middle': { version: '2.0.0', dev: true, optional: true },
      },
    }
    const generated = renderLicensingDependencies(lockfile)

    expect(generated.split('\n')[0]).toBe('lock_path\tversion\tlicense_metadata\tdev\tdev_optional\toptional\tresolved')
    expect(
      generated
        .split('\n')
        .slice(1, 4)
        .map(row => row.split('\t')[0])
    ).toEqual(['node_modules/@scope/first', 'node_modules/a-middle', 'node_modules/z-last'])
    expect(generated).toContain('node_modules/a-middle\t2.0.0\tUNSPECIFIED\ttrue\tfalse\ttrue\tUNSPECIFIED')
    expect(licensingDependenciesMatchLockfile(lockfile, generated)).toBe(true)
    expect(licensingDependenciesMatchLockfile(lockfile, `${generated}stale`)).toBe(false)
  })
})
