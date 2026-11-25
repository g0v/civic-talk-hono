export type IssueDraft = {
  title: string
  description: string
  tags: string
}

export function emptyIssueDraft(): IssueDraft {
  return { title: '', description: '', tags: '' }
}

export function hasIssueDraft(draft: IssueDraft): boolean {
  return Boolean(draft.title || draft.description || draft.tags)
}

export async function issueDraftKey(accountId: string): Promise<string | null> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return null
  try {
    // 只用帳號雜湊區分本機草稿，不把帳號 ID、email 或其他登入資料寫入儲存空間。
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(accountId))
    const scope = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    return `civic_home_issue_draft:${scope}`
  } catch {
    return null
  }
}

export function readIssueDraft(key: string): { draft: IssueDraft; available: boolean } {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return { draft: emptyIssueDraft(), available: false }
  }

  if (raw !== null) {
    try {
      const data: unknown = JSON.parse(raw)
      if (data && typeof data === 'object' && 'title' in data && 'description' in data && 'tags' in data) {
        const { title, description, tags } = data
        if (typeof title === 'string' && typeof description === 'string' && typeof tags === 'string') {
          return { draft: { title, description, tags }, available: true }
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return { draft: emptyIssueDraft(), available: true }
}

export function saveIssueDraft(key: string, draft: IssueDraft): boolean {
  try {
    if (hasIssueDraft(draft)) {
      const { title, description, tags } = draft
      window.localStorage.setItem(key, JSON.stringify({ title, description, tags }))
    } else {
      window.localStorage.removeItem(key)
    }
    return true
  } catch {
    return false
  }
}
