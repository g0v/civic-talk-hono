import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useViewerRole } from '../composables/useViewerRole'

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

describe('global viewer role preference', () => {
  let localStorage: Storage
  let sessionStorage: Storage

  beforeEach(() => {
    localStorage = createMemoryStorage()
    sessionStorage = createMemoryStorage()
    vi.stubGlobal('window', { localStorage, sessionStorage })
    useViewerRole().initViewerRole()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps an unremembered role only for the current browser session', () => {
    const roleState = useViewerRole()
    roleState.setViewerRole('volunteer')

    expect(roleState.viewerRole.value).toBe('volunteer')
    expect(roleState.preferredViewerRole.value).toBeNull()
    expect(sessionStorage.getItem('civic_viewer_role_session')).toBe('volunteer')
    expect(localStorage.getItem('civic_viewer_role')).toBeNull()
  })

  it('stores and subsequently updates an explicitly remembered role', () => {
    const roleState = useViewerRole()
    roleState.setViewerRole('volunteer', { remember: true })
    expect(localStorage.getItem('civic_viewer_role')).toBe('volunteer')
    expect(roleState.preferredViewerRole.value).toBe('volunteer')

    roleState.setViewerRole('citizen')
    expect(localStorage.getItem('civic_viewer_role')).toBe('citizen')
    expect(roleState.preferredViewerRole.value).toBe('citizen')
  })

  it('can forget a stored preference without losing the current session role', () => {
    const roleState = useViewerRole()
    roleState.setViewerRole('citizen', { remember: true })
    roleState.setViewerRole('volunteer', { remember: false })

    expect(localStorage.getItem('civic_viewer_role')).toBeNull()
    expect(sessionStorage.getItem('civic_viewer_role_session')).toBe('volunteer')
    expect(roleState.preferredViewerRole.value).toBeNull()
  })

  it('prefers a remembered role over a temporary session role during initialization', () => {
    localStorage.setItem('civic_viewer_role', 'volunteer')
    sessionStorage.setItem('civic_viewer_role_session', 'citizen')

    const roleState = useViewerRole()
    roleState.initViewerRole()

    expect(roleState.viewerRole.value).toBe('volunteer')
    expect(roleState.preferredViewerRole.value).toBe('volunteer')
  })
})
