import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  // 不解析投稿者提供的原始 HTML，避免 script、event handler 等標籤進入 v-html。
  html: false,
  breaks: true,
  linkify: true,
})

// Markdown 圖片也不輸出 img，避免投稿內容要求使用者的瀏覽器載入任意外部資源。
markdown.renderer.rules.image = () => ''

/** 將不受信任的 Markdown 轉為可安全插入頁面的 HTML。 */
export function renderSafeMarkdown(source: string): string {
  return markdown.render(source)
}
