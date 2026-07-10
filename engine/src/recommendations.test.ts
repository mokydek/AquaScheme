import { describe, expect, it } from 'vitest'
import { buildRecommendations } from './recommendations'
import type { SizingResult } from './sizing'

function baseResult(overrides: Partial<SizingResult>): SizingResult {
  return {
    pipes: [],
    nodes: [],
    iterations: 1,
    solves: 1,
    converged: true,
    issues: [],
    sourceHeadM: 140,
    totalDemandLps: 12,
    ...overrides,
  }
}

describe('buildRecommendations', () => {
  it('returns nothing when there are no issues', () => {
    expect(buildRecommendations(baseResult({}))).toHaveLength(0)
  })

  it('advises a booster or zoning when the source head cannot reach the node (static deficit)', () => {
    const result = baseResult({
      sourceHeadM: 120,
      converged: false,
      nodes: [
        {
          id: 'B1',
          kind: 'building',
          buildingId: 'x',
          elevationM: 118,
          headM: 119,
          pressureM: 1,
          requiredPressureM: 10,
          ok: false,
        },
      ],
      issues: [{ kind: 'lowPressure', targetId: 'B1', value: 1, limit: 10 }],
    })
    const recs = buildRecommendations(result)
    expect(recs).toHaveLength(1)
    expect(recs[0].actions[0]).toBe('boosterStation')
    expect(recs[0].severity).toBe('high')
    expect(recs[0].targets).toEqual(['B1'])
  })

  it('advises a larger diameter or loop when losses are the cause (dynamic deficit)', () => {
    const result = baseResult({
      sourceHeadM: 140,
      converged: false,
      nodes: [
        {
          id: 'B1',
          kind: 'building',
          buildingId: 'x',
          elevationM: 100,
          headM: 108,
          pressureM: 8,
          requiredPressureM: 10,
          ok: false,
        },
      ],
      issues: [{ kind: 'lowPressure', targetId: 'B1', value: 8, limit: 10 }],
    })
    const recs = buildRecommendations(result)
    expect(recs[0].actions[0]).toBe('increaseDiameter')
  })

  it('reports high velocity, high pressure and low velocity issues', () => {
    const result = baseResult({
      converged: false,
      issues: [
        { kind: 'highVelocity', targetId: 'P3', value: 2.7, limit: 2.5 },
        { kind: 'highPressure', targetId: 'B9', value: 64, limit: 60 },
        { kind: 'lowVelocity', targetId: 'P8', value: 0.4, limit: 0.7 },
      ],
    })
    const recs = buildRecommendations(result)
    const byKind = new Map(recs.map((r) => [r.kind, r]))
    expect(byKind.get('highVelocity')?.actions).toEqual(['increaseDiameter'])
    expect(byKind.get('highPressure')?.actions[0]).toBe('pressureRegulator')
    expect(byKind.get('highPressure')?.severity).toBe('medium')
    expect(byKind.get('lowVelocity')?.actions).toEqual(['reduceDiameter'])
  })
})
