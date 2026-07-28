import { describe, expect, it } from 'vitest'
import type { DatasetRow } from './datasets'
import { freezingDepthStatus } from './geologyStatus'

function dataset(content: unknown, fileName: string | null = null): DatasetRow {
  return {
    id: 'g1',
    project_id: 'p1',
    kind: 'geology',
    file_name: fileName,
    content,
    meta: null,
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('freezingDepthStatus', () => {
  it('does not turn a missing value into a hidden default', () => {
    const status = freezingDepthStatus(dataset({}))
    expect(status.valueM).toBeNull()
    expect(status.available).toBe(false)
    expect(status.verified).toBe(false)
    expect(status.blockers).toContain('Не задана положительная расчётная глубина промерзания.')
  })

  it('keeps an old numeric value unverified without an explicit decision', () => {
    const status = freezingDepthStatus(dataset({ freezingDepthM: 2.1, sourceFile: 'report.pdf' }))
    expect(status.available).toBe(true)
    expect(status.verified).toBe(false)
  })

  it('requires a source even when the verification flag is present', () => {
    const status = freezingDepthStatus(dataset({ freezingDepthM: 2.1, freezingDepthVerified: true }))
    expect(status.verified).toBe(false)
    expect(status.blockers).toContain('Не указан источник глубины промерзания.')
  })

  it('accepts a positive sourced and explicitly verified value', () => {
    const status = freezingDepthStatus(dataset({
      freezingDepthM: 2.1,
      freezingDepthSource: 'ИГИ, раздел 8.2',
      freezingDepthVerified: true,
    }))
    expect(status).toMatchObject({ available: true, verified: true, valueM: 2.1 })
  })

  it('never verifies synthetic demo geology', () => {
    const status = freezingDepthStatus(dataset({
      freezingDepthM: 1.8,
      sourceFile: 'synthetic-demo.json',
      freezingDepthVerified: true,
      synthetic: true,
    }))
    expect(status.verified).toBe(false)
    expect(status.blockers.at(-1)).toMatch(/Синтетические/)
  })
})
