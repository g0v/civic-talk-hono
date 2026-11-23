type Opinion = { readonly id: number; readonly body: string; readonly authorId: string | null }
type VoteValue = -1 | 0 | 1
type Vote = { readonly opinionId: number; readonly voterId: string; readonly value: VoteValue }
type Direction = 'agree' | 'disagree'
type Evidence = {
  readonly opinionId: number
  readonly body: string
  readonly kind: 'common_agree' | 'common_disagree' | 'tension'
  readonly groups: { readonly id: number; readonly direction: Direction }[]
}
type Analysis = {
  readonly qualifiedParticipants: number
  readonly votesRequired: number
  readonly status: 'insufficient' | 'unclustered' | 'clustered'
  readonly groups: { readonly id: number; readonly size: number; readonly x: number | null; readonly y: number | null }[]
  readonly myGroup: number | null
  readonly evidence: Evidence[]
}
type Participant = {
  readonly id: string
  readonly real: ReadonlyMap<number, VoteValue>
  readonly matrix: ReadonlyMap<number, VoteValue>
}
type Cluster = {
  readonly center: readonly number[]
  readonly members: readonly Participant[]
}
type Point = { readonly participant: Participant; readonly row: readonly number[] }

const MIN_PUBLIC_GROUP = 3
const MIN_VARIATION = 1e-10

function qualify(opinions: readonly Opinion[], votes: readonly Vote[], required: number): Participant[] {
  const byOpinion = new Map(opinions.map(opinion => [opinion.id, opinion]))
  const ownOpinions = new Map<string, number[]>()
  for (const { id, authorId } of opinions) {
    if (authorId === null) continue
    const authored = ownOpinions.get(authorId) ?? []
    authored.push(id)
    ownOpinions.set(authorId, authored)
  }
  const ballots = new Map<string, Map<number, VoteValue>>()
  for (const { opinionId, voterId, value } of votes) {
    const opinion = byOpinion.get(opinionId)
    if (!opinion || opinion.authorId === voterId) continue
    const real = ballots.get(voterId) ?? new Map<number, VoteValue>()
    // D1 enforces uniqueness. Conflicting duplicate inputs conservatively become a pass.
    const previous = real.get(opinionId)
    real.set(opinionId, previous === undefined || previous === value ? value : 0)
    ballots.set(voterId, real)
  }
  return [...ballots]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([id, real]) => {
      const own = ownOpinions.get(id) ?? []
      if (real.size + own.length < required) return []
      const matrix = new Map(real)
      for (const opinionId of own) matrix.set(opinionId, 1)
      return [{ id, real, matrix }]
    })
}

function centeredPoints(opinions: readonly Opinion[], participants: readonly Participant[]): Point[] {
  const means = opinions.map(({ id }) => {
    let sum = 0
    let count = 0
    for (const { matrix } of participants) {
      const value = matrix.get(id)
      if (value === undefined) continue
      sum += value
      count++
    }
    return count ? sum / count : 0
  })
  return participants.map(participant => ({
    participant,
    // Missing is imputed to the column mean, while a recorded pass is neutral (0).
    row: opinions.map(({ id }, column) => {
      const value = participant.matrix.get(id)
      return value === undefined ? 0 : value - means[column]
    }),
  }))
}

function squaredDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return sum
}

function farthest(points: readonly Point[], center: readonly number[]): readonly number[] {
  let farthestRow = center
  let maxDistance = 0
  for (const { row } of points) {
    const distance = squaredDistance(row, center)
    if (distance <= maxDistance) continue
    maxDistance = distance
    farthestRow = row
  }
  return farthestRow
}

