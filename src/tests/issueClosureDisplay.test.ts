import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { describe, expect, it } from 'vite-plus/test'
import { provideI18n } from '../l10n'
import IssueView from '../views/Issue.vue'

describe('closed issue presentation', () => {
  it('escapes the public reason while keeping the closed discussion accessible', async () => {
    const app = createSSRApp(IssueView, {
      issueId: 1,
      initialStep: 'comments',
      initialCommentAction: 'browse',
      initialCommentView: 'list',
      initialDetail: {
        issue: {
          id: 1,
          title: '結案後的議題',
          description: '背景說明',
          status: 'published',
          polis_id: null,
          is_closed: 1,
          closure_reason: '<img src=x onerror="alert(1)">已完成本階段討論',
          closure_changed_at: '2026-10-21 00:00:00',
          created_at: '2026-10-20 00:00:00',
          tags: [],
          abuse_flagged: 0,
          author_name: null,
          author_email: null,
        },
        materials: [],
        briefing: null,
        opinions: [
          {
            id: 1,
            issue_id: 1,
            summary: '結案後仍然可以閱讀的公民意見',
            created_at: '2026-10-21 00:00:00',
            author_name: null,
            author_email: null,
            abuse_flagged: 0,
          },
        ],
      },
    })
    provideI18n(app, 'zh-TW')

    const html = await renderToString(app)
    expect(html).toContain('&lt;img src=x onerror=')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('已完成本階段討論')
    expect(html).toContain('<p>結案後仍然可以閱讀的公民意見</p>')
    expect(html).toContain('href="/issues/1/comment/1"')
  })
})
