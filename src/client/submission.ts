import { isDuplicateNameEmailRequiredPayload } from '../lib/profile-name'

/**
 * 投稿先尊重表單當下的 email 選擇。若伺服器重新檢查後發現同名，先詢問使用者，
 * 只有明確確認才以 show_email=true 重送，避免在 TOCTOU 情況下靜默公開 email。
 */
export async function postSubmissionWithDuplicateNameCheck(url: string, body: Record<string, unknown>, confirmEmailDisclosure: () => boolean): Promise<Response | null> {
  const send = (payload: Record<string, unknown>) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

  const firstResponse = await send(body)
  if (firstResponse.status !== 409) return firstResponse

  const payload = await firstResponse
    .clone()
    .json()
    .catch(() => null)
  if (!isDuplicateNameEmailRequiredPayload(payload)) return firstResponse
  if (!confirmEmailDisclosure()) return null

  return send({ ...body, show_email: true })
}
