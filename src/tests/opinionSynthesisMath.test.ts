import { describe, expect, it } from 'vite-plus/test'
import { analyzeOpinionVotes } from '../opinions/synthesisMath'

type Opinions = Parameters<typeof analyzeOpinionVotes>[0]
type Votes = Parameters<typeof analyzeOpinionVotes>[1]

function opinions(count: number, authorId: string | null = null): Opinions {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    body: `Opinion ${i + 1}`,
    authorId: i === 0 ? authorId : null,
  }))
}

function ballot(voterId: string, values: readonly (Votes[number]['value'] | null)[]): Votes {
  return values.flatMap((value, i) => (value === null ? [] : [{ voterId, opinionId: i + 1, value }]))
}

function opposingCamps(left: number, right: number): Votes {
  return [...Array.from({ length: left }, (_, i) => ballot(`a${i}`, [1, 1, -1])).flat(), ...Array.from({ length: right }, (_, i) => ballot(`b${i}`, [-1, 1, -1])).flat()]
}

describe('opinion vote synthesis', () => {
  it('requires seven distinct in-scope ballots including passes, with a virtual ballot for an author', () => {
    const result = analyzeOpinionVotes(
      opinions(8, 'author'),
      [
        ...ballot('author', [-1, 0, 0, 0, 0, 0, 0]),
        ...ballot('seven', [0, 0, 0, 0, 0, 0, 0]),
        ...ballot('six', [0, 0, 0, 0, 0, 0]),
        { voterId: 'six', opinionId: 9, value: 1 },
        { voterId: 'six', opinionId: 6, value: 0 },
      ],
      'author'
    )

    expect(result).toEqual({
      status: 'insufficient',
      qualifiedParticipants: 2,
      votesRequired: 7,
      groups: [],
      myGroup: null,
      evidence: [],
    })
  })

  it('does not qualify an author whose only persisted ballot is a self-vote', () => {
    const result = analyzeOpinionVotes(
      opinions(3).map(opinion => ({ ...opinion, authorId: 'author' })),
      ballot('author', [-1]),
      'author'
    )

    expect(result).toMatchObject({ votesRequired: 3, qualifiedParticipants: 0, status: 'insufficient' })
  })

  it('uses a virtual agree instead of a stored self-vote in the clustering matrix', () => {
    const result = analyzeOpinionVotes(opinions(3, 'a0'), [...ballot('a0', [-1, 1, -1]), ...ballot('a1', [1, 1, -1]), ...ballot('b0', [-1, 1, -1]), ...ballot('b1', [-1, 1, -1])], 'a0')

    expect(result).toMatchObject({ status: 'clustered', qualifiedParticipants: 4, myGroup: 1 })
    expect(result.groups.map(group => group.size)).toEqual([2, 2])
  })

  it.each([
    [
      'coincident passes',
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    ],
    [
      'an evenly spread square',
      [
        [1, 1, 0],
        [1, -1, 0],
        [-1, 1, 0],
        [-1, -1, 0],
      ],
    ],
  ] satisfies [string, Votes[number]['value'][][]][])('shows one aggregate rather than inventing separate groups for %s', (_description, rows) => {
    const result = analyzeOpinionVotes(
      opinions(3),
      rows.flatMap((row, i) => ballot(`v${i}`, row)),
      'v0'
    )

    expect(result).toEqual({
      status: 'unclustered',
      qualifiedParticipants: 4,
      votesRequired: 3,
      groups: [{ id: 1, size: 4, x: 0, y: 0 }],
      myGroup: null,
      evidence: [],
    })
  })

  it('exposes only centroids and categorical evidence for two groups of three', () => {
    const result = analyzeOpinionVotes(opinions(3), opposingCamps(3, 3), null)

    expect(result).toEqual({
      status: 'clustered',
      qualifiedParticipants: 6,
      votesRequired: 3,
      myGroup: null,
      groups: [
        { id: 1, size: 3, x: 0, y: 0 },
        { id: 2, size: 3, x: expect.any(Number), y: 0 },
      ],
      evidence: [
        {
          opinionId: 1,
          body: 'Opinion 1',
          kind: 'tension',
          groups: [
            { id: 1, direction: 'agree' },
            { id: 2, direction: 'disagree' },
          ],
        },
        {
          opinionId: 2,
          body: 'Opinion 2',
          kind: 'common_agree',
          groups: [
            { id: 1, direction: 'agree' },
            { id: 2, direction: 'agree' },
          ],
        },
        {
          opinionId: 3,
          body: 'Opinion 3',
          kind: 'common_disagree',
          groups: [
            { id: 1, direction: 'disagree' },
            { id: 2, direction: 'disagree' },
          ],
        },
      ],
    })
    expect(result.groups[1].x).toBeGreaterThan(0)
  })

  it.each([
    [2, null],
    [3, 0],
  ])('suppresses small centroids and all evidence with a second group of size %i', (right, rightCoordinate) => {
    const { groups, evidence, status } = analyzeOpinionVotes(opinions(3), opposingCamps(2, right), null)

    expect({ groups, evidence, status }).toEqual({
      status: 'clustered',
      evidence: [],
      groups: [
        { id: 1, size: 2, x: null, y: null },
        { id: 2, size: right, x: rightCoordinate, y: rightCoordinate },
      ],
    })
  })

  it('does not disclose evidence with fewer than three opinions even for two public groups', () => {
    const result = analyzeOpinionVotes(opinions(2), opposingCamps(3, 3), null)

    expect(result).toMatchObject({ status: 'clustered', evidence: [] })
  })

  it('withholds thin evidence even when a missing real observation has a virtual author agree', () => {
    const posts = opinions(10).map(opinion => (opinion.id === 9 ? { ...opinion, authorId: 'a0' } : opinion))
    const agree = [1, 1, 1, 1, 1, 1, 1] as const
    const disagree = [-1, -1, -1, -1, -1, -1, -1] as const
    const result = analyzeOpinionVotes(
      posts,
      [
        ...ballot('a0', [...agree, null, null, 0]),
        ...ballot('a1', [...agree, 1, 1, 1]),
        ...ballot('a2', [...agree, 1, 1, 1]),
        ...['b0', 'b1', 'b2'].flatMap(id => ballot(id, [...disagree, -1, -1, -1])),
      ],
      null
    )

    expect(result.status).toBe('clustered')
    expect(result.evidence.map(item => item.opinionId)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it.each([
    ['a0', 1],
    ['b0', 2],
    ['partial', null],
    ['unknown', null],
    [null, null],
  ])('returns only the viewer membership for %s', (viewer, expected) => {
    const result = analyzeOpinionVotes(opinions(3), [...opposingCamps(3, 3), ...ballot('partial', [1])], viewer)

    expect(result.myGroup).toBe(expected)
  })

  it('produces the same projection when input order is reversed at the target workload', () => {
    const posts = opinions(120)
    const votes = Array.from({ length: 34 }, (_, i) =>
      ballot(
        `v${i}`,
        posts.map(() => (i < 17 ? 1 : -1))
      )
    ).flat()
    const result = analyzeOpinionVotes(posts, votes, 'v0')

    expect(result).toMatchObject({ status: 'clustered', qualifiedParticipants: 34, myGroup: 1 })
    expect(analyzeOpinionVotes([...posts].reverse(), [...votes].reverse(), 'v0')).toEqual(result)
  })
})
