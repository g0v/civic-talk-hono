import { createSSRApp, type Component } from 'vue'
import { provideI18n } from '../l10n'
import HomeView from '../views/Home.vue'
import AboutView from '../views/About.vue'
import IssueView from '../views/Issue.vue'
import ContributeView from '../views/Contribute.vue'
import AdminView from '../views/Admin.vue'
import MaterialDetailView from '../views/MaterialDetail.vue'
import OpinionDetailView from '../views/OpinionDetail.vue'
import NotFoundView from '../views/NotFound.vue'
import type { PageName } from '../ssr/render'

declare global {
  interface Window {
    __PAGE__?: PageName
    __SSR_STATE__?: Record<string, unknown>
  }
}

const pages: Record<PageName, Component> = {
  home: HomeView,
  about: AboutView,
  issue: IssueView,
  contribute: ContributeView,
  admin: AdminView,
  material: MaterialDetailView,
  opinion: OpinionDetailView,
  'not-found': NotFoundView,
}

const page = window.__PAGE__
const state = window.__SSR_STATE__ ?? {}

if (!page || !pages[page]) {
  console.error('[civic] unknown page for hydration:', page)
} else {
  const app = createSSRApp(pages[page], state)
  // 與 SSR 一致先用 zh-TW；localStorage 語言偏好在 AppHeader onMounted 再切
  provideI18n(app, 'zh-TW')
  app.mount('#app', true)
}
