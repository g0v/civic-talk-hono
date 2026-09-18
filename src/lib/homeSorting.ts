/**
 * 首頁議題列表的過濾與排序（#77）——抽成純函式供 Home.vue 與測試共用。
 * 只做純資料運算，不碰任何瀏覽器 API（SSR 安全）。
 */
import type { IssueListItem, IssueStatus } from '../db/queries'
import type { ViewerRole } from '../composables/useViewerRole'

export type SortOrder = 'newest' | 'most' | 'least'

/**
 * 各角色的狀態優先序（#90）——列表先依這個順序分階，階內再套使用者選的排序。
 * - 公民：關心已經有結論的議題，「已發佈」最前。
 * - 志願者：關心需要出力的議題，「彙整中」最前、「已發佈」最後。
 *
 * 公民仍會先被 `filterByRole()` 濾掉 `collecting`（#77 行為未變），
 * 這裡列出 `collecting` 只是讓兩個角色的優先序表形狀一致。
 */
const STATUS_PRIORITY: Record<ViewerRole, readonly IssueStatus[]> = {
  citizen: ['published', 'summarizing', 'collecting'],
  volunteer: ['summarizing', 'collecting', 'published'],
}

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
 * - 先套關鍵字搜尋，再套角色過濾，最後依角色的狀態優先序分階、階內套使用者選的排序。
 * - citizen：過濾掉 collecting，其餘依「已發佈 → 彙整中」排列（#90）。
 * - volunteer：不過濾，依「彙整中 → 素材收集中 → 已發佈」排列（#90）。
 */
export function filterAndSortHomeIssues(issues: IssueListItem[], role: ViewerRole, order: SortOrder, search = ''): IssueListItem[] {
  const searched = filterBySearch(issues, search)
  const filtered = filterByRole(searched, role)
  const priority = STATUS_PRIORITY[role]
  const tiers = priority.map(status => filtered.filter(issue => issue.status === status))
  // 防呆：日後若新增狀態而忘了更新 STATUS_PRIORITY，把它排在最後而不是讓它從列表中消失。
  tiers.push(filtered.filter(issue => !priority.includes(issue.status)))
  return tiers.flatMap(tier => sortByOrder(tier, order))
}
