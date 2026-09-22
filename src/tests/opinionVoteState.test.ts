import { describe, expect, it } from 'vite-plus/test'
import { toOpinionVoteState, type OpinionVoteAggregateRow } from '../db/queries'

function row(overrides: Partial<OpinionVoteAggregateRow> = {}): OpinionVoteAggregateRow {
  return { opinion_id: 1, author_id: 'author-1', agrees: 3, disagrees: 2, passes: 1, my_vote: null, ...overrides }
}

describe('toOpinionVoteState：提議者當然贊成票（#107 決策 4）', () => {
  it('有作者的意見，贊成票數自動 +1', () => {
    const state = toOpinionVoteState(row({ my_vote: 1 }), 'viewer-1')
    // 資料表裡是 3 票贊成，加上提議者的當然贊成＝4
    expect(state.tally).toEqual({ agree: 4, disagree: 2, pass: 1 })
  })

  it('需登入之前的舊資料（author_id 為 null）不加票', () => {
    const state = toOpinionVoteState(row({ author_id: null, my_vote: 1 }), 'viewer-1')
    expect(state.tally).toEqual({ agree: 3, disagree: 2, pass: 1 })
  })

  it('不論讀者是誰，當然贊成票都算進去', () => {
    const asAuthor = toOpinionVoteState(row(), 'author-1')
    const asOther = toOpinionVoteState(row({ my_vote: -1 }), 'viewer-1')
    expect(asAuthor.tally?.agree).toBe(4)
    expect(asOther.tally?.agree).toBe(4)
  })
})

describe('toOpinionVoteState：投票前不揭露分布（#107 決策 5）', () => {
  it('還沒投票的人拿不到票數', () => {
    const state = toOpinionVoteState(row(), 'viewer-1')
    expect(state.tally).toBeNull()
    expect(state.my_vote).toBeNull()
  })

  it('投過票之後才看得到票數', () => {
    expect(toOpinionVoteState(row({ my_vote: 1 }), 'viewer-1').tally).not.toBeNull()
    expect(toOpinionVoteState(row({ my_vote: -1 }), 'viewer-1').tally).not.toBeNull()
  })

  it('投「略過」（0）也算表態——0 是 falsy，這裡最容易寫錯', () => {
    const state = toOpinionVoteState(row({ my_vote: 0 }), 'viewer-1')
    expect(state.my_vote).toBe(0)
    expect(state.tally).not.toBeNull()
  })

  it('提議者本人不必投票就看得到分布（他已被計為一票）', () => {
    const state = toOpinionVoteState(row(), 'author-1')
    expect(state.is_author).toBe(true)
    expect(state.my_vote).toBeNull()
    expect(state.tally).toEqual({ agree: 4, disagree: 2, pass: 1 })
  })
})

describe('toOpinionVoteState：不外洩投稿者身分', () => {
  it('回傳值只有 is_author 布林值，沒有 author_id', () => {
    const state = toOpinionVoteState(row(), 'viewer-1')
    expect(Object.keys(state).sort()).toEqual(['is_author', 'my_vote', 'opinion_id', 'tally'])
    expect(JSON.stringify(state)).not.toContain('author-1')
  })

  it('別人的意見 is_author 為 false', () => {
    expect(toOpinionVoteState(row(), 'viewer-1').is_author).toBe(false)
    expect(toOpinionVoteState(row({ author_id: null }), 'viewer-1').is_author).toBe(false)
  })
})

describe('toOpinionVoteState：資料防呆', () => {
  it('SQL 的 SUM 在沒有任何票時可能回 null，一律當 0', () => {
    const state = toOpinionVoteState({ opinion_id: 9, author_id: 'a', agrees: null as never, disagrees: null as never, passes: null as never, my_vote: 1 }, 'viewer-1')
    expect(state.tally).toEqual({ agree: 1, disagree: 0, pass: 0 })
  })

  it('超出範圍的票值不會被當成自己的票', () => {
    expect(toOpinionVoteState(row({ my_vote: 7 }), 'viewer-1').my_vote).toBeNull()
  })
})
