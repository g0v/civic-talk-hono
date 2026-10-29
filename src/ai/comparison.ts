import { MAX_EVIDENCE, type Evidence } from './evidence'

export const COMPARISON_ALGORITHM_VERSION = 'comparison-1' as const
export type Relation = 'agree' | 'disagree' | 'unrelated' | 'uncertain'

export interface EvidencePair {
  key: string
  // 以證據 ID 而非全文表示，避免大量 pair 重複序列化引文。
  a: string
  b: string
}

export interface DirectComparison {
  pair_key: string
  // 原樣保留真正送題順序，與無向 key 的固定順序不同。
  evidence_ids: [string, string]
  relation: Relation
  question_version: string
  probabilities: Record<Relation, number>
  provider_diagnostics: unknown
  cached?: boolean
}

export interface ComparisonFailure {
  pair_key: string
  error_code: string
}

export interface ConsensusGroup {
  id: string
  evidence_ids: string[]
}

export interface PositionCandidate {
  id: string
  evidence_ids: string[]
}

export interface DisputeCandidate {
  id: string
  pair_key: string
  evidence_ids: [string, string]
  direct: DirectComparison
}

export interface CandidatePath {
  pair_key: string
  evidence_ids: [string, string]
  // path 的每一邊均為正式直接 agree，但兩端的關係不可由路徑推定。
  path: string[]
  status: 'pending' | 'failed' | 'disagree' | 'unrelated' | 'uncertain'
  exclusion_reason: 'missing_direct_comparison' | 'failed_direct_comparison' | 'direct_disagree' | 'direct_unrelated' | 'direct_uncertain'
  direct: DirectComparison | null
  failure: ComparisonFailure | null
}

export interface IncompletePair {
  pair_key: string
  evidence_ids: [string, string]
  status: 'missing' | 'failed'
  failure: ComparisonFailure | null
}

export interface ComparisonAnalysis {
  pairs: EvidencePair[]
  direct_comparisons: DirectComparison[]
  reverse_diagnostics: DirectComparison[]
  consensus_groups: ConsensusGroup[]
  position_candidates: PositionCandidate[]
  disputes: DisputeCandidate[]
  candidate_paths: CandidatePath[]
  incomplete_pairs: IncompletePair[]
  unclassified_evidence_ids: string[]
  diagnostics: {
    evidence_count: number
    eligible_pairs: number
    direct_judgments: number
    cache_hits: number
    inferred_candidates: number
    incomplete_pairs: number
  }
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 無向 key 有確定排序，JSON 陣列編碼避免任意證據 ID 造成分隔符碰撞。 */
export function pairKey(a: string, b: string): string {
  return `pair:${JSON.stringify(compareIds(a, b) <= 0 ? [a, b] : [b, a])}`
}

function orderedEvidence(evidence: readonly Evidence[]): Evidence[] {
  if (evidence.length > MAX_EVIDENCE) throw new Error('too_many_evidence')
  const ids = new Set<string>()
  for (const item of evidence) {
    if (!item || typeof item.id !== 'string' || !item.id || !Number.isSafeInteger(item.material_id) || item.material_id <= 0 || ids.has(item.id)) throw new Error('invalid_evidence')
    ids.add(item.id)
  }
  return [...evidence].sort((a, b) => compareIds(a.id, b.id))
}

/** 每個跨素材無向組合僅排題一次；相同素材不建立 pair。 */
export function createEvidencePairs(evidence: readonly Evidence[]): EvidencePair[] {
  const sorted = orderedEvidence(evidence)
  const pairs: EvidencePair[] = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i].material_id !== sorted[j].material_id) pairs.push({ key: pairKey(sorted[i].id, sorted[j].id), a: sorted[i].id, b: sorted[j].id })
    }
  }
  return pairs
}

const relations: readonly Relation[] = ['agree', 'disagree', 'unrelated', 'uncertain']

