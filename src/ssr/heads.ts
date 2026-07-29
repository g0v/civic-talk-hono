export type MetaEntry =
  | { name: string; content: string }
  | { property: string; content: string }

export interface HeadConfig {
  title: string
  description?: string
  meta?: MetaEntry[]
}

const SITE_NAME = 'Civic Talk'

const DEFAULT_OG_IMAGE = `https://www.moedict.tw/${encodeURIComponent('審議')}.png`

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function headForHome(origin: string): HeadConfig {
  const title = `${SITE_NAME}｜公共議題審議平台`
  const description =
    '用 AI 降低參與門檻，讓更多人真正了解議題全貌，而不只是選邊站。'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE, `${origin}/`),
  }
}

export function headForAbout(origin: string): HeadConfig {
  const title = `關於 — ${SITE_NAME}`
  const description = 'Civic Talk 實驗中的公民審議平台：素材彙整、說明頁與意見回饋循環。'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE, `${origin}/about`),
  }
}

export function headForIssue(title: string, description: string, id: number, origin: string): HeadConfig {
  const pageTitle = `${title} — ${SITE_NAME}`
  const desc = description || 'Civic Talk 議題說明與公眾參與'
  return {
    title: pageTitle,
    description: desc,
    meta: buildOg(pageTitle, desc, DEFAULT_OG_IMAGE, `${origin}/issues/${id}`),
  }
}

export function headForContribute(title: string, id: number, origin: string): HeadConfig {
  const pageTitle = `提交素材｜${title || SITE_NAME}`
  const description = '為議題提交素材：保留原文、標註來源與立場。'
  return {
    title: pageTitle,
    description,
    meta: buildOg(pageTitle, description, DEFAULT_OG_IMAGE, `${origin}/contribute/${id}`),
  }
}

export function headForAdmin(origin: string): HeadConfig {
  const title = `管理後台 — ${SITE_NAME}`
  const description = 'Civic Talk 管理後台'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE, `${origin}/admin`),
  }
}

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
      parts.push(
        `<meta property="${escapeHtml(m.property)}" content="${escapeHtml(m.content)}" />`,
      )
    }
  }
  return parts.join('\n    ')
}
