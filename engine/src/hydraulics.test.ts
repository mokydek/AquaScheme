import { describe, expect, it, vi } from 'vitest'
import { solveHydraulics } from './hydraulics'

/**
 * Reference tests: small networks calculated BY HAND with the
 * Darcy-Weisbach equation and the Swamee-Jain friction factor
 * (the approximation EPANET itself uses), kinematic viscosity
 * 1.0219e-6 m2/s (EPANET default of 1.1e-5 ft2/s).
 *
 * Hand calculation for a 100 mm pipe at 10 L/s, roughness 0.05 mm:
 *   v = Q/A = 0.01 / 0.0078540 = 1.2732 m/s
 *   Re = v*D/nu = 124 563
 *   f (Swamee-Jain) = 0.25 / log10(eps/3.7D + 5.74/Re^0.9)^2 = 0.01988
 *   hf = f * (L/D) * v^2/2g = 0.01988 * (500/0.1) * 0.08260 = 8.21 m
 *
 * TODO(Shevelev): add a parallel check against the Shevelev tables once
 * the exact 1000i table values are provided; the assertions below verify
 * the same physics through a fully reproducible hand calculation.
 */

describe('solveHydraulics reference cases', () => {
  it('matches the hand calculation for a single pipe', async () => {
    const result = await solveHydraulics({
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

    const pipe = result.pipes.get('P1')!
    const node = result.nodes.get('J1')!
    expect(pipe.flowLps).toBeCloseTo(10, 3)
    expect(pipe.velocityMs).toBeCloseTo(1.273, 2)
    expect(pipe.headlossM).toBeCloseTo(8.21, 1)
    expect(node.pressureM).toBeCloseTo(100 - 50 - 8.21, 1)
  })

  it('matches the hand calculation for two pipes in series', async () => {
    // P1: 300 m, D150, Q=15 L/s -> v=0.8488, f=0.01906, hf=1.400 m
    // P2: 400 m, D100, Q=10 L/s -> v=1.2732, f=0.01988, hf=6.57 m
    const result = await solveHydraulics({
      source: { id: 'SRC', totalHeadM: 100 },
      junctions: [
        { id: 'J1', elevationM: 60, demandLps: 5 },
        { id: 'J2', elevationM: 55, demandLps: 10 },
      ],
      pipes: [
        { id: 'P1', fromNode: 'SRC', toNode: 'J1', lengthM: 300, internalDiameterMm: 150, roughnessMm: 0.05 },
        { id: 'P2', fromNode: 'J1', toNode: 'J2', lengthM: 400, internalDiameterMm: 100, roughnessMm: 0.05 },
      ],
    })

    expect(result.pipes.get('P1')!.flowLps).toBeCloseTo(15, 3)
    expect(result.pipes.get('P2')!.flowLps).toBeCloseTo(10, 3)
    expect(result.pipes.get('P1')!.velocityMs).toBeCloseTo(0.849, 2)
    expect(result.pipes.get('P1')!.headlossM).toBeCloseTo(1.4, 1)
    expect(result.pipes.get('P2')!.headlossM).toBeCloseTo(6.57, 1)
    expect(result.nodes.get('J1')!.pressureM).toBeCloseTo(38.6, 1)
    expect(result.nodes.get('J2')!.pressureM).toBeCloseTo(37.03, 1)
  })

  it('splits flow equally between two identical parallel pipes', async () => {
    const result = await solveHydraulics({
      source: { id: 'SRC', totalHeadM: 100 },
      junctions: [{ id: 'J1', elevationM: 50, demandLps: 20 }],
      pipes: [
        { id: 'A', fromNode: 'SRC', toNode: 'J1', lengthM: 400, internalDiameterMm: 100, roughnessMm: 0.05 },
        { id: 'B', fromNode: 'SRC', toNode: 'J1', lengthM: 400, internalDiameterMm: 100, roughnessMm: 0.05 },
      ],
    })

    const a = result.pipes.get('A')!
    const b = result.pipes.get('B')!
    expect(Math.abs(a.flowLps)).toBeCloseTo(10, 2)
    expect(Math.abs(b.flowLps)).toBeCloseTo(10, 2)
    expect(a.headlossM).toBeCloseTo(b.headlossM, 3)
  })

  it('captures EPANET negative-pressure warning as data instead of flooding the console', async () => {
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const result = await solveHydraulics({
        source: { id: 'SRC', totalHeadM: 90 },
        junctions: [{ id: 'HIGH', elevationM: 100, demandLps: 1 }],
        pipes: [
          { id: 'P1', fromNode: 'SRC', toNode: 'HIGH', lengthM: 100, internalDiameterMm: 110, roughnessMm: 0.05 },
        ],
      })

      expect(result.nodes.get('HIGH')!.pressureM).toBeLessThan(0)
      expect(result.warnings).toEqual([
        expect.objectContaining({ code: 6, message: expect.stringMatching(/negative pressures/i) }),
      ])
      expect(consoleWarning).not.toHaveBeenCalled()
    } finally {
      consoleWarning.mockRestore()
    }
  })
})