function validateComparison(value: DirectComparison, pairs: Map<string, EvidencePair>): void {
  if (!value || typeof value !== 'object') throw new Error('invalid_direct_comparison')
  const pair = pairs.get(value.pair_key)
  if (!pair || !Array.isArray(value.evidence_ids) || value.evidence_ids.length !== 2 || typeof value.evidence_ids[0] !== 'string' || typeof value.evidence_ids[1] !== 'string' || pairKey(value.evidence_ids[0], value.evidence_ids[1]) !== pair.key || !relations.includes(value.relation) || typeof value.question_version !== 'string' || !value.question_version || !('provider_diagnostics' in value) || (value.cached !== undefined && typeof value.cached !== 'boolean')) throw new Error('invalid_direct_comparison')
  const probabilities = value.probabilities
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities) || Object.keys(probabilities).length !== relations.length || relations.some(relation => !Number.isFinite(probabilities[relation]) || probabilities[relation] < 0 || probabilities[relation] > 1)) throw new Error('invalid_direct_probabilities')
  const sum = relations.reduce((total, relation) => total + probabilities[relation], 0)
  if (Math.abs(sum - 1) > 0.01 || relations.some(relation => probabilities[relation] > probabilities[value.relation] + 0.000001)) throw new Error('invalid_direct_probabilities')
}

/**
 * 只使用正式直接判斷建立支持邊。反向抽查獨立記錄，不變更正式邊。
 * 每條支持邊皆作為一次種子，按固定順序做 complete-link 擴展；不枚舉所有 clique。
 * n ≤ 64 時位元集擴展為 O(n³)，候選群最多 n(n-1)/2。
 */
