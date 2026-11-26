import { describe, expect, it } from 'vite-plus/test'
import { isIssueDescriptionTooLong } from '../lib/issueDescription'

describe('議題簡介送出字數限制', () => {
  it('允許空白簡介與 300 字，超過 300 字才阻擋', () => {
    expect(isIssueDescriptionTooLong('')).toBe(false)
    expect(isIssueDescriptionTooLong('議'.repeat(100))).toBe(false)
    expect(isIssueDescriptionTooLong('議'.repeat(300))).toBe(false)
    expect(isIssueDescriptionTooLong('議'.repeat(301))).toBe(true)
  })

  it('以 Unicode code point 計數，emoji 不會被當作兩字', () => {
    expect(isIssueDescriptionTooLong('😀'.repeat(300))).toBe(false)
    expect(isIssueDescriptionTooLong('😀'.repeat(300) + '議')).toBe(true)
  })

  it('保留空白與換行的字數，與編輯器及送出的原文一致', () => {
    expect(isIssueDescriptionTooLong(' ' + '議'.repeat(298) + '\n')).toBe(false)
    expect(isIssueDescriptionTooLong(' ' + '議'.repeat(299) + '\n')).toBe(true)
  })
})
