import { computeNetworkDemand } from './demand'
import { minFreeHeadForFloors, NORMATIVE_DEFAULTS } from './norms'
import type { NormativeParams } from './norms'
import type { NetworkPipeKind, TracedNetwork } from './trace'
import { solveHydraulics } from './hydraulics'
import type { HydraulicsResult } from './hydraulics'

/**
 * Iterative pipe sizing.
 *
 * Constraints (SP RK 4.01-101 / SNiP 2.04.02-84*):
 *  - economic velocity range 0.7..1.5 m/s, absolute maximum 2.5 m/s;
 *  - free head at every building: 10 m for one storey plus 4 m per extra
 *    storey (clause 2.26), no more than 60 m (clause 2.28);
 *  - mains of a network with fire hydrants: at least 100 mm nominal,
 *    so the smallest main here is PE 110 (TODO: confirm clause number).
 *
 * Algorithm: start mains at the minimum allowed size and services at the
 * smallest size that keeps their velocity economic; then iterate with
 * EPANET: upsize pipes that exceed the economic velocity, then upsize the
 * mains with the highest unit head loss until every building reaches its
 * required free head; finally try to downsize mains one by one, keeping
 * every constraint satisfied (minimum cost pass).
 */

export interface PipeSizeOption {
  nominalMm: number
  internalMm: number
}

/**
 * PE100 SDR17 size series (GOST 18599): internal = OD - 2 * OD / SDR.
 */
export const PE100_SDR17_SIZES: PipeSizeOption[] = [
  { nominalMm: 63, internalMm: 55.6 },
  { nominalMm: 90, internalMm: 79.4 },
  { nominalMm: 110, internalMm: 97.1 },
  { nominalMm: 160, internalMm: 141.2 },
  { nominalMm: 225, internalMm: 198.5 },
  { nominalMm: 250, internalMm: 220.6 },
  { nominalMm: 315, internalMm: 277.9 },
]

/** Conservative Darcy-Weisbach roughness for new PE pipes, mm. */
export const DEFAULT_ROUGHNESS_MM = 0.05

/** Minimum nominal size of network mains (fire hydrant networks). */
export const MIN_MAIN_NOMINAL_MM = 110

export const ECONOMIC_V_MIN = 0.7
export const ECONOMIC_V_MAX = 1.5
export const ABSOLUTE_V_MAX = 2.5

export interface SizingBuilding {
  id: string
  floors: number
  residents: number
  /** Per unit daily norm, L/day (non residential presets). */
  specificDemandLpd?: number
}

export interface SizingInput {
  network: TracedNetwork
  buildings: SizingBuilding[]
  /** Available head at the source above ground, m. */
  availableHeadM: number
  norms?: NormativeParams
  roughnessMm?: number
  sizes?: PipeSizeOption[]
}

export interface SizedPipe {
  id: string
  kind: NetworkPipeKind
  fromNode: string
  toNode: string
  lengthM: number
  nominalMm: number
  internalMm: number
  flowLps: number
  velocityMs: number
  headlossM: number
  unitHeadlossMPerKm: number
}

export interface SizedNode {
  id: string
  kind: string
  buildingId?: string
  elevationM: number
  headM: number
  pressureM: number
  requiredPressureM?: number
  ok: boolean
}

export interface SizingIssue {
  kind: 'lowPressure' | 'highPressure' | 'highVelocity' | 'lowVelocity' | 'noSuitableItem'
  targetId: string
  value: number
  limit: number
}

