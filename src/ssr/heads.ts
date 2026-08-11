export type MetaEntry = { name: string; content: string } | { property: string; content: string }

export interface HeadConfig {
  title: string
  description?: string
  meta?: MetaEntry[]
}

const SITE_NAME = 'Civic Talk'

const DEFAULT_OG_IMAGE = (origin: string) => `${origin}/img/og-image.png`

function buildOg(title: string, description: string, image: string, url: string): MetaEntry[] {
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function headForHome(origin: string): HeadConfig {
  const title = `${SITE_NAME}｜公共議題審議平台`
  const description = '用 AI 降低參與門檻，讓更多人真正了解議題全貌，而不只是選邊站。'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE(origin), `${origin}/`),
  }
}

export function headForAbout(origin: string): HeadConfig {
  const title = `關於 — ${SITE_NAME}`
  const description = 'Civic Talk 實驗中的公民審議平台：素材彙整、說明頁與意見回饋循環。'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE(origin), `${origin}/about`),
  }
}

export function headForIssue(title: string, description: string, id: number, origin: string): HeadConfig {
  const pageTitle = `${title} — ${SITE_NAME}`
  const desc = description || 'Civic Talk 議題說明與公眾參與'
  return {
    title: pageTitle,
    description: desc,
    meta: buildOg(pageTitle, desc, DEFAULT_OG_IMAGE(origin), `${origin}/issues/${id}`),
  }
}

export function headForContribute(title: string, id: number, origin: string): HeadConfig {
  const pageTitle = `提交素材｜${title || SITE_NAME}`
  const description = '為議題提交素材：保留原文、標註來源與立場。'
  return {
    title: pageTitle,
    description,
    meta: buildOg(pageTitle, description, DEFAULT_OG_IMAGE(origin), `${origin}/contribute/${id}`),
  }
}

export function headForAdmin(origin: string): HeadConfig {
  const title = `管理後台 — ${SITE_NAME}`
  const description = 'Civic Talk 管理後台'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE(origin), `${origin}/admin`),
  }
}

export function headForMaterial(sourceName: string | null, issueTitle: string, issueId: number, materialId: number, origin: string): HeadConfig {
  const label = sourceName || '素材'
  const pageTitle = `${label}｜${issueTitle} — ${SITE_NAME}`
  const description = `來自「${issueTitle}」的素材：${label}`
  return {
    title: pageTitle,
    description,
    meta: buildOg(pageTitle, description, DEFAULT_OG_IMAGE(origin), `${origin}/issues/${issueId}/source/${materialId}`),
  }
}

export function headForOpinion(opinionSnippet: string, issueTitle: string, issueId: number, opinionId: number, origin: string): HeadConfig {
  const snippet = opinionSnippet.slice(0, 80) + (opinionSnippet.length > 80 ? '…' : '')
  const pageTitle = `意見：${snippet}｜${issueTitle} — ${SITE_NAME}`
  const description = `來自「${issueTitle}」的公眾意見：${snippet}`
  return {
    title: pageTitle,
    description,
    meta: buildOg(pageTitle, description, DEFAULT_OG_IMAGE(origin), `${origin}/issues/${issueId}/comment/${opinionId}`),
  }
}

export function headForNotFound(origin: string): HeadConfig {
  const title = `找不到頁面 — ${SITE_NAME}`
  const description = '這個網址可能已經移動、輸入錯誤，或內容已經被刪除。'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE(origin), `${origin}/`),
  }
}
export function headForPrivacy(origin: string): HeadConfig {
  const title = `隱私權政策 — ${SITE_NAME}`
  const description = 'Civic Talk 隱私權政策：說明平台收集、使用及保護個人資料的方式。'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE(origin), `${origin}/privacy`),
  }
}

export function headForTerms(origin: string): HeadConfig {
  const title = `使用條款 — ${SITE_NAME}`
  const description = 'Civic Talk 使用條款：具名提交、素材授權規範與平台行為準則。'
  return {
    title,
    description,
    meta: buildOg(title, description, DEFAULT_OG_IMAGE(origin), `${origin}/terms`),
  }
}


export function renderHeadTags(head: HeadConfig): string {
  const parts: string[] = ['<meta charset="UTF-8" />', '<meta name="viewport" content="width=device-width, initial-scale=1.0" />', `<title>${escapeHtml(head.title)}</title>`]
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
