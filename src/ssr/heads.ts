// <meta> 兩種寫法：name="..."（一般 SEO）與 property="..."（OG 系列）
export type MetaEntry =
  | { name: string; content: string }
  | { property: string; content: string }

// 每條路由產出的 head 設定，會交給 renderHeadTags() 轉成 HTML
export interface HeadConfig {
  title: string
  description?: string
  meta?: MetaEntry[]
}

const SITE_NAME = 'Hono Vue SSR Template'

// 預設的 OG 圖片是 "模板" 的字圖，來自 moedict.tw
const DEFAULT_OG_IMAGE = `https://www.moedict.tw/${encodeURIComponent('模板')}.png`

// 統一產 OG / Twitter Card meta，避免每條路由都自己寫一次
function buildOg(
  title: string,
  description: string,
  image: string,
  url: string,
): MetaEntry[] {
  return [
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: image },
    { property: 'og:url', content: url },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ]
}

export function headForHome(origin: string): HeadConfig {
  const title = `${SITE_NAME} — Home`
  const description = 'A minimal Hono + Vue SSR template on Cloudflare Workers.'
  return {
    title,
    description,
    // DEFAULT_OG_IMAGE 已是完整網址，不需再拼 origin
    meta: buildOg(title, description, DEFAULT_OG_IMAGE, `${origin}/`),
  }
}

export function headForAbout(origin: string): HeadConfig {
  const title = `About — ${SITE_NAME}`
  const description = 'About this template: Hono + Vue + Vue SSR on Cloudflare Workers.'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE, `${origin}/about`),
  }
}

export function headForWord(word: string, origin: string): HeadConfig {
  const title = `${word} — ${SITE_NAME}`
  const description = `Word page for: ${word}`

  // 使用 moedict.tw 的 API 來取得字圖
  const ogImage = `https://www.moedict.tw/${encodeURIComponent(word)}.png`
  return {
    title,
    description,
    meta: buildOg(title, description, ogImage, `${origin}/word/${encodeURIComponent(word)}`),
  }
}

export function headForHundredChart(origin: string): HeadConfig {
  const title = `百數表 Hydration — ${SITE_NAME}`
  const description =
    'Vue SSR 後由瀏覽器 hydration：v-model、v-for、:style 互動示範（倍數著色）。'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE, `${origin}/hundred`),
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 把 HeadConfig 轉成可以塞進 <head> 的 HTML 字串
export function renderHeadTags(head: HeadConfig): string {
  const parts: string[] = [
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<title>${escapeHtml(head.title)}</title>`,
  ]
  if (head.description) {
    parts.push(`<meta name="description" content="${escapeHtml(head.description)}" />`)
  }
  for (const m of head.meta ?? []) {
    if ('name' in m) {
      parts.push(`<meta name="${escapeHtml(m.name)}" content="${escapeHtml(m.content)}" />`)
    } else {
      parts.push(`<meta property="${escapeHtml(m.property)}" content="${escapeHtml(m.content)}" />`)
    }
  }
  return parts.join('\n    ')
}
