import { renderToString } from '@vue/server-renderer'
import { createSSRApp, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { provideI18n } from '../l10n'
import IssueView from '../views/Issue.vue'

// 測試限定的已登入狀態，讓環境開關實際走到志願者工具；不改應用程式的 SSR 認證規則。
vi.mock('../composables/useAuth', () => {
  return {
    useAuth: () => ({
      authState: ref('signed-in'),
      session: ref({ user: { id: 'visibility-user', name: '測試使用者', email: 'visibility@example.test', image: null }, role: 'user', banned: false, hasDuplicateDisplayName: false }),
      ensureAuthSession: async () => {},
      signOutAndReload: async () => {},
    }),
  }
})

afterEach(() => vi.unstubAllEnvs())

describe('建構中的一鍵彙整僅在 dev 掛載', () => {
  it.each([
    { dev: true, mode: 'development', visible: true },
    { dev: true, mode: 'remote', visible: true },
    { dev: false, mode: 'production', visible: false },
    { dev: false, mode: 'development', visible: false },
  ])('DEV=$dev / MODE=$mode 的登入志願者畫面', async ({ dev, mode, visible }) => {
    vi.stubEnv('DEV', dev)
    vi.stubEnv('MODE', mode)
    const app = createSSRApp(IssueView, {
      issueId: 7,
      initialStep: 'volunteer',
      initialDetail: {
        issue: {
          id: 7, title: '環境顯示驗收', description: '合成議題', status: 'collecting', polis_id: null, tags: [],
          created_at: '2026-11-11T00:00:00Z', is_closed: 0, closure_reason: null, closure_changed_at: null,
          abuse_flagged: 0, author_name: null, author_email: null,
        },
        materials: [], briefing: null, opinions: [],
      },
    })
    provideI18n(app, 'zh-TW')
    const html = await renderToString(app)
    expect(html.includes('data-testid="evidence-summary-start"')).toBe(visible)
    expect(html.includes('data-testid="evidence-summary-dialog"')).toBe(visible)
    // production 仍保留原有的手動彙整工具，不是把整段志願者 UI 一併隱藏。
    expect(html).toContain('id="briefing-consensus"')
    expect(html).toContain('id="briefing-disputes"')
    expect(html).toContain('id="briefing-positions"')
  })
})
