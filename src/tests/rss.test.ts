import { describe, expect, it } from 'vite-plus/test'
import { generateIssueRssFeed } from '../rss'

describe('單一議題 RSS', () => {
  it('只輸出該議題的素材與公民意見，並使用各自的永久連結', async () => {
    const binds: unknown[][] = []
    const db = {
      prepare(sql: string) {
        expect(sql).toContain('ct_materials')
        expect(sql).toContain('ct_opinions')
        return {
          bind(...args: unknown[]) {
            binds.push(args)
            return {
              all: async () => ({
                results: [
                  { type: 'opinion', id: 22, title: null, description: '我認為 <b>應該</b> 審慎處理', issue_id: 7, created_at: '2026-09-28T10:00:00Z' },
                  { type: 'material', id: 11, title: '研究報告', description: '報告內容', issue_id: 7, created_at: '2026-09-27T10:00:00Z' },
                ],
              }),
            }
          },
        }
      },
    } as unknown as D1Database

    const xml = await generateIssueRssFeed(db, { id: 7, title: '測試議題' }, 'https://civic.example')

    expect(binds).toEqual([[7, 7]])
    expect(xml).toContain('<title>Civic Talk — 測試議題</title>')
    expect(xml).toContain('https://civic.example/issues/7/rss.xml')
    expect(xml).toContain('https://civic.example/issues/7/source/11')
    expect(xml).toContain('https://civic.example/issues/7/comment/22')
    expect(xml).toContain('<category>素材</category>')
    expect(xml).toContain('<category>公民意見</category>')
    expect(xml).toContain('我認為 應該 審慎處理')
    expect(xml).not.toContain('<b>')
  })
})
