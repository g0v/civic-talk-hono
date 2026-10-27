import type { SortOrder } from './homeSorting'

const STORAGE_KEY = 'civic_home_sort_order'

/** SSR 固定最新發布；hydration 後恢復合法偏好，舊 newest 回到新預設（#186）。 */
export function readHomeSortPreference(): SortOrder {
  if (typeof window === 'undefined') return 'published'
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved === 'published' || saved === 'activity' || saved === 'most' || saved === 'least' ? saved : 'published'
  } catch {
    return 'published'
  }
}

/** 儲存失敗不影響目前頁面已選取的排序。 */
export function saveHomeSortPreference(order: SortOrder): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, order)
  } catch {
    /* 瀏覽器可能封鎖 localStorage，仍允許使用者在本頁切換排序。 */
  }
}
