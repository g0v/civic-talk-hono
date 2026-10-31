import { renderToString } from '@vue/server-renderer'
import { createSSRApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vite-plus/test'

const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))

vi.mock('vue3-carousel', async importOriginal => {
  const actual = await importOriginal<typeof import('vue3-carousel')>()
  const CarouselStub = defineComponent({
    inheritAttrs: false,
    props: { mouseDrag: { type: null }, touchDrag: { type: null } },
    setup(props, { slots }) {
      captured.props = { ...props }
      return () => h('div', slots.default?.())
    },
  })
  return { ...actual, Carousel: CarouselStub }
})

const { provideI18n } = await import('../l10n')
const { default: IssueView } = await import('../views/Issue.vue')

describe('Issue briefing carousel drag', () => {
  it('disables mouse drag for text selection but keeps touch drag', async () => {
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
          tags: [],
          is_closed: 0,
          closure_reason: null,
          closure_changed_at: null,
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

    await renderToString(app)

    expect(captured.props).toEqual({ mouseDrag: false, touchDrag: true })
  })
})
