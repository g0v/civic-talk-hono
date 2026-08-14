import { describe, expect, it } from 'vite-plus/test'
import { limitOAuthProfileSyncToAvatar, socialProviderProfileSync } from '../auth/createAuth'

describe('OAuth 個人資料同步', () => {
  it('每次第三方登入都要求 Better Auth 取得最新個人資料', () => {
    expect(socialProviderProfileSync).toEqual({ overrideUserInfoOnSignIn: true })
  })

  it('OAuth 回調只保留供應商頭像的更新，避免覆寫使用者自行設定的名稱與 email', () => {
    const result = limitOAuthProfileSyncToAvatar({ image: 'https://example.com/avatar-new.png', name: '供應商名稱', email: 'provider@example.com', emailVerified: true }, '/callback/google')

    expect(result).toEqual({ data: { name: undefined, email: undefined, emailVerified: undefined } })
  })

  it('非 OAuth 個人資料更新不受同步規則影響', () => {
    expect(limitOAuthProfileSyncToAvatar({ name: '使用者自行設定的名稱' }, '/update-user')).toBeUndefined()
  })
})
