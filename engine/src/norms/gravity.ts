import type { Justified } from '../normregistry'
import { justified } from '../normregistry'
import {
  maxFilling,
  maxVelocityMps,
  minGravityDiameterMm,
  minSewerDepthM,
  minSlopeForDiameter,
  minVelocityMps,
  sewerRoughnessN,
  type SewerNetworkLevel,
} from './sewer'
import type { TracedNetwork } from '../trace'
import { agskSectionForGravityPipe } from './agsk'

/**
 * Gravity (free-surface) hydraulics for sewer (К1) and storm (К2) networks
 * per СН РК 4.01-03-2013*. A circular pipe running partially full is solved
 * with the Chezy-Manning equation v = (1/n)·R^(2/3)·√i (n1 = 0.014 for gravity
 * collectors, п. 5.8.1). Design checks — minimum self-cleaning velocity
 * (Таблица 5.19), maximum filling 0.8 (п. 5.10.7), minimum diameter (5.9.1),
 * minimum slope (5.11.1) — all reference verified registry entries.
 *
 * This is NOT EPANET: EPANET solves pressurized networks. Gravity free-surface
 * flow is a different regime and is computed here from the norm formulas, with
 * a hand-calculation reference test (gravity.test.ts) as required by the
 * engineering guardrails.
 */

/**
 * Standard sewer/storm pipe diameter series, mm. Large trunk collectors use
 * reinforced concrete non-pressure pipes (серия 3.008.1-7/89 goes up to
 * 2400 мм), so the series continues past 1500 — a storm trunk of Ф2000 must
 * be selectable, not reported as "no bigger pipe".
 */
export const GRAVITY_DIAMETERS = [150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1600, 2000, 2400] as const

export interface CircularSection {
  /** Central angle subtended by the water surface, radians (0..2π). */
  thetaRad: number
  areaM2: number
  wettedPerimeterM: number
  hydraulicRadiusM: number
  topWidthM: number
}

/** Geometry of a circular pipe of diameter D (m) filled to ratio f = h/D. */
export function circularSection(diameterM: number, fill: number): CircularSection {
  const f = Math.min(Math.max(fill, 0), 1)
  const theta = 2 * Math.acos(1 - 2 * f) // radians
  const areaM2 = (diameterM * diameterM / 8) * (theta - Math.sin(theta))
  const wettedPerimeterM = (diameterM * theta) / 2
  const hydraulicRadiusM = wettedPerimeterM > 0 ? areaM2 / wettedPerimeterM : 0
  const topWidthM = diameterM * Math.sin(theta / 2)
  return { thetaRad: theta, areaM2, wettedPerimeterM, hydraulicRadiusM, topWidthM }
}

/** Chezy-Manning velocity v = (1/n)·R^(2/3)·√i, m/s. */
export function manningVelocity(hydraulicRadiusM: number, slope: number, n: number): number {
  if (hydraulicRadiusM <= 0 || slope <= 0) return 0
  return (1 / n) * Math.pow(hydraulicRadiusM, 2 / 3) * Math.sqrt(slope)
}

/** Free-surface flow Q (m3/s) in a circular pipe at fill ratio f. */
export function gravityFlowM3s(diameterM: number, slope: number, fill: number, n: number): number {
  const s = circularSection(diameterM, fill)
  return manningVelocity(s.hydraulicRadiusM, slope, n) * s.areaM2
}

/**
 * Fill ratio f = h/D that carries flow Q at the given diameter and slope.
 * Returns null when Q exceeds the capacity at f = capLimit (bisection).
 */
