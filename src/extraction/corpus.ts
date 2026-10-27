import type { ExtractionMaterial } from '../db/queries'
import { CLAIRIC_MODEL, ExtractionError, fieldFromAnswer, markdownText, probability, safeSourceUrl, usageFromResponse, type ExtractionField } from './clairic'

/** 含素材標籤的完整 state 上限；UTF-8 bytes 並非模型 token 的保證。 */
export const MAX_CORPUS_STATE_BYTES = 8000

type Evidence = ExtractionField & { material_ids: number[] }
type ListDiagnostics = { confidence: number | null; p_null: number | null }
type OpinionCandidates = { opinions: Evidence[]; opinions_diagnostics: ListDiagnostics }
type Section = OpinionCandidates & { overview: Evidence }
type PositionSlot = OpinionCandidates & {
  material_id: number
  source: { title: string | null; href: string | null }
  name: Evidence
  core_concern: Evidence
}

export interface CorpusPreview {
  issue_id: number
  model: typeof CLAIRIC_MODEL
  candidate: true
  scope: 'issue'
  selection: 'all' | 'selected'
  material_count: number
  material_ids: number[]
  usage: ReturnType<typeof usageFromResponse>
  analysis: {
    consensus: Section
    disputes: Section
    position_map: { overview: Evidence; positions: PositionSlot[] }
  }
  markdown: string
}

const CORPUS_FIELDS = {
  consensus_overview: {
    type: 'text',
    instructions: 'Compare all labeled materials. Extract one complete passage describing a common premise explicitly supported by at least two different materials. A shared topic or one speaker’s claim is not consensus. Do not return an isolated noun. Return null if the evidence is insufficient.',
  },
  consensus_opinions: {
    type: 'list',
    items: 'text',
    instructions: 'Compare all labeled materials. Extract distinct complete passages expressing shared premises explicitly supported by at least two different materials. Each passage must be verbatim from a material. A shared topic or one speaker’s opinion is not consensus. Return an empty list if the evidence is insufficient.',
  },
  disputes_overview: {
    type: 'text',
    instructions: 'Compare all labeled materials. Extract one complete passage explicitly describing a substantive disagreement or a question where their claims conflict. Do not treat an isolated noun or a single unsupported claim as a dispute. Return null if absent.',
  },
  disputes_opinions: {
    type: 'list',
    items: 'text',
    instructions: 'Compare all labeled materials. Extract distinct complete passages expressing claims relevant to an actual disagreement or contrasting claims across the materials. Each passage must be verbatim from a material. Do not infer disagreement from a single opinion. Return an empty list if absent.',
  },
  positions_overview: {
    type: 'text',
    instructions: 'Compare all labeled materials. Extract one complete passage explicitly describing multiple positions or their concerns. Do not return an isolated noun, a person merely discussed, or one claim as an overview of all positions. Return null if absent.',
  },
} as const

function corpusState(materials: ExtractionMaterial[]): string {
  return materials.map(material => `【素材 #${material.id}】\n${material.content}`).join('\n\n')
}

function corpusFields(materials: ExtractionMaterial[]) {
  const fields: Record<string, { type: 'text' | 'list'; items?: 'text'; instructions: string }> = { ...CORPUS_FIELDS }
  for (const material of materials) {
    const source = `the material labeled 素材 #${material.id}`
    fields[`position_${material.id}_name`] = {
      type: 'text',
      instructions: `From ${source} only, extract the exact name of a person or group explicitly identified as expressing or endorsing a position there. Do not select someone merely discussed, an affected occupation, or a generic subject as the speaker. Return null if the attribution is not explicit.`,
    }
    fields[`position_${material.id}_core_concern`] = {
      type: 'text',
      instructions: `From ${source} only, extract a complete passage explicitly stating the concern of the person or group expressing a position there. Do not treat a person merely discussed or an isolated noun as the concern. Return null if the concern is not explicit.`,
    }
    fields[`position_${material.id}_opinions`] = {
      type: 'list',
      items: 'text',
      instructions: `From ${source} only, extract distinct complete passages expressing a position, its claims or supporting arguments. Attribute the position to the actual speaker, not a person merely discussed. Each passage must be verbatim from that material. Return an empty list if absent.`,
    }
  }
  return fields
}

