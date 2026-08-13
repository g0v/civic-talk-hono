/**
 * RSS 2.0 產生器與 Cloudflare Cache API 快取層
 *
 * 規格：
 * - 議題（issue）與素材（material）混合，按 created_at DESC 取最新 20 筆
 * - Cache TTL：1 小時（3600 秒），使用 Cloudflare Worker Cache API（caches.default）
 * - 議題連結 → /issues/:id；素材連結 → /issues/:issue_id/source/:id
 */

import { listForRss } from './db/queries'

/** RSS Cache TTL（秒） */
const RSS_CACHE_TTL = 3600

/**
 * RSS 描述欄位的三層淨化：
 * 1. Strip HTML tags — 部分 RSS reader 把 <description> 當 HTML 渲染。
 *    HTML5 tag-open state 只在 `<` 直後接 ASCII letter 或 `/` 時才開 tag；
 *    所以只 strip `<[/]letter...>` 與 `<!-- comment -->` 即可精確覆蓋所有
 *    reader 會執行的結構，同時保留 `a < b > c` 這類數學比較式。
 * 2. 清除 XML 1.0 禁止的控制字元（U+0000–U+0008、U+000B–U+000C、U+000E–U+001F、U+FFFE、U+FFFF）
 * 3. 轉義 XML 特殊字元（&、<、>、"、'）
 */
function xmlEscape(str: string): string {
  const noTags = str.replace(/<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->/g, '')
  // eslint-disable-next-line no-control-regex
  const noCtrl = noTags.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
  return noCtrl
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** ISO 8601 → RFC 822（RSS 2.0 的 pubDate 格式） */
function toRfc822(iso: string): string {
  return new Date(iso).toUTCString()
}

/** 生成 RSS 2.0 XML 字串 */
export async function generateRssFeed(db: D1Database, origin: string): Promise<string> {
  const items = await listForRss(db, 20)
  const lastBuildDate =
    items.length > 0 ? toRfc822(items[0].created_at) : new Date().toUTCString()

  const itemXml = items
    .map(item => {
      const titleRaw =
        item.title ?? (item.type === 'issue' ? '（無標題議題）' : '素材投稿')
      // 素材 content 可能很長；描述截 300 字元避免 feed 過重
      const descRaw = (item.description ?? '').slice(0, 300)
      const link =
        item.type === 'issue'
          ? `${origin}/issues/${item.id}`
          : `${origin}/issues/${item.issue_id}/source/${item.id}`
      return `    <item>
      <title>${xmlEscape(titleRaw)}</title>
      <link>${link}</link>
      <description>${xmlEscape(descRaw)}</description>
      <category>${item.type === 'issue' ? '議題' : '素材'}</category>
      <pubDate>${toRfc822(item.created_at)}</pubDate>
      <guid isPermaLink="true">${link}</guid>
    </item>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Civic Talk — 公共議題討論平台</title>
    <link>${origin}</link>
    <description>公共議題審議平台，追蹤最新議題與素材投稿</description>
    <language>zh-TW</language>
    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${itemXml}
  </channel>
</rss>`
}

// Cloudflare Workers 執行環境有 caches.default；DOM lib 的 CacheStorage 型別不含此欄位。
// type 宣告不執行，故留頂層；實際的 caches 存取改到 handleRss 內部（惰性、每次請求）。
type CFCaches = typeof caches & { readonly default: Cache }

/**
 * /rss.xml 請求處理器 — waitUntil 只需最小介面，相容 Hono 與 CF Workers 兩邊的型別
 *
 * 快取策略：
 * 1. 查 caches.default — 命中直接回傳
 * 2. 未命中 → 查 D1 → 生成 XML → background waitUntil 寫入 cache → 回傳
 *
 * 注意：本機 wrangler dev 的 Cache API 可能與正式行為不同；
 * caches.default 的存取與使用都在 try/catch 內，dev 環境失敗時安靜跳過。
 */
export async function handleRss(
  db: D1Database,
  request: Request,
  executionCtx: { waitUntil(promise: Promise<unknown>): void }
): Promise<Response> {
  // 1. 惰性取 caches.default（每次請求內存取，避免模組頂層初始化失敗）
  const cacheKey = new Request(request.url)
  try {
    const cfCaches = caches as CFCaches
    const cached = await cfCaches.default.match(cacheKey)
    if (cached) return cached
  } catch {
    // 本機 dev 環境可能不支援 caches.default，忽略
  }

  // 2. 生成 RSS
  const origin = new URL(request.url).origin
  const xml = await generateRssFeed(db, origin)

  const response = new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${RSS_CACHE_TTL}`,
    },
  })

  // 3. 寫入 Cache（背景，不阻塞回應）
  try {
    const cfCaches = caches as CFCaches
    executionCtx.waitUntil(cfCaches.default.put(cacheKey, response.clone()))
  } catch {
    // 本機 dev 環境可能不支援 caches.default，忽略
  }

  return response
}
