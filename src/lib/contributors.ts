/** 公開軌跡只含可公開的來源描述，不含認證 ID、email 或私有證據工作。 */
export type ContributionKind = 'issue' | 'material' | 'briefing' | 'opinion'

export interface Contribution {
  readonly kind: ContributionKind
  readonly id: number
  readonly issue_id: number
  readonly title: string | null
  readonly created_at: string
  readonly version: number | null
}

export interface ContributorHistory {
  readonly public_id: string
  readonly name: string | null
  readonly joined_at: string
  readonly contributions: readonly Contribution[]
}
