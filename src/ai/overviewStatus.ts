import { messages as zhTW } from '../l10n/zh-TW'
import { messages as en } from '../l10n/en'
import { messages as ja } from '../l10n/ja'
import type { GenerationLanguage, GenerationSection } from './generation'

const catalogs = { 'zh-TW': zhTW, en, ja } as const
const sectionKeys = {
  consensus: 'ai_overview_section_consensus',
  disputes: 'ai_overview_section_disputes',
  positions: 'ai_overview_section_positions',
} as const
const statusKeys = {
  no_findings: 'ai_overview_no_findings',
  failed: 'ai_overview_failed',
  not_started: 'ai_overview_not_started',
} as const

/** 只描述處理狀態，不推論素材內容，也不建立虛假的來源引用。 */
export function statusOverview(section: GenerationSection, status: keyof typeof statusKeys, language: GenerationLanguage): string {
  const catalog = catalogs[language]
  return catalog[statusKeys[status]].replace('{section}', catalog[sectionKeys[section]])
}
