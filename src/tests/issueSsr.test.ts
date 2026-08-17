import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { describe, expect, it } from 'vite-plus/test'
import { provideI18n } from '../l10n'
import IssueView from '../views/Issue.vue'

describe('Issue SSR', () => {
  it('renders an issue page with i18n helpers available', async () => {
    const app = createSSRApp(IssueView, {
      issueId: 1,
      initialDetail: {
        issue: {
          id: 1,
          title: '測試議題',
          description: '議題說明',
          status: 'collecting',
          polis_id: null,
          created_at: '2026-08-17 00:00:00',
          abuse_flagged: 0,
          author_name: null,
          author_email: null,
        },
        materials: [],
        briefing: null,
        opinions: [],
      },
    })
    provideI18n(app, 'zh-TW')

    const html = await renderToString(app)

    expect(html).toContain('測試議題')
    expect(html).toContain('2026')
  })
})
