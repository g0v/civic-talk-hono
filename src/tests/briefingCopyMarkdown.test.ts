import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { describe, expect, it } from 'vite-plus/test'
import { briefingMarkdown } from '../client/clipboard'
import type { Briefing } from '../db/queries'
import { provideI18n } from '../l10n'
import IssueView from '../views/Issue.vue'

const briefing: Briefing = {
  id: 1,
  issue_id: 1,
  narrative: '# 概覽\n\n**粗體**概覽',
  consensus: '- 共識一\n- 共識二',
  disputes: '1. 爭點 `code`',
  positions: '> 立場引言\n\n[連結](https://example.com)',
  opinion_prompt: null,
  version: 2,
  created_at: '2026-08-17 00:00:00',
  author_name: '志願者',
  author_email: null,
  abuse_flagged: 0,
}

async function renderIssue(current: Briefing | null) {
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
      briefing: current,
      opinions: [],
    },
  })
  provideI18n(app, 'zh-TW')
  return renderToString(app)
}

describe('說明卡一鍵複製 Markdown', () => {
  it.each(['narrative', 'consensus', 'disputes', 'positions'] as const)('%s 卡複製該欄位的原始 Markdown', field => {
    expect(briefingMarkdown(briefing, field)).toBe(briefing[field])
  })

  it('欄位為空時回傳空字串', () => {
    expect(briefingMarkdown({ ...briefing, consensus: null }, 'consensus')).toBe('')
  })

  it('四張說明卡各有一顆對應章節的複製按鈕', async () => {
    const html = await renderIssue(briefing)

    for (const section of ['概覽', '共識', '爭點', '立場地圖']) {
      expect(html).toContain(`aria-label="複製「${section}」的 Markdown"`)
    }
    expect((html.match(/複製 Markdown/g) ?? []).length).toBe(4)
  })

  it('沒有說明頁時不顯示複製按鈕', async () => {
    const html = await renderIssue(null)

    expect(html).not.toContain('複製 Markdown')
  })
})
