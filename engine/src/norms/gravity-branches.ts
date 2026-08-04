import { compareDesignations } from '../units'
import type { TracedNetwork } from '../trace'
import type { GravityNetworkResult, GravityProfile, ProfileStation } from './gravity'
import { minSewerInvertDepthM } from './sewer'

export type GravityBranchProfileBlockerCode =
  | 'BRANCH_MAIN_PROFILE_MISSING'
  | 'BRANCH_ALIGNMENT_MISSING'
  | 'BRANCH_CALCULATION_MISSING'
  | 'BRANCH_TOPOLOGY_UNRESOLVED'

export interface GravityBranchProfileBlocker {
  code: GravityBranchProfileBlockerCode
  message: string
  pipeIds: string[]
  nodeIds?: string[]
}

export interface GravityBranchProfile {
  id: string
  title: string
  source?: string
  verified: boolean
  profile: GravityProfile
}

export interface GravityBranchProfilesResult {
  profiles: GravityBranchProfile[]
  blockers: GravityBranchProfileBlocker[]
  /** Gravity pipe ids represented by the main and generated branch profiles. */
  coveredPipeIds: string[]
  /** Gravity pipe ids for which no source-backed longitudinal profile was generated. */
  unprofiledPipeIds: string[]
}

function alignmentIsUsable(
  pipe: TracedNetwork['pipes'][number],
  nodeById: ReadonlyMap<string, TracedNetwork['nodes'][number]>,
): boolean {
  if (!Array.isArray(pipe.alignment)
    || pipe.alignment.length < 2
    || !pipe.alignment.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return false

  const from = nodeById.get(pipe.fromNode)
  const to = nodeById.get(pipe.toNode)
  if (!from || !to
    || !Number.isFinite(from.x) || !Number.isFinite(from.y)
    || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return false

  const first = pipe.alignment[0]
  const last = pipe.alignment[pipe.alignment.length - 1]
  const equals = (point: { x: number; y: number }, node: { x: number; y: number }) =>
    point.x === node.x && point.y === node.y

  // Both source orientations are valid. The plan/profile assembly normalises a
  // reversed polyline later; a detached endpoint is never closed by a chord.
  return (equals(first, from) && equals(last, to))
    || (equals(first, to) && equals(last, from))
}

/**
 * Builds profiles for every gravity-tree branch outside the governing main
 * profile. No plan geometry or levels are invented: an incomplete branch is
 * omitted and returned as a blocker.
 *
 * The furthest unprocessed leaves are followed downstream until they join the
 * main profile or an already-owned branch, so every tree pipe is represented
 * by exactly one profile.
 */
export function computeGravityBranchProfiles(input: {
  network: TracedNetwork
  result: GravityNetworkResult
  freezingDepthM: number
}): GravityBranchProfilesResult {
  const { network, result, freezingDepthM } = input
  const mainProfile = result.profile
  const gravityPipeIds = new Set(result.pipes.map((pipe) => pipe.id))
  const gravityPipes = network.pipes.filter((pipe) => gravityPipeIds.has(pipe.id))
  const allGravityPipeIds = gravityPipes.map((pipe) => pipe.id)
  const emptyResult = (blockers: GravityBranchProfileBlocker[]): GravityBranchProfilesResult => ({
    profiles: [],
    blockers,
    coveredPipeIds: mainProfile?.pipeIds.filter((pipeId) => gravityPipeIds.has(pipeId)) ?? [],
    unprofiledPipeIds: allGravityPipeIds.filter((pipeId) => !mainProfile?.pipeIds.includes(pipeId)),
  })

  if (!mainProfile || mainProfile.stations.length < 2 || !Number.isFinite(freezingDepthM) || freezingDepthM < 0) {
    return emptyResult([{
      code: 'BRANCH_MAIN_PROFILE_MISSING',
      message: 'Нельзя построить профили ветвей: основной расчётный профиль или расчётная глубина промерзания отсутствуют.',
      pipeIds: allGravityPipeIds,
    }])
  }

  const outletId = mainProfile.stations.at(-1)?.nodeId
  const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
  if (!outletId || !nodeById.has(outletId)) {
    return emptyResult([{
      code: 'BRANCH_MAIN_PROFILE_MISSING',
      message: 'Нельзя определить расчётный выпуск основного продольного профиля.',
      pipeIds: allGravityPipeIds,
    }])
  }

  const pipeById = new Map(gravityPipes.map((pipe) => [pipe.id, pipe]))
  const calculatedByPipeId = new Map(result.pipes.map((pipe) => [pipe.id, pipe]))
  const design = new Map(result.pipes.map((pipe) => [pipe.id, {
    diameterMm: pipe.diameterMm,
    slope: pipe.slope,
  }]))
  const adjacency = new Map<string, Array<{ to: string; pipeId: string }>>()
  for (const pipe of gravityPipes) {
    if (!adjacency.has(pipe.fromNode)) adjacency.set(pipe.fromNode, [])
    if (!adjacency.has(pipe.toNode)) adjacency.set(pipe.toNode, [])
    adjacency.get(pipe.fromNode)!.push({ to: pipe.toNode, pipeId: pipe.id })
    adjacency.get(pipe.toNode)!.push({ to: pipe.fromNode, pipeId: pipe.id })
  }
  for (const edges of adjacency.values()) {
    edges.sort((a, b) => compareDesignations(a.pipeId, b.pipeId) || compareDesignations(a.to, b.to))
  }

  // Mirror computeGravityProfile's outlet-rooted tree and invert calculation.
  const parentPipe = new Map<string, string>()
  const parentNode = new Map<string, string>()
  const distanceFromOutlet = new Map<string, number>([[outletId, 0]])
  const visited = new Set<string>([outletId])
  const queue = [outletId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const edge of adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue
      const pipe = pipeById.get(edge.pipeId)
      if (!pipe) continue
      visited.add(edge.to)
      parentPipe.set(edge.to, edge.pipeId)
      parentNode.set(edge.to, current)
      distanceFromOutlet.set(edge.to, (distanceFromOutlet.get(current) ?? 0) + pipe.lengthM)
      queue.push(edge.to)
    }
  }

  const children = new Map<string, string[]>()
  for (const [child, parent] of parentNode) {
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(child)
  }
  for (const nodes of children.values()) nodes.sort(compareDesignations)

  const diameterAt = (nodeId: string): number => {
    let diameterMm = 0
    for (const edge of adjacency.get(nodeId) ?? []) {
      diameterMm = Math.max(diameterMm, design.get(edge.pipeId)?.diameterMm ?? 0)
    }
    return diameterMm
  }
  const order = [...distanceFromOutlet.keys()].sort((a, b) =>
    (distanceFromOutlet.get(b) ?? 0) - (distanceFromOutlet.get(a) ?? 0)
      || compareDesignations(a, b),
  )
  const invertByNode = new Map<string, number>()
  for (const nodeId of order) {
    const node = nodeById.get(nodeId)
    const diameterMm = diameterAt(nodeId)
    if (!node || !Number.isFinite(node.groundElevation) || diameterMm <= 0) continue
    let invertM = node.groundElevation - minSewerInvertDepthM(diameterMm, freezingDepthM).value
    for (const childId of children.get(nodeId) ?? []) {
      const pipeId = parentPipe.get(childId)
      const pipe = pipeId ? pipeById.get(pipeId) : undefined
      const pipeDesign = pipeId ? design.get(pipeId) : undefined
      const childInvertM = invertByNode.get(childId)
      if (pipe && pipeDesign && childInvertM != null && Number.isFinite(pipeDesign.slope)) {
        invertM = Math.min(invertM, childInvertM - pipeDesign.slope * pipe.lengthM)
      }
    }
    invertByNode.set(nodeId, invertM)
  }

  const mainPipeIds = new Set(mainProfile.pipeIds)
  const treePipeIds = new Set(parentPipe.values())
  const assignedBranchPipeIds = new Set<string>()
  const coveredBranchPipeIds = new Set<string>()
  const profiles: GravityBranchProfile[] = []
  const blockers: GravityBranchProfileBlocker[] = []
  const leaves = [...distanceFromOutlet.keys()]
    .filter((nodeId) => (children.get(nodeId)?.length ?? 0) === 0)
    .sort((a, b) =>
      (distanceFromOutlet.get(b) ?? 0) - (distanceFromOutlet.get(a) ?? 0)
        || compareDesignations(a, b),
    )

  for (const leafId of leaves) {
    const nodeIds = [leafId]
    const pipeIds: string[] = []
    let current = leafId
    const guard = new Set<string>()
    while (current !== outletId && !guard.has(current)) {
      guard.add(current)
      const pipeId = parentPipe.get(current)
      const downstreamNodeId = parentNode.get(current)
      if (!pipeId || !downstreamNodeId || mainPipeIds.has(pipeId) || assignedBranchPipeIds.has(pipeId)) break
      pipeIds.push(pipeId)
      assignedBranchPipeIds.add(pipeId)
      nodeIds.push(downstreamNodeId)
      current = downstreamNodeId
    }
    if (pipeIds.length === 0) continue

    const invalidAlignmentPipeIds = pipeIds.filter((pipeId) => {
      const pipe = pipeById.get(pipeId)
      return !pipe || !alignmentIsUsable(pipe, nodeById)
    })
    if (invalidAlignmentPipeIds.length > 0) {
      blockers.push({
        code: 'BRANCH_ALIGNMENT_MISSING',
        message: `Профиль ветви ${leafId} не создан: отсутствует фактическая полилиния у участков ${invalidAlignmentPipeIds.join(', ')}.`,
        pipeIds: invalidAlignmentPipeIds,
        nodeIds,
      })
      continue
    }

    const invalidCalculationPipeIds = pipeIds.filter((pipeId) => {
      const calculated = calculatedByPipeId.get(pipeId)
      return !calculated
        || !Number.isFinite(calculated.diameterMm)
        || calculated.diameterMm <= 0
        || !Number.isFinite(calculated.slope)
        || calculated.slope < 0
        || !Number.isFinite(calculated.lengthM)
        || calculated.lengthM <= 0
    })
    const invalidNodeIds = nodeIds.filter((nodeId) => {
      const node = nodeById.get(nodeId)
      return !node
        || !Number.isFinite(node.groundElevation)
        || !Number.isFinite(invertByNode.get(nodeId))
        || diameterAt(nodeId) <= 0
    })
    if (invalidCalculationPipeIds.length > 0 || invalidNodeIds.length > 0) {
      blockers.push({
        code: 'BRANCH_CALCULATION_MISSING',
        message: `Профиль ветви ${leafId} не создан: не хватает расчётных отметок или диаметров.`,
        pipeIds: invalidCalculationPipeIds.length > 0 ? invalidCalculationPipeIds : pipeIds,
        nodeIds: invalidNodeIds,
      })
      continue
    }

    let chainageM = 0
    const stations: ProfileStation[] = nodeIds.map((nodeId, index) => {
      if (index > 0) chainageM += pipeById.get(pipeIds[index - 1])!.lengthM
      const node = nodeById.get(nodeId)!
      const invertElevationM = invertByNode.get(nodeId)!
      return {
        nodeId,
        buildingId: node.buildingId,
        chainageM: Math.round(chainageM * 100) / 100,
        groundElevationM: Math.round(node.groundElevation * 100) / 100,
        invertElevationM: Math.round(invertElevationM * 100) / 100,
        depthM: Math.round((node.groundElevation - invertElevationM) * 100) / 100,
        diameterMm: diameterAt(nodeId),
      }
    })
    const maxDepthM = stations.reduce((maximum, station) => Math.max(maximum, station.depthM), 0)
    const downstream = stations.at(-1)!
    const sourceValues = [...new Set(pipeIds
      .map((pipeId) => pipeById.get(pipeId)?.dataSource?.trim())
      .filter((source): source is string => Boolean(source)))]
    const calculatedPipes = pipeIds.map((pipeId) => calculatedByPipeId.get(pipeId)!)
    const headLabel = nodeById.get(leafId)?.label?.trim() || leafId
    const joinId = nodeIds.at(-1)!
    const joinLabel = nodeById.get(joinId)?.label?.trim() || joinId
    profiles.push({
      id: `branch-${profiles.length + 1}`,
      title: `Продольный профиль ветви ${headLabel}–${joinLabel}`,
      source: sourceValues.length > 0 ? sourceValues.join('; ') : 'calculation:gravity',
      verified: calculatedPipes.every((pipe) => pipe.issues.length === 0),
      profile: {
        stations,
        maxDepthM: Math.round(maxDepthM * 100) / 100,
        outletInvertElevationM: downstream.invertElevationM,
        totalLengthM: Math.round(chainageM * 100) / 100,
        pipeIds,
      },
    })
    pipeIds.forEach((pipeId) => coveredBranchPipeIds.add(pipeId))
  }

  const unresolvedTopologyPipeIds = allGravityPipeIds.filter((pipeId) =>
    !mainPipeIds.has(pipeId) && !treePipeIds.has(pipeId),
  )
  if (unresolvedTopologyPipeIds.length > 0) {
    blockers.push({
      code: 'BRANCH_TOPOLOGY_UNRESOLVED',
      message: `Не созданы профили для ${unresolvedTopologyPipeIds.length} участков: они не входят в однозначное дерево стока к выпуску.`,
      pipeIds: unresolvedTopologyPipeIds,
    })
  }

  const coveredPipeIds = allGravityPipeIds.filter((pipeId) =>
    mainPipeIds.has(pipeId) || coveredBranchPipeIds.has(pipeId),
  )
  const covered = new Set(coveredPipeIds)
  return {
    profiles,
    blockers,
    coveredPipeIds,
    unprofiledPipeIds: allGravityPipeIds.filter((pipeId) => !covered.has(pipeId)),
  }
}
