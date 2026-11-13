import type { ExtractionDebug } from '../ai/extractionDebug'

export function logExtractionDebug(debug: ExtractionDebug): void {
  if (!import.meta.env.DEV) return
  for (const entry of debug.entries) {
    const label = entry.kind === 'raw' ? '[extraction:raw] 原始抽取' : entry.kind === 'legacy' ? '[extraction:expanded] 已保存的 legacy 展句（不是 claim／context）' : '[extraction:diagnostic] 提取診斷'
    console.groupCollapsed(`${label}｜素材 ${entry.material_id}｜工作 ${debug.job_id}（私人、未經人工驗證）`)
    console.log('來源與設定', {
      checkpoint: debug.checkpoint,
      source_code: debug.source_code,
      settings: debug.settings,
      content_hash: entry.content_hash,
      artifact: entry.artifact,
      claim: debug.claim,
      context: debug.context,
      materials: debug.materials,
    })
    if (entry.kind === 'legacy' && Array.isArray(entry.data.evidence)) console.table(entry.data.evidence)
    // 不把 value 與 spans zip：provider 的兩個陣列可能不等長，完整原值分開保留。
    console.log(label, entry.data)
    console.groupEnd()
  }
}