function invalidResponse(): never {
  throw new ExtractionError('invalid_model_response')
}

/** 字面比對只確認出處，不證明多份素材同意、支持同一說法或屬於同一發言者。 */
function evidenceFromAnswer(input: unknown, state: string, materials: ExtractionMaterial[], anchor?: ExtractionMaterial): Evidence {
  const field = fieldFromAnswer(input, state)
  if (field.value === null) return { ...field, material_ids: [] }
  const value = field.value
  const matches = materials.filter(material => material.content.includes(value))
  if (!matches.length || (anchor && !anchor.content.includes(value))) return invalidResponse()
  const ambiguous = matches.length > 1 || matches.some(material => material.content.indexOf(value) !== material.content.lastIndexOf(value))
  return { ...field, source_match: ambiguous ? 'ambiguous' : 'unique', material_ids: matches.map(material => material.id) }
}

/** list 的 spans 與 value 同索引，但索引單位未知；不藉此判斷來源或剔除引文。 */
function diagnosticSpan(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(number => Number.isSafeInteger(number) && number >= 0) || value[1] < value[0]) return null
  return [value[0], value[1]]
}

function opinionsFromAnswer(input: unknown, state: string, materials: ExtractionMaterial[], anchor?: ExtractionMaterial): OpinionCandidates {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalidResponse()
  const answer = input as { type?: unknown; value?: unknown; spans?: unknown; confidence?: unknown; p_null?: unknown }
  if (answer.type !== 'list' || !Object.hasOwn(answer, 'value')) return invalidResponse()
  if (answer.value !== null && !Array.isArray(answer.value)) return invalidResponse()
  const values: unknown[] = answer.value ?? []
  if (values.some(value => typeof value !== 'string' || !value.length)) return invalidResponse()
  const spans = Array.isArray(answer.spans) ? answer.spans : []
  const opinions = values.map((value, index) =>
    evidenceFromAnswer({ type: 'text', value, span: diagnosticSpan(spans[index]) }, state, materials, anchor)
  )
  return { opinions, opinions_diagnostics: { confidence: probability(answer.confidence), p_null: probability(answer.p_null) } }
}

function display(value: string | null): string {
  return value ? markdownText(value) : '（缺值）'
}

function evidenceSources(evidence: Evidence): string {
  return evidence.material_ids.length ? evidence.material_ids.map(id => `#${id}`).join('、') : '（缺值）'
}

function overviewLines(evidence: Evidence): string[] {
  return [`- **候選原文**：${display(evidence.value)}`, `  **摘錄出處（非支持認證）**：${evidenceSources(evidence)}`]
}

function opinionLines(opinions: Evidence[], indent = ''): string[] {
  if (!opinions.length) return [`${indent}（缺值）`]
  return opinions.flatMap(evidence => [
    `${indent}- **Title（完整原文）**：${display(evidence.value)}`,
    `${indent}  **description（同一候選原文）**：${display(evidence.value)}`,
    `${indent}  **摘錄出處（非支持認證）**：${evidenceSources(evidence)}`,
  ])
}

