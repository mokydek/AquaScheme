import { describe, expect, it } from 'vitest'
import { buildStormDemo, STORM_DEMO_TOTAL_M } from './demoStorm'
import { solveGravityNetwork } from './norms/gravity'

describe('buildStormDemo', () => {
  it('is deterministic and shaped like the benchmark trunk', () => {
    const a = buildStormDemo()
    const b = buildStormDemo()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.sources.map((s) => s.label)).toEqual(['ОС-1', 'ОС-2', 'ОС-3', 'ОС-4'])
    expect(a.outletFlowLps).toBe(611 + 531 + 1155 + 200)
    expect(a.network.nodes.some((n) => n.kind === 'source')).toBe(true)
    // Chainage of the trunk reaches the full picket length.
    const ys = a.network.nodes.filter((n) => n.kind !== 'building').map((n) => n.y)
    expect(Math.max(...ys)).toBeCloseTo(STORM_DEMO_TOTAL_M, 2)
    // Neutral datum: elevations fall 7.9 m from 100.0, no real site marks.
    const elevations = a.network.nodes.map((n) => n.groundElevation)
    expect(Math.max(...elevations)).toBe(100)
    expect(Math.min(...elevations)).toBeCloseTo(92.1, 2)
  })

  it('solves to a Ф2000 trunk at the outlet with the min-burial strategy', () => {
    const demo = buildStormDemo()
    const flows = new Map(demo.network.nodes
      .filter((n) => n.kind === 'building')
      .map((n) => [n.id, demo.sources.find((s) => s.label === `ОС-${n.id.slice(2)}`)?.flowLps ?? 0]))
    const result = solveGravityNetwork({
      network: demo.network,
      buildingFlowLps: flows,
      system: 'storm',
      freezingDepthM: 2.2,
      strategy: 'minBurial',
    })
    expect(result.outletFlowLps).toBe(2497)
    // The last trunk segment carries the full flow at Ф2000 like the etalon.
    const lastMain = result.pipes
      .filter((p) => p.id.startsWith('P'))
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
      .at(-1)
    expect(lastMain?.diameterMm).toBe(2000)
    expect(result.profile).not.toBeNull()
  }, 60000)
})
