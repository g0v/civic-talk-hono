// 中介層以同一份方法／路徑清單涵蓋正式與實驗入口。
export const evidenceEndpoints = [
  ['POST', '/api/issues/:id/evidence-jobs'],
  ['GET', '/api/issues/:id/evidence-summary'],
  ['POST', '/api/issues/:id/evidence-summary'],
  ['GET', '/api/evidence-jobs/:jobId'],
  ['GET', '/api/evidence-jobs/:jobId/revisions'],
  ['POST', '/api/evidence-jobs/:jobId/revisions'],
  ['POST', '/api/evidence-maintenance/reconcile'],
  ['POST', '/api/evidence-maintenance/erase'],
] as const
