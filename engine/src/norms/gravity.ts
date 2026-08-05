import {
  maxFilling,
  maxVelocityMps,
  minGravityDiameterMm,
  minSewerInvertDepthM,
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
 *
 * 450 мм is catalogued: АГСК-3 позиция 241-702-0903 «Труба безнапорная
 * цилиндрическая раструбная типа ТС ГОСТ 6482-2011, DN/ID 450» sits between
 * 0902 (DN 400) and 0904 (DN 500). Municipal reconstruction assignments ask
 * for it by name, and without it the solver silently rounds to 400 or 500.
 * Таблица 5.19 (row 450..500) and п. 7.4.1 (spacing row 200..450) already
 * carry the size, so only this series was missing it.
 */
export const GRAVITY_DIAMETERS = [150, 200, 250, 300, 400, 450, 500, 600, 800, 1000, 1200, 1500, 1600, 2000, 2400] as const

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
  /** Расчётного расхода нет — диаметр не подобран, а принят по ряду. */
  | 'noDesignFlow'

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
  /**
   * Design criterion. 'minDiameter' (default) picks the smallest pipe and
   * steepens the slope until it works — economical on sloped terrain.
   * 'minBurial' minimises the burial growth on FLAT terrain the way
   * professional trunk collectors are designed: for every diameter the
   * smallest workable slope is found, the pipe that fits the ground slope
   * wins, otherwise the one with the flattest required slope (typically the
   * larger diameter). Both are norm-compliant; the choice is a design
   * decision (registry sewer.design.minBurial).
   */
  strategy?: 'minDiameter' | 'minBurial'
  /** Project catalogue diameters. The solver must not invent absent sizes. */
  allowedDiametersMm?: readonly number[]
  /** Confirmed design-rain period P; only P=0.33 enables note 3's 0.6 m/s exception. */
  stormRainPeriodYears?: number
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

  const catalogue = opts.allowedDiametersMm !== undefined
    ? [...new Set(opts.allowedDiametersMm)].filter(Number.isFinite).sort((a, b) => a - b)
    : [...GRAVITY_DIAMETERS]
  const candidates = catalogue.filter((d) => d >= minDia)
  let fallback: GravitySegmentDesign | null = null

  // Нулевой расчётный расход — не исходное данное для подбора. Наполнения и
  // скорости у него нет, проверку на самоочищение не проходит ни один диаметр,
  // и перебор доходил до конца ряда: на реконструкции по ул. Станкевича, где
  // притока по зданиям нет, в план шло «Ø2400» с замечанием о переполнении —
  // при нулевом-то расходе. Диаметр здесь не подбирается, а принимается по
  // техническим условиям, и сказать об этом надо прямо.
  if (!(flowLps > 0)) {
    const adopted = candidates[0] ?? minDia
    return {
      diameterMm: adopted,
      slope: Math.round(Math.max(groundSlope, minSlopeForDiameter(adopted)?.value ?? 0, 0.0005) * 1e5) / 1e5,
      fillRatio: 0,
      velocityMs: 0,
      flowLps,
      issues: [
        {
          code: 'noDesignFlow',
          refs: ['sewer.minDiameter'],
          message: 'Расчётного расхода нет: диаметр не подобран, а принят наименьший из заданного ряда.'
            + ' Задайте ряд по техническим условиям либо приток по зданиям',
        },
      ],
    }
  }

  if (opts.strategy === 'minBurial') {
    // For every diameter find the smallest workable slope (filling and
    // self-cleaning both satisfied). The first diameter whose required slope
    // fits the ground slope wins (the pipe follows the terrain, burial stays
    // constant); on flat terrain the flattest required slope wins.
    const makeDesign = (D: number, slope: number): GravitySegmentDesign => {
      const Dm = D / 1000
      const fill = fillForFlow(Q, Dm, slope, n) ?? 0.99
      const v = manningVelocity(circularSection(Dm, fill).hydraulicRadiusM, slope, n)
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
    let flattest: { D: number; slope: number } | null = null
    for (const D of candidates) {
      const Dm = D / 1000
      const minV = minVelocityMps(D, system, opts.stormRainPeriodYears).value
      const normMin = minSlopeForDiameter(D)?.value ?? 0
      let required: number | null = null
      for (let slope = Math.max(normMin, 0.0003); slope <= SLOPE_CAP + 1e-9; slope *= 1.05) {
        const fill = fillForFlow(Q, Dm, slope, n)
        if (fill === null || fill > maxFillR) continue
        const v = manningVelocity(circularSection(Dm, fill).hydraulicRadiusM, slope, n)
        if (v < minV) continue
        required = slope
        break
      }
      if (required === null) continue // over capacity even at the cap
      if (required <= Math.max(groundSlope, 0.0003) + 1e-9) {
        // Lay along the terrain: never flatter than required.
        return makeDesign(D, Math.max(required, Math.min(groundSlope, SLOPE_CAP)))
      }
      if (!flattest || required < flattest.slope) flattest = { D, slope: required }
    }
    if (flattest) return makeDesign(flattest.D, flattest.slope)
    // No diameter carries the flow: fall through to the minDiameter loop,
    // which produces the honest over-filled fallback.
  }

  for (const D of candidates) {
    const Dm = D / 1000
    const minV = minVelocityMps(D, system, opts.stormRainPeriodYears).value
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
          message: `Наполнение превышает допустимое ${maxFillR}; требуется больший диаметр, чем ${catalogue[catalogue.length - 1] ?? minDia} мм`,
        },
      ],
    }
  }

  return (
    fallback ?? {
      diameterMm: catalogue[0] ?? 0,
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
  options: {
    outletNodeId?: string
    includePipe?: (pipe: TracedNetwork['pipes'][number]) => boolean
  } = {},
): Map<string, number> {
  const outlet = options.outletNodeId
    ? network.nodes.find((n) => n.id === options.outletNodeId)
    : network.nodes.find((n) => n.kind === 'source' || n.kind === 'lns_inlet' || n.kind === 'pumping_station' || n.kind === 'outlet' || n.kind === 'outfall')
  const flowByPipe = new Map<string, number>()
  for (const p of network.pipes) flowByPipe.set(p.id, 0)
  if (!outlet) return flowByPipe

  // Undirected adjacency: node -> [{to, pipeId}].
  const adj = new Map<string, Array<{ to: string; pipeId: string }>>()
  for (const p of network.pipes) {
    if (options.includePipe && !options.includePipe(p)) continue
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
    if (node.kind !== 'building' && node.kind !== 'facility_inflow' && node.kind !== 'treatment_facility' && !node.buildingId) continue
    const flow = buildingFlowLps.get(node.buildingId ?? node.id) ?? node.designFlowLps ?? 0
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
  /** Freezing depth for min burial (п. 7.2.4). Omission leaves the profile blocked/null. */
  freezingDepthM?: number
  /** Design criterion per segment; see GravityDesignOptions.strategy. */
  strategy?: 'minDiameter' | 'minBurial'
  /** Explicit gravity outlet (normally the LNS inlet), not the final pressure outlet. */
  outletNodeId?: string
  /** Project catalogue diameter series. */
  allowedDiametersMm?: readonly number[]
  /** Confirmed storm design-rain period P for the minimum-velocity check. */
  stormRainPeriodYears?: number
}): GravityNetworkResult {
  const isGravityPipe = (pipe: TracedNetwork['pipes'][number]) =>
    pipe.systemType !== 'pressure' && pipe.kind !== 'pressure_main' && pipe.kind !== 'discharge'
  const flows = accumulateGravityFlows(input.network, input.buildingFlowLps, {
    outletNodeId: input.outletNodeId,
    includePipe: isGravityPipe,
  })
  const nodeById = new Map(input.network.nodes.map((n) => [n.id, n]))
  const outlet = input.outletNodeId
    ? input.network.nodes.find((n) => n.id === input.outletNodeId)
    : input.network.nodes.find((n) => n.kind === 'source' || n.kind === 'lns_inlet' || n.kind === 'pumping_station' || n.kind === 'outlet' || n.kind === 'outfall')

  const pipes: GravityPipeResult[] = input.network.pipes.filter(isGravityPipe).map((p) => {
    const from = nodeById.get(p.fromNode)
    const to = nodeById.get(p.toNode)
    const drop = from && to ? Math.abs(from.groundElevation - to.groundElevation) : 0
    const groundSlope = p.lengthM > 0 ? drop / p.lengthM : 0
    const flowLps = flows.get(p.id) ?? 0
    const design = designGravitySegment(flowLps, {
      system: input.system,
      roughness: input.roughness,
      groundSlope,
      strategy: input.strategy,
      allowedDiametersMm: input.allowedDiametersMm,
      stormRainPeriodYears: input.stormRainPeriodYears,
    })
    return { ...design, id: p.id, fromNode: p.fromNode, toNode: p.toNode, lengthM: p.lengthM }
  })

  const outletFlowLps = outlet
    ? input.network.pipes
        .filter((p) => isGravityPipe(p) && (p.fromNode === outlet.id || p.toNode === outlet.id))
        .reduce((sum, pipe) => sum + (flows.get(pipe.id) ?? 0), 0)
    : 0

  const design = new Map(pipes.map((p) => [p.id, { diameterMm: p.diameterMm, slope: p.slope }]))
  const profile = input.freezingDepthM == null
    ? null
    : computeGravityProfile({
      network: {
        nodes: input.network.nodes.map((node) => node.id === outlet?.id ? { ...node, kind: 'source' as const } : node),
        pipes: input.network.pipes.filter(isGravityPipe),
        totalLengthM: input.network.pipes.filter(isGravityPipe).reduce((sum, pipe) => sum + pipe.lengthM, 0),
      },
      design,
      freezingDepthM: input.freezingDepthM,
    })

  return { kind: 'gravity', systemType: input.system, pipes, outletFlowLps, profile }
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
  /** Pipe ids represented by this longitudinal profile, in head-to-outlet order. */
  pipeIds: string[]
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
  const minimumInvertDepth = (diameterMm: number): number =>
    minSewerInvertDepthM(diameterMm, freezingDepthM).value

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
    const byMinimumDepth = node.groundElevation - minimumInvertDepth(D)
    let inv = byMinimumDepth
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
  const pathPipeIds: string[] = []
  let cur = head
  const guard = new Set<string>()
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    pathHeadToOutlet.push(cur)
    if (cur === outlet.id) break
    const pipeId = parentPipe.get(cur)
    if (pipeId) pathPipeIds.push(pipeId)
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
    pipeIds: pathPipeIds,
  }
}

