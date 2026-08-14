import { describe, expect, it } from 'vite-plus/test'
import { renderSafeMarkdown } from '../markdown/renderSafeMarkdown'

describe('renderSafeMarkdown', () => {
  it('renders standard Markdown', () => {
    const html = renderSafeMarkdown('## 標題\n\n這是 **重點**，也是 *斜體*。')

    expect(html).toContain('<h2>標題</h2>')
    expect(html).toContain('<strong>重點</strong>')
    expect(html).toContain('<em>斜體</em>')
  })

  it('escapes raw HTML instead of rendering it', () => {
    const source = [
      '<script>alert("xss")</script>',
      '<div onclick="alert(1)">內容</div>',
      '<iframe src="https://evil.example/frame"></iframe>',
      '<video autoplay src="https://evil.example/video.mp4"></video>',
    ].join('\n\n')
    const html = renderSafeMarkdown(source)

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<div')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<video')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;div onclick=')
    expect(html).toContain('&lt;iframe src=')
    expect(html).toContain('&lt;video autoplay')
  })

  it('escapes every common raw HTML image element', () => {
    const source = [
      '<img src="https://evil.example/img.png" onerror="alert(1)">',
      '<picture><source srcset="https://evil.example/source.webp"><img src="https://evil.example/fallback.png"></picture>',
      '<svg><image href="https://evil.example/vector.png"></image></svg>',
      '<input type="image" src="https://evil.example/button.png">',
    ].join('\n\n')
    const html = renderSafeMarkdown(source)

    expect(html).not.toMatch(/<(?:img|picture|source|svg|image|input)\b/i)
    expect(html).toContain('&lt;img src=')
    expect(html).toContain('&lt;picture&gt;')
    expect(html).toContain('&lt;svg&gt;')
    expect(html).toContain('&lt;input type=')
  })

  it('omits inline, reference, nested-link, and data-URI Markdown images', () => {
    const source = [
      '![inline](https://evil.example/inline.png "title")',
      '![reference][hero]',
      '![collapsed][]',
      '![shortcut]',
      '[![nested](https://evil.example/nested.png)](https://example.com)',
      '![data](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
      '',
      '[hero]: https://evil.example/reference.png',
      '[collapsed]: https://evil.example/collapsed.png',
      '[shortcut]: https://evil.example/shortcut.png',
    ].join('\n\n')
    const html = renderSafeMarkdown(source)

    expect(html).not.toMatch(/<img\b/i)
    expect(html).not.toContain('inline.png')
    expect(html).not.toContain('reference.png')
    expect(html).not.toContain('collapsed.png')
    expect(html).not.toContain('shortcut.png')
    expect(html).not.toContain('nested.png')
  })

  it('does not turn image-like text or escaped HTML into an image element', () => {
    const sources = [
      '\\!\\[描述\\](https://evil.example/escaped.png)',
      '&lt;img src="https://evil.example/entity.png"&gt;',
      '`<img src="https://evil.example/code.png">`',
      '```html\n<img src="https://evil.example/fence.png">\n```',
    ]

    for (const source of sources) {
      expect(renderSafeMarkdown(source)).not.toMatch(/<img\b/i)
    }
  })

  it('does not create links with unsafe protocols', () => {
    const html = renderSafeMarkdown('[JavaScript](javascript:alert(1)) [資料](data:text/html;base64,PHNjcmlwdD4=)')

    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="data:')
  })
})
