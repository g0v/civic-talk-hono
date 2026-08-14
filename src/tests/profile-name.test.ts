import { describe, expect, it } from 'vite-plus/test'
import {
  DISPLAY_NAME_MAX_LENGTH,
  isNameChangeCooldownPayload,
  NAME_CHANGE_COOLDOWN_DAYS,
  NAME_CHANGE_COOLDOWN_MS,
  nameChangeCooldownExpiresAt,
  nameChangeCooldownRemainingDays,
  normalizeDisplayName,
} from '../lib/profile-name'

describe('個人名稱修改冷卻期', () => {
  const changedAt = '2026-08-01T00:00:00.000Z'
  const now = Date.parse(changedAt)

  it('名稱更新後 30 天內維持冷卻，到期時解除', () => {
    expect(nameChangeCooldownExpiresAt(changedAt, now)).toBe(now + NAME_CHANGE_COOLDOWN_MS)
    expect(nameChangeCooldownExpiresAt(changedAt, now + NAME_CHANGE_COOLDOWN_MS - 1)).toBe(now + NAME_CHANGE_COOLDOWN_MS)
    expect(nameChangeCooldownExpiresAt(changedAt, now + NAME_CHANGE_COOLDOWN_MS)).toBeNull()
  })

  it('未曾修改或無效時間戳記不會誤擋名稱更新', () => {
    expect(nameChangeCooldownExpiresAt(null, now)).toBeNull()
    expect(nameChangeCooldownExpiresAt('not-a-date', now)).toBeNull()
  })

  it('以向上取整的天數顯示剩餘冷卻期', () => {
    expect(nameChangeCooldownRemainingDays(changedAt, now)).toBe(NAME_CHANGE_COOLDOWN_DAYS)
    expect(nameChangeCooldownRemainingDays(changedAt, now + 24 * 60 * 60 * 1000)).toBe(29)
    expect(nameChangeCooldownRemainingDays(changedAt, now + NAME_CHANGE_COOLDOWN_MS - 1)).toBe(1)
    expect(nameChangeCooldownRemainingDays(changedAt, now + NAME_CHANGE_COOLDOWN_MS)).toBeNull()
  })

  it('可辨識 Worker 與 Better Auth client 的冷卻期錯誤格式', () => {
    expect(isNameChangeCooldownPayload({ code: 'NAME_CHANGE_COOLDOWN' })).toBe(true)
    expect(isNameChangeCooldownPayload({ error: { code: 'NAME_CHANGE_COOLDOWN' } })).toBe(true)
    expect(isNameChangeCooldownPayload({ code: 'OTHER_ERROR' })).toBe(false)
  })
})

describe('公開顯示名稱', () => {
  it('會去除首尾空白，並拒絕空白與超過上限的名稱', () => {
    expect(normalizeDisplayName('  王小明  ')).toBe('王小明')
    expect(normalizeDisplayName('   ')).toBeNull()
    expect(normalizeDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBeNull()
    expect(normalizeDisplayName(123)).toBeNull()
  })
})