export interface GravityFeasibility {
  /** Падение местности от верховой станции до выпуска, м. */
  availableFallM: number
  /** Падение, которого требуют принятые уклоны, м. */
  requiredFallM: number
  /** Сколько лотку приходится добирать заглублением, м. */
  shortfallM: number
  maxDepthM: number
  /** Уклон местности по трассе, ‰. */
  terrainSlopePermille: number
  /** Средний принятый уклон, ‰. */
  designSlopePermille: number
  feasible: boolean
  reason: string
}

/**
 * Осуществим ли самотёк по этой трассе.
 *
 * Самотёчный коллектор опирается на падение местности. Когда его не хватает,
 * решатель всё равно выдаёт профиль — просто лоток уходит всё глубже, и на
 * длинной трассе глубина вырастает до величин, при которых копать уже нельзя.
 * Ошибкой это не считается ни на одном участке по отдельности: каждый из них
 * по норме исправен, а неосуществима трасса целиком.
 *
 * На Талдыколе это видно в чистом виде: 2,5 м падения на 16,3 км — 0,15 ‰ при
 * потребных единицах ‰, — и профиль уходит на 59 м.
 *
 * Своего предела глубины функция не вводит: величина зависит от грунтов и
 * способа производства работ, в имеющемся комплекте нормативов её нет.
 * Сравнивается только требуемое падение с фактическим, а вывод — что разницу
 * придётся добирать заглублением, перепадными колодцами (п. 7.4.5) или
 * насосной станцией. Решение за инженером.
 */
