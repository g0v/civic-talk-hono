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
  it('renders opted-in author emails as mailto links only (#60)', async () => {
    const app = createSSRApp(IssueView, {
      issueId: 1,
      initialDetail: {
        issue: {
          id: 1,
          title: '測試議題',
          description: '議題說明',
          status: 'published',
          polis_id: null,
          created_at: '2026-08-17 00:00:00',
          abuse_flagged: 0,
          author_name: '議題建立者',
          author_email: 'issue@example.com',
        },
        materials: [
          {
            id: 1,
            issue_id: 1,
            source_name: '測試來源',
            source_url: 'https://example.com',
            content: '測試素材',
            stance: 'neutral',
            verified_count: 0,
            created_at: '2026-08-17 00:00:00',
            author_name: '素材投稿者',
            author_email: 'material@example.com',
            abuse_flagged: 0,
          },
        ],
        briefing: {
          id: 1,
          issue_id: 1,
          consensus: '共識',
          disputes: '爭點',
          positions: '立場',
          narrative: '說明',
          opinion_prompt: '',
          version: 1,
          created_at: '2026-08-17 00:00:00',
          author_name: '志願者',
          author_email: 'briefing@example.com',
          abuse_flagged: 0,
        },
        opinions: [
          {
            id: 1,
            issue_id: 1,
            summary: '測試意見',
            created_at: '2026-08-17 00:00:00',
            author_name: '意見投稿者',
            author_email: 'opinion@example.com',
            abuse_flagged: 0,
          },
        ],
      },
    })
    provideI18n(app, 'zh-TW')

    const html = await renderToString(app)
    const addresses = ['issue@example.com', 'material@example.com', 'briefing@example.com', 'opinion@example.com']

    for (const address of addresses) {
      expect(html).toContain(`mailto:${address}`)
      // 明碼只能存在於 href，不得成為頁面可見文字
      expect(html.replaceAll(`mailto:${address}`, '')).not.toContain(address)
    }

    // 巢狀 <a> 會被瀏覽器拆開而造成 hydration mismatch（註解先去掉，避免誤判）
    const anchors = html.replace(/<!--[\s\S]*?-->/g, '').match(/<a\b|<\/a>/g) ?? []
    let depth = 0
    for (const token of anchors) {
      depth += token === '</a>' ? -1 : 1
      expect(depth).toBeLessThanOrEqual(1)
    }
    expect(depth).toBe(0)
  })
})
