import { describe, expect, it } from 'vite-plus/test'
import { renderSafeMarkdown } from '../markdown/renderSafeMarkdown'

describe('renderSafeMarkdown', () => {
  it('renders standard Markdown', () => {
    expect(renderSafeMarkdown('## 標題\n\n這是 **重點**。')).toContain('<h2>標題</h2>')
    expect(renderSafeMarkdown('## 標題\n\n這是 **重點**。')).toContain('<strong>重點</strong>')
  })

  it('does not render raw HTML or Markdown images', () => {
    const html = renderSafeMarkdown('<script>alert(1)</script>\n\n<img src="https://evil.example/image.png">\n\n![描述](https://evil.example/image.png)')

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('does not create links with unsafe protocols', () => {
    expect(renderSafeMarkdown('[危險連結](javascript:alert(1))')).not.toContain('href="javascript:')
  })
})
