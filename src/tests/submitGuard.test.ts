import { describe, it, expect } from 'vite-plus/test'
import { useSubmitGuard } from '../composables/useSubmitGuard'

// #97：送出鈕按下後到實際送出之間有時間差，重複點擊不得變成重複送出。
// 這裡守住防重入的核心契約（按鈕的 disabled 與「資料處理中」文案只是第二層）。
describe('useSubmitGuard', () => {
  it('請求進行中的重複呼叫只會送出一次', async () => {
    const { pending, run } = useSubmitGuard()
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })

    const first = run(async () => {
      calls += 1
      await gate
    })
    const second = run(async () => {
      calls += 1
    })

    expect(pending.value).toBe(true)
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(pending.value).toBe(false)
  })

  it('前一次送出完成後可以再次送出', async () => {
    const { run } = useSubmitGuard()
    let calls = 0

    await run(async () => {
      calls += 1
    })
    await run(async () => {
      calls += 1
    })

    expect(calls).toBe(2)
  })

  it('callback 拋錯時不會把按鈕鎖住', async () => {
    const { pending, run } = useSubmitGuard()

    await expect(
      run(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(pending.value).toBe(false)
  })
})
