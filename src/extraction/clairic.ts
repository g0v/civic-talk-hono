import type { ExtractionMaterial } from '../db/queries'

/** 此模型只摘錄原文；預覽不產生結論，也不發布或儲存彙整。 */
export const CLAIRIC_MODEL = '@cf/cloudflare/clairic'
export const MAX_MATERIALS = 8
export const MAX_MATERIAL_BYTES = 4000

// 每份素材只請求一組固定欄位，避免把不同素材的平行陣列任意配對。
export const CLAIRIC_FIELDS = {
  consensus_overview: { type: 'text', instructions: 'Extract one passage explicitly describing shared ground or a common premise. Do not infer agreement. Return null if absent.' },
  consensus_opinion: { type: 'text', instructions: 'Extract one complete passage explicitly stating a shared premise. Do not infer agreement from this source alone. Return null if absent.' },
  disputes_overview: { type: 'text', instructions: 'Extract one passage explicitly describing a disagreement or disputed issue. Return null if absent.' },
  disputes_opinion: { type: 'text', instructions: 'Extract one complete passage explicitly expressing a disputed claim or point of disagreement. Return null if absent.' },
  positions_overview: { type: 'text', instructions: 'Extract one passage explicitly describing the positions in this material. Return null if absent.' },
  position_name: { type: 'text', instructions: 'Extract the explicit name of a position or group presenting a position. Do not invent a name. Return null if absent.' },
  position_core_concern: { type: 'text', instructions: 'Extract one passage explicitly stating the concern of a position or group. Return null if absent.' },
  position_opinion: { type: 'text', instructions: 'Extract one complete passage expressing a position, its claim or supporting argument. Return null if absent.' },
} as const

type FieldName = keyof typeof CLAIRIC_FIELDS

export interface ExtractionField {
  value: string | null
  /** 模型提供的原始索引，單位未經確認；不可用它切原文。 */
  span: [number, number] | null
  confidence: number | null
  p_null: number | null
  source_match: 'unique' | 'ambiguous' | null
}

type Usage = { input_tokens: number; output_tokens: number } & Partial<Record<'state_tokens' | 'image_tokens' | 'schema_tokens' | 'passes', number>>
type Extraction = { material_id: number; fields: Record<FieldName, ExtractionField>; usage: Usage }

export interface ExtractionPreview {
  issue_id: number
  model: typeof CLAIRIC_MODEL
  candidate: true
  markdown: string
  material_count: number
  extractions: Extraction[]
}

export class ExtractionError extends Error {
  constructor(readonly kind: 'model_failure' | 'truncated' | 'invalid_model_response' | 'too_large') {
    super(kind)
  }
}

function invalidResponse(): never {
  throw new ExtractionError('invalid_model_response')
}

export function probability(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return invalidResponse()
  return value
}

export function fieldFromAnswer(input: unknown, content: string): ExtractionField {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalidResponse()
  const answer = input as { type?: unknown; value?: unknown; span?: unknown; confidence?: unknown; p_null?: unknown }
  if (answer.type !== 'text' || !Object.hasOwn(answer, 'value')) return invalidResponse()
  const value = answer.value
  if (value !== null && (typeof value !== 'string' || value.length === 0 || !content.includes(value))) return invalidResponse()

  // null 時模型可能仍附上 guess 與 guess 的 span；兩者都不能當作抽取結果。
  let span: [number, number] | null = null
  if (value !== null && answer.span !== undefined && answer.span !== null) {
    if (!Array.isArray(answer.span) || answer.span.length !== 2 || !answer.span.every(n => Number.isSafeInteger(n) && n >= 0) || answer.span[1] < answer.span[0]) return invalidResponse()
    span = [answer.span[0], answer.span[1]]
  }
  return {
    value,
    span,
    confidence: probability(answer.confidence),
    p_null: probability(answer.p_null),
    source_match: value === null ? null : content.indexOf(value) === content.lastIndexOf(value) ? 'unique' : 'ambiguous',
  }
}

export function usageFromResponse(value: unknown): Usage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalidResponse()
  const input = value as Partial<Record<'input_tokens' | 'output_tokens' | 'state_tokens' | 'image_tokens' | 'schema_tokens' | 'passes', unknown>>
  const usage = {} as Usage
  const keys = ['input_tokens', 'output_tokens', 'state_tokens', 'image_tokens', 'schema_tokens', 'passes'] as const
  for (const key of keys) {
    const count = input[key]
    if (count === undefined && key !== 'input_tokens' && key !== 'output_tokens') continue
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return invalidResponse()
    usage[key] = count
  }
  return usage
}

function extractionFromResponse(input: unknown, material: ExtractionMaterial): Extraction {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalidResponse()
  const response = input as { model?: unknown; answers?: unknown; truncated?: unknown; usage?: unknown }
  if (response.truncated === true) throw new ExtractionError('truncated')
  if (response.truncated !== false || (response.model !== 'clairic' && response.model !== CLAIRIC_MODEL)) return invalidResponse()
  if (response.answers === null || typeof response.answers !== 'object' || Array.isArray(response.answers)) return invalidResponse()
  const answers = response.answers as Partial<Record<FieldName, unknown>>
  const fields = {} as Record<FieldName, ExtractionField>
  for (const key of Object.keys(CLAIRIC_FIELDS) as FieldName[]) fields[key] = fieldFromAnswer(answers[key], material.content)
  return { material_id: material.id, fields, usage: usageFromResponse(response.usage) }
}

