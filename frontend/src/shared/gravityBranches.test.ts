import { describe, expect, it } from 'vitest'
import { solveGravityNetwork } from '@aquascheme/engine'
import type { TracedNetwork } from '@aquascheme/engine'
import { resolveGravityBranchProfilesForDrawings } from './gravityBranches'

const network: TracedNetwork = {
  nodes: [
    { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
    { id: 'J', kind: 'manhole', x: 100, y: 0, groundElevation: 100.2 },
    { id: 'A', kind: 'building', x: 300, y: 0, groundElevation: 100.5, buildingId: 'a' },
    { id: 'B', kind: 'building', x: 100, y: 100, groundElevation: 100.4, buildingId: 'b' },
  ],
  pipes: [
    { id: 'p-sj', kind: 'gravity_collector', fromNode: 'S', toNode: 'J', lengthM: 100, alignment: [{ x: 0, y: 0 }, { x: 100, y: 0 }], dataSource: 'DWG' },
    { id: 'p-ja', kind: 'gravity_collector', fromNode: 'J', toNode: 'A', lengthM: 200, alignment: [{ x: 100, y: 0 }, { x: 300, y: 0 }], dataSource: 'DWG' },
    { id: 'p-jb', kind: 'gravity_collector', fromNode: 'J', toNode: 'B', lengthM: 100, alignment: [{ x: 100, y: 0 }, { x: 100, y: 100 }], dataSource: 'DWG' },
  ],
  totalLengthM: 400,
}

describe('resolveGravityBranchProfilesForDrawings', () => {
  it('passes only calculated source-backed branch profiles to the sheet set', () => {
    const result = solveGravityNetwork({
      network,
      buildingFlowLps: new Map([['a', 8], ['b', 4]]),
      system: 'storm',
      freezingDepthM: 1.8,
      allowedDiametersMm: [300, 400, 500, 600, 800],
    })
    const resolved = resolveGravityBranchProfilesForDrawings({ network, result, freezingDepthM: 1.8 })
    expect(resolved.blockers).toEqual([])
    expect(resolved.unprofiledPipeIds).toEqual([])
    expect(resolved.branchProfiles).toHaveLength(1)
    expect(resolved.branchProfiles[0].profile.pipeIds).toEqual(['p-jb'])
    expect(resolved.branchProfiles[0].source).toBe('DWG')
  })

  it('propagates a blocker instead of substituting endpoint geometry', () => {
    const missingAlignment = {
      ...network,
      pipes: network.pipes.map((pipe) => pipe.id === 'p-jb' ? { ...pipe, alignment: undefined } : pipe),
    }
    const result = solveGravityNetwork({
      network: missingAlignment,
      buildingFlowLps: new Map([['a', 8], ['b', 4]]),
      system: 'storm',
      freezingDepthM: 1.8,
      allowedDiametersMm: [300, 400, 500, 600, 800],
    })
    const resolved = resolveGravityBranchProfilesForDrawings({
      network: missingAlignment,
      result,
      freezingDepthM: 1.8,
    })
    expect(resolved.branchProfiles).toEqual([])
    expect(resolved.unprofiledPipeIds).toEqual(['p-jb'])
    expect(resolved.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BRANCH_ALIGNMENT_MISSING' }),
    ]))
  })
})
