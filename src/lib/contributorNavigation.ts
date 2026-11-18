import type { Contribution, ContributionKind } from './contributors'

export type ContributorView = 'timeline' | 'list'

export interface ContributorNavigation {
  readonly view: ContributorView
  readonly expanded: readonly string[]
}

export const contributionKinds = ['issue', 'material', 'briefing', 'opinion'] as const satisfies readonly ContributionKind[]

export function parseContributorNavigation(search: string): ContributorNavigation {
  const params = new URLSearchParams(search)
  return {
    view: params.get('tab') === 'list' ? 'list' : 'timeline',
    expanded: [...new Set((params.get('expanded') ?? '').split(',').filter(value => /^\d{4}:(issue|material|briefing|opinion)$/.test(value)))],
  }
}

export function writeContributorNavigation(url: string, state: ContributorNavigation): string {
  const next = new URL(url, 'https://civic-talk.invalid')
  if (state.view === 'timeline') next.searchParams.delete('tab')
  else next.searchParams.set('tab', state.view)
  if (state.expanded.length) next.searchParams.set('expanded', state.expanded.join(','))
  else next.searchParams.delete('expanded')
  return `${next.pathname}${next.search}${next.hash}`
}

export function contributionHref(item: Contribution): string {
  switch (item.kind) {
    case 'issue':
      return `/issues/${item.id}`
    case 'briefing':
      return `/issues/${item.issue_id}`
    case 'material':
      return `/issues/${item.issue_id}/source/${item.id}`
    case 'opinion':
      return `/issues/${item.issue_id}/comment/${item.id}`
    default: {
      const exhaustive: never = item.kind
      return exhaustive
    }
  }
}
