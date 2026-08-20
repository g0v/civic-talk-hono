import { renderToString } from '@vue/server-renderer'
import { createSSRApp, type Component } from 'vue'
import { describe, expect, it } from 'vite-plus/test'
import AppFooter from '../components/AppFooter.vue'
import AppHeader from '../components/AppHeader.vue'
import IssueCard from '../components/IssueCard.vue'
import LongTextContent from '../components/LongTextContent.vue'
import ModerationAppealForm from '../components/ModerationAppealForm.vue'
import ModerationAppealNotice from '../components/ModerationAppealNotice.vue'
import SignInButtons from '../components/SignInButtons.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Toast from '../components/Toast.vue'
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
  polis_id: null,
  created_at: '2026-08-17 00:00:00',
  abuse_flagged: 0,
  author_name: null,
  author_email: null,
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
    const html = await render(IssueCard, { issue: optedIn })
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
    const html = await render(IssueCard, { issue: { ...issue, material_count: 0, opinion_count: 0 } })
    expect(html).not.toContain('mailto:')
  })
})

describe('shared component SSR smoke tests', () => {
  const cases: Array<{ name: string; component: Component; props?: Record<string, unknown> }> = [
    { name: 'app footer', component: AppFooter },
    { name: 'app header', component: AppHeader },
    { name: 'issue card', component: IssueCard, props: { issue: { ...issue, material_count: 1, opinion_count: 1 } } },
    { name: 'long text content', component: LongTextContent, props: { text: '短素材' } },
    { name: 'moderation appeal form', component: ModerationAppealForm, props: { appealType: 'rejected_submission', reportId: 1, policyCode: 'spam', rationale: '測試' } },
    { name: 'moderation appeal notice', component: ModerationAppealNotice, props: { appealType: 'rejected_submission', reportId: 1, policyCode: 'spam', rationale: '測試' } },
    { name: 'sign-in buttons', component: SignInButtons, props: { callbackUrl: '/' } },
    { name: 'status badge', component: StatusBadge, props: { status: 'collecting' } },
    { name: 'toast', component: Toast },
  ]

  for (const testCase of cases) {
    it(`renders ${testCase.name}`, async () => {
      const html = await render(testCase.component, testCase.props)
      expect(html.length).toBeGreaterThan(0)
    })
  }
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
