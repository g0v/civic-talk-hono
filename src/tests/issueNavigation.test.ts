import { describe, expect, it } from 'vite-plus/test'
import { parseIssueCommentAction, parseIssueStep, writeIssueCommentAction, writeIssueCommentSearch, writeIssueStep } from '../lib/issueNavigation'

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

  it('parses supported comment actions and defaults invalid values to start', () => {
    expect(parseIssueCommentAction('?action=start')).toBe('start')
    expect(parseIssueCommentAction('?action=commit')).toBe('commit')
    expect(parseIssueCommentAction('?action=celebrate')).toBe('celebrate')
    expect(parseIssueCommentAction('?action=ai_help')).toBe('ai_help')
    expect(parseIssueCommentAction('?action=browse')).toBe('browse')
    expect(parseIssueCommentAction('?action=unknown')).toBe('start')
    expect(parseIssueCommentAction('')).toBe('start')
  })

  it('writes comment actions canonically while preserving other query parameters and hash', () => {
    expect(writeIssueCommentAction('/issues/7?sort=recent&step=comments#opinions', 'browse')).toBe('/issues/7?sort=recent&step=comments&action=browse#opinions')
    expect(writeIssueCommentAction('/issues/7?sort=recent&step=comments&action=browse#opinions', 'start')).toBe('/issues/7?sort=recent&step=comments#opinions')
  })

  it('writes and removes the comment search keyword', () => {
    expect(writeIssueCommentSearch('/issues/7?step=comments#opinions', '  democracy  ')).toBe('/issues/7?step=comments&search=democracy#opinions')
    expect(writeIssueCommentSearch('/issues/7?step=comments&search=democracy#opinions', '   ')).toBe('/issues/7?step=comments#opinions')
  })
})
