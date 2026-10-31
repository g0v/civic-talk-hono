import type { EvidenceBindings } from './env'
import { inspectSource, SOURCE_NAMESPACE } from './source'
import { EvidenceStore, type Snapshot } from './store'

export class SourceUnavailable extends Error {
  constructor(readonly code: 'source_unavailable' | 'source_withdrawn' | 'source_erased' | 'account_suspended') {
    super(code)
  }
}

/** 啟動及管理命令全量對帳；指定 execution 時僅核對該工作來源。 */
export async function reconcileSources(env: EvidenceBindings, executionId?: string): Promise<{ checked: number; withdrawn: number; erased: number }> {
  const store = new EvidenceStore(env.DB)
  const sources = await store.listSources(executionId)
  const seen = new Set<string>()
  const result = { checked: 0, withdrawn: 0, erased: 0 }
  for (const source of sources) {
    if (source.namespace !== SOURCE_NAMESPACE) throw new SourceUnavailable('source_unavailable')
    const key = `${source.kind}:${source.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const current = await inspectSource(env.SOURCE_DB, source.kind, source.id, source.hash)
    // 有 current hash 時由 store 對所有舊快照逐一比對，而非撤下同 ID 的新快照。
    const status = current.status === 'deleted' ? 'deleted' : current.hash === null ? 'withdrawn' : 'valid'
    await store.reconcileSource({ namespace: source.namespace, kind: source.kind, id: source.id, status, currentHash: current.hash })
    result.checked++
    if (status === 'deleted') result.erased++
    if (status === 'withdrawn' || current.status === 'withdrawn') result.withdrawn++
  }
  return result
}

/** 工作當下重新核對每個依賴來源；隱藏、變更與刪除均不得使用舊 payload。 */
export async function checkedSnapshot(env: EvidenceBindings, executionId: string): Promise<Snapshot> {
  const store = new EvidenceStore(env.DB)
  const snapshot = await store.getSnapshot(executionId)
  if (!snapshot) throw new SourceUnavailable('source_withdrawn')
  for (const source of snapshot.sources) {
    const current = await inspectSource(env.SOURCE_DB, source.kind, source.id, source.hash)
    if (current.status !== 'valid') {
      const status = current.status === 'deleted' ? 'deleted' : current.hash === null ? 'withdrawn' : 'valid'
      await store.reconcileSource({ namespace: SOURCE_NAMESPACE, kind: source.kind, id: source.id, status, currentHash: current.hash })
      throw new SourceUnavailable(current.status === 'deleted' ? 'source_erased' : 'source_withdrawn')
    }
  }
  if (!await store.touchSources(executionId, snapshot.generations)) throw new SourceUnavailable('source_withdrawn')
  return snapshot
}

/** 工作流不保存 session；在每次付費前只讀取申請帳號的當前停權狀態。 */
export async function checkInitiator(dbAuth: D1Database, userId: string): Promise<void> {
  const user = await dbAuth.prepare(`SELECT "id" FROM "user" WHERE "id" = ?
    AND (COALESCE("banned", 0) = 0 OR ("banExpires" IS NOT NULL AND datetime("banExpires") <= CURRENT_TIMESTAMP))`)
    .bind(userId).first<{ id: string }>()
  if (!user) throw new SourceUnavailable('account_suspended')
}
