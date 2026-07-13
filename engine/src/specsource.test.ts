import { describe, expect, it } from 'vitest'
import { builtinCatalogSource, selectSpecificationSource, SPEC_SOURCES, vgskSource } from './specsource'

describe('SpecificationSource', () => {
  it('lists the built-in source as available and VGSK as not', () => {
    expect(builtinCatalogSource.available).toBe(true)
    expect(vgskSource.available).toBe(false)
    expect(SPEC_SOURCES.map((s) => s.id)).toEqual(['builtin', 'vgsk'])
  })

  it('VGSK is not implemented and throws if built (structure not invented)', () => {
    expect(() => vgskSource.build({} as never)).toThrow()
  })

  it('selects the built-in source by default and for an unavailable id', () => {
    expect(selectSpecificationSource().id).toBe('builtin')
    expect(selectSpecificationSource('vgsk').id).toBe('builtin')
    expect(selectSpecificationSource('builtin').id).toBe('builtin')
  })
})
