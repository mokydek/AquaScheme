import { describe, expect, it } from 'vitest'
import { computeConsumption } from './consumption'
import { computeNetworkDemand } from './demand'

const BUILDINGS = [
  { id: 'b1', residents: 500 },
  { id: 'b2', residents: 300 },
]

describe('computeConsumption', () => {
  it('drainage flow equals the domestic water design flow (no irrigation, no fire)', () => {
    const c = computeConsumption(BUILDINGS)
    const water = computeNetworkDemand(BUILDINGS)
    expect(c.drainageFlowLps).toBe(water.designFlowLps)
    expect(c.drainageDailyM3).toBe(water.maxDailyM3)
    // Fire flow is a water reserve, not a discharge — excluded from drainage.
    expect(c.drainageFlowLps).toBeLessThan(water.designFlowWithFireLps)
  })

  it('is the single source of truth: same buildings give the same water demand', () => {
    const c = computeConsumption(BUILDINGS)
    expect(c.water.totalResidents).toBe(800)
    expect(c.water.designFlowLps).toBeGreaterThan(0)
  })

  it('is zero for an empty district', () => {
    const c = computeConsumption([])
    expect(c.drainageFlowLps).toBe(0)
    expect(c.drainageDailyM3).toBe(0)
  })
})
