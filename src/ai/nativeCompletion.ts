export class NativeCompletionError extends Error {
  constructor(readonly code: 'generation_invalid_completion' | 'generation_incomplete_completion' | 'generation_refusal_or_invalid_message' | 'generation_invalid_json' | 'generation_invalid_schema') {
    super(code)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Gemma 原生 Chat 回應只取明確 stop 的唯一 assistant content；不讀取或拼接思考欄位。
export function parseNativeContent(value: unknown): string {
  if (!isObject(value) || typeof value.model !== 'string' || !Array.isArray(value.choices) || value.choices.length !== 1) throw new NativeCompletionError('generation_invalid_completion')
  const choice = value.choices[0]
  if (!isObject(choice) || choice.index !== 0) throw new NativeCompletionError('generation_invalid_completion')
  if (
    choice.finish_reason !== 'stop' ||
    (value.error !== undefined && value.error !== null) ||
    (value.truncated !== undefined && value.truncated !== false) ||
    (choice.truncated !== undefined && choice.truncated !== false)
  )
    throw new NativeCompletionError('generation_incomplete_completion')
  const message = choice.message
  if (isObject(message) && message.truncated !== undefined && message.truncated !== false) throw new NativeCompletionError('generation_incomplete_completion')
  if (
    !isObject(message) ||
    message.role !== 'assistant' ||
    (Object.hasOwn(message, 'refusal') && message.refusal !== null) ||
    typeof message.content !== 'string' ||
    (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) ||
    (message.function_call !== undefined && message.function_call !== null)
  )
    throw new NativeCompletionError('generation_refusal_or_invalid_message')
  return message.content
}

export function parseNativeJson(value: unknown): unknown {
  const text = parseNativeContent(value)
  // 只拆除佔據整份回應、以獨立行開閉的單一外框；內部仍須是完整合法 JSON。
  const fenced = /^[ \t\r\n]*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t\r\n]*$/.exec(text)
  try {
    return JSON.parse(fenced ? fenced[1] : text)
  } catch (error) {
    if (error instanceof SyntaxError) throw new NativeCompletionError('generation_invalid_json')
    throw error
  }
}
