/**
 * 首頁議題列表的過濾與排序（#77）——抽成純函式供 Home.vue 與測試共用。
 * 只做純資料運算，不碰任何瀏覽器 API（SSR 安全）。
 */
import type { IssueListItem } from '../db/queries'

/** 檢視者角色：公民（預設）看不到「素材收集中」的議題；志願者看得到且收集中固定排最前 */
export type ViewerRole = 'citizen' | 'volunteer'
export type SortOrder = 'newest' | 'most' | 'least'

/**
 * citizen 過濾掉 status === 'collecting' 的議題；volunteer 不過濾。
 */
export function filterByRole(issues: IssueListItem[], role: ViewerRole): IssueListItem[] {
  if (role === 'volunteer') return issues
  return issues.filter(issue => issue.status !== 'collecting')
}

/**
 * 依使用者選擇排序。newest 以「最新活動日期」為準（#77），不再用議題建立日期。
 */
export function sortByOrder(issues: IssueListItem[], order: SortOrder): IssueListItem[] {
  const result = [...issues]
  if (order === 'most') {
    result.sort((a, b) => b.material_count + b.opinion_count - (a.material_count + a.opinion_count))
  } else if (order === 'least') {
    result.sort((a, b) => a.material_count + a.opinion_count - (b.material_count + b.opinion_count))
  } else {
    // newest: last_activity_at DESC（穩定排序，維持 API 既有順序作為同值 fallback）。
    // last_activity_at 為 NULL（尚無子內容活動）時 fallback 到 created_at（#77）。
    const activityOf = (issue: IssueListItem): string => issue.last_activity_at ?? issue.created_at
    result.sort((a, b) => {
      const aAt = activityOf(a)
      const bAt = activityOf(b)
      return aAt < bAt ? 1 : aAt > bAt ? -1 : 0
    })
  }
  return result
}

/**
 * 依關鍵字過濾（比照既有行為：比對標題或簡介，不分大小寫）；空字串不過濾。
 */
function filterBySearch(issues: IssueListItem[], q: string): IssueListItem[] {
  const query = q.trim().toLowerCase()
  if (!query) return issues
  return issues.filter(issue => (issue.title ?? '').toLowerCase().includes(query) || (issue.description ?? '').toLowerCase().includes(query))
}

/**
 * 首頁列表的完整過濾＋排序：
 * - 先套關鍵字搜尋，再套角色過濾，最後排序。
 * - citizen：過濾掉 collecting，再套用使用者選的排序。
 * - volunteer：不過濾，「素材收集中」（collecting）固定排最前（第一階），階內再套用使用者選的排序。
 */
export function filterAndSortHomeIssues(issues: IssueListItem[], role: ViewerRole, order: SortOrder, search = ''): IssueListItem[] {
  const searched = filterBySearch(issues, search)
  const filtered = filterByRole(searched, role)
  if (role === 'volunteer') {
    const collecting = sortByOrder(
      filtered.filter(issue => issue.status === 'collecting'),
      order
    )
    const rest = sortByOrder(
      filtered.filter(issue => issue.status !== 'collecting'),
      order
    )
    return [...collecting, ...rest]
  }
  return sortByOrder(filtered, order)
}