export function fillForFlow(
  flowM3s: number,
  diameterM: number,
  slope: number,
  n: number,
  capLimit = 0.95,
): number | null {
  if (flowM3s <= 0) return 0
  if (gravityFlowM3s(diameterM, slope, capLimit, n) < flowM3s) return null
  let lo = 0
  let hi = capLimit
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (gravityFlowM3s(diameterM, slope, mid, n) < flowM3s) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export type GravityIssueCode =
  | 'belowSelfCleaning'
  | 'overMaxFilling'
  | 'overMaxVelocity'
  | 'noSuitableDiameter'

export interface GravityIssue {
  code: GravityIssueCode
  refs: string[]
  message: string
}

export interface GravitySegmentDesign {
  diameterMm: number
  /** Design slope adopted, m/m. */
  slope: number
  fillRatio: number
  velocityMs: number
  flowLps: number
  issues: GravityIssue[]
}

export interface GravityDesignOptions {
  system: 'sewer' | 'storm'
  level?: SewerNetworkLevel
  /** Manning roughness; default 0.014 (gravity collectors, п. 5.8.1). */
  roughness?: number
  /** Absolute ground slope along the segment (drop/length); default 0. */
  groundSlope?: number
  /** Pipe material for the maximum velocity limit (5.10.3). */
  material?: 'metal' | 'nonmetal'
}

const SLOPE_CAP = 0.1 // 10% — practical steepness bound before drop structures

/**
 * Designs one gravity segment: the smallest standard diameter and a slope that
 * keep the filling within the norm and the velocity self-cleaning. Every check
 * cites its verified СН РК 4.01-03-2013* clause.
 */
export function designGravitySegment(flowLps: number, opts: GravityDesignOptions): GravitySegmentDesign {
  const system = opts.system
  const level = opts.level ?? 'street'
  const n = opts.roughness ?? sewerRoughnessN('gravity').value
  const groundSlope = Math.max(opts.groundSlope ?? 0, 0)
  const material = opts.material ?? 'nonmetal'
  const Q = flowLps / 1000
  const minDia = minGravityDiameterMm(system, level).value
  const maxFillR = maxFilling(system).value
  const vMax = maxVelocityMps(system, material).value

  const candidates = GRAVITY_DIAMETERS.filter((d) => d >= minDia)
  let fallback: GravitySegmentDesign | null = null

  for (const D of candidates) {
    const Dm = D / 1000
    const minV = minVelocityMps(D).value
    const normMin = minSlopeForDiameter(D)?.value ?? 0
    const base = Math.max(groundSlope, normMin, 0.0005)

    for (let slope = base; slope <= SLOPE_CAP + 1e-9; slope *= 1.08) {
      const fill = fillForFlow(Q, Dm, slope, n)
      if (fill === null) continue // over capacity at this slope → steepen
      const v = manningVelocity(circularSection(Dm, fill).hydraulicRadiusM, slope, n)
      if (fill > maxFillR) continue // too full → steepen (or larger D)
      if (v < minV) continue // not self-cleaning → steepen
      const issues: GravityIssue[] = []
      if (v > vMax) {
        issues.push({
          code: 'overMaxVelocity',
          refs: ['sewer.velocity.max'],
          message: `Скорость ${v.toFixed(2)} м/с выше предельной ${vMax} м/с; требуются перепадные колодцы или гашение скорости`,
        })
      }
      return {
        diameterMm: D,
        slope: Math.round(slope * 1e5) / 1e5,
        fillRatio: Math.round(fill * 1000) / 1000,
        velocityMs: Math.round(v * 100) / 100,
        flowLps,
        issues,
      }
    }

    // This diameter could not satisfy filling within the slope cap; remember
    // the largest one as an honest fallback (over-filled) rather than invent.
    const slope = Math.max(groundSlope, normMin, 0.0005)
    const fill = fillForFlow(Q, Dm, Math.min(slope, SLOPE_CAP), n, 0.99) ?? 0.99
    const v = manningVelocity(circularSection(Dm, Math.min(fill, 0.99)).hydraulicRadiusM, Math.min(slope, SLOPE_CAP), n)
    fallback = {
      diameterMm: D,
      slope: Math.round(Math.min(slope, SLOPE_CAP) * 1e5) / 1e5,
      fillRatio: Math.round(Math.min(fill, 0.99) * 1000) / 1000,
      velocityMs: Math.round(v * 100) / 100,
      flowLps,
      issues: [
        {
          code: 'overMaxFilling',
          refs: ['sewer.filling.max'],
          message: `Наполнение превышает допустимое ${maxFillR}; требуется больший диаметр, чем ${GRAVITY_DIAMETERS[GRAVITY_DIAMETERS.length - 1]} мм`,
        },
      ],
    }
  }

  return (
    fallback ?? {
      diameterMm: minDia,
      slope: 0,
      fillRatio: 0,
      velocityMs: 0,
      flowLps,
      issues: [
        {
          code: 'noSuitableDiameter',
          refs: ['sewer.minDiameter'],
          message: 'Не удалось подобрать диаметр из стандартного ряда для заданного расхода',
        },
      ],
    }
  )
}

export interface GravityPipeResult extends GravitySegmentDesign {
  id: string
  fromNode: string
  toNode: string
  lengthM: number
}

export interface GravityNetworkResult {
  kind: 'gravity'
  systemType: 'sewer' | 'storm'
  pipes: GravityPipeResult[]
  /** Total design flow that reached the outlet, L/s. */
  outletFlowLps: number
  /** Longitudinal profile of the main collector (null if no outlet). */
  profile: GravityProfile | null
}

/**
 * Accumulates each building's drainage flow along the shortest path (fewest
 * hops) to the outlet (the source node), summing flows on every pipe traversed.
 * Returns L/s per pipe id.
 */
export function accumulateGravityFlows(
  network: TracedNetwork,
  buildingFlowLps: Map<string, number>,
): Map<string, number> {
  const outlet = network.nodes.find((n) => n.kind === 'source')
  const flowByPipe = new Map<string, number>()
  for (const p of network.pipes) flowByPipe.set(p.id, 0)
  if (!outlet) return flowByPipe

  // Undirected adjacency: node -> [{to, pipeId}].
  const adj = new Map<string, Array<{ to: string; pipeId: string }>>()
  for (const p of network.pipes) {
    if (!adj.has(p.fromNode)) adj.set(p.fromNode, [])
    if (!adj.has(p.toNode)) adj.set(p.toNode, [])
    adj.get(p.fromNode)!.push({ to: p.toNode, pipeId: p.id })
    adj.get(p.toNode)!.push({ to: p.fromNode, pipeId: p.id })
  }

  // BFS from the outlet gives, for every node, the pipe stepping one hop closer
  // to the outlet (parent edge). A building routes its flow along parent edges.
  const parentPipe = new Map<string, string>()
  const visited = new Set<string>([outlet.id])
  const queue = [outlet.id]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const edge of adj.get(cur) ?? []) {
      if (visited.has(edge.to)) continue
      visited.add(edge.to)
      parentPipe.set(edge.to, edge.pipeId)
      queue.push(edge.to)
    }
  }

  const nodeById = new Map(network.nodes.map((nn) => [nn.id, nn]))
  const parentNode = new Map<string, string>()
  for (const p of network.pipes) {
    // Determine which endpoint is the child (further from outlet).
    if (parentPipe.get(p.fromNode) === p.id) parentNode.set(p.fromNode, p.toNode)
    if (parentPipe.get(p.toNode) === p.id) parentNode.set(p.toNode, p.fromNode)
  }

  for (const node of network.nodes) {
    if (node.kind !== 'building' && !node.buildingId) continue
    const flow = buildingFlowLps.get(node.buildingId ?? node.id) ?? 0
    if (flow <= 0) continue
    let cur = node.id
    const guard = new Set<string>()
    while (cur !== outlet.id && parentPipe.has(cur) && !guard.has(cur)) {
      guard.add(cur)
      const pipeId = parentPipe.get(cur) as string
      flowByPipe.set(pipeId, (flowByPipe.get(pipeId) ?? 0) + flow)
      const next = parentNode.get(cur)
      if (!next || !nodeById.has(next)) break
      cur = next
    }
  }
  return flowByPipe
}

