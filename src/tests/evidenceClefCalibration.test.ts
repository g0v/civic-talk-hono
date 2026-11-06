import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { evaluateCalibration } from '../../scripts/evidence-clef-calibration.mjs'

const script = fileURLToPath(new URL('../../scripts/evidence-clef-calibration.mjs', import.meta.url))
const hash = 'a'.repeat(64)

// 僅供程式邊界測試的合成資料；不是人工標註樣本或模型品質驗收。
function fixture() {
  return {
    labels: {
      evidence_snapshot_sha256: hash,
      labels: [
        { id: 'a', relation: 'agree', reviewed_by_human: true },
        { id: 'b', relation: 'agree', reviewed_by_human: true },
        { id: 'c', relation: 'disagree', reviewed_by_human: true },
        { id: 'd', relation: 'unrelated', reviewed_by_human: true },
        { id: 'e', relation: 'uncertain', reviewed_by_human: true },
      ],
    },
    old: {
      evidence_snapshot_sha256: hash,
      prompt_version: 'old-v1',
      predictions: [
        { id: 'e', relation: 'uncertain' },
        { id: 'd', relation: 'agree' },
        { id: 'c', relation: 'disagree' },
        { id: 'b', relation: 'unrelated' },
        { id: 'a', relation: 'agree' },
      ],
    },
    new: {
      evidence_snapshot_sha256: hash,
      prompt_version: 'new-v2',
      predictions: [
        { id: 'a', relation: 'agree' },
        { id: 'b', relation: 'agree' },
        { id: 'c', relation: 'disagree' },
        { id: 'd', relation: 'unrelated' },
        { id: 'e', relation: 'disagree' },
      ],
    },
  }
}

