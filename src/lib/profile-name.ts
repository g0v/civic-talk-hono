export const NAME_CHANGE_COOLDOWN_CODE = 'NAME_CHANGE_COOLDOWN' as const
export const NAME_CHANGE_COOLDOWN_DAYS = 30
export const NAME_CHANGE_COOLDOWN_MS = NAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
export const DISPLAY_NAME_MAX_LENGTH = 100

/**
 * 名稱是公開署名的一部分；只接受去除首尾空白後仍有內容、且不超過 UI 上限的字串。
 * 回傳正規化後的值，讓 Worker 與前端採用相同規則。
 */
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized || normalized.length > DISPLAY_NAME_MAX_LENGTH) return null
  return normalized
}

/** 回傳仍在冷卻期時的到期 epoch 毫秒；無紀錄、格式無效或已到期皆回 null。 */
export function nameChangeCooldownExpiresAt(nameChangedAt: string | null, now = Date.now()): number | null {
  if (!nameChangedAt) return null

  const changedAt = Date.parse(nameChangedAt)
  if (Number.isNaN(changedAt)) return null

  const expiresAt = changedAt + NAME_CHANGE_COOLDOWN_MS
  return now < expiresAt ? expiresAt : null
}

/** 冷卻期以天為單位向上取整，讓剩餘任一小時也明確顯示仍不可修改。 */
export function nameChangeCooldownRemainingDays(nameChangedAt: string | null, now = Date.now()): number | null {
  const expiresAt = nameChangeCooldownExpiresAt(nameChangedAt, now)
  return expiresAt === null ? null : Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000))
}

/** Better Auth client 與 Worker 回傳的錯誤格式不同，兩種都辨識。 */
export function isNameChangeCooldownPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false

  const record = payload as { code?: unknown; error?: unknown }
  if (record.code === NAME_CHANGE_COOLDOWN_CODE) return true

  const nested = record.error
  return !!nested && typeof nested === 'object' && (nested as { code?: unknown }).code === NAME_CHANGE_COOLDOWN_CODE
}