/** Runs the gravity design over every pipe of a traced/imported network. */
export function solveGravityNetwork(input: {
  network: TracedNetwork
  buildingFlowLps: Map<string, number>
  system: 'sewer' | 'storm'
  roughness?: number
  /** Freezing depth for min burial (п. 7.2.4); default 1.5 m. */
  freezingDepthM?: number
}): GravityNetworkResult {
  const flows = accumulateGravityFlows(input.network, input.buildingFlowLps)
  const nodeById = new Map(input.network.nodes.map((n) => [n.id, n]))
  const outlet = input.network.nodes.find((n) => n.kind === 'source')

  const pipes: GravityPipeResult[] = input.network.pipes.map((p) => {
    const from = nodeById.get(p.fromNode)
    const to = nodeById.get(p.toNode)
    const drop = from && to ? Math.abs(from.groundElevation - to.groundElevation) : 0
    const groundSlope = p.lengthM > 0 ? drop / p.lengthM : 0
    const flowLps = flows.get(p.id) ?? 0
    const design = designGravitySegment(flowLps, {
      system: input.system,
      roughness: input.roughness,
      groundSlope,
    })
    return { ...design, id: p.id, fromNode: p.fromNode, toNode: p.toNode, lengthM: p.lengthM }
  })

  const outletFlowLps = outlet
    ? input.network.pipes
        .filter((p) => p.fromNode === outlet.id || p.toNode === outlet.id)
        .reduce((s, p) => Math.max(s, flows.get(p.id) ?? 0), 0)
    : 0

  const design = new Map(pipes.map((p) => [p.id, { diameterMm: p.diameterMm, slope: p.slope }]))
  const profile = computeGravityProfile({
    network: input.network,
    design,
    freezingDepthM: input.freezingDepthM ?? 1.5,
  })

  return { kind: 'gravity', systemType: input.system, pipes, outletFlowLps, profile }
}