export interface SizingResult {
  pipes: SizedPipe[]
  nodes: SizedNode[]
  iterations: number
  solves: number
  converged: boolean
  issues: SizingIssue[]
  sourceHeadM: number
  totalDemandLps: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function velocityFor(flowLps: number, internalMm: number): number {
  const area = (Math.PI * (internalMm / 1000) ** 2) / 4
  return area > 0 ? Math.abs(flowLps) / 1000 / area : 0
}

export async function sizeNetwork(input: SizingInput): Promise<SizingResult> {
  const norms = input.norms ?? NORMATIVE_DEFAULTS
  const sizes = input.sizes ?? PE100_SDR17_SIZES
  const roughness = input.roughnessMm ?? DEFAULT_ROUGHNESS_MM
  const net = input.network

  const source = net.nodes.find((n) => n.kind === 'source')
  if (!source) throw new Error('network has no source node')
  const sourceHeadM = source.groundElevation + input.availableHeadM

  const demand = computeNetworkDemand(
    input.buildings.map((b) => ({
      id: b.id,
      residents: b.residents,
      specificDemandLpd: b.specificDemandLpd,
    })),
    norms,
  )
  const demandByBuilding = new Map(
    demand.buildings.map((b) => [b.id as string, b.designFlowLps]),
  )
  const floorsByBuilding = new Map(input.buildings.map((b) => [b.id, b.floors]))
  const nodeById = new Map(net.nodes.map((n) => [n.id, n]))

  const junctions = net.nodes
    .filter((n) => n.kind !== 'source')
    .map((n) => ({
      id: n.id,
      elevationM: n.groundElevation,
      demandLps: n.buildingId ? (demandByBuilding.get(n.buildingId) ?? 0) : 0,
    }))

  const requiredPressureFor = (nodeId: string): number | undefined => {
    const node = nodeById.get(nodeId)
    if (!node?.buildingId) return undefined
    const floors = floorsByBuilding.get(node.buildingId)
    return floors ? minFreeHeadForFloors(floors, norms) : norms.minFreeHeadBaseM
  }

  // Initial sizes.
  const minMainIdx = Math.max(
    0,
    sizes.findIndex((s) => s.nominalMm >= MIN_MAIN_NOMINAL_MM),
  )
  const idxByPipe = new Map<string, number>()
  for (const p of net.pipes) {
    if (p.kind === 'service') {
      const target = nodeById.get(p.toNode)
      const flow = target?.buildingId ? (demandByBuilding.get(target.buildingId) ?? 0) : 0
      let idx = 0
      while (idx < sizes.length - 1 && velocityFor(flow, sizes[idx].internalMm) > ECONOMIC_V_MAX) {
        idx++
      }
      idxByPipe.set(p.id, idx)
    } else {
      idxByPipe.set(p.id, minMainIdx)
    }
  }

  let solves = 0
  const solve = async (): Promise<HydraulicsResult> => {
    solves++
    return solveHydraulics({
      source: { id: source.id, totalHeadM: sourceHeadM },
      junctions,
      pipes: net.pipes.map((p) => ({
        id: p.id,
        fromNode: p.fromNode,
        toNode: p.toNode,
        lengthM: Math.max(p.lengthM, 0.5),
        internalDiameterMm: sizes[idxByPipe.get(p.id) ?? 0].internalMm,
        roughnessMm: roughness,
      })),
    })
  }

  const deficientBuildings = (res: HydraulicsResult) =>
    junctions.filter((j) => {
      const required = requiredPressureFor(j.id)
      if (required === undefined) return false
      const pressure = res.nodes.get(j.id)?.pressureM ?? 0
      return pressure < required - 0.005
    })

  let result = await solve()
  let iterations = 0
  const maxIterations = 40

  while (iterations < maxIterations) {
    iterations++
    let changed = false

    // 1. Velocity pass: keep every pipe inside the economic maximum.
    for (const p of net.pipes) {
      const idx = idxByPipe.get(p.id) ?? 0
      const velocity = result.pipes.get(p.id)?.velocityMs ?? 0
      if (velocity > ECONOMIC_V_MAX && idx < sizes.length - 1) {
        idxByPipe.set(p.id, idx + 1)
        changed = true
      }
    }

    if (!changed) {
      // 2. Pressure pass: upsize the most loaded mains.
      const deficient = deficientBuildings(result)
      if (deficient.length === 0) break
      const candidates = net.pipes
        .filter((p) => p.kind !== 'service' && (idxByPipe.get(p.id) ?? 0) < sizes.length - 1)
        .sort(
          (a, b) =>
            (result.pipes.get(b.id)?.unitHeadlossMPerKm ?? 0) -
            (result.pipes.get(a.id)?.unitHeadlossMPerKm ?? 0),
        )
      if (candidates.length > 0) {
        for (const p of candidates.slice(0, 2)) {
          idxByPipe.set(p.id, (idxByPipe.get(p.id) ?? 0) + 1)
        }
        changed = true
      } else {
        // Mains are maxed out: try the services of deficient buildings.
        const deficientIds = new Set(deficient.map((d) => d.id))
        const services = net.pipes.filter(
          (p) =>
            p.kind === 'service' &&
            deficientIds.has(p.toNode) &&
            (idxByPipe.get(p.id) ?? 0) < sizes.length - 1,
        )
        if (services.length === 0) break
        for (const p of services) idxByPipe.set(p.id, (idxByPipe.get(p.id) ?? 0) + 1)
        changed = true
      }
    }

    if (changed) result = await solve()
  }

  // 3. Economy pass: try to downsize mains while keeping all constraints.
  const acceptable = (res: HydraulicsResult): boolean => {
    for (const p of net.pipes) {
      if ((res.pipes.get(p.id)?.velocityMs ?? 0) > ECONOMIC_V_MAX) return false
    }
    return deficientBuildings(res).length === 0
  }

  const mainsByVelocity = net.pipes
    .filter((p) => p.kind !== 'service')
    .sort(
      (a, b) =>
        (result.pipes.get(a.id)?.velocityMs ?? 0) - (result.pipes.get(b.id)?.velocityMs ?? 0),
    )
  for (const p of mainsByVelocity) {
    const idx = idxByPipe.get(p.id) ?? 0
    if (idx <= minMainIdx) continue
    idxByPipe.set(p.id, idx - 1)
    const trial = await solve()
    if (acceptable(trial)) {
      result = trial
    } else {
      idxByPipe.set(p.id, idx)
    }
  }

  // Final report.
  const pipes: SizedPipe[] = net.pipes.map((p) => {
    const size = sizes[idxByPipe.get(p.id) ?? 0]
    const r = result.pipes.get(p.id)
    return {
      id: p.id,
      kind: p.kind,
      fromNode: p.fromNode,
      toNode: p.toNode,
      lengthM: p.lengthM,
      nominalMm: size.nominalMm,
      internalMm: size.internalMm,
      flowLps: round2(r?.flowLps ?? 0),
      velocityMs: round2(r?.velocityMs ?? 0),
      headlossM: round2(r?.headlossM ?? 0),
      unitHeadlossMPerKm: round2(r?.unitHeadlossMPerKm ?? 0),
    }
  })

  const issues: SizingIssue[] = []
  const nodes: SizedNode[] = net.nodes.map((n) => {
    const r = result.nodes.get(n.id)
    const pressureM = round2(r?.pressureM ?? 0)
    const required = requiredPressureFor(n.id)
    let ok = true
    if (n.kind !== 'source' && required !== undefined) {
      if (pressureM < required - 0.005) {
        ok = false
        issues.push({ kind: 'lowPressure', targetId: n.id, value: pressureM, limit: required })
      }
      if (pressureM > norms.maxFreeHeadM + 0.005) {
        ok = false
        issues.push({
          kind: 'highPressure',
          targetId: n.id,
          value: pressureM,
          limit: norms.maxFreeHeadM,
        })
      }
    }
    return {
      id: n.id,
      kind: n.kind,
      buildingId: n.buildingId,
      elevationM: n.groundElevation,
      headM: round2(r?.headM ?? 0),
      pressureM,
      requiredPressureM: required,
      ok,
    }
  })

  const maxSizeIndex = sizes.length - 1
  for (const p of pipes) {
    if (p.velocityMs > ABSOLUTE_V_MAX) {
      // Over the limit even at the largest size the catalog offers: there is
      // no suitable item, so we say so instead of inventing a bigger pipe.
      const atMax = (idxByPipe.get(p.id) ?? 0) >= maxSizeIndex
      issues.push({
        kind: atMax ? 'noSuitableItem' : 'highVelocity',
        targetId: p.id,
        value: p.velocityMs,
        limit: ABSOLUTE_V_MAX,
      })
    } else if (p.kind !== 'service' && p.velocityMs < ECONOMIC_V_MIN && p.flowLps !== 0) {
      issues.push({ kind: 'lowVelocity', targetId: p.id, value: p.velocityMs, limit: ECONOMIC_V_MIN })
    }
  }

  const converged = !issues.some(
    (i) => i.kind === 'lowPressure' || i.kind === 'highVelocity' || i.kind === 'noSuitableItem',
  )

  return {
    pipes,
    nodes,
    iterations,
    solves,
    converged,
    issues,
    sourceHeadM: round2(sourceHeadM),
    totalDemandLps: round2(demand.designFlowLps),
  }
}
