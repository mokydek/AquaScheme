import { describe, expect, it } from 'vitest'
import { internalDiameterMm, parseCatalogRows, toPipeSizeOptions } from './catalog'

describe('parseCatalogRows', () => {
  it('parses pipes and fittings with Russian headers', () => {
    const result = parseCatalogRows([
      {
        'Тип': 'труба',
        'Материал': 'ПЭ100 SDR17',
        'DN': 110,
        'Наружный диаметр, мм': 110,
        'Толщина стенки, мм': 6.6,
        'PN': 10,
        'Цена': 1200,
      },
      { 'Тип': 'гидрант', 'DN': 125, 'PN': 10, 'Цена': 45000 },
    ])
    expect(result.issues).toHaveLength(0)
    expect(result.items).toHaveLength(2)
    expect(result.items[0].itemType).toBe('pipe')
    expect(result.items[1].itemType).toBe('hydrant')
  })

  it('flags an unknown type', () => {
    const result = parseCatalogRows([{ 'Тип': 'нечто', 'DN': 100 }])
    expect(result.issues).toEqual([{ row: 2, code: 'unknownType' }])
  })

  it('flags a pipe without a resolvable diameter', () => {
    const result = parseCatalogRows([{ 'Тип': 'труба', 'DN': 110 }])
    expect(result.issues).toEqual([{ row: 2, code: 'noDiameter' }])
  })

  it('flags non numeric cells', () => {
    const result = parseCatalogRows([{ 'Тип': 'труба', 'Наружный диаметр, мм': 'abc', 'Толщина стенки, мм': 5 }])
    expect(result.issues).toEqual([{ row: 2, code: 'badNumber' }])
  })

  it('skips empty rows silently', () => {
    const result = parseCatalogRows([{ 'Тип': '' }, { 'Тип': 'труба', 'Наружный диаметр, мм': 110, 'SDR': 17 }])
    expect(result.items).toHaveLength(1)
    expect(result.issues).toHaveLength(0)
  })
})

describe('internalDiameterMm', () => {
  it('computes from outer and wall', () => {
    expect(internalDiameterMm({ itemType: 'pipe', outerMm: 110, wallMm: 6.6 })).toBeCloseTo(96.8, 1)
  })
  it('computes from outer and SDR', () => {
    expect(internalDiameterMm({ itemType: 'pipe', outerMm: 110, sdr: 17 })).toBeCloseTo(97.1, 1)
  })
  it('returns null without enough data', () => {
    expect(internalDiameterMm({ itemType: 'pipe', dn: 110 })).toBeNull()
  })
})

describe('toPipeSizeOptions', () => {
  it('builds a sorted size series and a roughness from pipe items', () => {
    const result = toPipeSizeOptions([
      { itemType: 'pipe', dn: 160, outerMm: 160, sdr: 17, roughnessMm: 0.05 },
      { itemType: 'pipe', dn: 110, outerMm: 110, sdr: 17, roughnessMm: 0.1 },
      { itemType: 'hydrant', dn: 125 },
    ])
    expect(result).not.toBeNull()
    expect(result?.sizes.map((s) => s.nominalMm)).toEqual([110, 160])
    expect(result?.roughnessMm).toBeCloseTo(0.1, 6)
  })

  it('returns null when there are no pipes', () => {
    expect(toPipeSizeOptions([{ itemType: 'valve', dn: 100 }])).toBeNull()
  })
})