export function assessGravityFeasibility(
  profile: GravityProfile,
  design: Map<string, { diameterMm: number; slope: number }>,
): GravityFeasibility {
  const stations = profile.stations
  if (stations.length < 2) {
    return {
      availableFallM: 0, requiredFallM: 0, shortfallM: 0, maxDepthM: profile.maxDepthM,
      terrainSlopePermille: 0, designSlopePermille: 0, feasible: true,
      reason: 'Трасса короче двух станций: осуществимость самотёка не оценивается.',
    }
  }
  const head = stations[0]
  const outlet = stations[stations.length - 1]
  const lengthM = Math.abs(outlet.chainageM - head.chainageM)
  const availableFallM = head.groundElevationM - outlet.groundElevationM
  // Уклон безразмерный, поэтому требуемое падение — сумма «уклон × длина
  // участка» по фактическим расстояниям между станциями.
  let requiredFallM = 0
  for (let i = 1; i < stations.length; i++) {
    const span = Math.abs(stations[i].chainageM - stations[i - 1].chainageM)
    const pipeId = profile.pipeIds[i - 1]
    const slope = design.get(pipeId)?.slope ?? 0
    requiredFallM += span * slope
  }
  const shortfallM = Math.round((requiredFallM - availableFallM) * 100) / 100
  const terrainSlopePermille = lengthM > 0 ? (availableFallM / lengthM) * 1000 : 0
  const designSlopePermille = lengthM > 0 ? (requiredFallM / lengthM) * 1000 : 0
  const feasible = shortfallM <= 0
  return {
    availableFallM: Math.round(availableFallM * 100) / 100,
    requiredFallM: Math.round(requiredFallM * 100) / 100,
    shortfallM,
    maxDepthM: profile.maxDepthM,
    terrainSlopePermille: Math.round(terrainSlopePermille * 100) / 100,
    designSlopePermille: Math.round(designSlopePermille * 100) / 100,
    feasible,
    reason: feasible
      ? `Падения местности хватает: ${Math.round(availableFallM * 100) / 100} м при потребных `
        + `${Math.round(requiredFallM * 100) / 100} м на ${lengthM.toFixed(0)} м трассы.`
      : `Падения местности не хватает на ${shortfallM} м: уклон местности `
        + `${(Math.round(terrainSlopePermille * 100) / 100).toFixed(2)} ‰ против потребных `
        + `${(Math.round(designSlopePermille * 100) / 100).toFixed(2)} ‰ на ${lengthM.toFixed(0)} м. `
        + `Разницу добирает заглубление — наибольшая глубина ${profile.maxDepthM} м. `
        + 'Одним самотёчным участком трасса не решается: нужны перепадные колодцы, '
        + 'разбивка на бассейны или насосная станция. Решение принимает инженер.',
  }
}

