import type { IncompletePair } from './comparison'
import type { EvidenceRejection } from './evidence'
import type { GenerationLanguage, GenerationSection, GenerationSectionState } from './generation'

export const MANUAL_REVIEW_GUIDE_POLICY = {
  version: 'partial-manual-review-v2-empty-sections',
  text: {
    'zh-TW': {
      title: '人工校對補充指南',
      notice: '這是部分草稿，未替換已保存的完整摘要。以下是程式診斷，不是素材結論；所有 AI 文字仍未經人工驗證。',
      missing: '缺少有效內容的項目',
      complete: '各生成分項已有有效結果；部分狀態來自下列提取或比較缺口。',
      failed: '生成或驗證失敗',
      not_started: '未啟動生成',
      no_findings: '處理完成，但沒有符合規則的可交付項目（no_findings）；不是生成或驗證失敗。',
      empty: '請核對原文、提取覆蓋與候選，再決定補充或保留空白；不要為填滿區段而捏造共識、爭點或立場。',
      section: '請回查原文與引用，補上此分項的 Overview／項目；保留歸屬、必要條件與不同立場，不把狀態占位當結論。',
      introduction: '請讀取議題簡介與有效三分項，補寫連貫的 Markdown 議題說明；不要逐段拼接，也不要把缺漏當成共識或無歧見。',
      coverage: '提取與比較缺口',
      material: '回查此素材原文，核對未提取／被拒收的主張及座標，再檢查是否影響三分項。',
      pair: '人工核對此證據對的關係，不能用間接路徑或同主題代替直接支持／反對。',
      checklist: '校對順序',
      checks: [
        '先補來源／比較缺口，再校對共識、爭點、立場與引用，最後補寫或重讀 introduction。',
        'no_findings 是已完成但沒有符合規則的項目，不列為生成失敗；整份仍以部分草稿交付，也不代表現實中沒有共識、爭點或立場。',
        '驗證碼只標示已知失敗範圍，不推測未回報的項目或句子。保留原 AI 稿與引用，人工修訂仍是 human_unverified，不會自動發布或重跑模型。',
      ],
    },
    en: {
      title: 'Manual review and completion guide',
      notice: 'This is a partial draft and has not replaced the saved complete summary. These are program diagnostics, not source conclusions; all AI text remains human-unverified.',
      missing: 'Items without valid generated content',
      complete: 'All generation sections have valid results; partial status comes from extraction or comparison gaps below.',
      failed: 'Generation or validation failed',
      not_started: 'Generation not started',
      no_findings: 'Processing completed without qualifying deliverable items (no_findings); this is not a generation or validation failure.',
      empty: 'Review the original text, extraction coverage and candidates, then decide whether to supplement or retain the empty section. Do not invent agreement, disputes or positions to fill it.',
      section: 'Check original sources and citations, then complete this section’s Overview/items. Preserve attribution, conditions and differing positions; do not treat status placeholders as findings.',
      introduction: 'Read the issue background and valid sections, then write a coherent Markdown introduction. Do not concatenate sections or interpret missing content as agreement or absence of disagreement.',
      coverage: 'Extraction and comparison gaps',
      material: 'Check this material’s original text, missing/rejected claims and coordinates, then review their effect on the three sections.',
      pair: 'Review this evidence pair directly; indirect paths or a shared topic do not establish support or disagreement.',
      checklist: 'Review order',
      checks: [
        'Address source/comparison gaps, review consensus, disputes, positions and citations, then write or reread the introduction.',
        'no_findings means processing completed without qualifying items, not a generation failure. The overall result remains a partial draft; it does not imply absence of real-world agreement, disputes or positions.',
        'Codes identify only known failure scope, not unreported items or sentences. Preserve the AI base and citations; edits remain human_unverified and do not publish or rerun models automatically.',
      ],
    },
    ja: {
      title: '手動校正・補足ガイド',
      notice: 'これは部分草稿であり、保存済みの完全な要約を置き換えていません。以下は処理診断で、資料の結論ではありません。AI 文は人手未検証です。',
      missing: '有効な生成内容がない項目',
      complete: '生成各項には有効な結果があり、部分状態の原因は以下の抽出・比較の欠落です。',
      failed: '生成または検証の失敗',
      not_started: '生成未開始',
      no_findings: '処理は完了しましたが、条件に合う提供可能な項目がありません（no_findings）。生成・検証の失敗ではありません。',
      empty: '原文・抽出範囲・候補を確認し、補足するか空欄を維持するか判断してください。項目を埋めるために合意・争点・立場を創作しないでください。',
      section: '原文と引用を確認し、この項目の Overview と項目を補足してください。帰属・条件・異なる立場を保ち、状態表示を結論にしないでください。',
      introduction: '議題の背景と有効な三項を読み、連続した Markdown の議題説明を補ってください。単純に連結せず、欠落を合意や対立なしと解釈しないでください。',
      coverage: '抽出・比較の欠落',
      material: 'この資料の原文、未抽出・拒否された主張と座標を確認し、三項への影響を点検してください。',
      pair: 'この証拠ペアを直接確認してください。間接経路や同じ話題だけで支持・反対を推定しないでください。',
      checklist: '校正の順序',
      checks: [
        '資料・比較の欠落を補い、合意・争点・立場と引用を点検した後、introduction を補足または再読してください。',
        'no_findings は処理済みで条件に合う項目がない状態で、生成失敗ではありません。全体は部分草稿として扱い、現実の合意・争点・立場の不存在を意味しません。',
        '検証コードは既知の失敗範囲のみを示し、未報告の項目や文は推測しません。AI 原稿と引用を保ち、修正後も human_unverified のままで自動公開・モデル再実行はしません。',
      ],
    },
  },
} as const