/** 把不可信的原文顯示成文字，避免 Markdown、原始 HTML 或換行注入結構。 */
export function markdownText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+\-.!|~]/g, '\\$&')
}

function display(value: string | null | undefined): string {
  return value ? markdownText(value) : '（缺值）'
}

/** 限制連結僅取資料庫中的 http(s) 來源，不抓取、不使用模型產出的網址。 */
export function safeSourceUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function sourceHref(value: string | null): string {
  const url = safeSourceUrl(value)
  return url ? `<${url}>` : '（缺值）'
}

const CLOSING_QUOTE: Readonly<Record<string, string>> = { '「': '」', '『': '』', '“': '”', '‘': '’', '"': '"' }

/** Title 僅是同一候選原文的首句，並非模型改寫或生成的標題。 */
function firstSentence(value: string): string {
  const quotes: string[] = []
  for (let i = 0; i < value.length; i++) {
    const character = value[i]!
    if (quotes.length && quotes[quotes.length - 1] === character) {
      quotes.pop()
      continue
    }
    if (CLOSING_QUOTE[character]) {
      quotes.push(CLOSING_QUOTE[character]!)
      continue
    }
    if (quotes.length) continue
    if ('」』”’'.includes(character)) return value
    if ('。！？!?\n\r'.includes(character)) return value.slice(0, i + 1)
    if (character === '.' && (i + 1 === value.length || /\s/u.test(value[i + 1]!))) return value.slice(0, i + 1)
  }
  return value
}

function overview(extractions: Extraction[], key: 'consensus_overview' | 'disputes_overview' | 'positions_overview'): string[] {
  return extractions.map(extraction => `- 素材 #${extraction.material_id}：${display(extraction.fields[key].value)}`)
}

function opinionLines(extractions: Extraction[], key: 'consensus_opinion' | 'disputes_opinion', indent = ''): string[] {
  const lines: string[] = []
  for (const extraction of extractions) {
    const value = extraction.fields[key].value
    if (value === null) continue
    lines.push(`${indent}- **Title（原文首句）**：${display(firstSentence(value))}`, `${indent}  **description（同一候選全文）**：${display(value)}`, `${indent}  **素材 ID**：${extraction.material_id}`)
  }
  return lines.length ? lines : [`${indent}（缺值）`]
}

function renderMarkdown(materials: ExtractionMaterial[], extractions: Extraction[]): string {
  const lines = [
    '> **人工評估候選**：僅逐份素材抽取原文；不是已驗證的共識或立場，未進行跨素材共識統整。',
    '> 每份素材在每類最多一個候選，並非完整觀點；同一素材的各欄位是否相關仍須人工核對。Title 僅取同一候選原文首句，並非新擬標題。',
    '',
    '# 共識',
    '',
    '## Overview',
    ...overview(extractions, 'consensus_overview'),
    '',
    '## Opinion 清單',
    ...opinionLines(extractions, 'consensus_opinion'),
    '',
    '# 爭點',
    '',
    '## Overview',
    ...overview(extractions, 'disputes_overview'),
    '',
    '## Opinion 清單',
    ...opinionLines(extractions, 'disputes_opinion'),
    '',
    '# 立場地圖',
    '',
    '## Overview',
    ...overview(extractions, 'positions_overview'),
    '',
    '## 各方立場',
  ]

  let positionCount = 0
  for (const [index, extraction] of extractions.entries()) {
    const { position_name, position_core_concern, position_opinion } = extraction.fields
    if (position_name.value === null && position_core_concern.value === null && position_opinion.value === null) continue
    const material = materials[index]!
    positionCount++
    lines.push(
      '',
      `### Position ${positionCount}（素材 #${material.id}）`,
      `- **name**：${display(position_name.value)}`,
      '- **Sources**：',
      `  - **Title（來源名稱）**：${display(material.source_name)}`,
      `    **href**：${sourceHref(material.source_url)}`,
      `    **素材 ID**：${material.id}`,
      `- **Core_concern**：${display(position_core_concern.value)}`,
      '- **主要主張與論據**：'
    )
    if (position_opinion.value === null) {
      lines.push('  （缺值）')
    } else {
      lines.push(`  - **Title（原文首句）**：${display(firstSentence(position_opinion.value))}`, `    **description（同一候選全文）**：${display(position_opinion.value)}`)
    }
  }
  if (!positionCount) lines.push('（缺值）')
  return lines.join('\n')
}

export async function extractIssuePreview(ai: Ai, issueId: number, materials: ExtractionMaterial[]): Promise<ExtractionPreview> {
  const extractions: Extraction[] = []
  for (const material of materials) {
    let response: unknown
    try {
      response = await ai.run(CLAIRIC_MODEL, { model: 'clairic', state: material.content, fields: CLAIRIC_FIELDS })
    } catch {
      throw new ExtractionError('model_failure')
    }
    extractions.push(extractionFromResponse(response, material))
  }
  return {
    issue_id: issueId,
    model: CLAIRIC_MODEL,
    candidate: true,
    markdown: renderMarkdown(materials, extractions),
    material_count: materials.length,
    extractions,
  }
}