/** The design filling cap used as a headline justified value for the UI. */
export function designFillingCap(system: 'sewer' | 'storm'): Justified<number> {
  return justified(maxFilling(system).value, ['sewer.filling.max'])
}

export interface ProfileStation {
  nodeId: string
  buildingId?: string
  /** Distance along the main collector from its head, m. */
  chainageM: number
  groundElevationM: number
  /** Invert (лоток) elevation of the pipe at this node, m. */
  invertElevationM: number
  /** Excavation depth from ground to invert, m. */
  depthM: number
  /** Diameter of the governing pipe at this node, mm. */
  diameterMm: number
}

export interface GravityProfile {
  /** Stations from the collector head (chainage 0) down to the outlet. */
  stations: ProfileStation[]
  maxDepthM: number
  outletInvertElevationM: number
  totalLengthM: number
}

/**
 * Longitudinal profile of the main gravity collector: invert (лоток) elevations
 * and manhole excavation depths from the outlet up to the furthest head.
 *
 * Method (upstream-controlled, соединение по лоткам): every head starts at the
 * minimum burial depth (п. 7.2.4: не менее глубины промерзания минус 0,3/0,5 м,
 * но не менее 0,7 м до верха трубы, плюс диаметр до лотка). Going downstream the
 * invert drops by slope × length; at each manhole the invert is the deeper of
 * the hydraulic drop and the local minimum cover, so cover is never violated.
 */
export function computeGravityProfile(input: {
  network: TracedNetwork
  design: Map<string, { diameterMm: number; slope: number }>
  freezingDepthM: number
}): GravityProfile | null {
  const { network, design, freezingDepthM } = input
  const outlet = network.nodes.find((n) => n.kind === 'source')
  if (!outlet || network.pipes.length === 0) return null
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]))

  // Adjacency and a BFS tree rooted at the outlet.
  const adj = new Map<string, Array<{ to: string; pipeId: string }>>()
  for (const p of network.pipes) {
    if (!adj.has(p.fromNode)) adj.set(p.fromNode, [])
    if (!adj.has(p.toNode)) adj.set(p.toNode, [])
    adj.get(p.fromNode)!.push({ to: p.toNode, pipeId: p.id })
    adj.get(p.toNode)!.push({ to: p.fromNode, pipeId: p.id })
  }
  const parentPipe = new Map<string, string>()
  const parentNode = new Map<string, string>()
  const distFromOutlet = new Map<string, number>([[outlet.id, 0]])
  const visited = new Set<string>([outlet.id])
  const queue = [outlet.id]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const edge of adj.get(cur) ?? []) {
      if (visited.has(edge.to)) continue
      visited.add(edge.to)
      parentPipe.set(edge.to, edge.pipeId)
      parentNode.set(edge.to, cur)
      const len = network.pipes.find((p) => p.id === edge.pipeId)?.lengthM ?? 0
      distFromOutlet.set(edge.to, (distFromOutlet.get(cur) ?? 0) + len)
      queue.push(edge.to)
    }
  }

  const pipeById = new Map(network.pipes.map((p) => [p.id, p]))
  const diameterAt = (nodeId: string): number => {
    let d = 0
    for (const edge of adj.get(nodeId) ?? []) {
      const dd = design.get(edge.pipeId)?.diameterMm ?? 0
      if (dd > d) d = dd
    }
    return d || minGravityDiameterMm('sewer', 'street').value
  }
  const coverToInvert = (D: number): number => minSewerDepthM(D, freezingDepthM).value + D / 1000

  // Children map (nodes whose parent is this node), for downstream-first order.
  const children = new Map<string, string[]>()
  for (const [child, parent] of parentNode) {
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(child)
  }

  // Process upstream nodes first (largest distance from outlet), so a child's
  // invert is known before its parent's.
  const order = [...distFromOutlet.keys()].sort(
    (a, b) => (distFromOutlet.get(b) ?? 0) - (distFromOutlet.get(a) ?? 0),
  )
  const invert = new Map<string, number>()
  for (const nodeId of order) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    const D = diameterAt(nodeId)
    const byCover = node.groundElevation - coverToInvert(D)
    let inv = byCover
    for (const child of children.get(nodeId) ?? []) {
      const pipeId = parentPipe.get(child)
      const pipe = pipeId ? pipeById.get(pipeId) : undefined
      const slope = pipeId ? design.get(pipeId)?.slope ?? 0 : 0
      const childInv = invert.get(child)
      if (pipe && childInv != null) {
        inv = Math.min(inv, childInv - slope * pipe.lengthM)
      }
    }
    invert.set(nodeId, inv)
  }

  // Main collector = path from the furthest node down to the outlet.
  let head = outlet.id
  let far = 0
  for (const [nodeId, d] of distFromOutlet) {
    if (d > far) {
      far = d
      head = nodeId
    }
  }
  const pathHeadToOutlet: string[] = []
  let cur = head
  const guard = new Set<string>()
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    pathHeadToOutlet.push(cur)
    if (cur === outlet.id) break
    const next = parentNode.get(cur)
    if (!next) break
    cur = next
  }

  const headChainage = distFromOutlet.get(head) ?? 0
  const stations: ProfileStation[] = pathHeadToOutlet.map((nodeId) => {
    const node = nodeById.get(nodeId)!
    const inv = invert.get(nodeId) ?? node.groundElevation
    return {
      nodeId,
      buildingId: node.buildingId,
      chainageM: Math.round((headChainage - (distFromOutlet.get(nodeId) ?? 0)) * 100) / 100,
      groundElevationM: Math.round(node.groundElevation * 100) / 100,
      invertElevationM: Math.round(inv * 100) / 100,
      depthM: Math.round((node.groundElevation - inv) * 100) / 100,
      diameterMm: diameterAt(nodeId),
    }
  })

  const maxDepthM = stations.reduce((m, s) => Math.max(m, s.depthM), 0)
  return {
    stations,
    maxDepthM: Math.round(maxDepthM * 100) / 100,
    outletInvertElevationM: Math.round((invert.get(outlet.id) ?? outlet.groundElevation) * 100) / 100,
    totalLengthM: Math.round(headChainage * 100) / 100,
  }
}

