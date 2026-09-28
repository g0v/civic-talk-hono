import { describe, expect, it } from 'vite-plus/test'
import { parseIssueStep, writeIssueStep } from '../lib/issueNavigation'

describe('issue step URL navigation', () => {
  it('parses only supported direct steps', () => {
    expect(parseIssueStep('?step=comments')).toBe('comments')
    expect(parseIssueStep('?step=materials')).toBe('materials')
    expect(parseIssueStep('?step=volunteer')).toBe('volunteer')
    expect(parseIssueStep('?step=briefing')).toBeNull()
    expect(parseIssueStep('')).toBeNull()
  })

  it('writes the step while preserving other query parameters and hash', () => {
    expect(writeIssueStep('/issues/7?sort=recent&step=materials#opinions', 'comments')).toBe('/issues/7?sort=recent&step=comments#opinions')
    expect(writeIssueStep('/issues/7?sort=recent&step=materials#opinions', null)).toBe('/issues/7?sort=recent#opinions')
  })
})
