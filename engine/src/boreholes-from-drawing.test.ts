import { describe, expect, it } from 'vitest'
import type { DxfNetworkData } from './dxfread'
import type { Borehole } from './geology'
import {
  boreholesFromDrawing,
  mergeBoreholePositions,
  normalizeBoreholeLabel,
} from './boreholes-from-drawing'

const drawing = (texts: Array<[number, number, string, string?]>): DxfNetworkData => ({
  ok: true,
  points: [],
  layers: [],
  segments: [],
  textEntities: texts.map(([x, y, text, layer]) => ({ x, y, text, layer: layer ?? 'GEO' })),
})

const SITE = { minX: -300, minY: 7800, maxX: 120, maxY: 8200 }

describe('метки скважин', () => {
  it('приводятся к общему виду независимо от записи', () => {
    for (const raw of ['скв-1', 'Скв. 1', 'скв №1', 'с-1', 'СКВ1']) {
      expect(normalizeBoreholeLabel(raw)).toBe('скв-1')
    }
    expect(normalizeBoreholeLabel('скв-012')).toBe('скв-12')
  })

  it('не принимает произвольный текст за метку', () => {
    for (const raw of ['Скважина N ___', 'План расположения скважин', 'сеть', '1']) {
      expect(normalizeBoreholeLabel(raw)).toBeNull()
    }
  })
})

describe('привязка скважин по чертежу', () => {
  it('берёт координаты подписей', () => {
    const result = boreholesFromDrawing(drawing([
      [-198.5, 8112.2, 'скв-1'], [-17.6, 8038.8, 'скв-2'], [20.5, 7854.4, 'скв-3'],
    ]), { bounds: SITE })
    expect(result.boreholes.map((b) => b.label)).toEqual(['скв-1', 'скв-2', 'скв-3'])
    expect(result.boreholes[0].x).toBe(-198.5)
    expect(result.ambiguous).toEqual([])
  })

  it('отбрасывает подписи вне границ площадки — это врезка или штамп', () => {
    const result = boreholesFromDrawing(drawing([
      [-198.5, 8112.2, 'скв-1'],
      [516.3, 8110.8, 'скв-1'],
      [606.7, 8074.1, 'скв-2'],
    ]), { bounds: SITE })
    expect(result.boreholes.map((b) => b.label)).toEqual(['скв-1'])
    expect(result.outsideBounds).toBe(2)
    expect(result.reason).toContain('Вне границ площадки')
  })

  it('без границ повторная метка помечается неоднозначной, а не выбирается наугад', () => {
    const result = boreholesFromDrawing(drawing([
      [-198.5, 8112.2, 'скв-1'], [516.3, 8110.8, 'скв-1'], [-17.6, 8038.8, 'скв-2'],
    ]))
    expect(result.boreholes.map((b) => b.label)).toEqual(['скв-2'])
    expect(result.ambiguous).toHaveLength(1)
    expect(result.ambiguous[0].positions).toHaveLength(2)
    expect(result.reason).toContain('врезка')
  })

  it('одна метка, продублированная в той же точке, неоднозначной не считается', () => {
    const result = boreholesFromDrawing(drawing([
      [10, 7900, 'скв-1'], [10.4, 7900.2, 'скв-1'],
    ]), { bounds: SITE })
    expect(result.boreholes).toHaveLength(1)
    expect(result.ambiguous).toEqual([])
  })

  it('пустой чертёж не выдаёт себя за успешную привязку', () => {
    const result = boreholesFromDrawing(drawing([[0, 7900, 'Скважина N ___']]), { bounds: SITE })
    expect(result.boreholes).toEqual([])
    expect(result.reason).toContain('не найдены')
  })
})

describe('перенос координат в ведомость', () => {
  const sheet: Borehole[] = [
    { label: 'скв-1', layers: [{ topDepthM: 0, bottomDepthM: 6, soilName: 'суглинок' }], water: {} },
    { label: 'Скв. 2', layers: [], water: {} },
    { label: 'скв-9', layers: [], water: {} },
  ]

  it('связывает по метке, приводя записи к общему виду', () => {
    const result = mergeBoreholePositions(sheet, [
      { label: 'скв-1', x: -198.5, y: 8112.2, layer: 'GEO' },
      { label: 'скв-2', x: -17.6, y: 8038.8, layer: 'GEO' },
    ])
    expect(result.boreholes[0].x).toBe(-198.5)
    expect(result.boreholes[1].x).toBe(-17.6)
    expect(result.unlocated).toEqual(['скв-9'])
  })

  it('координаты, введённые человеком, не перетираются чертежом', () => {
    const withCoords: Borehole[] = [{ label: 'скв-1', x: 1, y: 2, layers: [], water: {} }]
    const result = mergeBoreholePositions(withCoords, [
      { label: 'скв-1', x: -198.5, y: 8112.2, layer: 'GEO' },
    ])
    expect(result.boreholes[0].x).toBe(1)
    expect(result.boreholes[0].y).toBe(2)
  })

  it('сообщает о координатах без скважины в ведомости', () => {
    const result = mergeBoreholePositions([sheet[0]], [
      { label: 'скв-1', x: 0, y: 0, layer: 'GEO' },
      { label: 'скв-7', x: 5, y: 5, layer: 'GEO' },
    ])
    expect(result.unmatched).toEqual(['скв-7'])
  })
})

describe('номер выработки голым числом на своём слое', () => {
  /**
   * На съёмке Станкевича номера скважин подписаны «1», «2», «3» без слова
   * «скв», а рядом на том же слое стоят дата бурения и отметка устья.
   */
  const drawing = {
    textEntities: [
      { text: '1', layer: 'номер скв', x: 253.71, y: 8134.1 },
      { text: '06.2025г.', layer: 'номер скв', x: 255.88, y: 8128.25 },
      { text: '685,13', layer: 'номер скв', x: 325.75, y: 8134.15 },
      { text: '2', layer: 'номер скв', x: 254.16, y: 8010.71 },
      { text: '3', layer: 'номер скв', x: 259.38, y: 7884.3 },
      // Число на постороннем слое номером выработки не становится.
      { text: '7', layer: 'РЕЛЬЕФ', x: 300, y: 8000 },
    ],
  } as never

  it('без объявленного слоя голые числа не берутся', () => {
    expect(boreholesFromDrawing(drawing).boreholes).toHaveLength(0)
  })

  it('на объявленном слое берутся только целые номера', () => {
    const found = boreholesFromDrawing(drawing, { numberLayers: ['номер скв'] })
    expect(found.boreholes.map((borehole) => borehole.label)).toEqual(['скв-1', 'скв-2', 'скв-3'])
    // Дата и отметка устья лежат на том же слое и номером не притворяются.
    expect(found.boreholes.every((borehole) => /^скв-[123]$/.test(borehole.label))).toBe(true)
    expect(found.boreholes[0].x).toBeCloseTo(253.71, 2)
  })

  it('число на чужом слое остаётся числом', () => {
    const found = boreholesFromDrawing(drawing, { numberLayers: ['номер скв'] })
    expect(found.boreholes.some((borehole) => borehole.y === 8000)).toBe(false)
  })
})
