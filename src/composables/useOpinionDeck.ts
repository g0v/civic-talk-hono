import { computed, ref, watch, type Ref } from 'vue'
import type { Opinion, OpinionVoteState } from '../db/queries'

type DeckOpinion = Opinion & Partial<OpinionVoteState>

/** 本次瀏覽的隊列；投票更新不重排，重新進入或更換登入者才重建。 */
export function useOpinionDeck(opinions: Readonly<Ref<readonly DeckOpinion[]>>, ready: Readonly<Ref<boolean>>, viewer: { id: Readonly<Ref<string | null>>; opinionId?: Readonly<Ref<number | null>> }) {
  const order = ref<number[] | null>(null)
  const reviewed = ref(new Set<number>())

  watch(
    [ready, viewer.id],
    ([isReady, id], previous) => {
      if (previous && id !== previous[1]) {
        order.value = null
        reviewed.value = new Set()
      }
      if (!isReady || order.value !== null) return
      const ids = opinions.value.filter(opinion => opinion.abuse_flagged < 2 && !opinion.is_author && opinion.can_vote !== false && opinion.my_vote == null).map(opinion => opinion.id)
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
      }
      const preferredIndex = ids.findIndex(id => id === viewer.opinionId?.value)
      if (preferredIndex > 0) ids.unshift(...ids.splice(preferredIndex, 1))
      order.value = ids
    },
    { immediate: true }
  )

  // 每次都讀最新公開投影：來源被移除或隱藏後，不繼續顯示舊快照。
  const items = computed(() => {
    const byId = new Map(opinions.value.map(opinion => [opinion.id, opinion]))
    return (order.value ?? []).flatMap(id => {
      const opinion = byId.get(id)
      return opinion && opinion.abuse_flagged < 2 && !opinion.is_author && opinion.can_vote !== false ? [opinion] : []
    })
  })
  const completed = computed(() => items.value.filter(opinion => reviewed.value.has(opinion.id) || opinion.my_vote != null).length)
  const current = computed(() => items.value.find(opinion => !reviewed.value.has(opinion.id) && opinion.my_vote == null))
  const total = computed(() => items.value.length)

  function advance(id: number) {
    if (current.value?.id !== id) return
    reviewed.value = new Set([...reviewed.value, id])
  }

  return { current, completed, total, initialized: computed(() => order.value !== null), advance }
}