describe('Clef 離線校準', () => {
  it('對齊 ID 計算兩組四類混淆矩陣、逐類指標與錯配，與輸入順序無關', () => {
    const { labels, old, new: candidate } = fixture()
    const report = evaluateCalibration(labels, old, candidate)
    expect(report.case_count).toBe(5)
    expect(report.evidence_snapshot_sha256).toBe(hash)
    expect(report.old.prompt_version).toBe('old-v1')
    expect(report.old.confusion_matrix).toEqual({
      agree: { agree: 1, disagree: 0, unrelated: 1, uncertain: 0 },
      disagree: { agree: 0, disagree: 1, unrelated: 0, uncertain: 0 },
      unrelated: { agree: 1, disagree: 0, unrelated: 0, uncertain: 0 },
      uncertain: { agree: 0, disagree: 0, unrelated: 0, uncertain: 1 },
    })
    expect(report.old.by_class.agree).toEqual({ support: 2, predicted: 2, precision: 0.5, recall: 0.5 })
    expect(report.old.by_class.unrelated).toEqual({ support: 1, predicted: 1, precision: 0, recall: 0 })
    expect(report.old.mismatches).toEqual([
      { id: 'b', expected: 'agree', predicted: 'unrelated' },
      { id: 'd', expected: 'unrelated', predicted: 'agree' },
    ])
    expect(report.new.by_class.disagree).toEqual({ support: 1, predicted: 2, precision: 0.5, recall: 1 })
    expect(report.new.by_class.uncertain).toEqual({ support: 1, predicted: 0, precision: null, recall: 0 })
    expect(report.new.mismatches).toEqual([{ id: 'e', expected: 'uncertain', predicted: 'disagree' }])
    expect(evaluateCalibration({ ...labels, labels: [...labels.labels].reverse() }, old, candidate)).toEqual(report)
  })

  it('未出現的類別保留零分母，不把無法計算誤報為零或一', () => {
    const { labels, old, new: candidate } = fixture()
    const only = { ...labels, labels: labels.labels.slice(0, 1) }
    const oldOnly = { ...old, predictions: [{ id: 'a', relation: 'agree' }] }
    const newOnly = { ...candidate, predictions: candidate.predictions.slice(0, 1) }
    const report = evaluateCalibration(only, oldOnly, newOnly)
    expect(report.old.by_class.agree).toEqual({ support: 1, predicted: 1, precision: 1, recall: 1 })
    expect(report.old.by_class.disagree).toEqual({ support: 0, predicted: 0, precision: null, recall: null })
    expect(report.old.mismatches).toEqual([])
  })

  it('拒絕空樣本、缺少或否定人工核可、無效類別與夾帶非必要欄位', () => {
    const { labels, old, new: candidate } = fixture()
    expect(() => evaluateCalibration({ ...labels, labels: [] }, old, candidate)).toThrow('no_labels')
    expect(() => evaluateCalibration({ ...labels, labels: [{ id: 'a', relation: 'agree' }] }, old, candidate)).toThrow('human_review_required')
    expect(() => evaluateCalibration({ ...labels, labels: [{ ...labels.labels[0], reviewed_by_human: false }] }, old, candidate)).toThrow('human_review_required')
    expect(() => evaluateCalibration({ ...labels, labels: [{ ...labels.labels[0], relation: 'maybe' }] }, old, candidate)).toThrow('invalid_labels')
    expect(() => evaluateCalibration({ ...labels, labels: [{ ...labels.labels[0], quote: '不應放入的資料' }] }, old, candidate)).toThrow('invalid_labels')
    expect(() => evaluateCalibration(labels, { ...old, predictions: [{ id: 'a', relation: 'maybe' }] }, candidate)).toThrow('invalid_prediction')
  })

  it('任一檔案的重複、未知或漏配案例一律拒絕作成績', () => {
    const { labels, old, new: candidate } = fixture()
    expect(() => evaluateCalibration({ ...labels, labels: [...labels.labels, labels.labels[0]] }, old, candidate)).toThrow('duplicate_label_id')
    expect(() => evaluateCalibration(labels, { ...old, predictions: [...old.predictions, old.predictions[0]] }, candidate)).toThrow('duplicate_prediction_id')
    expect(() => evaluateCalibration(labels, { ...old, predictions: [{ id: 'unknown', relation: 'agree' }] }, candidate)).toThrow('unknown_prediction_id')
    expect(() => evaluateCalibration(labels, { ...old, predictions: old.predictions.slice(1) }, candidate)).toThrow('missing_prediction_id')
    expect(() => evaluateCalibration(labels, old, { ...candidate, predictions: [] })).toThrow('missing_prediction_id')
    expect(() => evaluateCalibration(labels, old, { ...candidate, predictions: [...candidate.predictions, candidate.predictions[0]] })).toThrow('duplicate_prediction_id')
  })

  it('只比較同一凍結證據 hash，拒絕錯誤 hash 與無版本預測', () => {
    const { labels, old, new: candidate } = fixture()
    expect(() => evaluateCalibration({ ...labels, evidence_snapshot_sha256: 'not-a-hash' }, old, candidate)).toThrow('invalid_snapshot_hash')
    expect(() => evaluateCalibration(labels, { ...old, evidence_snapshot_sha256: 'b'.repeat(64) }, candidate)).toThrow('snapshot_mismatch')
    expect(() => evaluateCalibration(labels, old, { ...candidate, evidence_snapshot_sha256: 'b'.repeat(64) })).toThrow('snapshot_mismatch')
    expect(() => evaluateCalibration(labels, { ...old, prompt_version: '' }, candidate)).toThrow('invalid_prediction')
  })

  it('CLI 讀取指定的三個 JSON，輸出指標而非額外資料，失敗時不回傳檔名', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clef-calibration-'))
    try {
      const { labels, old, new: candidate } = fixture()
      const paths = ['labels', 'old', 'new'].map(name => join(directory, `${name}.json`))
      for (const [index, value] of [labels, old, candidate].entries()) writeFileSync(paths[index], JSON.stringify(value))
      const result = spawnSync(process.execPath, [script, '--labels', paths[0], '--old', paths[1], '--new', paths[2]], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toMatchObject({
        case_count: 5,
        old: { by_class: { agree: { precision: 0.5, recall: 0.5 } } },
        new: { by_class: { disagree: { precision: 0.5, recall: 1 } } },
      })

      writeFileSync(paths[0], JSON.stringify({ ...labels, labels: labels.labels.map((row, index) => index === 0 ? { ...row, reviewed_by_human: false } : row) }))
      const unreviewed = spawnSync(process.execPath, [script, '--labels', paths[0], '--old', paths[1], '--new', paths[2]], { encoding: 'utf8' })
      expect(unreviewed.status).not.toBe(0)
      expect(unreviewed.stdout).toBe('')
      expect(unreviewed.stderr).toContain('human_review_required')

      const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' })
      expect(help.status).toBe(0)
      expect(help.stdout).toContain('--labels')
      expect(help.stdout).toContain('--old')
      expect(help.stdout).toContain('--new')

      const invalidPath = join(directory, 'missing-private-path.json')
      const failed = spawnSync(process.execPath, [script, '--labels', invalidPath, '--old', paths[1], '--new', paths[2]], { encoding: 'utf8' })
      expect(failed.status).not.toBe(0)
      expect(failed.stdout).toBe('')
      expect(failed.stderr).toContain('invalid_input_file')
      expect(failed.stderr).not.toContain(invalidPath)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