export function analyzeComparisons(
  evidence: readonly Evidence[],
  direct: readonly DirectComparison[],
  failures: readonly ComparisonFailure[] = [],
  reverseDiagnostics: readonly DirectComparison[] = []
): ComparisonAnalysis {
  const sorted = orderedEvidence(evidence)
  const pairs = createEvidencePairs(sorted)
  const pairMap = new Map(pairs.map(pair => [pair.key, pair]))
  const byId = new Map(sorted.map((item, index) => [item.id, index]))
  const comparisons = new Map<string, DirectComparison>()
  for (const result of direct) {
    validateComparison(result, pairMap)
    if (comparisons.has(result.pair_key)) throw new Error('duplicate_direct_comparison')
    comparisons.set(result.pair_key, result)
  }
  const failed = new Map<string, ComparisonFailure>()
  for (const failure of failures) {
    if (!pairMap.has(failure.pair_key) || comparisons.has(failure.pair_key) || failed.has(failure.pair_key) || typeof failure.error_code !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(failure.error_code)) throw new Error('invalid_comparison_failure')
    failed.set(failure.pair_key, failure)
  }
  for (const result of reverseDiagnostics) validateComparison(result, pairMap)

  const n = sorted.length
  const bits = sorted.map((_, index) => 1n << BigInt(index))
  const compatible = sorted.map(() => 0n)
  const neighbors: number[][] = sorted.map(() => [])
  // 同素材內不比較，也不計為另一份來源；跨素材必須有直接 agree。
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && sorted[i].material_id === sorted[j].material_id) compatible[i] |= bits[j]
    }
  }
  for (const pair of pairs) {
    if (comparisons.get(pair.key)?.relation !== 'agree') continue
    const a = byId.get(pair.a)!
    const b = byId.get(pair.b)!
    compatible[a] |= bits[b]
    compatible[b] |= bits[a]
    neighbors[a].push(b)
    neighbors[b].push(a)
  }
  for (const list of neighbors) list.sort((a, b) => a - b)

  const groups = new Map<string, ConsensusGroup>()
  for (const pair of pairs) {
    if (comparisons.get(pair.key)?.relation !== 'agree') continue
    let mask = bits[byId.get(pair.a)!] | bits[byId.get(pair.b)!]
    for (let i = 0; i < n; i++) {
      if ((mask & bits[i]) === 0n && (compatible[i] & mask) === mask) mask |= bits[i]
    }
    const evidenceIds = sorted.filter((_, index) => (mask & bits[index]) !== 0n).map(item => item.id)
    const id = `consensus:${JSON.stringify(evidenceIds)}`
    groups.set(id, { id, evidence_ids: evidenceIds })
  }
  const consensusGroups = [...groups.values()].sort((a, b) => compareIds(a.id, b.id))
  const positionCandidates: PositionCandidate[] = [
    ...sorted.map(item => ({ id: `position:${JSON.stringify([item.id])}`, evidence_ids: [item.id] })),
    ...consensusGroups.map(group => ({ id: `position:${JSON.stringify(group.evidence_ids)}`, evidence_ids: group.evidence_ids })),
  ]
  const grouped = new Set(consensusGroups.flatMap(group => group.evidence_ids))
  const disputes: DisputeCandidate[] = []
  const incompletePairs: IncompletePair[] = []
  for (const pair of pairs) {
    const judgment = comparisons.get(pair.key)
    if (judgment?.relation === 'disagree') disputes.push({ id: `dispute:${pair.key}`, pair_key: pair.key, evidence_ids: [pair.a, pair.b], direct: judgment })
    if (!judgment) {
      const failure = failed.get(pair.key) ?? null
      incompletePairs.push({ pair_key: pair.key, evidence_ids: [pair.a, pair.b], status: failure ? 'failed' : 'missing', failure })
    }
  }

  // 每個起點只做一次 BFS，保留可重現的最短支持路徑與直接反例；不補造端點邊。
  const parents: number[][] = []
  for (let start = 0; start < n; start++) {
    const parent = Array<number>(n).fill(-1)
    parent[start] = start
    const queue = [start]
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      for (const next of neighbors[current]) {
        if (parent[next] === -1) { parent[next] = current; queue.push(next) }
      }
    }
    parents.push(parent)
  }
  const candidatePaths: CandidatePath[] = []
  for (const pair of pairs) {
    const judgment = comparisons.get(pair.key) ?? null
    if (judgment?.relation === 'agree') continue
    const start = byId.get(pair.a)!
    const end = byId.get(pair.b)!
    const parent = parents[start]
    if (parent[end] === -1) continue
    const path: string[] = []
    for (let cursor = end; cursor !== start; cursor = parent[cursor]) path.push(sorted[cursor].id)
    path.push(pair.a)
    path.reverse()
    const failure = failed.get(pair.key) ?? null
    const status = judgment ? judgment.relation as 'disagree' | 'unrelated' | 'uncertain' : failure ? 'failed' : 'pending'
    const exclusionReason = status === 'pending' ? 'missing_direct_comparison' : status === 'failed' ? 'failed_direct_comparison' : `direct_${status}` as const
    candidatePaths.push({ pair_key: pair.key, evidence_ids: [pair.a, pair.b], path, status, exclusion_reason: exclusionReason, direct: judgment, failure })
  }
  return {
    pairs,
    direct_comparisons: pairs.flatMap(pair => comparisons.has(pair.key) ? [comparisons.get(pair.key)!] : []),
    reverse_diagnostics: [...reverseDiagnostics],
    consensus_groups: consensusGroups,
    position_candidates: positionCandidates,
    disputes,
    candidate_paths: candidatePaths,
    incomplete_pairs: incompletePairs,
    unclassified_evidence_ids: sorted.filter(item => !grouped.has(item.id)).map(item => item.id),
    diagnostics: {
      evidence_count: n,
      eligible_pairs: pairs.length,
      direct_judgments: comparisons.size,
      cache_hits: direct.filter(result => result.cached).length,
      inferred_candidates: candidatePaths.length,
      incomplete_pairs: incompletePairs.length,
    },
  }
}
