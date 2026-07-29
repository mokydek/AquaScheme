import { computeGravityBranchProfiles } from '@aquascheme/engine'
import type {
  GravityNetworkResult,
  TracedNetwork,
  WorkingDrawingBranchProfileInput,
} from '@aquascheme/engine'

export interface DrawingBranchProfileResolution {
  branchProfiles: WorkingDrawingBranchProfileInput[]
  blockers: Array<{ code: string; message: string }>
  unprofiledPipeIds: string[]
}

/** Translate the pure engine result into the drawing-register contract. */
export function resolveGravityBranchProfilesForDrawings(input: {
  network: TracedNetwork
  result: GravityNetworkResult | null
  freezingDepthM: number
}): DrawingBranchProfileResolution {
  if (!input.result) return { branchProfiles: [], blockers: [], unprofiledPipeIds: [] }
  const resolved = computeGravityBranchProfiles({
    network: input.network,
    result: input.result,
    freezingDepthM: input.freezingDepthM,
  })
  return {
    branchProfiles: resolved.profiles,
    blockers: resolved.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
    })),
    unprofiledPipeIds: resolved.unprofiledPipeIds,
  }
}
