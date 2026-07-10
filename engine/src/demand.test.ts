import { describe, expect, it } from 'vitest'
import { betaMaxForResidents, computeNetworkDemand } from './demand'
import { createDemoDataset } from './demo'
import { NORMATIVE_DEFAULTS } from './norms'

describe('betaMaxForResidents (SNiP 2.04.02 table 2)', () => {
  it('returns table values exactly', () => {
    expect(betaMaxForResidents(100)).toBe(4.5)
    expect(betaMaxForResidents(1000)).toBe(2)
    expect(betaMaxForResidents(20000)).toBe(1.2)
  })

  it('interpolates between rows', () => {
    // 3250 residents: halfway between 2500 (1.6) and 4000 (1.5)
    expect(betaMaxForResidents(3250)).toBeCloseTo(1.55, 10)
  })

  it('clamps outside the table', () => {
    expect(betaMaxForResidents(10)).toBe(4.5)
    expect(betaMaxForResidents(5_000_000)).toBe(1)
  })
})

describe('computeNetworkDemand', () => {
  it('matches a hand calculation for a single building of 100 residents', () => {
    // q = 200 L/day: Q_day.avg = 20 m3/day, Q_day.max = 24 m3/day,
    // K_hour.max = 1.3 * 4.5 = 5.85, Q_hour.max = 24 * 5.85 / 24 = 5.85 m3/h,
    // q_design = 5.85 / 3.6 = 1.625 L/s.
    const demand = computeNetworkDemand([{ residents: 100 }])
    expect(demand.avgDailyM3).toBeCloseTo(20, 10)
    expect(demand.maxDailyM3).toBeCloseTo(24, 10)
    expect(demand.kHourMax).toBeCloseTo(5.85, 10)
    expect(demand.maxHourlyM3h).toBeCloseTo(5.85, 10)
    expect(demand.designFlowLps).toBeCloseTo(1.625, 10)
    expect(demand.designFlowWithFireLps).toBeCloseTo(1.625 + NORMATIVE_DEFAULTS.fireFlowLps, 10)
  })

  it('distributes the design flow proportionally to residents', () => {
    const demand = computeNetworkDemand([
      { id: 'a', residents: 300 },
      { id: 'b', residents: 100 },
    ])
    const [a, b] = demand.buildings
    expect(a.designFlowLps / b.designFlowLps).toBeCloseTo(3, 10)
    const sum = demand.buildings.reduce((s, x) => s + x.designFlowLps, 0)
    expect(sum).toBeCloseTo(demand.designFlowLps, 10)
  })

  it('computes the demo district demand', () => {
    const demo = createDemoDataset()
    const demand = computeNetworkDemand(
      demo.buildings.map((b) => ({ residents: b.residents })),
    )
    // 40 buildings, floors pattern sums to 124 storeys, 16 residents each.
    expect(demand.totalResidents).toBe(1984)
    expect(demand.avgDailyM3).toBeCloseTo(396.8, 6)
    expect(demand.maxDailyM3).toBeCloseTo(476.16, 6)
    expect(demand.betaMax).toBeCloseTo(1.7032, 4)
    expect(demand.designFlowLps).toBeGreaterThan(10)
    expect(demand.designFlowLps).toBeLessThan(15)
  })

  it('handles an empty list without NaN', () => {
    const demand = computeNetworkDemand([])
    expect(demand.totalResidents).toBe(0)
    expect(demand.avgDailyM3).toBe(0)
    expect(demand.maxHourlyM3h).toBe(0)
    expect(demand.designFlowLps).toBe(0)
    expect(Number.isFinite(demand.kHourMax)).toBe(true)
  })
})
