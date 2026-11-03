/** 僅停用 Vite 的本機 development server；remote 模式與任何正式建置均保留 Auth。 */
export function isLocalAuthDisabled(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE === 'development'
}
