import { renderToString } from '@vue/server-renderer'
import { createSSRApp, type Component } from 'vue'
import { describe, expect, it } from 'vite-plus/test'
import AppFooter from '../components/AppFooter.vue'
import AppHeader from '../components/AppHeader.vue'
import IssueCard from '../components/IssueCard.vue'
import IssuePreviewCard from '../components/IssuePreviewCard.vue'
import LongTextContent from '../components/LongTextContent.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import ModerationAppealForm from '../components/ModerationAppealForm.vue'
import ModerationAppealNotice from '../components/ModerationAppealNotice.vue'
import SignInButtons from '../components/SignInButtons.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Toast from '../components/Toast.vue'
import ViewerRoleSwitch from '../components/ViewerRoleSwitch.vue'
import { provideI18n } from '../l10n'
import AboutView from '../views/About.vue'
import AdminView from '../views/Admin.vue'
import ContributeView from '../views/Contribute.vue'
import HomeView from '../views/Home.vue'
import MaterialDetailView from '../views/MaterialDetail.vue'
import NotFoundView from '../views/NotFound.vue'
import OpinionDetailView from '../views/OpinionDetail.vue'
import PrivacyView from '../views/Privacy.vue'
import ProfileView from '../views/Profile.vue'
import TermsView from '../views/Terms.vue'
import AppealsView from '../views/Appeals.vue'

const issue = {
  id: 1,
  title: '測試議題',
  description: '議題說明',
  status: 'collecting',
  tags: [],
  polis_id: null,
  created_at: '2026-08-17 00:00:00',
  last_activity_at: '2026-08-17 00:00:00',
  is_closed: 0,
  closure_reason: null,
  closure_changed_at: null,
  abuse_flagged: 0,
  author_name: null,
  author_email: null,
  vote_count: 0,
} as const

const material = {
  id: 1,
  issue_id: 1,
  source_name: '測試來源',
  source_url: 'https://example.com',
  content: '測試素材',
  stance: 'neutral',
  verified_count: 0,
  created_at: '2026-08-17 00:00:00',
  author_name: null,
  author_email: null,
  abuse_flagged: 0,
} as const

const opinion = {
  id: 1,
  issue_id: 1,
  summary: '測試意見',
  created_at: '2026-08-17 00:00:00',
  author_name: null,
  author_email: null,
  abuse_flagged: 0,
} as const

async function render(component: Component, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(component, props)
  provideI18n(app, 'zh-TW')
  return renderToString(app)
}

describe('routable view SSR smoke tests', () => {
  const cases: Array<{ name: string; component: Component; props?: Record<string, unknown> }> = [
    { name: 'home', component: HomeView, props: { initialIssues: [{ ...issue, material_count: 1, opinion_count: 1 }] } },
    { name: 'about', component: AboutView },
    { name: 'admin', component: AdminView },
    { name: 'appeals', component: AppealsView },
    { name: 'contribute', component: ContributeView, props: { issueId: 1, issueTitle: issue.title } },
    { name: 'material detail', component: MaterialDetailView, props: { issueId: 1, materialId: 1, initialData: { issue, material } } },
    { name: 'not found', component: NotFoundView },
    { name: 'opinion detail', component: OpinionDetailView, props: { issueId: 1, opinionId: 1, initialData: { issue, opinion } } },
    { name: 'privacy', component: PrivacyView },
    { name: 'profile', component: ProfileView },
    { name: 'terms', component: TermsView },
  ]

  for (const testCase of cases) {
    it(`renders ${testCase.name}`, async () => {
      const html = await render(testCase.component, testCase.props)
      expect(html.length).toBeGreaterThan(0)
    })
  }
})

