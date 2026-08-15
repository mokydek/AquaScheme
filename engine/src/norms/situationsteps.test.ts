import { describe, expect, it } from 'vitest'
import { buildSituationSteps } from './situationsteps'
import type { TracedNetwork } from '../trace'

const NETWORK: TracedNetwork = {
  nodes: [
    { id: 'A', kind: 'junction', x: 0, y: 0, groundElevation: 100 },
    { id: 'B', kind: 'source', x: 100, y: 0, groundElevation: 99 },
  ],
  pipes: [{ id: 'P1', kind: 'main', fromNode: 'A', toNode: 'B', lengthM: 100 }],
  totalLengthM: 100,
}

describe('buildSituationSteps', () => {
  it('orders the stages like a drafter and carries the data provenance', () => {
    const steps = buildSituationSteps({
      network: NETWORK,
      pipeDiameterMm: new Map([['P1', 2000]]),
      buildingsCount: 4,
      corridorRings: 1,
      outletFlowLps: 42.5,
    })
    expect(steps.map((s) => s.id)).toEqual(['context', 'corridor', 'route', 'diameters', 'outlet', 'legend'])
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6])
    expect(steps.every((s) => s.present)).toBe(true)
    expect(steps[2].stats).toEqual({ pipes: 1, lengthM: 100 })
    expect(steps[3].sourceKey).toBe('diametersCalc')
    expect(steps[3].stats.list).toBe('Ø2000')
    expect(steps[4].stats.flowLps).toBe('42.5')
  })

  it('marks absent layers honestly instead of dropping them', () => {
    const steps = buildSituationSteps({
      network: NETWORK,
      pipeDiameterMm: new Map(),
      buildingsCount: 0,
      corridorRings: 0,
    })
    const corridor = steps.find((s) => s.id === 'corridor')
    expect(corridor?.present).toBe(false)
    expect(corridor?.sourceKey).toBe('corridorEmpty')
    expect(steps.find((s) => s.id === 'context')?.sourceKey).toBe('contextEmpty')
  })

  it('reports adopted-from-plan diameters as their own provenance', () => {
    const steps = buildSituationSteps({
      network: NETWORK,
      pipeDiameterMm: new Map([['P1', 2000]]),
      buildingsCount: 1,
      diametersAdoptedFromPlan: true,
    })
    expect(steps.find((s) => s.id === 'diameters')?.sourceKey).toBe('diametersPlan')
  })

})