/** Picket (ПК) label for a chainage, e.g. 1057 m → «ПК10+57». */
export function picketLabel(chainageM: number): string {
  const pk = Math.floor(chainageM / 100)
  const plus = chainageM - pk * 100
  return `ПК${pk}+${plus.toFixed(0).padStart(2, '0')}`
}

/** Manhole label along the collector: ВК-1..n, «Вып.» at the outlet. */
export function manholeLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? 'Вып.' : `ВК-${i + 1}`))
}

export interface SewerScheduleManhole {
  label: string
  picket: string
  /** Full depth to the invert, mm. */
  depthMm: number
  pipeDiameterMm: number
}

export interface SewerSchedulePipe {
  designation: string
  diameterMm: number
  /** Total length of this diameter, m. */
  lengthM: number
  /** АГСК-3 catalogue section code for the pipe category. */
  agskCode: string
}

export interface SewerSchedule {
  /** Manholes along the main collector (from the profile). */
  manholes: SewerScheduleManhole[]
  /** Pipe totals by diameter across the whole network. */
  pipes: SewerSchedulePipe[]
  totalPipeLengthM: number
}

/**
 * Materials schedule (ведомость колодцев и труб) for К1, at the level the model
 * knows: manhole number, picket, full depth and pipe diameter along the main
 * collector, plus pipe totals by diameter. The per-element consumption
 * (КС/ПД/КО rings, скобы, гидроизоляция) comes from a типовой проект such as
 * ТПР 902-09-22.84 by manhole depth and diameter, which is NOT invented here.
 */
export function buildSewerSchedule(result: GravityNetworkResult): SewerSchedule {
  const stations = result.profile?.stations ?? []
  const labels = manholeLabels(stations.length)
  const manholes: SewerScheduleManhole[] = stations.map((s, i) => ({
    label: labels[i],
    picket: picketLabel(s.chainageM),
    depthMm: Math.round(s.depthM * 1000),
    pipeDiameterMm: s.diameterMm,
  }))

  const lengthByDiameter = new Map<number, number>()
  for (const p of result.pipes) {
    lengthByDiameter.set(p.diameterMm, (lengthByDiameter.get(p.diameterMm) ?? 0) + p.lengthM)
  }
  const gravityAgsk = agskSectionForGravityPipe('concrete').code
  const pipes: SewerSchedulePipe[] = [...lengthByDiameter.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([diameterMm, lengthM]) => ({
      designation: `Труба безнапорная Ø${diameterMm}`,
      diameterMm,
      lengthM: Math.round(lengthM),
      agskCode: gravityAgsk,
    }))
  const totalPipeLengthM = Math.round(result.pipes.reduce((s, p) => s + p.lengthM, 0))

  return { manholes, pipes, totalPipeLengthM }
}
