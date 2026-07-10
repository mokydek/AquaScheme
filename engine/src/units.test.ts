import { describe, expect, it } from 'vitest'
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
