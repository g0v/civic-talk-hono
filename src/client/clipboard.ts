import type { Briefing } from '../db/queries'

/** 在點擊當下啟動寫入，讓需要 user activation 的瀏覽器也能複製非同步取得的 prompt。 */
export async function copyTextWhenReady(text: Promise<string | null>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const blob = text.then(value => {
        if (value === null) throw new Error('No prompt to copy')
        return new Blob([value], { type: 'text/plain' })
      })
      // 即使瀏覽器立即拒絕寫入，仍接住後續取消投稿造成的 rejection。
      void blob.catch(() => undefined)
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
    } else {
      const value = await text
      if (value === null) return false
      await navigator.clipboard.writeText(value)
    }
    return true
  } catch {
    return false
  }
}

export type BriefingMarkdownField = 'narrative' | 'consensus' | 'disputes' | 'positions'

/** 取得說明卡欄位的原始 Markdown */
export function briefingMarkdown(briefing: Pick<Briefing, BriefingMarkdownField>, field: BriefingMarkdownField): string {
  return briefing[field] ?? ''
}
