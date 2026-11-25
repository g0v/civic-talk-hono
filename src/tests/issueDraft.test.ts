import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { effectScope } from 'vue'
import { emptyIssueDraft, issueDraftKey, readIssueDraft, saveIssueDraft } from '../client/issueDraft'
import { useIssueDraft } from '../composables/useIssueDraft'

const draft = { title: '未發布的議題', description: '  初稿\n\n', tags: '居住、 交通，' }
const emptyDraft = { title: '', description: '', tags: '' }

function browserStorage(canWrite = () => true) {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    crypto: webcrypto,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem(key: string, value: string) {
        if (!canWrite()) throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
        values.set(key, value)
      },
      removeItem: (key: string) => values.delete(key),
    },
  })
  return values
}

async function keyFor(accountId: string): Promise<string> {
  const key = await issueDraftKey(accountId)
  if (!key) throw new Error('測試需要可用的 Web Crypto')
  return key
}

afterEach(() => vi.unstubAllGlobals())

it('同帳號恢復原始文字，其他帳號無法由表單讀回，儲存不含帳號與勾選資料', async () => {
  const values = browserStorage()
  const accountId = 'first-test-account'
  const key = await keyFor(accountId)
  const secondKey = await keyFor('second-test-account')
  const form = { ...draft, terms_accepted: true, show_email: true, email: 'test@example.invalid' }

  expect(saveIssueDraft(key, form)).toBe(true)

  expect(readIssueDraft(await keyFor(accountId))).toEqual({ draft, available: true })
  expect(readIssueDraft(secondKey).draft).toEqual(emptyDraft)
  expect(key).not.toContain(accountId)
  expect(JSON.parse(values.get(key) ?? 'null')).toEqual(draft)
})

it('清空時刪除本帳號草稿，但不刪除其他帳號草稿', async () => {
  const values = browserStorage()
  const key = await keyFor('first-test-account')
  const secondKey = await keyFor('second-test-account')
  saveIssueDraft(key, draft)
  saveIssueDraft(secondKey, draft)

  expect(saveIssueDraft(key, emptyIssueDraft())).toBe(true)

  expect(values.has(key)).toBe(false)
  expect(readIssueDraft(secondKey).draft).toEqual(draft)
})

it.each(['{', '{"title":"a","description":"b","tags":[]}', 'null'])('不將損毀或型別不符的記錄帶入表單：%s', async raw => {
  const values = browserStorage()
  const key = await keyFor('first-test-account')
  values.set(key, raw)

  expect(readIssueDraft(key)).toEqual({ draft: emptyDraft, available: true })
})

it('瀏覽器封鎖 localStorage 時回報不可用，而不是讓編輯流程出錯', () => {
  vi.stubGlobal('window', {
    get localStorage() {
      throw new DOMException('Storage blocked', 'SecurityError')
    },
  })
  const key = 'test-key'

  expect(readIssueDraft(key)).toEqual({ draft: emptyDraft, available: false })
  expect(saveIssueDraft(key, draft)).toBe(false)
})

it('已載入的另一分頁開啟表單時恢復新草稿，編輯標籤不會覆蓋原標題', async () => {
  browserStorage()
  const account = () => 'same-account-in-two-tabs'
  const scope = effectScope()
  try {
    const tabA = scope.run(() => useIssueDraft(account))
    const tabB = scope.run(() => useIssueDraft(account))
    if (!tabA || !tabB) throw new Error('測試需要可用的表單作用域')
    await vi.waitFor(() => {
      expect(tabA.draftLoading.value || tabB.draftLoading.value).toBe(false)
    })
    tabA.openIssueForm()
    tabA.draft.value.title = draft.title
    tabA.showForm.value = false

    tabB.openIssueForm()
    tabB.draft.value.tags = draft.tags

    const key = await keyFor(account())
    expect(readIssueDraft(key).draft).toEqual({ ...emptyDraft, title: draft.title, tags: draft.tags })
  } finally {
    scope.stop()
  }
})

it('本機儲存空間不足時，重開表單不以舊草稿覆蓋尚未存入的文字', async () => {
  let canWrite = true
  browserStorage(() => canWrite)
  const account = () => 'quota-test-account'
  const key = await keyFor(account())
  saveIssueDraft(key, draft)
  const scope = effectScope()
  try {
    const form = scope.run(() => useIssueDraft(account))
    if (!form) throw new Error('測試需要可用的表單作用域')
    await vi.waitFor(() => expect(form.draftLoading.value).toBe(false))
    form.openIssueForm()
    canWrite = false
    form.draft.value.title = '尚未存入的新標題'
    form.showForm.value = false

    form.openIssueForm()

    expect(form.draft.value.title).toBe('尚未存入的新標題')
    expect(form.draftStorageAvailable.value).toBe(false)
  } finally {
    scope.stop()
  }
})
