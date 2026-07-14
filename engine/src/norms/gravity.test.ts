import { describe, expect, it } from 'vitest'
import {
  accumulateGravityFlows,
  circularSection,
  designGravitySegment,
  fillForFlow,
  gravityFlowM3s,
  manningVelocity,
  solveGravityNetwork,
} from './gravity'
import type { TracedNetwork } from '../trace'

// Reference values are computed by hand (Chezy-Manning, n = 0.014) as required
// by the engineering guardrails.

describe('circular partial-flow geometry', () => {
  it('full pipe matches A = πD²/4 and R = D/4', () => {
    const D = 0.3
    const s = circularSection(D, 1)
    expect(s.areaM2).toBeCloseTo((Math.PI * D * D) / 4, 6)
    expect(s.hydraulicRadiusM).toBeCloseTo(D / 4, 6)
  })

  it('half-full pipe: area is half of full, R equals full pipe R', () => {
    const D = 0.3
    const half = circularSection(D, 0.5)
    const full = circularSection(D, 1)
    expect(half.areaM2).toBeCloseTo(full.areaM2 / 2, 6)
    // A known property: R at half full equals R at full (both D/4).
    expect(half.hydraulicRadiusM).toBeCloseTo(D / 4, 6)
    expect(half.topWidthM).toBeCloseTo(D, 6)
  })
})

describe('Chezy-Manning reference (hand calc, n = 0.014)', () => {
  it('D=300 mm, i=0.005, full pipe: v≈0.898 m/s, Q≈63.5 L/s', () => {
    const D = 0.3
    const n = 0.014
    const i = 0.005
    const R = D / 4 // 0.075
    // v = (1/0.014) * 0.075^(2/3) * sqrt(0.005)
    const v = manningVelocity(R, i, n)
    expect(v).toBeCloseTo(0.898, 2)
    const Q = gravityFlowM3s(D, i, 1, n)
    expect(Q * 1000).toBeCloseTo(63.5, 0)
  })

  it('half-full carries half the full-pipe flow at the same velocity', () => {
    const D = 0.3
    const n = 0.014
    const i = 0.005
    const full = gravityFlowM3s(D, i, 1, n)
    const half = gravityFlowM3s(D, i, 0.5, n)
    expect(half).toBeCloseTo(full / 2, 5)
  })

  it('fillForFlow inverts the flow relation', () => {
    const D = 0.3
    const n = 0.014
    const i = 0.005
    const Q = gravityFlowM3s(D, i, 0.6, n)
    const fill = fillForFlow(Q, D, i, n)
    expect(fill).not.toBeNull()
    expect(fill as number).toBeCloseTo(0.6, 2)
  })

  it('returns null when flow exceeds capacity at the fill cap', () => {
    expect(fillForFlow(10, 0.2, 0.007, 0.014)).toBeNull()
  })
})

describe('gravity segment design (СН РК 4.01-03-2013*)', () => {
  it('street sewer uses at least the 200 mm minimum diameter (5.9.1)', () => {
    const d = designGravitySegment(5, { system: 'sewer', level: 'street' })
    expect(d.diameterMm).toBeGreaterThanOrEqual(200)
    expect(d.fillRatio).toBeLessThanOrEqual(0.8)
    expect(d.velocityMs).toBeGreaterThanOrEqual(0.7) // Таблица 5.19
  })

  it('storm street network uses at least 250 mm (5.9.1)', () => {
    const d = designGravitySegment(20, { system: 'storm', level: 'street' })
    expect(d.diameterMm).toBeGreaterThanOrEqual(250)
    expect(d.fillRatio).toBeLessThanOrEqual(1)
  })

  it('keeps filling at or below 0.8 for a large sewer flow (5.10.7)', () => {
    const d = designGravitySegment(120, { system: 'sewer', level: 'street' })
    expect(d.fillRatio).toBeLessThanOrEqual(0.8 + 1e-6)
    expect(d.velocityMs).toBeGreaterThanOrEqual(0.7)
  })

  it('a steep ground slope may exceed the max velocity and is flagged (5.10.3)', () => {
    const d = designGravitySegment(30, { system: 'sewer', level: 'street', groundSlope: 0.08, material: 'nonmetal' })
    if (d.velocityMs > 4) {
      expect(d.issues.some((i) => i.code === 'overMaxVelocity')).toBe(true)
    }
  })
})

describe('network flow accumulation', () => {
  const network: TracedNetwork = {
    nodes: [
      { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
      { id: 'J1', kind: 'junction', x: 10, y: 0, groundElevation: 101 },
      { id: 'B1', kind: 'building', x: 20, y: 0, groundElevation: 102, buildingId: 'b1' },
      { id: 'B2', kind: 'building', x: 10, y: 10, groundElevation: 103, buildingId: 'b2' },
    ],
    pipes: [
      { id: 'p_sj', kind: 'main', fromNode: 'S', toNode: 'J1', lengthM: 10 },
      { id: 'p_jb1', kind: 'service', fromNode: 'J1', toNode: 'B1', lengthM: 10 },
      { id: 'p_jb2', kind: 'service', fromNode: 'J1', toNode: 'B2', lengthM: 10 },
    ],
    totalLengthM: 30,
  }

  it('sums building flows toward the outlet along the tree', () => {
    const flows = accumulateGravityFlows(network, new Map([['b1', 3], ['b2', 2]]))
    // The trunk S-J1 carries both buildings; each service carries its own.
    expect(flows.get('p_sj')).toBeCloseTo(5, 6)
    expect(flows.get('p_jb1')).toBeCloseTo(3, 6)
    expect(flows.get('p_jb2')).toBeCloseTo(2, 6)
  })

  it('solveGravityNetwork designs every pipe and reports the outlet flow', () => {
    const result = solveGravityNetwork({
      network,
      buildingFlowLps: new Map([['b1', 3], ['b2', 2]]),
      system: 'sewer',
    })
    expect(result.pipes).toHaveLength(3)
    expect(result.outletFlowLps).toBeCloseTo(5, 6)
    const trunk = result.pipes.find((p) => p.id === 'p_sj')
    expect(trunk?.diameterMm).toBeGreaterThanOrEqual(200)
  })
})
