import type { TracedNetwork } from './trace'

/**
 * Deterministic demo of a flat-terrain storm trunk collector (демо
 * «водосбросной коллектор»). The engineering shape reproduces the benchmark
 * object: a ~15.8 km gravity trunk (ПК157+92.89) on almost flat terrain with
 * four side inflows from storm treatment plants and one outlet, so the
 * calculation ends the trunk at Ф2000 and the sheet set reaches the scale of
 * a professional НК album. Identifying data is deliberately NEUTRAL per the
 * benchmark confidentiality rule: generic source names (ОС-1…ОС-4) and a
 * neutral elevation datum (100.0 falling to 92.1 — the same 7.9 m drop that
 * defines the slopes, without the real site marks).
 */

export const STORM_DEMO_TOTAL_M = 15792.89
export const STORM_DEMO_STEP_M = 100

/** Side inflows, L/s (integers: the buildings.residents column is integer). */
export const STORM_DEMO_INFLOWS: Array<{ label: string; atM: number; flowLps: number }> = [
  { label: 'ОС-1', atM: 0, flowLps: 611 },
  { label: 'ОС-2', atM: 3000, flowLps: 531 },
  { label: 'ОС-3', atM: 8000, flowLps: 1155 },
  { label: 'ОС-4', atM: 15000, flowLps: 200 },
]

export interface StormDemo {
  network: TracedNetwork
  /** Source objects to store as buildings: residents = inflow, L/s. */
  sources: Array<{ label: string; x: number; y: number; flowLps: number }>
  outletFlowLps: number
}

function elevationAt(m: number): number {
  return 100.0 - (m / STORM_DEMO_TOTAL_M) * 7.9
}

export function buildStormDemo(): StormDemo {
  const nodes: TracedNetwork['nodes'] = []
  const pipes: TracedNetwork['pipes'] = []
  const stations: number[] = []
  for (let m = 0; m <= STORM_DEMO_TOTAL_M; m += STORM_DEMO_STEP_M) stations.push(m)
  if (stations[stations.length - 1] < STORM_DEMO_TOTAL_M) stations.push(STORM_DEMO_TOTAL_M)

  stations.forEach((m, i) => {
    const isOutlet = i === stations.length - 1
    nodes.push({
      id: `M${i}`,
      kind: isOutlet ? 'source' : 'junction',
      x: 0,
      y: m,
      groundElevation: Math.round(elevationAt(m) * 100) / 100,
    })
    if (i > 0) {
      pipes.push({ id: `P${i}`, kind: 'main', fromNode: `M${i - 1}`, toNode: `M${i}`, lengthM: m - stations[i - 1] })
    }
  })

  const sources: StormDemo['sources'] = []
  STORM_DEMO_INFLOWS.forEach((inflow, k) => {
    const nearest = Math.round(inflow.atM / STORM_DEMO_STEP_M)
    const id = `OS${k + 1}`
    const y = nearest * STORM_DEMO_STEP_M
    nodes.push({
      id,
      kind: 'building',
      x: 60,
      y,
      groundElevation: Math.round(elevationAt(y) * 100) / 100,
      buildingId: id,
    })
    pipes.push({ id: `S${k + 1}`, kind: 'service', fromNode: id, toNode: `M${nearest}`, lengthM: 60 })
    sources.push({ label: inflow.label, x: 60, y, flowLps: inflow.flowLps })
  })

  const totalLengthM = pipes.reduce((s, p) => s + p.lengthM, 0)
  return {
    network: { nodes, pipes, totalLengthM },
    sources,
    outletFlowLps: STORM_DEMO_INFLOWS.reduce((s, i) => s + i.flowLps, 0),
  }
}