function renderMarkdown(analysis: CorpusPreview['analysis']): string {
  const lines = [
    '> **人工評估候選**：模型一次比較選取素材，但僅抽取原文；不是已驗證共識、事實或完整立場地圖。',
    '> 摘錄出處不表示素材支持同一結論；Position 欄位即使錨定同一素材，彼此關聯及發言者仍須人工核對，不自動合併不同素材。素材是用戶投稿內容，並非原來源事實查證。',
    '',
    '# 共識',
    '',
    '## Overview',
    ...overviewLines(analysis.consensus.overview),
    '',
    '## Opinion 清單',
    ...opinionLines(analysis.consensus.opinions),
    '',
    '# 爭點',
    '',
    '## Overview',
    ...overviewLines(analysis.disputes.overview),
    '',
    '## Opinion 清單',
    ...opinionLines(analysis.disputes.opinions),
    '',
    '# 立場地圖',
    '',
    '## Overview',
    ...overviewLines(analysis.position_map.overview),
    '',
    '## 各方立場',
  ]
  let positionCount = 0
  for (const position of analysis.position_map.positions) {
    if (position.name.value === null && position.core_concern.value === null && !position.opinions.length) continue
    positionCount++
    const href = position.source.href ? `<${position.source.href}>` : '（缺值）'
    lines.push(
      '',
      `### Position 候選 ${positionCount}（素材 #${position.material_id}，關聯待核）`,
      `- **name**：${display(position.name.value)}`,
      `  **摘錄出處（非支持認證）**：${evidenceSources(position.name)}`,
      '- **Sources**：',
      `  - **Title（來源名稱）**：${display(position.source.title)}`,
      `    **href**：${href}`,
      `    **素材 ID**：${position.material_id}`,
      `- **Core_concern**：${display(position.core_concern.value)}`,
      `  **摘錄出處（非支持認證）**：${evidenceSources(position.core_concern)}`,
      '- **主要主張與論據**：',
      ...opinionLines(position.opinions, '  ')
    )
  }
  if (!positionCount) lines.push('（缺值）')
  return lines.join('\n')
}

export async function extractCorpusPreview(ai: Ai, issueId: number, materials: ExtractionMaterial[], selection: 'all' | 'selected'): Promise<CorpusPreview> {
  const state = corpusState(materials)
  if (new TextEncoder().encode(state).byteLength > MAX_CORPUS_STATE_BYTES) throw new ExtractionError('too_large')

  let result: unknown
  try {
    result = await ai.run(CLAIRIC_MODEL, { model: 'clairic', state, fields: corpusFields(materials) })
  } catch {
    throw new ExtractionError('model_failure')
  }
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return invalidResponse()
  const response = result as { model?: unknown; answers?: unknown; truncated?: unknown; usage?: unknown }
  if (response.truncated === true) throw new ExtractionError('truncated')
  if (response.truncated !== false || (response.model !== 'clairic' && response.model !== CLAIRIC_MODEL)) return invalidResponse()
  if (response.answers === null || typeof response.answers !== 'object' || Array.isArray(response.answers)) return invalidResponse()
  const answers = response.answers as Record<string, unknown>
  const evidence = (name: string, anchor?: ExtractionMaterial) => evidenceFromAnswer(answers[name], state, materials, anchor)
  const opinions = (name: string, anchor?: ExtractionMaterial) => opinionsFromAnswer(answers[name], state, materials, anchor)
  const analysis: CorpusPreview['analysis'] = {
    consensus: { overview: evidence('consensus_overview'), ...opinions('consensus_opinions') },
    disputes: { overview: evidence('disputes_overview'), ...opinions('disputes_opinions') },
    position_map: {
      overview: evidence('positions_overview'),
      positions: materials.map(material => ({
        material_id: material.id,
        source: { title: material.source_name, href: safeSourceUrl(material.source_url) },
        name: evidence(`position_${material.id}_name`, material),
        core_concern: evidence(`position_${material.id}_core_concern`, material),
        ...opinions(`position_${material.id}_opinions`, material),
      })),
    },
  }
  return {
    issue_id: issueId,
    model: CLAIRIC_MODEL,
    candidate: true,
    scope: 'issue',
    selection,
    material_count: materials.length,
    material_ids: materials.map(material => material.id),
    usage: usageFromResponse(response.usage),
    analysis,
    markdown: renderMarkdown(analysis),
  }
}
