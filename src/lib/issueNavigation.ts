export type IssueStep = 'comments' | 'materials' | 'volunteer'

const ISSUE_STEPS: readonly IssueStep[] = ['comments', 'materials', 'volunteer']
export type IssueCommentAction = 'start' | 'commit' | 'celebrate' | 'ai_help' | 'browse'

const ISSUE_COMMENT_ACTIONS: readonly IssueCommentAction[] = ['start', 'commit', 'celebrate', 'ai_help', 'browse']

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
