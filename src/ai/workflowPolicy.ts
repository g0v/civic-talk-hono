// 實際 step 選項與規模預估一併納入設定指紋，不能讓舊工作靜默換版續跑。
const HANDOFF_RETRY_LIMIT = 3

export const WORKFLOW_CONTROL_POLICY = {
  version: 'bounded-generation-handoffs-v2',
  paid_step: { retries: { limit: 0, delay: '1 second' as const }, timeout: '10 minutes' as const },
  non_model_step: { retries: { limit: 0, delay: '1 second' as const }, timeout: '30 seconds' as const },
  handoff_step: { retries: { limit: HANDOFF_RETRY_LIMIT, delay: '1 second' as const, backoff: 'exponential' as const }, timeout: '30 seconds' as const },
  fixed_step_upper_bound: 24,
  generation_guard_checks_upper_bound: 24 + 7 * HANDOFF_RETRY_LIMIT,
  handoffs: 'load-generation-state; prepare-generation-per-section; finish-generation-per-section; no-source-text-in-checkpoints',
  failure: 'bounded-retrying-fail-workflow; deterministic-guards-stop-without-retry; throw-safe-error-if-cleanup-fails; never-retry-paid-attempts',
} as const
