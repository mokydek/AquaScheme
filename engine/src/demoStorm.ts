import type { NetworkCoordinate, TracedNetwork } from './trace'

/**
 * Small, entirely synthetic storm-network example.
 *
 * The demo is intentionally unrelated to the confidential acceptance object:
 * it uses a local coordinate system, generic labels and invented dimensions.
 * Its purpose is to exercise the calculation and drawing workflow. It must
 * never be treated as surveyed or construction-ready input.
 */
export const STORM_DEMO_TOTAL_M = 2400
export const STORM_DEMO_STEP_M = 100

export const STORM_DEMO_INFLOWS: Array<{ label: string; atM: number; flowLps: number }> = [
  { label: 'Источник A', atM: 0, flowLps: 12 },
  { label: 'Источник B', atM: 900, flowLps: 18 },
  { label: 'Источник C', atM: 1800, flowLps: 9 },
]

export interface StormDemo {
  network: TracedNetwork
  sources: Array<{ label: string; x: number; y: number; flowLps: number }>
  outletFlowLps: number
}

export interface PersistedStormDemoBuilding {
  id: string
  x: number
  y: number
}

function coordinateKey(x: number, y: number): string {
  return `${x.toFixed(6)}:${y.toFixed(6)}`
}

/** Bind synthetic source nodes to the real IDs returned by the database. */
export function bindStormDemoBuildingIds(
  network: TracedNetwork,
  buildings: PersistedStormDemoBuilding[],
): TracedNetwork {
  const idByCoordinate = new Map(buildings.map((building) => [
    coordinateKey(building.x, building.y),
    building.id,
  ]))
  const missing: string[] = []
  const nodes = network.nodes.map((node) => {
    if (node.kind !== 'building') return node
    const buildingId = idByCoordinate.get(coordinateKey(node.x, node.y))
    if (!buildingId) {
      missing.push(node.id)
      return node
    }
    return { ...node, buildingId }
  })
  if (missing.length > 0) {
    throw new Error(`Не найдены сохранённые здания для узлов: ${missing.join(', ')}.`)
  }
  return { ...network, nodes }
}

export function stormDemoAxisAt(stationM: number): NetworkCoordinate {
  const y = stationM
  const x = stationM <= 800
    ? stationM * 0.04
    : stationM <= 1600
      ? 32 - (stationM - 800) * 0.065
      : -20 + (stationM - 1600) * 0.05
  return { x: Math.round(x * 100) / 100, y }
}

export function stormDemoElevationAt(stationM: number): number {
  return Math.round((100 - stationM * 0.002) * 100) / 100
}

function lineLength(points: NetworkCoordinate[]): number {
  return points.slice(1).reduce(
    (sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y),
    0,
  )
}

export function buildStormDemo(): StormDemo {
  const nodes: TracedNetwork['nodes'] = []
  const pipes: TracedNetwork['pipes'] = []
  const stations: number[] = []
  for (let station = 0; station <= STORM_DEMO_TOTAL_M; station += STORM_DEMO_STEP_M) stations.push(station)

  stations.forEach((station, index) => {
    const point = stormDemoAxisAt(station)
    nodes.push({
      id: `M${index}`,
      kind: index === stations.length - 1 ? 'source' : 'junction',
      ...point,
      groundElevation: stormDemoElevationAt(station),
      dataSource: 'synthetic-demo',
    })
    if (index > 0) {
      const previous = stormDemoAxisAt(stations[index - 1])
      const middle = stormDemoAxisAt((stations[index - 1] + station) / 2)
      const alignment = [previous, middle, point]
      pipes.push({
        id: `P${index}`,
        kind: 'main',
        fromNode: `M${index - 1}`,
        toNode: `M${index}`,
        lengthM: lineLength(alignment),
        alignment,
        dataSource: 'synthetic-demo',
      })
    }
  })

  const sources: StormDemo['sources'] = []
  STORM_DEMO_INFLOWS.forEach((inflow, index) => {
    const nearest = Math.round(inflow.atM / STORM_DEMO_STEP_M)
    const target = stormDemoAxisAt(nearest * STORM_DEMO_STEP_M)
    const source = { x: target.x + 60, y: target.y }
    const id = `OS${index + 1}`
    nodes.push({
      id,
      kind: 'building',
      ...source,
      groundElevation: stormDemoElevationAt(target.y),
      dataSource: 'synthetic-demo',
    })
    pipes.push({
      id: `S${index + 1}`,
      kind: 'service',
      fromNode: id,
      toNode: `M${nearest}`,
      lengthM: 60,
      alignment: [source, target],
      dataSource: 'synthetic-demo',
    })
    sources.push({ label: inflow.label, ...source, flowLps: inflow.flowLps })
  })

  return {
    network: { nodes, pipes, totalLengthM: pipes.reduce((sum, pipe) => sum + pipe.lengthM, 0) },
    sources,
    outletFlowLps: STORM_DEMO_INFLOWS.reduce((sum, inflow) => sum + inflow.flowLps, 0),
  }
}
