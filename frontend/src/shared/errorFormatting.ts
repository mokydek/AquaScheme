const FALLBACK_ERROR = 'Неизвестная ошибка'
const MAX_OUTPUT_LENGTH = 2_000
const MAX_DEPTH = 6

const STANDARD_FIELDS = ['code', 'message', 'details', 'hint'] as const

function truncate(value: string): string {
  const safeValue = value.replaceAll('[object Object]', 'нечитаемый объект')
  if (safeValue.length <= MAX_OUTPUT_LENGTH) return safeValue
  return `${safeValue.slice(0, MAX_OUTPUT_LENGTH - 1)}…`
}

function normalizeForDisplay(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return value.description ? `Symbol(${value.description})` : 'Symbol()'
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (depth >= MAX_DEPTH) return '[Max depth]'
  if (seen.has(value)) return '[Circular]'

  seen.add(value)
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeForDisplay(item, seen, depth + 1))
    seen.delete(value)
    return normalized
  }

  const normalized: Record<string, unknown> = {}
  try {
    for (const key of Object.keys(value).sort()) {
      try {
        normalized[key] = normalizeForDisplay(
          (value as Record<string, unknown>)[key],
          seen,
          depth + 1,
        )
      } catch {
        normalized[key] = '[Unreadable]'
      }
    }
  } catch {
    seen.delete(value)
    return '[Unreadable object]'
  }
  seen.delete(value)
  return normalized
}

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  try {
    const json = JSON.stringify(normalizeForDisplay(value, new WeakSet<object>(), 0))
    return json && json !== '{}' ? json : null
  } catch {
    return '[Unreadable value]'
  }
}

function readField(value: object, field: string): unknown {
  try {
    return (value as Record<string, unknown>)[field]
  } catch {
    return '[Unreadable]'
  }
}

/**
 * Formats browser, HTTP and Supabase failures without invoking an object's
 * implicit `toString`, so the UI never degrades to "[object Object]".
 */
export function formatAppError(error: unknown): string {
  if (typeof error === 'string') return truncate(error.trim() || FALLBACK_ERROR)
  if (error === null || error === undefined) return FALLBACK_ERROR

  if (typeof error === 'object' || typeof error === 'function') {
    const parts = STANDARD_FIELDS.flatMap((field) => {
      const formatted = displayValue(readField(error, field))
      return formatted ? [`${field}: ${formatted}`] : []
    })
    if (parts.length > 0) return truncate(parts.join(' · '))

    const formatted = displayValue(error)
    if (formatted) return truncate(formatted)
    return FALLBACK_ERROR
  }

  return truncate(displayValue(error) ?? FALLBACK_ERROR)
}
