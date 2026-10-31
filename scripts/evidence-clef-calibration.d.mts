export type CalibrationRelation = 'agree' | 'disagree' | 'unrelated' | 'uncertain'

export interface CalibrationResult {
  prompt_version: string
  /** 第一層為人工標籤，第二層為預測。 */
  confusion_matrix: Record<CalibrationRelation, Record<CalibrationRelation, number>>
  by_class: Record<CalibrationRelation, { support: number; predicted: number; precision: number | null; recall: number | null }>
  mismatches: { id: string; expected: CalibrationRelation; predicted: CalibrationRelation }[]
}

export interface CalibrationReport {
  evidence_snapshot_sha256: string
  case_count: number
  old: CalibrationResult
  new: CalibrationResult
}

/** 逐筆驗證人工核可、完整配對與相同的凍結證據 hash。 */
export declare function evaluateCalibration(labelsFile: unknown, oldFile: unknown, newFile: unknown): CalibrationReport