describe('author email disclosure (#60)', () => {
  const optedIn = { ...issue, material_count: 1, opinion_count: 1, author_name: '投稿者', author_email: 'contributor@example.com' }

  it('renders the opted-in email as a mailto link, not as visible text', async () => {
    const html = await render(IssuePreviewCard, { issue: optedIn })
    expect(html).toContain('mailto:contributor@example.com')
    // 明碼只能出現在 href 裡，不能成為可見文字
    expect(html.replace(/mailto:contributor@example\.com/g, '')).not.toContain('contributor@example.com')
  })

  it('never nests an anchor inside the issue card link', async () => {
    const html = await render(IssueCard, { issue: optedIn })
    // 先去掉註解，避免註解文字裡的標籤字樣被誤判
    const anchors = html.replace(/<!--[\s\S]*?-->/g, '').match(/<a\b|<\/a>/g) ?? []
    let depth = 0
    for (const token of anchors) {
      depth += token === '</a>' ? -1 : 1
      expect(depth).toBeLessThanOrEqual(1)
    }
    expect(depth).toBe(0)
  })

  it('escapes issue tag text in server-rendered cards', async () => {
    const html = await render(IssueCard, {
      issue: { ...optedIn, tags: ['<script>alert(1)</script>'] },
    })
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('renders mailto links on the detail views', async () => {
    const materialHtml = await render(MaterialDetailView, {
      issueId: 1,
      materialId: 1,
      initialData: { issue, material: { ...material, author_name: '投稿者', author_email: 'material@example.com' } },
    })
    expect(materialHtml).toContain('mailto:material@example.com')
    expect(materialHtml.replace(/mailto:material@example\.com/g, '')).not.toContain('material@example.com')

    const opinionHtml = await render(OpinionDetailView, {
      issueId: 1,
      opinionId: 1,
      initialData: { issue, opinion: { ...opinion, author_name: '投稿者', author_email: 'opinion@example.com' } },
    })
    expect(opinionHtml).toContain('mailto:opinion@example.com')
    expect(opinionHtml.replace(/mailto:opinion@example\.com/g, '')).not.toContain('opinion@example.com')
  })

  it('renders nothing when the author did not opt in', async () => {
    const html = await render(IssuePreviewCard, { issue: { ...issue, material_count: 0, opinion_count: 0 } })
    expect(html).not.toContain('mailto:')
  })
})

describe('home issue card counters', () => {
  it('keeps tags but omits both counters when there are no opinions or votes', async () => {
    const html = await render(IssueCard, { issue: { ...issue, material_count: 0, opinion_count: 0, vote_count: 0, tags: ['能源'] } })
    expect(html).toContain('#能源')
    expect(html).not.toContain('role="img"')
  })

  it('shows the opinion count even when there are no tags', async () => {
    const html = await render(IssueCard, { issue: { ...issue, material_count: 0, opinion_count: 2, vote_count: 0 } })
    const indicator = html.match(/<span role="img"[\s\S]*?<\/span>/)?.[0]
    expect(indicator?.replace(/<[^>]*>/g, '').trim()).toBe('2')
  })

  it('shows cached cumulative votes even when the live opinion count is zero', async () => {
    const html = await render(IssueCard, { issue: { ...issue, material_count: 0, opinion_count: 0, vote_count: 3 } })
    const indicators = [...html.matchAll(/<span role="img"[\s\S]*?<\/span>/g)].map(match => match[0].replace(/<[^>]*>/g, '').trim())
    expect(indicators).toEqual(['3'])
  })
})

describe('home issue preview', () => {
  const previewIssue = { ...issue, material_count: 3, opinion_count: 5, vote_count: 7, author_name: '建立者', author_email: null }

  it('renders title, description, metadata, and the enter link', async () => {
    const html = await render(IssuePreviewCard, { issue: previewIssue })
    expect(html).toContain('測試議題')
    expect(html).toContain('議題說明')
    expect(html).toContain('3 份素材')
    expect(html).toContain('5 份意見')
    expect(html).toContain('建立者：建立者')
    expect(html).toContain('href="/issues/1"')
    expect(html).toContain('進入議題')
  })

  it('SSR 預設依發布日期而非最新活動排序', async () => {
    const html = await render(HomeView, {
      initialIssues: [
        { ...previewIssue, id: 2, title: 'Older publication', status: 'published', created_at: '2026-08-01', last_activity_at: '2026-10-01' },
        { ...previewIssue, id: 3, title: 'Newer publication', status: 'published', created_at: '2026-09-01', last_activity_at: '2026-09-01' },
      ],
    })
    expect(html).toContain('Older publication')
    expect(html).toContain('Newer publication')
    expect(html.indexOf('Newer publication')).toBeLessThan(html.indexOf('Older publication'))
  })

  it('SSR renders the preview layout from query-derived initial state', async () => {
    const html = await render(HomeView, { initialIssues: [previewIssue], initialPreviewIssueId: 1 })
    expect(html).toContain('議題說明')
    expect(html).toContain('進入議題')
    expect(html).not.toContain('id="home-issue-search"')
  })

  it('SSR initializes the home search and filters by tags without browser state', async () => {
    const html = await render(HomeView, {
      initialIssues: [
        { ...previewIssue, id: 2, title: '居住議題', status: 'published', tags: ['Housing Justice'] },
        { ...previewIssue, id: 3, title: '交通議題', status: 'published', tags: ['Transit'] },
      ],
      initialSearchQuery: '#housing',
    })
    expect(html).toContain('id="home-issue-search"')
    expect(html).toContain('value="#housing"')
    expect(html).toContain('value="#Housing Justice"')
    expect(html).toContain('居住議題')
    expect(html).not.toContain('交通議題')
  })

  it('SSR defaults to the open tab and excludes closed issues', async () => {
    const html = await render(HomeView, {
      initialIssues: [
        { ...previewIssue, id: 2, title: 'Open issue', status: 'published', is_closed: 0 },
        { ...previewIssue, id: 3, title: 'Closed issue', status: 'published', is_closed: 1 },
      ],
    })
    expect(html).toContain('aria-labelledby="home-tab-open"')
    expect(html).toContain('Open issue')
    expect(html).not.toContain('Closed issue')
  })

  it('SSR renders the closed lifecycle tab from initial state without showing open issues', async () => {
    const html = await render(HomeView, {
      initialIssues: [
        { ...previewIssue, id: 2, title: 'Open issue', status: 'published', is_closed: 0 },
        { ...previewIssue, id: 3, title: 'Closed issue', status: 'published', is_closed: 1 },
      ],
      initialLifecycleTab: 'closed',
    })
    expect(html).toContain('id="home-tab-closed"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-labelledby="home-tab-closed"')
    expect(html).toContain('Closed issue')
    expect(html).not.toContain('Open issue')
  })
})

describe('detail content Markdown and moderation boundaries', () => {
  const source = '**重點**\n\n- 第一項\n- 第二項\n\n[來源](https://example.com/reference)\n\n<script>alert(1)</script>\n\n![圖片](https://evil.example/tracker.png)\n\n[危險](javascript:alert(1))'
  const cases = [
    { component: MaterialDetailView, props: { issueId: 1, materialId: 1 }, entry: 'material', value: { ...material, content: source } },
    { component: OpinionDetailView, props: { issueId: 1, opinionId: 1 }, entry: 'opinion', value: { ...opinion, summary: source } },
  ]

  for (const { component, props, entry, value } of cases) {
    it(`renders formatted ${entry} content without executable HTML or remote images`, async () => {
      const html = await render(component, { ...props, initialData: { issue, [entry]: value } })
      expect(html).toContain('<strong>重點</strong>')
      expect(html).toContain('<li>第一項</li>')
      expect(html).toContain('href="https://example.com/reference"')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(html).not.toContain('<script>')
      expect(html).not.toMatch(/<img\b[^>]*\bsrc=["'](?:https?:|data:|\/\/)/i)
      expect(html).not.toContain('tracker.png')
      expect(html).not.toContain('href="javascript:')
    })

    it(`keeps hidden ${entry} content out of the rendered page`, async () => {
      const html = await render(component, { ...props, initialData: { issue, [entry]: { ...value, abuse_flagged: 3 } } })
      expect(html).not.toContain('重點')
      expect(html).not.toContain('第一項')
      expect(html).not.toContain('alert(1)')
      expect(html).not.toContain('https://example.com/reference')
    })
  }
})

describe('shared component SSR smoke tests', () => {
  const cases: Array<{ name: string; component: Component; props?: Record<string, unknown> }> = [
    { name: 'app footer', component: AppFooter },
    { name: 'app header', component: AppHeader },
    { name: 'issue card', component: IssueCard, props: { issue: { ...issue, material_count: 1, opinion_count: 1 } } },
    { name: 'issue preview card', component: IssuePreviewCard, props: { issue: { ...issue, material_count: 1, opinion_count: 1 } } },
    { name: 'long text content', component: LongTextContent, props: { text: '短素材' } },
    { name: 'moderation appeal form', component: ModerationAppealForm, props: { appealType: 'rejected_submission', reportId: 1, policyCode: 'spam', rationale: '測試' } },
    { name: 'moderation appeal notice', component: ModerationAppealNotice, props: { appealType: 'rejected_submission', reportId: 1, policyCode: 'spam', rationale: '測試' } },
    { name: 'sign-in buttons', component: SignInButtons, props: { callbackUrl: '/' } },
    { name: 'status badge', component: StatusBadge, props: { status: 'collecting' } },
    { name: 'toast', component: Toast },
    { name: 'viewer role switch', component: ViewerRoleSwitch },
  ]

  for (const testCase of cases) {
    it(`renders ${testCase.name}`, async () => {
      const html = await render(testCase.component, testCase.props)
      expect(html.length).toBeGreaterThan(0)
    })
  }
})

describe('desktop navbar current route', () => {
  it('underlines the active issues/about link and leaves the other link without an underline', async () => {
    const homeHtml = await render(AppHeader, { current: 'home' })
    const homeIssuesLink = homeHtml.match(/<a href="\/" class="([^"]*)"[^>]*>\s*所有議題/)?.[1] ?? ''
    const homeAboutLink = homeHtml.match(/<a href="\/about" class="([^"]*)"[^>]*>\s*關於/)?.[1] ?? ''
    expect(homeIssuesLink.split(' ')).toContain('underline')
    expect(homeIssuesLink.split(' ')).not.toContain('no-underline')
    expect(homeAboutLink.split(' ')).toContain('no-underline')

    const aboutHtml = await render(AppHeader, { current: 'about' })
    const aboutIssuesLink = aboutHtml.match(/<a href="\/" class="([^"]*)"[^>]*>\s*所有議題/)?.[1] ?? ''
    const aboutLink = aboutHtml.match(/<a href="\/about" class="([^"]*)"[^>]*>\s*關於/)?.[1] ?? ''
    expect(aboutIssuesLink.split(' ')).toContain('no-underline')
    expect(aboutLink.split(' ')).toContain('underline')
    expect(aboutLink.split(' ')).not.toContain('no-underline')
  })
})

