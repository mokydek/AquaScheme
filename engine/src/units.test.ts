import { describe, expect, it } from 'vitest'
import { compareDesignations } from './units'
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
