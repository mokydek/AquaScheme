import { describe, expect, it } from 'vitest'
import { bindStormDemoBuildingIds, buildStormDemo, STORM_DEMO_TOTAL_M } from './demoStorm'
import { solveGravityNetwork } from './norms/gravity'

describe('buildStormDemo', () => {
  it('is deterministic, synthetic and preserves pipe alignments', () => {
    const first = buildStormDemo()
    const second = buildStormDemo()
    expect(second).toEqual(first)
    expect(first.sources.map((source) => source.label)).toEqual(['Источник A', 'Источник B', 'Источник C'])
    expect(first.outletFlowLps).toBe(39)
    expect(first.network.pipes.every((pipe) => (pipe.alignment?.length ?? 0) >= 2)).toBe(true)
    expect(first.network.pipes.every((pipe) => pipe.dataSource === 'synthetic-demo')).toBe(true)
    expect(first.network.nodes.filter((node) => node.kind === 'building').every((node) => node.buildingId === undefined)).toBe(true)
    const ys = first.network.nodes.filter((node) => node.kind !== 'building').map((node) => node.y)
    expect(Math.max(...ys)).toBe(STORM_DEMO_TOTAL_M)
    const elevations = first.network.nodes.map((node) => node.groundElevation)
    expect(Math.max(...elevations)).toBe(100)
    expect(Math.min(...elevations)).toBeCloseTo(95.2, 2)
  })

  it('binds persisted building UUIDs by coordinates before network storage', () => {
    const demo = buildStormDemo()
    const buildingNodes = demo.network.nodes.filter((node) => node.kind === 'building')
    const persisted = buildingNodes.map((node, index) => ({
      id: `${index + 1}`.padStart(8, '0') + '-1111-4111-8111-111111111111',
      x: node.x,
      y: node.y,
    }))
    const bound = bindStormDemoBuildingIds(demo.network, persisted)
    expect(bound.nodes.filter((node) => node.buildingId).map((node) => node.buildingId))
      .toEqual(persisted.map((row) => row.id))
    expect(bound.nodes.filter((node) => node.buildingId).every((node) => node.kind === 'junction')).toBe(true)
    expect(demo.network.nodes.filter((node) => node.kind === 'building').every((node) => node.buildingId === undefined)).toBe(true)
  })

  it('passes the generic gravity calculation without target-result fitting', () => {
    const demo = buildStormDemo()
    const flowByLabel = new Map(demo.sources.map((source) => [source.label, source.flowLps]))
    const flows = new Map(demo.network.nodes
      .filter((node) => node.kind === 'building')
      .map((node, index) => [node.id, flowByLabel.get(demo.sources[index].label) ?? 0]))
    const result = solveGravityNetwork({
      network: demo.network,
      buildingFlowLps: flows,
      system: 'storm',
      freezingDepthM: 1.8,
      strategy: 'minBurial',
    })
    expect(result.outletFlowLps).toBe(39)
    expect(result.profile).not.toBeNull()
    expect(result.pipes.every((pipe) => Number.isFinite(pipe.diameterMm) && pipe.diameterMm > 0)).toBe(true)
  })
})
