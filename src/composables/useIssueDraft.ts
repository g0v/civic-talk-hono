import { readonly, ref, watch } from 'vue'
import { emptyIssueDraft, issueDraftKey, readIssueDraft, saveIssueDraft } from '../client/issueDraft'

export function useIssueDraft(accountId: () => string | undefined) {
  const showForm = ref(false)
  const draft = ref(emptyIssueDraft())
  const draftLoading = ref(false)
  const draftStorageAvailable = ref(true)
  const draftKey = ref<string | null>(null)

  watch(
    draft,
    fields => {
      if (draftKey.value) draftStorageAvailable.value = saveIssueDraft(draftKey.value, fields)
    },
    { deep: true, flush: 'sync' }
  )

  function restoreDraft(key: string): void {
    const stored = readIssueDraft(key)
    draftStorageAvailable.value = stored.available
    if (stored.available) {
      // 載入是讀取，不應把快照回寫到另一個分頁可能正在使用的儲存空間。
      draftKey.value = null
      draft.value = stored.draft
    }
    draftKey.value = key
  }

  watch(
    accountId,
    async (id, _previousId, onCleanup) => {
      let current = true
      onCleanup(() => {
        current = false
      })
      draftKey.value = null
      draft.value = emptyIssueDraft()
      draftLoading.value = Boolean(id)
      if (!id) return

      const key = await issueDraftKey(id)
      if (!current) return
      if (key) restoreDraft(key)
      else draftStorageAvailable.value = false
      draftLoading.value = false
    },
    { immediate: true, flush: 'sync' }
  )

  function openIssueForm(): void {
    // 同帳號可能從另一個分頁改過草稿；若儲存失敗則保留目前分頁的文字。
    if (!showForm.value && draftKey.value && draftStorageAvailable.value) restoreDraft(draftKey.value)
    showForm.value = true
  }

  return { showForm, draft, draftLoading, draftStorageAvailable, draftKey: readonly(draftKey), openIssueForm }
}
