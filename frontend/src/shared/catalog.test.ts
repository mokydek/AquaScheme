import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { resolveGravityCatalog } from './catalog'

describe('resolveGravityCatalog', () => {
  it('uses the built-in series only when no custom catalog is selected', () => {
    expect(resolveGravityCatalog(null, undefined)).toEqual({ ready: true })
  })

  it('blocks the solver while a selected catalog is loading', () => {
    const result = resolveGravityCatalog('catalog-1', undefined)
    expect(result.ready).toBe(false)
    expect(result.blocker).toContain('ожидает загрузку')
  })

  it('blocks empty and failed custom catalogs instead of producing diameter zero', () => {
    expect(resolveGravityCatalog('catalog-1', []).ready).toBe(false)
    const failed = resolveGravityCatalog('catalog-1', undefined, 'HTTP 400')
    expect(failed.ready).toBe(false)
    expect(failed.blocker).toContain('HTTP 400')
  })

  it('normalizes positive catalog diameters before hydraulic sizing', () => {
    expect(resolveGravityCatalog('catalog-1', [1200, 800, 1200, 0, Number.NaN])).toEqual({
      ready: true,
      allowedDiametersMm: [800, 1200],
    })
  })
})
