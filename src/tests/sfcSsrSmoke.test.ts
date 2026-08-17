import { renderToString } from '@vue/server-renderer'
import { createSSRApp, type Component } from 'vue'
import { describe, expect, it } from 'vite-plus/test'
import AppFooter from '../components/AppFooter.vue'
import AppHeader from '../components/AppHeader.vue'
import IssueCard from '../components/IssueCard.vue'
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

describe('shared component SSR smoke tests', () => {
  const cases: Array<{ name: string; component: Component; props?: Record<string, unknown> }> = [
    { name: 'app footer', component: AppFooter },
    { name: 'app header', component: AppHeader },
    { name: 'issue card', component: IssueCard, props: { issue: { ...issue, material_count: 1, opinion_count: 1 } } },
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