function twoClusters(points: readonly Point[], dimensions: number): readonly [Cluster, Cluster] | null {
  const origin = Array.from({ length: dimensions }, () => 0)
  const total = points.reduce((sum, { row }) => sum + squaredDistance(row, origin), 0)
  if (total <= MIN_VARIATION) return null

  // Deterministic farthest-first two-means in vote space, not in the display projection.
  let left = farthest(points, origin)
  let right = farthest(points, left)
  for (let iteration = 0; iteration < 16; iteration++) {
    const bins = [
      { points: new Array<Point>(), sums: origin.map(() => 0) },
      { points: new Array<Point>(), sums: origin.map(() => 0) },
    ] as const
    for (const point of points) {
      const bin = squaredDistance(point.row, left) <= squaredDistance(point.row, right) ? bins[0] : bins[1]
      bin.points.push(point)
      point.row.forEach((value, i) => {
        bin.sums[i] += value
      })
    }
    const [a, b] = bins
    if (!a.points.length || !b.points.length) return null
    const nextLeft = a.sums.map(sum => sum / a.points.length)
    const nextRight = b.sums.map(sum => sum / b.points.length)
    if (squaredDistance(left, nextLeft) + squaredDistance(right, nextRight) <= MIN_VARIATION) {
      if (a.points.length < 2 || b.points.length < 2) return null
      const within = a.points.reduce((sum, { row }) => sum + squaredDistance(row, nextLeft), 0) + b.points.reduce((sum, { row }) => sum + squaredDistance(row, nextRight), 0)
      // Do not turn weak structure or coincident centroids into named groups.
      if (within > total / 3 || squaredDistance(nextLeft, nextRight) <= MIN_VARIATION) return null
      return [
        { center: nextLeft, members: a.points.map(point => point.participant) },
        { center: nextRight, members: b.points.map(point => point.participant) },
      ]
    }
    left = nextLeft
    right = nextRight
  }
  return null
}

function opinionDirection(opinionId: number, members: readonly Participant[]): Direction | null {
  let observations = 0
  let agree = 0
  let disagree = 0
  for (const { real } of members) {
    const value = real.get(opinionId)
    if (value === undefined) continue
    observations++
    if (value === 1) agree++
    if (value === -1) disagree++
  }
  // A virtual author vote cannot unlock disclosure; passes dilute directional support.
  if (agree >= 3 && 4 * agree >= 3 * observations) return 'agree'
  if (disagree >= 3 && 4 * disagree >= 3 * observations) return 'disagree'
  return null
}

export function analyzeOpinionVotes(opinions: readonly Opinion[], votes: readonly Vote[], viewerId: string | null): Analysis {
  const ordered = [...opinions].sort((a, b) => a.id - b.id)
  const votesRequired = Math.min(7, ordered.length)
  const participants = qualify(ordered, votes, votesRequired)
  const baseline = { qualifiedParticipants: participants.length, votesRequired, groups: [], myGroup: null, evidence: [] }
  if (participants.length < 4) return { ...baseline, status: 'insufficient' }

  const pair = twoClusters(centeredPoints(ordered, participants), ordered.length)
  if (!pair) return { ...baseline, status: 'unclustered' }
  const [first, second] = pair
  const [a, b] = first.members[0].id < second.members[0].id ? pair : [second, first]
  const bothPublic = a.members.length >= MIN_PUBLIC_GROUP && b.members.length >= MIN_PUBLIC_GROUP
  // Project the centroids on their connecting axis. With two centroids this is
  // one-dimensional. A lone public centroid is the origin, not an offset that
  // would let readers back-calculate the suppressed centroid.
  const separation = bothPublic ? Math.max(0.25, Math.round(4 * Math.sqrt(squaredDistance(a.center, b.center) / ordered.length)) / 4) : 0
  const groups = [a, b].map(({ members }, index) => ({
    id: index + 1,
    size: members.length,
    x: members.length < MIN_PUBLIC_GROUP ? null : index * separation,
    y: members.length < MIN_PUBLIC_GROUP ? null : 0,
  }))
  const viewerIndex = [a, b].findIndex(({ members }) => members.some(({ id }) => id === viewerId))
  const evidence: Evidence[] = []
  if (bothPublic && ordered.length >= 3) {
    for (const { id, body } of ordered) {
      if (!body) continue
      const left = opinionDirection(id, a.members)
      const right = opinionDirection(id, b.members)
      if (left === null || right === null) continue
      evidence.push({
        opinionId: id,
        body,
        kind: left !== right ? 'tension' : left === 'agree' ? 'common_agree' : 'common_disagree',
        groups: [
          { id: 1, direction: left },
          { id: 2, direction: right },
        ],
      })
    }
  }
  return { ...baseline, status: 'clustered', groups, myGroup: viewerIndex < 0 ? null : viewerIndex + 1, evidence }
}
