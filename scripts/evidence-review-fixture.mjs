// 此基準與 sources.sql 一起維護；不因本機資料改動而變更或補寫既有 fixture。
const expected = [
  { kind: 'issue', id: 900013, title: '【虛構案例】社區圖書館週末開館', description: '此議題與素材均為合成資料，僅供本機證據草稿 API 審閱。', status: 'published', issue_id: null, source_name: null, source_url: null, stance: null, content: null, abuse_flagged: 0 },
  { kind: 'material', id: 900025, title: null, description: null, status: null, issue_id: 900013, source_name: '虛構居民甲', source_url: 'https://example.invalid/evidence-review/900025', stance: 'pro', content: '虛構居民甲支持延長社區圖書館週末開館時間，認為上班族和學生能有更多使用空間的機會；甲也認為應先公開估算人力與照明成本。', abuse_flagged: 0 },
  { kind: 'material', id: 900026, title: null, description: null, status: null, issue_id: 900013, source_name: '虛構居民乙', source_url: 'https://example.invalid/evidence-review/900026', stance: 'con', content: '虛構居民乙擔心延長週末開館會增加人力負擔與夜間交通需求，建議先試辦並公布成本；乙同意應讓更多居民方便使用圖書館。', abuse_flagged: 0 },
]

export const fixtureQuery = `SELECT 'issue' AS kind, id, title, description, status, NULL AS issue_id, NULL AS source_name, NULL AS source_url, NULL AS stance, NULL AS content, abuse_flagged FROM ct_issues WHERE id = 900013
UNION ALL SELECT 'material', id, NULL, NULL, NULL, issue_id, source_name, source_url, stance, content, abuse_flagged FROM ct_materials WHERE id IN (900025, 900026)`

export function fixtureInitialized(markers, rows) {
  if (markers.length > 1 || (markers.length === 1 && (markers[0].id !== 1 || markers[0].version !== 1))) {
    throw new Error('來源資料的 fixture marker 不符；未重設資料，請人工檢查')
  }
  for (const row of rows) {
    const baseline = expected.find(item => item.kind === row.kind && item.id === row.id)
    if (!baseline || Object.keys(baseline).some(key => row[key] !== baseline[key])) {
      throw new Error('審閱來源 fixture 已變更；未覆寫，請人工檢查')
    }
  }
  if (markers.length === 1 && rows.length !== expected.length) throw new Error('審閱來源 fixture 已缺失；未重建，請人工檢查')
  return markers.length === 1
}
