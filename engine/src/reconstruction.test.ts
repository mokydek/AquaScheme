import { describe, expect, it } from 'vitest'
import { estimateRoughnessMm, normativeRoughnessMm, summarizeAct } from './reconstruction'

/** Величина есть — иначе тест сравнивал бы с `null` и молча проходил. */
const mm = (value: number | null): number => {
  expect(value).not.toBeNull()
  return value as number
}

describe('estimateRoughnessMm', () => {
  it('returns the fresh roughness at zero wear', () => {
    expect(mm(estimateRoughnessMm('steel', 0))).toBeCloseTo(0.1, 3)
  })

  it('grows with wear towards the worn value', () => {
    const mid = mm(estimateRoughnessMm('steel', 50))
    expect(mid).toBeGreaterThan(mm(estimateRoughnessMm('steel', 0)))
    expect(mid).toBeLessThan(mm(estimateRoughnessMm('steel', 100)))
    expect(mm(estimateRoughnessMm('steel', 100))).toBeCloseTo(2.0, 3)
  })

  it('adds an increment for overgrowth', () => {
    expect(mm(estimateRoughnessMm('cast_iron', 50, 100)))
      .toBeGreaterThan(mm(estimateRoughnessMm('cast_iron', 50, 0)))
  })

  it('keeps plastic pipes smooth', () => {
    expect(mm(estimateRoughnessMm('pe', 100))).toBeLessThan(0.3)
  })

  it('clamps out of range wear', () => {
    expect(mm(estimateRoughnessMm('steel', 200))).toBeCloseTo(2.0, 3)
    expect(mm(estimateRoughnessMm('steel', -50))).toBeCloseTo(0.1, 3)
  })

  it('керамика без подтверждённой шероховатости не получает молчаливого значения', () => {
    // Кривой износа для керамики нет ни в норме, ни в оценочном ряду проекта.
    // Раньше неизвестный материал падал в `unknown` и получал чужие 0,5…2,0 мм:
    // расчёт шёл дальше на выдуманной величине, и заметить это было нечем.
    expect(estimateRoughnessMm('ceramic', 0)).toBeNull()
    expect(estimateRoughnessMm('ceramic', 80)).toBeNull()
    expect(estimateRoughnessMm('ceramic', 80, 50)).toBeNull()
    // Явно выбранный «неизвестный» материал — это по-прежнему выбор инженера,
    // и своя строка у него остаётся.
    expect(estimateRoughnessMm('unknown', 50)).not.toBeNull()
  })
})

describe('normativeRoughnessMm', () => {
  it('керамика берётся из табл. 5.18 со ссылкой, а не из оценочного ряда', () => {
    const value = normativeRoughnessMm('ceramic')
    // 0,135 см в таблице — это 1,35 мм.
    expect(value?.value).toBeCloseTo(1.35, 3)
    expect(value?.basis).toBe('normative')
    expect(value?.refs).toContain('sewer.roughness')
    expect(value?.note).toContain('Таблица 5.18')
    // Нормативная величина и оценочный ряд — разные вещи: у стали в таблице
    // 0,08 мм, а в ряду проекта 0,1 мм, и подменять одно другим нельзя.
    expect(normativeRoughnessMm('steel')?.value).toBeCloseTo(0.8, 3)
  })

  it('материала без строки в таблице ближайшей строкой не подменяет', () => {
    expect(normativeRoughnessMm('unknown')).toBeNull()
  })
})

describe('summarizeAct', () => {
  it('totals lengths and counts by decision', () => {
    const summary = summarizeAct([
      { id: 'a', lengthM: 100, decision: 'keep' },
      { id: 'b', lengthM: 200, decision: 'replace' },
      { id: 'c', lengthM: 50, decision: 'rehabilitate' },
      { id: 'd', lengthM: 150, decision: 'replace' },
    ])
    expect(summary.totalLengthM).toBe(500)
    expect(summary.replaceLengthM).toBe(350)
    expect(summary.keepLengthM).toBe(100)
    expect(summary.rehabilitateLengthM).toBe(50)
    expect(summary.counts.replace).toBe(2)
  })
})
