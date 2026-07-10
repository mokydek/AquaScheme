import type { NetworkNode, TracedNetwork } from './trace'

/**
 * Materials, burial depth and appurtenances.
 *
 * Rules (SP RK 4.01-101-2012 / SP RK 2.03-30-2017 / SNiP 2.04.02-84*):
 *  - aggressive soils or high groundwater: non metallic pipes are preferred;
 *  - site seismicity of 7 points and above: welded PE joints or ductile iron
 *    with flexible sockets, compensation inserts at wells and at building
 *    entries (SP RK 2.03-30);
 *  - pressure class is selected with a margin over the working pressure;
 *  - burial: pipe bottom 0.5 m below the design freezing depth
 *    (SNiP 2.04.02-84*, TODO: confirm the exact clause number);
 *  - fire hydrants along the mains with spacing of at most 150 m;
 *  - air valves at local high points, washouts at local low points,
 *    sectioning gate valves, manholes at every equipped node.
 */

export interface GeologyInput {
  soilType: 'sand' | 'loam' | 'clay' | 'rock'
  groundwaterDepthM: number
  corrosivity: 'low' | 'medium' | 'high'
  freezingDepthM: number
}

export interface SeismicInput {
  siteIntensityPoints: number
  subsidenceProne: boolean
  floodProne: boolean
}

export type PipeMaterialCode =
  | 'PE100_SDR17'
  | 'PE100_SDR11'
  | 'DUCTILE_IRON'
  | 'STEEL'
  | 'PVC'

export type MaterialReasonCode =
  | 'corrosionProtection'
  | 'seismicJoints'
  | 'subsidence'
  | 'flood'
  | 'pressureClass'
  | 'freezingDepth'

