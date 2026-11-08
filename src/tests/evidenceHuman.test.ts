import { describe, expect, it } from 'vite-plus/test'
import { validateHumanData } from '../ai/human'
import type { MaterialSource } from '../ai/source'

const materials: MaterialSource[] = [{ id: 25, issue_id: 13, source_name: '來源甲', source_url: 'https://example.test/source', content: '素材主張。', content_hash: 'fixture' }]
function humanDraft() {
  return {
    consensus: { Overview: '共同關注的問題。', items: [{ Title: '共同方向', description: '兩份主張所支持的方向。' }] },
    disputes: { Overview: '這是處理狀態：本次沒有經驗證的爭點項目。', items: [] },
    positions: {
      Overview: '各組立場關注不同面向。',
      items: [
        {
          name: '來源呈現的主張',
          Sources: [{ Title: '來源甲', href: 'https://example.test/source', material_id: 25 }],
          Core_concern: '從明示主張綜整的核心關注。',
          opinions: [{ Title: '具體主張', description: '保留適用條件。' }],
        },
      ],
    },
  }
}

describe('人改草稿的必填概述與核心關注', () => {
  it('接受非空概述與核心關注，不讓來源網址或識別被冒充', () => {
    expect(validateHumanData(humanDraft(), materials)).toBe(true)
    const forged = humanDraft()
    forged.positions.items[0].Sources[0].href = 'https://forged.test/'
    expect(validateHumanData(forged, materials)).toBe(false)
  })

  it('三種概述均拒絕 null、空白、缺欄位及非文字值，空分區也必須有說明', () => {
    for (const section of ['consensus', 'disputes', 'positions'] as const) {
      for (const missing of [null, '', ' \r\n ', [], 42]) {
        const draft = humanDraft()
        Object.assign(draft[section], { Overview: missing })
        expect(validateHumanData(draft, materials)).toBe(false)
      }
      const draft = humanDraft()
      Reflect.deleteProperty(draft[section], 'Overview')
      expect(validateHumanData(draft, materials)).toBe(false)
    }
  })

  it('每組核心關注均拒絕 null、空白、缺欄位及非文字值', () => {
    for (const missing of [null, '', ' \t ', [], {}]) {
      const draft = humanDraft()
      Object.assign(draft.positions.items[0], { Core_concern: missing })
      expect(validateHumanData(draft, materials)).toBe(false)
    }
    const draft = humanDraft()
    Reflect.deleteProperty(draft.positions.items[0], 'Core_concern')
    expect(validateHumanData(draft, materials)).toBe(false)
  })
})
