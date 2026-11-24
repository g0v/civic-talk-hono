export type IssueStep = 'comments' | 'materials' | 'volunteer'

const ISSUE_STEPS: readonly IssueStep[] = ['comments', 'materials', 'volunteer']
export type IssueCommentAction = 'start' | 'commit' | 'celebrate' | 'ai_help' | 'browse'
export type IssueCommentView = 'card' | 'list' | 'synthesis'

const ISSUE_COMMENT_ACTIONS: readonly IssueCommentAction[] = ['start', 'commit', 'celebrate', 'ai_help', 'browse']

export function parseIssueCommentView(search: string, synthesisEnabled = true): IssueCommentView {
  const view = new URLSearchParams(search).get('view')
  if (view === 'list' || (view === 'synthesis' && synthesisEnabled)) return view
  return 'card'
}

export function writeIssueCommentView(url: string, view: IssueCommentView): string {
  const next = new URL(url, 'https://civic-talk.invalid')
  if (view === 'synthesis') {
    next.searchParams.set('step', 'comments')
    next.searchParams.set('action', 'browse')
  }
  next.searchParams.set('view', view)
  return `${next.pathname}${next.search}${next.hash}`
}

const ISSUE_BRIEFING_TABS = ['overview', 'consensus', 'disputes', 'positions', 'actions'] as const

export function parseIssueBriefingSlide(search: string): number {
  const tab = new URLSearchParams(search).get('tab')
  const index = ISSUE_BRIEFING_TABS.findIndex(value => value === tab)
  return index < 0 ? 0 : index
}

export function writeIssueBriefingSlide(url: string, index: number): string {
  const next = new URL(url, 'https://civic-talk.invalid')
  const tab = ISSUE_BRIEFING_TABS[index]
  if (!tab || index === 0) next.searchParams.delete('tab')
  else next.searchParams.set('tab', tab)
  return `${next.pathname}${next.search}${next.hash}`
}

export function parseIssueOpinionAnchor(hash: string): number | null {
  const match = /^#opinion-([1-9]\d*)$/.exec(hash)
  const id = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(id) ? id : null
}

export function writeIssueOpinionAnchor(url: string, opinionId: number): string {
  const next = new URL(url, 'https://civic-talk.invalid')
  next.hash = `opinion-${opinionId}`
  return `${next.pathname}${next.search}${next.hash}`
}

export function parseIssueCommentAction(search: string): IssueCommentAction {
  const value = new URLSearchParams(search).get('action')
  return ISSUE_COMMENT_ACTIONS.includes(value as IssueCommentAction) ? (value as IssueCommentAction) : 'start'
}

export function writeIssueCommentAction(url: string, action: IssueCommentAction): string {
  const next = new URL(url, 'https://civic-talk.invalid')
  if (action === 'start') next.searchParams.delete('action')
  else next.searchParams.set('action', action)
  return `${next.pathname}${next.search}${next.hash}`
}

export function writeIssueCommentSearch(url: string, keyword: string): string {
  const next = new URL(url, 'https://civic-talk.invalid')
  const value = keyword.trim()
  if (value) next.searchParams.set('search', value)
  else next.searchParams.delete('search')
  return `${next.pathname}${next.search}${next.hash}`
}

export function parseIssueStep(search: string): IssueStep | null {
  const value = new URLSearchParams(search).get('step')
  return ISSUE_STEPS.includes(value as IssueStep) ? (value as IssueStep) : null
}

export function writeIssueStep(url: string, step: IssueStep | null): string {
  const next = new URL(url, 'https://civic-talk.invalid')
  if (step) next.searchParams.set('step', step)
  else next.searchParams.delete('step')
  return `${next.pathname}${next.search}${next.hash}`
}
