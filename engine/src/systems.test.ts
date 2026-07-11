import { describe, expect, it } from 'vitest'
import { createGravitySolver, SOLVER_AVAILABILITY } from './systems'
import { waterPressureSolver } from './hydraulics'

describe('solver architecture (requirements update 1)', () => {
  it('declares availability per system', () => {
    expect(SOLVER_AVAILABILITY.water).toBe('ready')
    expect(SOLVER_AVAILABILITY.sewer).toBe('planned')
    expect(SOLVER_AVAILABILITY.storm).toBe('planned')
  })

  it('gravity solvers are declared but not implemented yet', async () => {
    await expect(createGravitySolver('sewer').solve(undefined as never)).rejects.toThrow(/notImplemented.*K1/)
    await expect(createGravitySolver('storm').solve(undefined as never)).rejects.toThrow(/notImplemented.*K2/)
  })

  it('the water solver wraps EPANET and returns a pressure result', async () => {
    const result = await waterPressureSolver.solve({
      source: { id: 'SRC', totalHeadM: 100 },
      junctions: [{ id: 'J1', elevationM: 50, demandLps: 10 }],
      pipes: [
        {
          id: 'P1',
          fromNode: 'SRC',
          toNode: 'J1',
          lengthM: 500,
          internalDiameterMm: 100,
          roughnessMm: 0.05,
        },
      ],
    })
    expect(result.kind).toBe('pressure')
    expect(result.systemType).toBe('water')
    const j1 = result.nodes.find((n) => n.id === 'J1')
    expect(j1?.pressureM).toBeCloseTo(41.8, 0)
    expect(result.pipes[0].velocityMs).toBeCloseTo(1.273, 2)
  })
})
