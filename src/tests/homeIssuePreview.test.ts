import { describe, expect, it } from 'vite-plus/test'
import { HOME_ISSUE_PREVIEW_ACTION, homeIssuePreviewUrl, readHomeIssuePreviewId } from '../lib/homeIssuePreview'

describe('home issue preview query state', () => {
  it('reads a valid preview action and issue id', () => {
    const url = new URL(`https://example.com/?action=${HOME_ISSUE_PREVIEW_ACTION}&issue=42`)
    expect(readHomeIssuePreviewId(url)).toBe(42)
  })

  it('ignores incomplete, unrelated, or invalid preview queries', () => {
    expect(readHomeIssuePreviewId(new URL('https://example.com/?issue=42'))).toBeNull()
    expect(readHomeIssuePreviewId(new URL('https://example.com/?action=click_issue_card'))).toBeNull()
    expect(readHomeIssuePreviewId(new URL('https://example.com/?action=click_issue_card&issue=0'))).toBeNull()
    expect(readHomeIssuePreviewId(new URL('https://example.com/?action=click_issue_card&issue=abc'))).toBeNull()
  })

  it('preserves existing query and hash while adding preview state', () => {
    const next = homeIssuePreviewUrl(new URL('https://example.com/?role=volunteer#issues'), 7)
    expect(next.searchParams.get('role')).toBe('volunteer')
    expect(next.searchParams.get('action')).toBe(HOME_ISSUE_PREVIEW_ACTION)
    expect(next.searchParams.get('issue')).toBe('7')
    expect(next.hash).toBe('#issues')
  })
})