export interface GravityBasin {
  /** Номер бассейна от верховья, с 1. */
  index: number
  fromNodeId: string
  toNodeId: string
  fromChainageM: number
  toChainageM: number
  lengthM: number
  /** Наибольшая глубина в бассейне, м. */
  maxDepthM: number
  /** В конце бассейна нужна перекачка; у последнего — выпуск. */
  liftAtEnd: boolean
}

export interface GravityLift {
  nodeId: string
  chainageM: number
  /** Глубина лотка перед подъёмом, м. */
  incomingDepthM: number
  /** Насколько лоток поднимается до минимального заглубления, м. */
  liftHeightM: number
}

export interface GravityBasinPlan {
  basins: GravityBasin[]
  lifts: GravityLift[]
  /** Наибольшая глубина после разбивки, м. */
  maxDepthM: number
  reason: string
}

/**
 * Разбивка трассы на самотёчные бассейны.
 *
 * Когда падения местности не хватает (см. `assessGravityFeasibility`), лоток
 * уходит всё глубже и на длинной трассе доходит до глубин, на которых копать
 * уже нельзя. Обычное решение — разбить трассу на самотёчные бассейны и в конце
 * каждого поднять поток насосной станцией.
 *
 * Предел глубины — вход, а не константа: он зависит от грунтов и способа
 * производства работ, и в имеющемся комплекте нормативов его нет. Естественный
 * источник — каталог конструкций колодцев проекта: глубже самой глубокой
 * позиции каталога колодец просто не из чего собрать.
 *
 * Насосная станция ставится там, где глубина впервые превышает предел, а не
 * задним числом в удобном месте: место определяется трассой и рельефом.
 * Гидравлику напорного участка функция не считает — это отдельная задача.
 */
