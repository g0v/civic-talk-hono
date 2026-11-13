import { MODEL_SELECTORS } from './models'
import type { Artifact, InputManifest } from './store'

export interface ExtractionDebugEntry {
  key: string
  kind: 'raw' | 'legacy' | 'diagnostic'
  material_id: number
  content_hash: string
  artifact: { id: string; sha256: string }
  data: Record<string, unknown>
}

export interface ExtractionDebug {
  version: 'extraction-observation-v1'
  job_id: string
  checkpoint: 'A:baseline-observation'
  source_code: { commit: string | null; dirty: boolean | null }
  settings: { clairic_prompt: string | null; evidence_algorithm: string | null; config_sha256: string | null }
  claim: { status: 'unavailable'; reason: 'not_created_at_checkpoint_A' }
  context: { status: 'unavailable'; reason: 'not_created_at_checkpoint_A' }
  materials: Array<{ material_id: number; raw: 'available' | 'unavailable'; legacy: 'available' | 'unavailable' }>
  entries: ExtractionDebugEntry[]
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fields(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function extractionMaterial(stepKey: unknown): number | null {
  if (typeof stepKey !== 'string' || !/^extract:[1-9][0-9]*$/.test(stepKey)) return null
  const id = Number(stepKey.slice('extract:'.length))
  return Number.isSafeInteger(id) ? id : null
}

// 只投影已保存的結果；不重跑 extractor，也不把 legacy quote 改名成 claim／context。
export function buildExtractionDebug(
  jobId: string,
  manifest: InputManifest,
  rawArtifacts: Array<Artifact & { materialId: number }>,
  extractions: Artifact[],
  diagnostics: Artifact[]
): ExtractionDebug {
  const settings = object(manifest.settings) ? manifest.settings : {}
  const config = object(settings.config) ? settings.config : {}
  const versions = object(config.versions) ? config.versions : {}
  const hashes = object(settings.hashes) ? settings.hashes : {}
  const source = object(settings.source_code) ? settings.source_code : {}
  const entries: ExtractionDebugEntry[] = []
  const materials = new Map(manifest.materials.map(material => [material.id, material]))
  const add = (artifact: Artifact, materialId: number, kind: ExtractionDebugEntry['kind'], data: Record<string, unknown>) => {
    const material = materials.get(materialId)
    if (!material) return
    entries.push({
      key: `${kind}:${artifact.id}:${artifact.payloadHash}:${materialId}`,
      kind,
      material_id: materialId,
      content_hash: material.content_hash,
      artifact: { id: artifact.id, sha256: artifact.payloadHash },
      data,
    })
  }
  for (const artifact of rawArtifacts) {
    if (!object(artifact.payload) || artifact.payload.selector !== MODEL_SELECTORS.clairic) continue
    const response = object(artifact.payload.response) ? artifact.payload.response : {}
    const answers = object(response.answers) ? response.answers : {}
    const answer = object(answers.claims) ? answers.claims : null
    const provenance = object(artifact.payload.provenance) ? artifact.payload.provenance : {}
    add(artifact, artifact.materialId, 'raw', {
      model_selector: artifact.payload.selector,
      provider_model: text(response.model),
      request_sha256: text(provenance.request_sha256),
      ...fields(response, ['truncated']),
      claims: answer ? fields(answer, ['type', 'value', 'spans', 'confidence', 'p_null']) : null,
    })
  }
  const coverageFields = ['status', 'evidence_count', 'rejected', 'duplicates', 'error_code', 'usage_status'] as const
  const legacyMaterials = new Set<number>()
  for (const artifact of extractions) {
    if (!object(artifact.payload)) continue
    const evidence = Array.isArray(artifact.payload.evidence) ? artifact.payload.evidence.filter(object) : []
    const coverage = Array.isArray(artifact.payload.coverage) ? artifact.payload.coverage.filter(object) : []
    for (const material of manifest.materials) {
      const selected = evidence.filter(item => item.material_id === material.id)
      const detail = coverage.find(item => item.material_id === material.id)
      if (!selected.length && !detail) continue
      legacyMaterials.add(material.id)
      add(artifact, material.id, 'legacy', {
        evidence: selected.map(item => fields(item, ['id', 'material_id', 'quote', 'raw_quote', 'raw_span', 'expanded_span', 'provider_span'])),
        coverage: detail ? fields(detail, coverageFields) : null,
      })
    }
  }
  for (const artifact of diagnostics) {
    if (!object(artifact.payload)) continue
    const payload = artifact.payload
    if (payload.stage === 'provider') {
      const materialId = extractionMaterial(payload.step_key)
      if (materialId !== null) add(artifact, materialId, 'diagnostic', fields(payload, ['stage', 'code', 'model_selector', 'category', 'http_status', 'provider_code']))
    } else if (payload.stage === 'extraction' && Array.isArray(payload.coverage)) {
      for (const coverage of payload.coverage) {
        if (!object(coverage) || typeof coverage.material_id !== 'number' || legacyMaterials.has(coverage.material_id)) continue
        // state_mapping 可能包含完整 state_text，不能跟著 coverage 一起輸出。
        add(artifact, coverage.material_id, 'diagnostic', { stage: 'extraction', coverage: fields(coverage, coverageFields) })
      }
    }
  }
  return {
    version: 'extraction-observation-v1',
    job_id: jobId,
    checkpoint: 'A:baseline-observation',
    source_code: { commit: text(source.commit), dirty: typeof source.dirty === 'boolean' ? source.dirty : null },
    settings: { clairic_prompt: text(versions.clairic_prompt), evidence_algorithm: text(versions.evidence_algorithm), config_sha256: text(hashes.config) },
    claim: { status: 'unavailable', reason: 'not_created_at_checkpoint_A' },
    context: { status: 'unavailable', reason: 'not_created_at_checkpoint_A' },
    materials: manifest.materials.map(material => ({
      material_id: material.id,
      raw: entries.some(entry => entry.material_id === material.id && entry.kind === 'raw') ? 'available' : 'unavailable',
      legacy: legacyMaterials.has(material.id) ? 'available' : 'unavailable',
    })),
    entries,
  }
}
