import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import AuthorName from '../components/AuthorName.vue'
import { provideI18n } from '../l10n'
import { parseContributorNavigation, writeContributorNavigation } from '../lib/contributorNavigation'
import ContributorView from '../views/Contributor.vue'

afterEach(() => vi.unstubAllEnvs())

describe('貢獻者導覽與 SSR', () => {
  it('視角與展開狀態可由 URL 還原，保留其他 query 與 hash', () => {
    const state = parseContributorNavigation('?tab=list&expanded=2025:issue,invalid,2025:issue,2026:briefing&keep=yes')
    expect(state).toEqual({ view: 'list', expanded: ['2025:issue', '2026:briefing'] })
    const next = new URL(writeContributorNavigation('https://civic.test/contributors/public?keep=yes#history', state), 'https://civic.test')
    expect(next.searchParams.get('keep')).toBe('yes')
    expect(next.hash).toBe('#history')
    expect(parseContributorNavigation(next.search)).toEqual(state)
    const reset = new URL(writeContributorNavigation(next.href, { view: 'timeline', expanded: [] }), 'https://civic.test')
    expect(reset.search).toBe('?keep=yes')
  })

  it.each([true, false])('DEV=%s 時作者連結皆可用且保留投稿名稱', async dev => {
    vi.stubEnv('DEV', dev)
    const app = createSSRApp(AuthorName, { name: '投稿時名字', publicId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
    provideI18n(app, 'zh-TW')
    const html = await renderToString(app)
    expect(html).toContain('投稿時名字')
    expect(html).toContain('href="/contributors/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"')
  })

  it('年度列表以 UTC 分組，每個 briefing 版本各列一筆，連到目前議題頁', async () => {
    const app = createSSRApp(ContributorView, {
      initialView: 'list',
      initialExpanded: ['2025:briefing'],
      initialHistory: {
        public_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: '貢獻者',
        joined_at: '2025-01-01T00:00:00Z',
        contributions: [
          { kind: 'briefing', id: 1, issue_id: 7, title: '議題', version: 1, created_at: '2025-12-31 23:59:59' },
          { kind: 'briefing', id: 2, issue_id: 7, title: '議題', version: 2, created_at: '2026-01-01 00:00:00' },
        ],
      },
    })
    provideI18n(app, 'zh-TW')
    const html = await renderToString(app)
    expect(html).toContain('id="year-2025"')
    expect(html).toContain('id="year-2026"')
    expect(html.match(/href="\/issues\/7"/g)).toHaveLength(2)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('2025-12-31T23:59:59.000Z')
  })
})