describe('long text collapsing (#65)', () => {
  const longText = '長'.repeat(1200)

  it('renders short content inline without a toggle', async () => {
    const html = await render(LongTextContent, { text: '短素材內容' })
    expect(html).toContain('短素材內容')
    expect(html).not.toContain('展開全文')
  })

  it('renders content of exactly the threshold length inline', async () => {
    const html = await render(LongTextContent, { text: '字'.repeat(1000) })
    expect(html).not.toContain('展開全文')
  })

  it('shows the character count and a toggle instead of long content, never a truncated excerpt', async () => {
    const html = await render(LongTextContent, { text: longText })
    expect(html).toContain('全文共 1200 字')
    expect(html).toContain('展開全文')
    // 折疊時完全不輸出原文（不截短，符合 CC BY-NC-ND 的禁止改作）
    expect(html).not.toContain('長長長')
  })

  it('counts astral characters as single characters', async () => {
    const html = await render(LongTextContent, { text: '😀'.repeat(1001) })
    expect(html).toContain('全文共 1001 字')
  })
})

describe('shared Markdown editor soft character limit', () => {
  it('counts emoji as code points and keeps content beyond the suggested limit', async () => {
    const atLimit = '😀'.repeat(100)
    const overLimit = '😀'.repeat(101)
    const atLimitHtml = await render(MarkdownEditor, { modelValue: atLimit, id: 'editor', label: '內容', maxChars: 100 })
    const overLimitHtml = await render(MarkdownEditor, { modelValue: overLimit, id: 'editor', label: '內容', maxChars: 100 })

    expect(atLimitHtml).toContain('100/100')
    expect(overLimitHtml).toContain('101/100')
    expect(overLimitHtml).not.toContain('maxlength=')
    expect(overLimitHtml).toContain(overLimit)
  })
})
