export type IssueStep = 'comments' | 'materials' | 'volunteer'

const ISSUE_STEPS: readonly IssueStep[] = ['comments', 'materials', 'volunteer']

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
