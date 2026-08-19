import { describe, expect, it } from 'vitest'
import { formatAppError, looksLikeDatasetKindRejection } from './errorFormatting'

describe('formatAppError', () => {
  it('formats an Error through its message without exposing a stack', () => {
    const result = formatAppError(new Error('network unavailable'))

    expect(result).toBe('message: network unavailable')
    expect(result).not.toContain('[object Object]')
    expect(result).not.toContain('at ')
  })

  it('preserves the standard Supabase error fields in a stable order', () => {
    expect(formatAppError({
      hint: 'apply the migration',
      details: 'relation engineering_route is missing',
      message: 'request failed',
      code: 'PGRST205',
    })).toBe(
      'code: PGRST205 · message: request failed · details: relation engineering_route is missing · hint: apply the migration',
    )
  })

  it('serializes nested objects instead of coercing them implicitly', () => {
    const result = formatAppError({ request: { status: 400, body: { reason: 'invalid route' } } })

    expect(result).toBe('{"request":{"body":{"reason":"invalid route"},"status":400}}')
    expect(result).not.toContain('[object Object]')
  })

  it('returns a string error unchanged', () => {
    expect(formatAppError('HTTP 400')).toBe('HTTP 400')
    expect(formatAppError('[object Object]')).toBe('нечитаемый объект')
  })

  it('marks circular references and never throws', () => {
    const circular: { stage: string; self?: unknown } = { stage: 'engineering route' }
    circular.self = circular

    const result = formatAppError(circular)
    expect(result).toContain('"self":"[Circular]"')
    expect(result).toContain('"stage":"engineering route"')
    expect(result).not.toContain('[object Object]')
  })

  it('uses a localized fallback for nullish unknown values', () => {
    expect(formatAppError(undefined)).toBe('Неизвестная ошибка')
    expect(formatAppError(null)).toBe('Неизвестная ошибка')
  })

  it('handles unreadable objects safely', () => {
    const unreadable = new Proxy({}, {
      ownKeys: () => { throw new Error('denied') },
      get: () => { throw new Error('denied') },
    })

    expect(() => formatAppError(unreadable)).not.toThrow()
    expect(formatAppError(unreadable)).not.toContain('[object Object]')
  })
})

describe('подсказка о миграции показывается только по делу', () => {
  it('узнаёт отказ базы принять вид набора', () => {
    // Настоящий текст ошибки Postgres, на который подсказка и рассчитана.
    expect(looksLikeDatasetKindRejection(
      'new row for relation "datasets" violates check constraint "datasets_kind_check"',
    )).toBe(true)
    expect(looksLikeDatasetKindRejection('ERROR: 23514: check constraint')).toBe(true)
    expect(looksLikeDatasetKindRejection('база не принимает этот вид набора: ограничение kind')).toBe(true)
  })

  it('молчит, когда всё в порядке или сломалось другое', () => {
    // Инженер, у которого всё хорошо, не должен читать про миграции.
    expect(looksLikeDatasetKindRejection(null)).toBe(false)
    expect(looksLikeDatasetKindRejection('')).toBe(false)
    expect(looksLikeDatasetKindRejection('Не удалось прочитать файл каталога')).toBe(false)
    expect(looksLikeDatasetKindRejection('network error')).toBe(false)
  })
})
