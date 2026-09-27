export const HOME_ISSUE_PREVIEW_ACTION = 'click_issue_card'

/** 從首頁 query 還原目前預覽的議題；格式不完整時維持一般清單版面。 */
export function readHomeIssuePreviewId(url: URL): number | null {
  if (url.searchParams.get('action') !== HOME_ISSUE_PREVIEW_ACTION) return null
  const rawIssueId = url.searchParams.get('issue')
  if (!rawIssueId || !/^[1-9]\d*$/.test(rawIssueId)) return null
  return Number(rawIssueId)
}

/** 保留其他 query，只同步首頁議題預覽所需的 action 與 issue。 */
export function homeIssuePreviewUrl(currentUrl: URL, issueId: number): URL {
  const nextUrl = new URL(currentUrl)
  nextUrl.searchParams.set('action', HOME_ISSUE_PREVIEW_ACTION)
  nextUrl.searchParams.set('issue', String(issueId))
  return nextUrl
}
