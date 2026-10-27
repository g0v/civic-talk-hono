import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { readHomeSortPreference, saveHomeSortPreference } from '../lib/homeSortPreference'

const STORAGE_KEY = 'civic_home_sort_order'

afterEach(() => vi.unstubAllGlobals())

function browserStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem(key: string) { return values.get(key) ?? null },
      setItem(key: string, value: string) { values.set(key, value) },
    },
  })
  return values
}

describe('首頁排序偏好', () => {
  it.each(['published', 'activity', 'most', 'least'] as const)('儲存並恢復手動選擇的 %s', order => {
    browserStorage()
    saveHomeSortPreference(order)
    expect(readHomeSortPreference()).toBe(order)
  })

  it('rejects missing, empty and unsupported stored values without overwriting storage', () => {
    const values = browserStorage()
    expect(readHomeSortPreference()).toBe('published')
    expect(values.has(STORAGE_KEY)).toBe(false)
    for (const invalid of ['newest', '', 'MOST', 'unknown', '__proto__']) {
      values.set(STORAGE_KEY, invalid)
      expect(readHomeSortPreference()).toBe('published')
      expect(values.get(STORAGE_KEY)).toBe(invalid)
    }
  })

  it('falls back safely when browser storage is blocked or window is absent during SSR', () => {
    vi.stubGlobal('window', {
      get localStorage() { throw new DOMException('Storage blocked', 'SecurityError') },
    })
    expect(readHomeSortPreference()).toBe('published')
    vi.stubGlobal('window', undefined)
    expect(readHomeSortPreference()).toBe('published')
  })
})
