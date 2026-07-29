import { describe, expect, it } from 'vitest'
import type { TracedNetwork } from '../trace'
import { computeGravityBranchProfiles } from './gravity-branches'
import { buildSewerSchedule, solveGravityNetwork } from './gravity'

function branchedNetwork(): TracedNetwork {
  return {
    nodes: [
      { id: 'S', kind: 'source', label: 'Выпуск', x: 0, y: 0, groundElevation: 100 },
      { id: 'J', kind: 'manhole', label: 'К-1', x: 100, y: 0, groundElevation: 100.2 },
      { id: 'A', kind: 'building', label: 'Главная голова', x: 400, y: 0, groundElevation: 100.5, buildingId: 'a' },
      { id: 'B', kind: 'manhole', label: 'К-2', x: 100, y: 100, groundElevation: 100.4 },
      { id: 'C', kind: 'building', label: 'Ветвь C', x: 100, y: 200, groundElevation: 100.7, buildingId: 'c' },
      { id: 'D', kind: 'building', label: 'Ветвь D', x: 180, y: 100, groundElevation: 100.6, buildingId: 'd' },
    ],
    pipes: [
      { id: 'p-sj', kind: 'gravity_collector', fromNode: 'S', toNode: 'J', lengthM: 100, alignment: [{ x: 0, y: 0 }, { x: 100, y: 0 }], dataSource: 'DWG:K2' },
      { id: 'p-ja', kind: 'gravity_collector', fromNode: 'J', toNode: 'A', lengthM: 300, alignment: [{ x: 100, y: 0 }, { x: 250, y: 0 }, { x: 400, y: 0 }], dataSource: 'DWG:K2' },
      { id: 'p-jb', kind: 'gravity_collector', fromNode: 'J', toNode: 'B', lengthM: 100, alignment: [{ x: 100, y: 0 }, { x: 100, y: 100 }], dataSource: 'DWG:K2' },
      { id: 'p-bc', kind: 'gravity_collector', fromNode: 'B', toNode: 'C', lengthM: 100, alignment: [{ x: 100, y: 100 }, { x: 100, y: 200 }], dataSource: 'DWG:K2' },
      { id: 'p-bd', kind: 'gravity_collector', fromNode: 'B', toNode: 'D', lengthM: 80, alignment: [{ x: 100, y: 100 }, { x: 180, y: 100 }], dataSource: 'DWG:K2' },
    ],
    totalLengthM: 680,
  }
}

function solve(network: TracedNetwork) {
  return solveGravityNetwork({
    network,
    buildingFlowLps: new Map([['a', 8], ['c', 4], ['d', 3]]),
    system: 'storm',
    freezingDepthM: 1.8,
    allowedDiametersMm: [300, 400, 500, 600, 800, 1000, 1200],
  })
}

