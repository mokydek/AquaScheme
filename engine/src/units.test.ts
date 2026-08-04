import { describe, expect, it } from 'vitest'
import { compareDesignations, maxOf, minOf } from './units'
import {
  cubicMetersPerDayToLitersPerSecond,
  cubicMetersPerHourToLitersPerSecond,
  litersPerSecondToCubicMetersPerHour,
} from './units'

describe('flow unit conversions', () => {
  it('converts 1 L/s to 3.6 m3/h', () => {
    expect(litersPerSecondToCubicMetersPerHour(1)).toBeCloseTo(3.6, 12)
  })

  it('round trips L/s through m3/h without loss', () => {
    const q = 12.5
    expect(cubicMetersPerHourToLitersPerSecond(litersPerSecondToCubicMetersPerHour(q))).toBeCloseTo(q, 12)
  })

  it('converts 86.4 m3/day to 1 L/s', () => {
    expect(cubicMetersPerDayToLitersPerSecond(86.4)).toBeCloseTo(1, 12)
  })
})

describe('сравнение обозначений с номерами', () => {
  it('ВК-2 идёт раньше ВК-10', () => {
    // Обычное строковое сравнение ставит «ВК-10» между «ВК-1» и «ВК-2»: в
    // ведомости это читается как ошибка нумерации.
    const labels = ['ВК-1', 'ВК-11', 'ВК-2', 'ВК-10', 'ВК-9']
    expect([...labels].sort(compareDesignations)).toEqual(['ВК-1', 'ВК-2', 'ВК-9', 'ВК-10', 'ВК-11'])
  })

  it('работает и для латиницы, и для смешанных обозначений', () => {
    expect(['MH-10', 'MH-2'].sort(compareDesignations)).toEqual(['MH-2', 'MH-10'])
    expect(['К2-3', 'К2-12', 'К1-5'].sort(compareDesignations)).toEqual(['К1-5', 'К2-3', 'К2-12'])
  })

  it('обозначения без номеров сравниваются как обычно', () => {
    expect(['Вып.', 'ВК-1'].sort(compareDesignations)).toEqual(['ВК-1', 'Вып.'])
    expect(compareDesignations('одинаково', 'одинаково')).toBe(0)
  })

  it('многозначные номера не путаются', () => {
    const many = Array.from({ length: 25 }, (_, index) => `ВК-${index + 1}`)
    const shuffled = [...many].sort((a, b) => a.localeCompare(b))
    expect(shuffled).not.toEqual(many)
    expect([...shuffled].sort(compareDesignations)).toEqual(many)
  })
})

describe('наименьшее и наибольшее без раскрытия аргументов', () => {
  it('совпадают с Math.min и Math.max на обычных данных', () => {
    const values = [3, -1, 7.5, 0, 7.4999]
    expect(minOf(values)).toBe(Math.min(...values))
    expect(maxOf(values)).toBe(Math.max(...values))
  })

  it('выдерживают массив, на котором раскрытие аргументов ненадёжно', () => {
    // Предел раскрытия зависит от размера стека: в браузере он меньше, чем в
    // рабочем потоке Node, поэтому утверждать конкретное число здесь нельзя —
    // проверяется только то, что счёт по массиву от размера не зависит.
    const many = Array.from({ length: 300_000 }, (_, index) => index)
    expect(maxOf(many)).toBe(299_999)
    expect(minOf(many)).toBe(0)
  })

  it('пустой массив даёт null, а не бесконечность', () => {
    // Бесконечность, попав в габарит или отметку, выглядит как значение.
    expect(minOf([])).toBeNull()
    expect(maxOf([])).toBeNull()
    expect(Math.min()).toBe(Number.POSITIVE_INFINITY)
  })

  it('нечисловые значения пропускаются, а не отравляют результат', () => {
    // Math.max с NaN в массиве возвращает NaN: одна испорченная отметка
    // обнуляет весь габарит, и дальше по расчёту идёт пустое число.
    const dirty = [1, Number.NaN, 5, Number.POSITIVE_INFINITY, 2]
    expect(Number.isNaN(Math.max(...dirty))).toBe(true)
    expect(minOf(dirty)).toBe(1)
    expect(maxOf(dirty)).toBe(5)
  })
})
