import { describe, expect, it } from 'vitest'
import type { CrossingRecord } from './working-drawings'
import { triageCrossings, type DepthBand } from './crossing-triage'

/** Коллектор на глубине ~4 м: земля 686, лоток 682, DN450. */
const GROUND = 686
const INVERT = 682
const card = (id: string, kind: string, elevation?: number): CrossingRecord => ({
  id, stationM: 100, kind, approved: false,
  designInvertElevationM: INVERT,
  ...(elevation !== undefined ? { existingElevationM: elevation } : {}),
})

const bands: Record<string, DepthBand> = {
  'кабель связи': { minM: 0.6, maxM: 1.2, source: 'ТУ владельца' },
  'газопровод': { minM: 0.8, maxM: 1.8, source: 'паспорт сети' },
  'водопровод': { minM: 1.5, maxM: 3.6, source: 'решение инженера' },
}

const base = {
  depthBands: bands,
  requiredClearanceM: 0.2,
  groundElevationAtM: () => GROUND,
  designDiameterMm: 450,
}

describe('отбор пересечений на вскрытие', () => {
  it('мелкая сеть над глубоким коллектором вскрытия не требует', () => {
    const result = triageCrossings({ ...base, crossings: [card('X-1', 'кабель связи')] })
    expect(result.items[0].verdict).toBe('clears_by_margin')
    // Кабель максимум на 1.2 м → 684.8; верх трубы 682.45; просвет 2.35 м.
    expect(result.items[0].worstClearanceM).toBeCloseTo(2.35, 2)
    expect(result.needLevelling).toHaveLength(0)
    expect(result.items[0].reason).toContain('вскрытие не требуется')
  })

  it('сеть, способная лечь вплотную, требует вскрытия', () => {
    // Водопровод от 1.5 до 3.6 м: при 3.6 м это 682.4, верх трубы 682.45 — конфликт;
    // при 1.5 м это 684.5 — просвет 2.05 м. Исход зависит от факта.
    const result = triageCrossings({ ...base, crossings: [card('X-2', 'водопровод')] })
    expect(result.items[0].verdict).toBe('needs_levelling')
    expect(result.needLevelling).toHaveLength(1)
    expect(result.items[0].reason).toContain('зависит от фактической отметки')
  })

  it('неизбежный конфликт не лечится измерением', () => {
    const deep = triageCrossings({
      ...base,
      requiredClearanceM: 3,
      crossings: [card('X-3', 'кабель связи')],
    })
    // Даже самый мелкий кабель даёт 2.95 м при требуемых 3.
    expect(deep.items[0].verdict).toBe('conflict_certain')
    expect(deep.conflicts).toHaveLength(1)
    expect(deep.items[0].reason).toContain('измерение не поможет')
  })

  it('отнивелированное пересечение считается по факту', () => {
    const result = triageCrossings({ ...base, crossings: [card('X-4', 'газопровод', 684.5)] })
    expect(result.items[0].verdict).toBe('levelled')
    expect(result.items[0].worstClearanceM).toBeCloseTo(2.05, 2)
    expect(result.needLevelling).toHaveLength(0)
  })

  it('без заданного диапазона пересечение остаётся на вскрытие, а не угадывается', () => {
    const result = triageCrossings({ ...base, crossings: [card('X-5', 'теплосеть')] })
    expect(result.items[0].verdict).toBe('unknown_band')
    expect(result.needLevelling).toHaveLength(1)
    expect(result.items[0].reason).toContain('не задан')
  })

  it('без отметки земли на пикете исход не выдумывается', () => {
    const result = triageCrossings({
      ...base, groundElevationAtM: () => null, crossings: [card('X-6', 'газопровод')],
    })
    expect(result.items[0].verdict).toBe('unknown_band')
  })

  it('сводка считает по исходам', () => {
    const result = triageCrossings({
      ...base,
      crossings: [
        card('X-1', 'кабель связи'),
        card('X-2', 'водопровод'),
        card('X-3', 'газопровод', 684.9),
        card('X-4', 'теплосеть'),
      ],
    })
    expect(result.summary).toContain('Пересечений 4')
    expect(result.summary).toContain('отнивелировано 1')
    expect(result.summary).toContain('просвет обеспечен расчётом 1')
    expect(result.summary).toContain('вскрывать 2')
  })
})
