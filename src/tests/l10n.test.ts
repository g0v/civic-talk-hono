import { describe, it, expect } from 'vite-plus/test'
import { messages as zhTW } from '../l10n/zh-TW'
import { messages as en } from '../l10n/en'

// zh-TW 是 MessageKey 的真實來源；en 由 TypeScript 靜態強制覆蓋所有 key，
// 但這裡做運行時驗證以提供清晰的失敗訊息（顯示具體缺少哪些 key）。

const zhTWKeys = Object.keys(zhTW)
const enKeys = Object.keys(en)

describe('i18n key 同步', () => {
  it('zh-TW 的 key 在 en 裡都存在（en 沒有缺少 zh-TW 的 key）', () => {
    const missing = zhTWKeys.filter(k => !Object.hasOwn(en as Record<string, string>, k))
    expect(missing).toEqual([])
  })

  it('en 的 key 在 zh-TW 裡都存在（zh-TW 沒有缺少 en 的 key）', () => {
    const missing = enKeys.filter(k => !Object.hasOwn(zhTW as Record<string, string>, k))
    expect(missing).toEqual([])
  })

  it('兩個語言檔的 key 數量相同', () => {
    expect(zhTWKeys.length).toBe(enKeys.length)
  })
})
