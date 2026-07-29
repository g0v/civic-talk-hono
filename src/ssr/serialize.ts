/** 安全序列化 JSON，避免 </script> 破壞 HTML 殼 */
export function serializeState(state: unknown): string {
  return JSON.stringify(state).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
