import { expect, it } from 'vite-plus/test'
import { buildClairicCandidateRequest, CLAIRIC_CANDIDATE_INSTRUCTIONS } from '../ai/extractionCandidate'
import { MODEL_SELECTORS } from '../ai/models'

it('離線 P1 選用候選指令但保留原文 state、Clairic selector 與單一 list 協議', () => {
  const source = '自學團體籲補助國中小自學生 全教總：對「偽自學」產生巨大誘因'

  const request = buildClairicCandidateRequest(source)

  expect(request).toEqual({
    selector: MODEL_SELECTORS.clairic,
    input: {
      model: 'clairic',
      state: source,
      fields: { claims: { type: 'list', items: 'text', instructions: CLAIRIC_CANDIDATE_INSTRUCTIONS } },
      options: { return_state_text: true },
    },
  })
})
