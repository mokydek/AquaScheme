import { describe, expect, it } from 'vitest'
import { solvePressureMain } from './pressure'

describe('solvePressureMain', () => {
  it('keeps pressure hydraulics separate and accounts for parallel barrels', () => {
    const single = solvePressureMain({
      pipes: [{ id: 'P1', lengthM: 1000, diameterMm: 800, flowLps: 600 }],
      inletElevationM: 340,
      outletElevationM: 345,
      availablePumpHeadM: 20,
    })
    const parallel = solvePressureMain({
      pipes: [{ id: 'P1', lengthM: 1000, diameterMm: 800, flowLps: 600, parallelCount: 2 }],
      inletElevationM: 340,
      outletElevationM: 345,
      availablePumpHeadM: 20,
    })
    expect(single.kind).toBe('pressure')
    expect(single.status).toBe('calculated')
    expect(parallel.pipes[0].velocityMs).toBeLessThan(single.pipes[0].velocityMs)
    expect(parallel.frictionHeadM).toBeLessThan(single.frictionHeadM)
  })

  it('blocks a final pressure result when pump duty is absent', () => {
    const result = solvePressureMain({
      pipes: [{ id: 'P1', lengthM: 50, diameterMm: 500, flowLps: 100 }],
      inletElevationM: 340,
      outletElevationM: 341,
    })
    expect(result.status).toBe('blocked')
    expect(result.blockers.join(' ')).toContain('насоса')
  })
})
