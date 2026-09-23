export const POLIS_COMMENTS_HEADER = 'timestamp,datetime,comment-id,author-id,agrees,disagrees,moderated,comment-body'

export interface OpinionExportInput {
  id: number
  summary: string | null
  created_at: string | number
  author_id: string | null
  agrees: number
  disagrees: number
}

export interface CommentsCsvRow {
  id: number
  body: string
  authorId: number
  agrees: number
  disagrees: number
  createdAt: string | number
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function timestampMs(value: string | number): number {
  if (typeof value === 'number') return value
  const normalized = /(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}Z`
  const parsed = Date.parse(normalized)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function polisDatetime(value: string | number): string {
  const date = new Date(timestampMs(value))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
}

export function csvQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function toCommentsCsvRows(rows: OpinionExportInput[]): CommentsCsvRow[] {
  const firstOpinionByAuthor = new Map<string, number>()
  for (const row of rows) {
    if (row.author_id !== null && (!firstOpinionByAuthor.has(row.author_id) || row.id < (firstOpinionByAuthor.get(row.author_id) as number))) {
      firstOpinionByAuthor.set(row.author_id, row.id)
    }
  }
  const knownAuthors = new Map<string, number>()
  const orderedAuthors = [...firstOpinionByAuthor.entries()].sort((a, b) => a[1] - b[1])
  orderedAuthors.forEach(([author], index) => knownAuthors.set(author, index + 1))
  let nextAnonymousId = knownAuthors.size + 1

  return rows.map(row => {
    const authorId = row.author_id === null ? nextAnonymousId++ : (knownAuthors.get(row.author_id) as number)
    return {
      id: row.id,
      body: row.summary ?? '',
      authorId,
      agrees: row.agrees,
      disagrees: row.disagrees,
      createdAt: row.created_at,
    }
  })
}

export function formatCommentsCsv(rows: CommentsCsvRow[]): string {
  const lines = rows.map(row => [Math.floor(timestampMs(row.createdAt) / 1000), polisDatetime(row.createdAt), row.id, row.authorId, row.agrees, row.disagrees, 1, csvQuote(row.body)].join(','))
  return [POLIS_COMMENTS_HEADER, ...lines].join('\n') + '\n'
}
