import type { ExtractionDebug, ExtractionDebugEntry } from '../ai/extractionDebug'

const labels: Record<ExtractionDebugEntry['kind'], string> = {
  raw: '[extraction:raw] 原始抽取',
  legacy: '[extraction:expanded] 已保存的 legacy 展句（不是 claim／context）',
  claim: '[extraction:claim] 已保存的主張候選',
  context: '[extraction:context] 原文語境',
  diagnostic: '[extraction:diagnostic] 提取診斷',
}

export function logExtractionDebug(debug: ExtractionDebug): void {
  if (!import.meta.env.DEV) return
  for (const entry of debug.entries) {
    const label = labels[entry.kind]
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
    if (entry.kind === 'claim' && Array.isArray(entry.data.claims)) console.table(entry.data.claims)
    if (entry.kind === 'context' && Array.isArray(entry.data.contexts)) console.table(entry.data.contexts)
    // 不把 value 與 spans zip：provider 的兩個陣列可能不等長，完整原值分開保留。
    console.log(label, entry.data)
    console.groupEnd()
  }
}
