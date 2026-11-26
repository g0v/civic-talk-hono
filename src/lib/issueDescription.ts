export const ISSUE_DESCRIPTION_MAX_CHARS = 300

export function isIssueDescriptionTooLong(description: string): boolean {
  let count = 0
  for (const _character of description) {
    if (++count > ISSUE_DESCRIPTION_MAX_CHARS) return true
  }
  return false
}