type ReviewContext = {
  readonly language: GenerationLanguage
  readonly generation: readonly {
    readonly section: GenerationSection | 'introduction'
    readonly status: GenerationSectionState
    readonly reason: string | null
    readonly validation_code: string | null
  }[]
  readonly coverage: readonly {
    readonly material_id: number
    readonly status: 'complete' | 'partial' | 'failed'
    readonly error_code: string | null
    readonly rejected: readonly EvidenceRejection[]
  }[]
  readonly incomplete_pairs: readonly IncompletePair[]
}

export function buildManualReviewGuide(context: ReviewContext): string {
  const text = MANUAL_REVIEW_GUIDE_POLICY.text[context.language]
  const missing: string[] = []
  for (const outcome of context.generation) {
    switch (outcome.status) {
      case 'completed':
        break
      case 'no_findings':
        missing.push(`- \`/${outcome.section}\`: ${text.no_findings}\n  ${text.empty}`)
        break
      case 'failed':
      case 'not_started':
        missing.push(`- \`/${outcome.section}\`: ${text[outcome.status]} | reason=\`${outcome.reason}\` | validation_code=\`${outcome.validation_code}\`\n  ${outcome.section === 'introduction' ? text.introduction : text.section}`)
        break
      default: {
        const exhaustive: never = outcome.status
        return exhaustive
      }
    }
  }
  const gaps = [
    ...context.coverage.filter(item => item.status !== 'complete').map(item =>
      `- material_id=${item.material_id} | status=${item.status} | reason=\`${item.error_code}\` | rejected=${JSON.stringify(item.rejected.map(({ index, reason }) => ({ index, reason })))}\n  ${text.material}`
    ),
    ...context.incomplete_pairs.map(item =>
      `- evidence_ids=${JSON.stringify(item.evidence_ids)} | status=${item.status} | reason=\`${item.failure?.error_code ?? null}\`\n  ${text.pair}`
    ),
  ]
  return [
    `# ${text.title}`, text.notice, `## ${text.missing}`, ...missing,
    ...(missing.length ? [] : [text.complete]),
    ...(gaps.length ? [`## ${text.coverage}`, ...gaps] : []),
    `## ${text.checklist}`, ...text.checks.map((step, index) => `${index + 1}. ${step}`),
  ].join('\n\n')
}
