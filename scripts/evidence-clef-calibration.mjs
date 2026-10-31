import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELATIONS = ['agree', 'disagree', 'unrelated', 'uncertain']
const HASH = /^[0-9a-f]{64}$/u
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/u
const USAGE = `用法：node scripts/evidence-clef-calibration.mjs --labels <labels.json> --old <old.json> --new <new.json>

三個檔案均為 JSON；僅放識別碼、標籤與 hash，不放原文、模型原始回應、cookie 或資料庫內容。
labels.json 欄位：evidence_snapshot_sha256（同一凍結證據的 64 位小寫 SHA-256）、
  labels（非空陣列，每筆有 id、relation、reviewed_by_human: true）。
old.json 與 new.json 欄位：evidence_snapshot_sha256、prompt_version、
  predictions（陣列，每筆有 id、relation）。
relation 必須是 agree、disagree、unrelated、uncertain 之一；每個案例在三份檔案恰好各出現一次。
人工標籤必須逐筆經人核可；程式只核對核可旗標，不能證明標註人或核對 hash 的來源。
校準集與人工保留驗收集請分開製作並分別執行。混淆矩陣以人工標籤為列、預測為欄；
precision 或 recall 的分母為零時回報 null，輸出錯配案例 ID，不輸出來源內容。`

const ERRORS = {
  invalid_arguments: '參數須各提供一次 --labels、--old、--new。',
  invalid_input_file: '無法讀取或解析輸入 JSON。',
  invalid_labels: '人工標籤檔或其案例格式有誤。',
  no_labels: '人工標籤不可為空。',
  human_review_required: '每筆人工標籤都必須明示已由人核可。',
  duplicate_label_id: '人工標籤含重複案例 ID。',
  invalid_prediction: '預測檔或其案例格式有誤。',
  duplicate_prediction_id: '預測檔含重複案例 ID。',
  unknown_prediction_id: '預測含人工標籤以外的案例 ID。',
  missing_prediction_id: '預測缺少人工標籤中的案例 ID。',
  invalid_snapshot_hash: '凍結證據 hash 須為 64 位小寫 SHA-256。',
  snapshot_mismatch: '三份檔案必須使用相同的凍結證據 hash。',
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasKeys(value, keys) {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
}

function validRelation(value) {
  return typeof value === 'string' && RELATIONS.includes(value)
}

function snapshotHash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error('invalid_snapshot_hash')
  return value
}

function labelsById(value) {
  if (!hasKeys(value, ['evidence_snapshot_sha256', 'labels']) || !Array.isArray(value.labels)) throw new Error('invalid_labels')
  if (value.labels.length === 0) throw new Error('no_labels')
  const labels = new Map()
  for (const row of value.labels) {
    if (!record(row) || !validId(row.id) || !validRelation(row.relation)) throw new Error('invalid_labels')
    if (row.reviewed_by_human !== true) throw new Error('human_review_required')
    if (!hasKeys(row, ['id', 'relation', 'reviewed_by_human'])) throw new Error('invalid_labels')
    if (labels.has(row.id)) throw new Error('duplicate_label_id')
    labels.set(row.id, row.relation)
  }
  return labels
}

function predictionsById(value, labels) {
  if (!hasKeys(value, ['evidence_snapshot_sha256', 'prompt_version', 'predictions']) || typeof value.prompt_version !== 'string' || !VERSION.test(value.prompt_version) || !Array.isArray(value.predictions)) throw new Error('invalid_prediction')
  const predictions = new Map()
  for (const row of value.predictions) {
    if (!hasKeys(row, ['id', 'relation']) || !validId(row.id) || !validRelation(row.relation)) throw new Error('invalid_prediction')
    if (predictions.has(row.id)) throw new Error('duplicate_prediction_id')
    if (!labels.has(row.id)) throw new Error('unknown_prediction_id')
    predictions.set(row.id, row.relation)
  }
  if (predictions.size !== labels.size) throw new Error('missing_prediction_id')
  return predictions
}

function metrics(labels, predictions, promptVersion) {
  const confusion = Object.fromEntries(RELATIONS.map(expected => [expected, Object.fromEntries(RELATIONS.map(predicted => [predicted, 0]))]))
  const mismatches = []
  for (const [id, expected] of labels) {
    const predicted = predictions.get(id)
    confusion[expected][predicted] += 1
    if (expected !== predicted) mismatches.push({ id, expected, predicted })
  }
  mismatches.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const byClass = Object.fromEntries(RELATIONS.map(relation => {
    const truePositive = confusion[relation][relation]
    const support = RELATIONS.reduce((sum, predicted) => sum + confusion[relation][predicted], 0)
    const predicted = RELATIONS.reduce((sum, expected) => sum + confusion[expected][relation], 0)
    return [relation, {
      support,
      predicted,
      precision: predicted === 0 ? null : truePositive / predicted,
      recall: support === 0 ? null : truePositive / support,
    }]
  }))
  return { prompt_version: promptVersion, confusion_matrix: confusion, by_class: byClass, mismatches }
}

/** 只接受每筆已人工核可、同一凍結證據且完整配對的標籤及兩組預測。 */
export function evaluateCalibration(labelsFile, oldFile, newFile) {
  const labels = labelsById(labelsFile)
  const oldPredictions = predictionsById(oldFile, labels)
  const newPredictions = predictionsById(newFile, labels)
  const evidenceHash = snapshotHash(labelsFile.evidence_snapshot_sha256)
  if (snapshotHash(oldFile.evidence_snapshot_sha256) !== evidenceHash || snapshotHash(newFile.evidence_snapshot_sha256) !== evidenceHash) throw new Error('snapshot_mismatch')
  return {
    evidence_snapshot_sha256: evidenceHash,
    case_count: labels.size,
    old: metrics(labels, oldPredictions, oldFile.prompt_version),
    new: metrics(labels, newPredictions, newFile.prompt_version),
  }
}

function options(args) {
  if (args.length !== 6) throw new Error('invalid_arguments')
  const result = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!['--labels', '--old', '--new'].includes(key) || !value || value.startsWith('--') || result.has(key)) throw new Error('invalid_arguments')
    result.set(key, value)
  }
  if (result.size !== 3) throw new Error('invalid_arguments')
  return result
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // 不回傳檔名、檔案內容或系統錯誤細節。
    throw new Error('invalid_input_file')
  }
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const files = options(args)
  const report = evaluateCalibration(readJson(files.get('--labels')), readJson(files.get('--old')), readJson(files.get('--new')))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    const code = error instanceof Error && Object.hasOwn(ERRORS, error.message) ? error.message : 'invalid_input_file'
    process.stderr.write(`校準失敗（${code}）：${ERRORS[code]}\n`)
    if (code === 'invalid_arguments') process.stderr.write(`${USAGE}\n`)
    process.exitCode = 1
  }
}
