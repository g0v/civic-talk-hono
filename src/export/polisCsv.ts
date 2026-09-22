/**
 * pol.is 相容的 CSV 匯出（issue #107）。
 *
 * 格式以 mashbean/pocket-polis 的 src/export.ts 為準，該專案的 comments.csv 已驗證
 * 可直接上傳 Sensemaker（https://make.vtaiwan.tw/）做 AI 綜整。沿用同一份格式，
 * Civic Talk 匯出的檔案才不必轉檔就能進同一套工具鏈。
 *
 * 硬性規則（偏離會讓嚴格比對 header 的工具讀不出來）：
 *   - UTF-8、LF 換行、無 BOM
 *   - datetime 欄不加引號；comment-body 一律加引號，內部雙引號寫成 ""
 *   - 結尾保留一個換行
 *
 * 匿名化：投票者與投稿者一律以「該議題內首次出現的順序」編成 p1、p2⋯，
 * 絕不輸出 Better Auth 的 user.id（AGENTS.md 的作者隱私規則）。
 */

/** 1 同意、-1 不同意、0 略過（pol.is 語意） */
export type VoteValue = 1 | 0 | -1

export const POLIS_COMMENTS_HEADER = 'timestamp,datetime,comment-id,author-id,agrees,disagrees,moderated,comment-body'
export const VOTES_HEADER = 'participant,statement_id,vote,updated_at'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * SQLite 的 DATETIME 是「YYYY-MM-DD HH:MM:SS」且沒有時區標記，CURRENT_TIMESTAMP 寫的是 UTC。
 * 直接丟給 new Date() 會依引擎不同被當成當地時間，整批時間平移；這裡補上 T 與 Z 明示 UTC。
 * 解析不出來時回 0，讓匯出不會因單一壞資料整份失敗。
 */
export function sqliteToMs(value: string | null): number {
  if (!value) return 0
  const iso = value.includes('T') ? value : value.replace(' ', 'T')
  const ms = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * 與 Node 在 TZ=UTC 下 Date#toString() 同形（pol.is 匯出檔就是這個樣子）。
 * 不能直接用 toString()：執行環境的時區名稱會被在地化成「世界標準時間」之類的字樣。
 */
export function polisDatetime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ` +
    'GMT+0000 (Coordinated Universal Time)'
  )
}

/**
 * pol.is 的 moderated 欄：1 已核准、0 未審、-1 已拒絕。
 * 對應 Civic Talk 的 abuse_flagged：0 正常 → 1；1 使用者回報待審 → 0。
 * 2（確認違規）與 3（AI 判定違規）的內容不得外流，呼叫端必須在查詢階段就排除，
 * 不是靠這裡標記，所以這兩種值視為已拒絕只是防呆。
 */
export function moderatedFlag(abuseFlagged: number): 1 | 0 | -1 {
  if (abuseFlagged === 0) return 1
  if (abuseFlagged === 1) return 0
  return -1
}

/** comment-body 一律加引號（pol.is 的寫法） */
export function csvQuote(text: string): string {
  return `"${text.replaceAll('"', '""')}"`
}

export interface CommentRow {
  /** 意見 id，對應 pol.is 的 comment-id */
  id: number
  summary: string | null
  created_at: string | null
  abuse_flagged: number
  /** 匿名化後的投稿者序號；缺作者（需登入之前的舊資料）為 0 */
  author_seq: number
  agrees: number
  disagrees: number
}

export function formatCommentsCsv(rows: CommentRow[]): string {
  const lines = rows.map(r => {
    const ms = sqliteToMs(r.created_at)
    return [Math.floor(ms / 1000), polisDatetime(ms), r.id, r.author_seq, r.agrees, r.disagrees, moderatedFlag(r.abuse_flagged), csvQuote(r.summary ?? '')].join(',')
  })
  return [POLIS_COMMENTS_HEADER, ...lines].join('\n') + '\n'
}

export interface VoteRow {
  /** 匿名化後的投票者序號 */
  participant_seq: number
  opinion_id: number
  value: VoteValue
  updated_at: string | null
}

export function formatVotesCsv(rows: VoteRow[]): string {
  const lines = rows.map(r => [`p${r.participant_seq}`, r.opinion_id, r.value, new Date(sqliteToMs(r.updated_at)).toISOString()].join(','))
  return [VOTES_HEADER, ...lines].join('\n') + '\n'
}

/**
 * 把 Better Auth 的 user.id 對應成該議題內穩定的 p 序號。
 *
 * 穩定性來自呼叫端給的順序：SQL 以 created_at、id 排序後依序餵進來，同一份資料
 * 重複匯出會得到同一組代號。序號從 1 開始，0 保留給「沒有作者的舊資料」。
 */
export function createParticipantIndex(): { seqOf: (userId: string | null) => number } {
  const seen = new Map<string, number>()
  return {
    seqOf(userId: string | null): number {
      if (!userId) return 0
      const existing = seen.get(userId)
      if (existing !== undefined) return existing
      const next = seen.size + 1
      seen.set(userId, next)
      return next
    },
  }
}
