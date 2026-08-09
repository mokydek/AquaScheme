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

describe('позиция каталога несёт свой источник', () => {
  it('код справочника и страница доходят до позиции', () => {
    // Позиция каталога — данные с источником, а не результат расчёта: по коду
    // её можно найти в официальном справочнике и сверить глазами.
    const parsed = parseCatalogRows([{
      'Тип': 'труба',
      'Материал': 'железобетон',
      'Стандарт': 'ГОСТ 6482-2011',
      'Код': '241-702-0912',
      'Страница': '1706',
      'DN': '2000',
      'ID': '2000',
    }])
    expect(parsed.issues).toEqual([])
    expect(parsed.items[0]).toMatchObject({
      itemType: 'pipe',
      standard: 'ГОСТ 6482-2011',
      code: '241-702-0912',
      sourcePage: 1706,
      dn: 2000,
      internalMm: 2000,
    })
  })

  it('позиция без кода принимается: не всякий каталог его несёт', () => {
    const parsed = parseCatalogRows([{ 'Тип': 'труба', 'DN': '450', 'ID': '450' }])
    expect(parsed.items[0].code).toBeUndefined()
    expect(parsed.items[0].sourcePage).toBeUndefined()
  })

  it('условный проход сам по себе внутренним диаметром не считается', () => {
    // DN — величина условная: у полимерной трубы он близок к наружному
    // диаметру, у стальной — ни к тому, ни к другому. Без явного ID подбирать
    // не по чему, и строка получает замечание, а не выдуманный диаметр.
    const parsed = parseCatalogRows([{ 'Тип': 'труба', 'DN': '450' }])
    expect(parsed.issues.map((issue) => issue.code)).toContain('noDiameter')
  })

  it('нечисловая страница — замечание строки, а не тихий пропуск', () => {
    const parsed = parseCatalogRows([{ 'Тип': 'труба', 'DN': '450', 'ID': '450', 'Страница': 'см. приложение' }])
    expect(parsed.issues.map((issue) => issue.code)).toContain('badNumber')
  })
})