describe('computeGravityBranchProfiles', () => {
  it('covers every off-main tree pipe exactly once using calculated levels and alignments', () => {
    const network = branchedNetwork()
    const result = solve(network)
    expect(result.profile?.pipeIds).toEqual(['p-ja', 'p-sj'])

    const branches = computeGravityBranchProfiles({ network, result, freezingDepthM: 1.8 })

    expect(branches.blockers).toEqual([])
    expect(branches.profiles).toHaveLength(2)
    expect(branches.profiles.flatMap((branch) => branch.profile.pipeIds).sort())
      .toEqual(['p-bc', 'p-bd', 'p-jb'])
    expect(new Set(branches.coveredPipeIds)).toEqual(new Set(network.pipes.map((pipe) => pipe.id)))
    expect(branches.unprofiledPipeIds).toEqual([])

    const longBranch = branches.profiles.find((branch) => branch.profile.pipeIds.includes('p-bc'))!
    expect(longBranch.profile.pipeIds).toEqual(['p-bc', 'p-jb'])
    expect(longBranch.profile.stations.map((station) => station.nodeId)).toEqual(['C', 'B', 'J'])
    expect(longBranch.profile.stations.map((station) => station.chainageM)).toEqual([0, 100, 200])
    expect(longBranch.profile.stations.map((station) => station.groundElevationM)).toEqual([100.7, 100.4, 100.2])
    expect(longBranch.profile.stations.every((station) => station.diameterMm > 0)).toBe(true)
    expect(longBranch.profile.stations.every((station) => Number.isFinite(station.invertElevationM))).toBe(true)
    expect(longBranch.source).toBe('DWG:K2')
  })

  it('adds every branch manhole to the sewer schedule once and deduplicates shared junctions', () => {
    const network = branchedNetwork()
    const result = solve(network)
    const branches = computeGravityBranchProfiles({ network, result, freezingDepthM: 1.8 })

    const schedule = buildSewerSchedule(result, {
      branchProfiles: branches.profiles.map((branch) => branch.profile),
    })

    expect(schedule.manholes).toHaveLength(network.nodes.length)
    expect(schedule.manholes.map((manhole) => manhole.nodeId).sort()).toEqual(
      network.nodes.map((node) => node.id).sort(),
    )
    expect(new Set(schedule.manholes.map((manhole) => manhole.nodeId)).size).toBe(network.nodes.length)
    expect(schedule.manholes.filter((manhole) => manhole.nodeId === 'J')).toHaveLength(1)
    expect(schedule.manholes.filter((manhole) => manhole.nodeId === 'B')).toHaveLength(1)
    expect(schedule.manholes.find((manhole) => manhole.nodeId === 'S')?.label).toBe('Вып.')
    expect(new Set(schedule.manholes.map((manhole) => manhole.label)).size).toBe(network.nodes.length)
  })

  it('does not fabricate a profile when a branch has no factual alignment', () => {
    const network = branchedNetwork()
    network.pipes = network.pipes.map((pipe) => pipe.id === 'p-bd' ? { ...pipe, alignment: undefined } : pipe)
    const result = solve(network)

    const branches = computeGravityBranchProfiles({ network, result, freezingDepthM: 1.8 })

    expect(branches.profiles.flatMap((branch) => branch.profile.pipeIds)).not.toContain('p-bd')
    expect(branches.unprofiledPipeIds).toContain('p-bd')
    expect(branches.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BRANCH_ALIGNMENT_MISSING', pipeIds: ['p-bd'] }),
    ]))
  })

  it('accepts a factual branch alignment stored in reverse node orientation', () => {
    const network = branchedNetwork()
    network.pipes = network.pipes.map((pipe) => pipe.id === 'p-bd'
      ? { ...pipe, alignment: [...pipe.alignment!].reverse() }
      : pipe)
    const result = solve(network)

    const branches = computeGravityBranchProfiles({ network, result, freezingDepthM: 1.8 })

    expect(branches.blockers).toEqual([])
    expect(branches.profiles.flatMap((branch) => branch.profile.pipeIds)).toContain('p-bd')
    expect(branches.unprofiledPipeIds).toEqual([])
  })

  it('rejects a finite branch polyline whose endpoint is detached from its network node', () => {
    const network = branchedNetwork()
    network.pipes = network.pipes.map((pipe) => pipe.id === 'p-bd'
      ? { ...pipe, alignment: [{ x: 100, y: 100 }, { x: 180, y: 100.001 }] }
      : pipe)
    const result = solve(network)

    const branches = computeGravityBranchProfiles({ network, result, freezingDepthM: 1.8 })

    expect(branches.profiles.flatMap((branch) => branch.profile.pipeIds)).not.toContain('p-bd')
    expect(branches.unprofiledPipeIds).toContain('p-bd')
    expect(branches.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BRANCH_ALIGNMENT_MISSING', pipeIds: ['p-bd'] }),
    ]))
  })

  it('is deterministic for the same hydraulic result', () => {
    const network = branchedNetwork()
    const result = solve(network)
    const first = computeGravityBranchProfiles({ network, result, freezingDepthM: 1.8 })
    const second = computeGravityBranchProfiles({ network, result, freezingDepthM: 1.8 })
    expect(second).toEqual(first)
  })
})
