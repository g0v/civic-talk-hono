import { describe, expect, it } from 'vite-plus/test'
import {
  parseIssueBriefingSlide,
  parseIssueCommentAction,
  parseIssueCommentView,
  parseIssueOpinionAnchor,
  parseIssueStep,
  writeIssueBriefingSlide,
  writeIssueCommentAction,
  writeIssueCommentSearch,
  writeIssueCommentView,
  writeIssueOpinionAnchor,
  writeIssueStep,
} from '../lib/issueNavigation'

describe('issue step URL navigation', () => {
  it.each([
    ['', 'card'],
    ['?view=unknown', 'card'],
    ['?view=card', 'card'],
    ['?view=list', 'list'],
  ])('restores the opinion view from %s', (search, expected) => {
    expect(parseIssueCommentView(search)).toBe(expected)
  })

  it('round-trips opinion views while preserving the action, search and return anchor', () => {
    const original = '/issues/19?step=comments&action=browse&search=energy#opinion-42'
    const list = writeIssueCommentView(original, 'list')
    const card = writeIssueCommentView(list, 'card')
    expect(list).toBe(`${original.split('#')[0]}&view=list#opinion-42`)
    expect(card).toBe(`${original.split('#')[0]}&view=card#opinion-42`)
    expect(parseIssueCommentView(new URL(card, 'https://civic-talk.invalid').search)).toBe('card')
  })

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

  it('restores briefing slides and ignores unknown tabs', () => {
    expect(parseIssueBriefingSlide('?tab=consensus')).toBe(1)
    expect(parseIssueBriefingSlide('?tab=disputes')).toBe(2)
    expect(parseIssueBriefingSlide('?tab=positions')).toBe(3)
    expect(parseIssueBriefingSlide('?tab=actions')).toBe(4)
    expect(parseIssueBriefingSlide('?tab=unknown')).toBe(0)
    expect(parseIssueBriefingSlide('')).toBe(0)
  })

  it('round-trips a briefing tab without losing the step, unrelated query or hash', () => {
    const url = writeIssueBriefingSlide('/issues/7?step=comments&sort=recent#briefing', 2)
    expect(url).toBe('/issues/7?step=comments&sort=recent&tab=disputes#briefing')
    expect(parseIssueBriefingSlide(new URL(url, 'https://civic-talk.invalid').search)).toBe(2)
    expect(writeIssueBriefingSlide(url, 0)).toBe('/issues/7?step=comments&sort=recent#briefing')
  })

  it('recognizes only positive safe opinion ids in the return anchor', () => {
    expect(parseIssueOpinionAnchor('#opinion-42')).toBe(42)
    for (const hash of ['', '#opinions', '#opinion-0', '#opinion--1', '#opinion-1.5', '#opinion-42-extra', '#opinion-9007199254740992']) {
      expect(parseIssueOpinionAnchor(hash)).toBeNull()
    }
  })

  it('preserves the browse context when returning to a specific opinion', () => {
    const url = writeIssueOpinionAnchor('/issues/7?tab=positions&step=comments&action=browse&search=energy#old', 42)
    expect(url).toBe('/issues/7?tab=positions&step=comments&action=browse&search=energy#opinion-42')
    expect(parseIssueOpinionAnchor(new URL(url, 'https://civic-talk.invalid').hash)).toBe(42)
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
