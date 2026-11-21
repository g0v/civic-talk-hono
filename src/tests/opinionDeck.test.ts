import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useOpinionDeck } from '../composables/useOpinionDeck'
import type { OpinionWithVote } from '../db/queries'

function opinion(id: number, overrides: Partial<OpinionWithVote> = {}): OpinionWithVote {
  return {
    id,
    issue_id: 19,
    summary: `opinion ${id}`,
    created_at: '2026-11-16',
    author_name: null,
    author_email: null,
    abuse_flagged: 0,
    response_count: 0,
    vote_agree: null,
    vote_disagree: null,
    vote_pass: null,
    my_vote: null,
    can_vote: true,
    is_author: false,
    can_view_vote_distribution: false,
    ...overrides,
  }
}

const scopes: ReturnType<typeof effectScope>[] = []
function setup(rows: OpinionWithVote[], isReady = true) {
  const opinions = ref(rows)
  const ready = ref(isReady)
  const viewer = ref<string | null>('voter')
  const opinionId = ref<number | null>(null)
  const scope = effectScope()
  scopes.push(scope)
  const deck = scope.run(() => useOpinionDeck(opinions, ready, { id: viewer, opinionId }))
  if (!deck) throw new Error('inactive test scope')
  return { opinions, ready, viewer, opinionId, ...deck }
}

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.restoreAllMocks()
})

describe('opinion deck (#173)', () => {
  it('queues only unvoted, visible opinions from other authors, including reported content', () => {
    const deck = setup([
      opinion(1),
      opinion(2, { abuse_flagged: 1 }),
      opinion(3, { abuse_flagged: 2 }),
      opinion(4, { abuse_flagged: 3 }),
      opinion(5, { is_author: true, can_vote: false }),
      opinion(6, { my_vote: 0 }),
      opinion(7, { my_vote: -1 }),
      opinion(8, { my_vote: 1 }),
      opinion(9, { can_vote: false }),
    ])

    const visited = []
    while (deck.current.value) {
      visited.push(deck.current.value.id)
      deck.advance(deck.current.value.id)
    }

    expect(visited.sort()).toEqual([1, 2])
    expect(deck.completed.value).toBe(2)
    expect(deck.total.value).toBe(2)
  })

  it('shuffles once, then preserves the remaining order and denominator across vote updates', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const deck = setup([opinion(1), opinion(2), opinion(3)])
    expect(deck.current.value?.id).toBe(2)

    deck.advance(2)
    deck.opinions.value = [opinion(3), opinion(2, { my_vote: 1 }), opinion(1), opinion(4)]
    await nextTick()

    expect(deck.current.value?.id).toBe(3)
    expect(deck.completed.value).toBe(1)
    expect(deck.total.value).toBe(3)
    deck.advance(3)
    expect(deck.current.value?.id).toBe(1)
  })

  it('does not initialize from the anonymous SSR snapshot before viewer data arrives', async () => {
    const deck = setup([opinion(1)], false)
    expect(deck.initialized.value).toBe(false)

    deck.opinions.value = [opinion(1, { my_vote: 0 }), opinion(2)]
    deck.ready.value = true
    await nextTick()

    expect(deck.total.value).toBe(1)
    expect(deck.current.value?.id).toBe(2)
  })

  it('counts an anonymous pass locally without mutating any vote state', async () => {
    const row = opinion(1)
    const deck = setup([row])
    deck.viewer.value = null
    await nextTick()

    deck.advance(1)
    deck.advance(1)

    expect(deck.completed.value).toBe(1)
    expect(deck.current.value).toBeUndefined()
    expect(deck.opinions.value[0].my_vote).toBeNull()
  })

  it('removes hidden or deleted content instead of retaining a stale queued snapshot', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const deck = setup([opinion(1), opinion(2), opinion(3)])

    deck.opinions.value = [opinion(1, { abuse_flagged: 3 }), opinion(3)]

    expect(deck.current.value?.id).toBe(3)
    expect(deck.total.value).toBe(1)
    expect(deck.completed.value).toBe(0)
  })

  it('rebuilds progress for a different viewer without carrying over anonymous passes', async () => {
    const deck = setup([opinion(1)])
    deck.advance(1)

    deck.viewer.value = 'another-voter'
    await nextTick()

    expect(deck.completed.value).toBe(0)
    expect(deck.current.value?.id).toBe(1)
  })

  it('returns to the requested unvoted opinion after login without adding ineligible ids', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const deck = setup([opinion(1), opinion(2), opinion(3, { my_vote: 0 })], false)
    deck.opinionId.value = 2
    deck.ready.value = true
    await nextTick()
    expect(deck.current.value?.id).toBe(2)
    expect(deck.total.value).toBe(2)
  })
})