export interface MaterialSelection {
  primary: PipeMaterialCode
  alternative: PipeMaterialCode
  pnBar: number
  jointType: 'welded' | 'flexibleSocket'
  needsCompensators: boolean
  burialDepthM: number
  reasons: MaterialReasonCode[]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Pipe bottom depth: 0.5 m below the design freezing depth. */
export function burialDepthM(freezingDepthM: number): number {
  return round2(freezingDepthM + 0.5)
}

export function selectMaterials(input: {
  geology: GeologyInput
  seismicity: SeismicInput
  /** Maximum working pressure in the network, m of water column. */
  maxPressureM: number
}): MaterialSelection {
  const { geology, seismicity, maxPressureM } = input
  const reasons: MaterialReasonCode[] = []

  // Pressure class with a 25 percent margin, in bars.
  const requiredPn = Math.max(10, Math.ceil((maxPressureM / 10) * 1.25))
  const primary: PipeMaterialCode = requiredPn > 10 ? 'PE100_SDR11' : 'PE100_SDR17'
  const pnBar = requiredPn > 10 ? 16 : 10
  reasons.push('pressureClass')

  const aggressiveSoil = geology.corrosivity !== 'low'
  const highGroundwater = geology.groundwaterDepthM < 3
  if (aggressiveSoil || highGroundwater) reasons.push('corrosionProtection')

  const seismic = seismicity.siteIntensityPoints >= 7
  if (seismic) reasons.push('seismicJoints')
  if (seismicity.subsidenceProne) reasons.push('subsidence')
  if (seismicity.floodProne) reasons.push('flood')

  reasons.push('freezingDepth')

  return {
    primary,
    alternative: 'DUCTILE_IRON',
    pnBar,
    jointType: 'welded',
    needsCompensators: seismic || seismicity.subsidenceProne,
    burialDepthM: burialDepthM(geology.freezingDepthM),
    reasons,
  }
}

export type FittingType = 'hydrant' | 'valve' | 'airValve' | 'washout'

export interface FittingsPlan {
  items: Array<{ nodeId: string; types: FittingType[] }>
  wells: Array<{ nodeId: string; label: string }>
  counts: { hydrants: number; valves: number; airValves: number; washouts: number; wells: number }
}

export interface FittingsOptions {
  /** Maximum hydrant spacing along the mains, m. */
  hydrantSpacingM?: number
  /** Maximum length of a ring section between gate valves, m. */
  valveSpacingM?: number
}

const FITTINGS_DEFAULTS: Required<FittingsOptions> = {
  hydrantSpacingM: 150,
  valveSpacingM: 400,
}

function distance(a: NetworkNode, b: NetworkNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Greedy placement along an ordered path of nodes: an item goes to the
 * previous node whenever adding the next segment would exceed the spacing.
 * Guarantees the distance between marked nodes never exceeds the spacing
 * (segments themselves are shorter than the spacing by construction).
 */
function placeAlongPath(path: NetworkNode[], spacingM: number, marked: Set<string>): void {
  if (path.length === 0) return
  marked.add(path[0].id)
  let sinceLast = 0
  for (let i = 1; i < path.length; i++) {
    const segment = distance(path[i - 1], path[i])
    if (sinceLast + segment > spacingM) {
      marked.add(path[i - 1].id)
      sinceLast = segment
    } else {
      sinceLast += segment
    }
    if (marked.has(path[i].id)) sinceLast = 0
  }
}

function localExtremes(
  path: NetworkNode[],
  cyclic: boolean,
): { maxima: string[]; minima: string[] } {
  const maxima: string[] = []
  const minima: string[] = []
  const n = path.length
  if (n < 3) return { maxima, minima }
  const start = cyclic ? 0 : 1
  const end = cyclic ? n : n - 1
  for (let i = start; i < end; i++) {
    const prev = path[(i - 1 + n) % n].groundElevation
    const current = path[i].groundElevation
    const next = path[(i + 1) % n].groundElevation
    if (current > prev && current > next) maxima.push(path[i].id)
    if (current < prev && current < next) minima.push(path[i].id)
  }
  return { maxima, minima }
}

export function placeFittings(network: TracedNetwork, options: FittingsOptions = {}): FittingsPlan {
  const opt = { ...FITTINGS_DEFAULTS, ...options }
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]))

  // Ring path in construction order R1..Rn, closed back to R1.
  const ringNodes = network.nodes
    .filter((n) => n.kind === 'ring')
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  const ringPath = ringNodes.length > 0 ? [...ringNodes, ringNodes[0]] : []

  // Cross main chain in pipe order: west ring node, C1..Ck, east ring node.
  const crossPipes = network.pipes.filter((p) => p.kind === 'cross')
  const crossPath: NetworkNode[] = []
  if (crossPipes.length > 0) {
    const first = nodeById.get(crossPipes[0].fromNode)
    if (first) crossPath.push(first)
    for (const pipe of crossPipes) {
      const next = nodeById.get(pipe.toNode)
      if (next) crossPath.push(next)
    }
  }

  const hydrants = new Set<string>()
  placeAlongPath(ringPath, opt.hydrantSpacingM, hydrants)
  placeAlongPath(crossPath, opt.hydrantSpacingM, hydrants)

  const valves = new Set<string>()
  if (ringNodes.length > 0) valves.add(ringNodes[0].id)
  if (crossPath.length > 1) {
    valves.add(crossPath[0].id)
    valves.add(crossPath[crossPath.length - 1].id)
  }
  placeAlongPath(ringPath, opt.valveSpacingM, valves)

  const airValves = new Set<string>()
  const washouts = new Set<string>()
  const ringExtremes = localExtremes(ringNodes, true)
  const crossExtremes = localExtremes(crossPath, false)
  for (const id of [...ringExtremes.maxima, ...crossExtremes.maxima]) airValves.add(id)
  for (const id of [...ringExtremes.minima, ...crossExtremes.minima]) washouts.add(id)

  // Assemble per node; wells at every equipped node, numbered in path order.
  const orderedIds = [
    ...ringNodes.map((n) => n.id),
    ...crossPath.slice(1, Math.max(1, crossPath.length - 1)).map((n) => n.id),
  ]
  const items: FittingsPlan['items'] = []
  const wells: FittingsPlan['wells'] = []
  let wellIndex = 0
  for (const id of orderedIds) {
    const types: FittingType[] = []
    if (hydrants.has(id)) types.push('hydrant')
    if (valves.has(id)) types.push('valve')
    if (airValves.has(id)) types.push('airValve')
    if (washouts.has(id)) types.push('washout')
    if (types.length > 0) {
      items.push({ nodeId: id, types })
      wellIndex++
      wells.push({ nodeId: id, label: `ВК-${wellIndex}` })
    }
  }

  return {
    items,
    wells,
    counts: {
      hydrants: hydrants.size,
      valves: valves.size,
      airValves: airValves.size,
      washouts: washouts.size,
      wells: wells.length,
    },
  }
}