export function planGravityBasins(
  profile: GravityProfile,
  design: Map<string, { diameterMm: number; slope: number }>,
  options: { maxDepthM: number; freezingDepthM: number },
): GravityBasinPlan {
  const stations = profile.stations
  const minDepth = (diameterMm: number) =>
    minSewerInvertDepthM(diameterMm || minGravityDiameterMm('sewer', 'street').value, options.freezingDepthM).value

  if (stations.length < 2 || !(options.maxDepthM > 0)) {
    return {
      basins: [], lifts: [], maxDepthM: profile.maxDepthM,
      reason: 'Разбивка не выполняется: нужна трасса от двух станций и положительный предел глубины.',
    }
  }

  const lifts: GravityLift[] = []
  const basins: GravityBasin[] = []
  let invert = stations[0].groundElevationM - minDepth(stations[0].diameterMm)
  let basinStart = 0
  let basinMaxDepth = stations[0].groundElevationM - invert
  let overallMaxDepth = basinMaxDepth

  const closeBasin = (endIndex: number, liftAtEnd: boolean) => {
    basins.push({
      index: basins.length + 1,
      fromNodeId: stations[basinStart].nodeId,
      toNodeId: stations[endIndex].nodeId,
      fromChainageM: stations[basinStart].chainageM,
      toChainageM: stations[endIndex].chainageM,
      lengthM: Math.round(Math.abs(stations[endIndex].chainageM - stations[basinStart].chainageM) * 100) / 100,
      maxDepthM: Math.round(basinMaxDepth * 100) / 100,
      liftAtEnd,
    })
  }

  for (let i = 1; i < stations.length; i++) {
    const station = stations[i]
    const span = Math.abs(station.chainageM - stations[i - 1].chainageM)
    const slope = design.get(profile.pipeIds[i - 1])?.slope ?? 0
    // Тот же расчёт, что и в профиле: лоток идёт по уклону, но не выше
    // минимального заглубления.
    invert = Math.min(station.groundElevationM - minDepth(station.diameterMm), invert - slope * span)
    const depth = station.groundElevationM - invert

    if (depth > options.maxDepthM) {
      // Предел превышен: здесь и стоит насосная станция.
      const raised = station.groundElevationM - minDepth(station.diameterMm)
      lifts.push({
        nodeId: station.nodeId,
        chainageM: station.chainageM,
        incomingDepthM: Math.round(depth * 100) / 100,
        liftHeightM: Math.round((raised - invert) * 100) / 100,
      })
      basinMaxDepth = Math.max(basinMaxDepth, depth)
      overallMaxDepth = Math.max(overallMaxDepth, depth)
      closeBasin(i, true)
      basinStart = i
      invert = raised
      basinMaxDepth = station.groundElevationM - invert
      continue
    }
    basinMaxDepth = Math.max(basinMaxDepth, depth)
    overallMaxDepth = Math.max(overallMaxDepth, depth)
  }
  closeBasin(stations.length - 1, false)

  return {
    basins,
    lifts,
    maxDepthM: Math.round(overallMaxDepth * 100) / 100,
    reason: lifts.length === 0
      ? `Трасса решается одним самотёчным бассейном: наибольшая глубина ${Math.round(overallMaxDepth * 100) / 100} м `
        + `при пределе ${options.maxDepthM} м.`
      : `Трасса разбита на ${basins.length} самотёчных бассейна(ов) с ${lifts.length} перекачкой(ами): `
        + `предел глубины ${options.maxDepthM} м достигается на пикетах `
        + `${lifts.map((lift) => lift.chainageM.toFixed(0)).join(', ')} м. `
        + 'Гидравлика напорных участков здесь не считается — это отдельная задача.',
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
  /** Network node represented by this row; present for calculated schedules. */
  nodeId?: string
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
  /** Unique manholes across the main collector and calculated branch profiles. */
  manholes: SewerScheduleManhole[]
  /** Pipe totals by diameter across the whole network. */
  pipes: SewerSchedulePipe[]
  totalPipeLengthM: number
  /**
   * Участки без диаметра или длины: в ведомость труб они не попали. Список
   * возвращается, а не проглатывается, — иначе строка исчезает молча и разница
   * между «нет участка» и «участок без величины» теряется.
   */
  incompletePipeIds?: string[]
}

export interface BuildSewerScheduleOptions {
  /** Calculated off-main profiles. Shared junction nodes are included once. */
  branchProfiles?: readonly GravityProfile[]
}

/**
 * Materials schedule (ведомость колодцев и труб) for К1, at the level the model
 * knows: manhole number, picket, full depth and pipe diameter across the main
 * collector and calculated branches, plus pipe totals by diameter. The
 * main-profile station is authoritative when a branch shares its junction.
 * The per-element consumption
 * (КС/ПД/КО rings, скобы, гидроизоляция) comes from a типовой проект such as
 * ТПР 902-09-22.84 by manhole depth and diameter, which is NOT invented here.
 */
export function buildSewerSchedule(
  result: GravityNetworkResult,
  options: BuildSewerScheduleOptions = {},
): SewerSchedule {
  const mainStations = result.profile?.stations ?? []
  const outletNodeId = mainStations.at(-1)?.nodeId
  const stations: ProfileStation[] = []
  const seenNodeIds = new Set<string>()
  for (const profileStations of [mainStations, ...(options.branchProfiles ?? []).map((profile) => profile.stations)]) {
    for (const station of profileStations) {
      if (seenNodeIds.has(station.nodeId)) continue
      seenNodeIds.add(station.nodeId)
      stations.push(station)
    }
  }

  let manholeNumber = 0
  const manholes: SewerScheduleManhole[] = stations.map((s) => ({
    nodeId: s.nodeId,
    label: s.nodeId === outletNodeId ? 'Вып.' : `ВК-${++manholeNumber}`,
    picket: picketLabel(s.chainageM),
    depthMm: Math.round(s.depthM * 1000),
    pipeDiameterMm: s.diameterMm,
  }))

  // Участок без диаметра или длины в ведомость труб не идёт. Прежде он
  // попадал туда строкой «Труба безнапорная Øundefined» на «NaN м»: такая
  // строка выглядит позицией, а не пробелом, и уходит в спецификацию к
  // сметчику. Отсутствие величины должно быть видно как отсутствие.
  const lengthByDiameter = new Map<number, number>()
  const incompletePipeIds: string[] = []
  for (const p of result.pipes) {
    if (!Number.isFinite(p.diameterMm) || !(p.diameterMm > 0) || !Number.isFinite(p.lengthM)) {
      incompletePipeIds.push(p.id)
      continue
    }
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
  const totalPipeLengthM = Math.round(result.pipes.reduce(
    (sum, p) => sum + (Number.isFinite(p.lengthM) ? p.lengthM : 0), 0))

  return {
    manholes,
    pipes,
    totalPipeLengthM,
    ...(incompletePipeIds.length > 0 ? { incompletePipeIds } : {}),
  }
}
