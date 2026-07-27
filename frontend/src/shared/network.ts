import { supabase } from './supabase'
import { ROUTE_ALGORITHM_VERSION } from '@aquascheme/engine'
import type { EngineeringRouteStatus, NetworkNodeKind, NetworkPipeKind, TracedNetwork } from '@aquascheme/engine'

export interface NodeMeta {
  engineKind?: string
  engineId?: string
  pressureM?: number
  headM?: number
  requiredPressureM?: number | null
  ok?: boolean
  fittings?: string[]
  wellLabel?: string | null
}

export interface PipeMeta {
  kind?: string
  engineId?: string
  flowLps?: number
  velocityMs?: number
  headlossM?: number
  internalMm?: number
}

export interface NodeRow {
  id: string
  kind: string
  label: string | null
  x: number
  y: number
  ground_elevation: number | null
  building_id: string | null
  design_flow_lps?: number | null
  invert_elevation_m?: number | null
  system_type?: string | null
  source_entity?: string | null
  data_source?: string | null
  meta: NodeMeta | null
}

export interface PipeRow {
  id: string
  from_node: string
  to_node: string
  length_m: number | null
  diameter_mm: number | null
  material: string | null
  engineering_kind?: string | null
  system_type?: string | null
  parallel_count?: number | null
  alignment?: Array<{ x: number; y: number }> | null
  source_layer?: string | null
  source_entity?: string | null
  flow_direction?: 'from_to' | 'to_from' | 'unknown' | null
  inner_diameter_mm?: number | null
  sdr?: number | null
  sn?: number | null
  pn?: number | null
  roughness_mm?: number | null
  slope?: number | null
  start_invert_m?: number | null
  end_invert_m?: number | null
  cover_m?: number | null
  design_flow_lps?: number | null
  velocity_mps?: number | null
  filling_ratio?: number | null
  pressure_m?: number | null
  calculation_status?: 'unverified' | 'preliminary' | 'calculated' | 'blocked' | null
  data_source?: string | null
  meta: PipeMeta | null
}

/** Rebuild the engine network from database rows (labels are engine ids). */
export function networkFromRows(nodes: NodeRow[], pipes: PipeRow[]): TracedNetwork {
  const engineIdByDbId = new Map(nodes.map((n) => [n.id, n.meta?.engineKind ? (n.meta.engineId ?? n.label ?? n.id) : (n.label ?? n.id)]))
  return {
    nodes: nodes.map((n) => ({
      id: engineIdByDbId.get(n.id) ?? n.id,
      kind: (n.meta?.engineKind ?? (n.kind === 'source' ? 'source' : 'ring')) as NetworkNodeKind,
      label: n.label ?? undefined,
      x: n.x,
      y: n.y,
      groundElevation: n.ground_elevation ?? 0,
      buildingId: n.building_id ?? undefined,
      designFlowLps: n.design_flow_lps ?? undefined,
      invertElevationM: n.invert_elevation_m ?? undefined,
      systemType: n.system_type as 'gravity' | 'pressure' | 'non_hydraulic' | undefined,
      sourceEntity: n.source_entity ?? undefined,
      dataSource: n.data_source ?? undefined,
    })),
    pipes: pipes.map((p) => ({
      id: p.meta?.engineId ?? p.id,
      kind: (p.engineering_kind ?? p.meta?.kind ?? 'ring') as NetworkPipeKind,
      fromNode: engineIdByDbId.get(p.from_node) ?? p.from_node,
      toNode: engineIdByDbId.get(p.to_node) ?? p.to_node,
      lengthM: p.length_m ?? 0,
      diameterMm: p.diameter_mm ?? undefined,
      material: p.material ?? undefined,
      parallelCount: p.parallel_count ?? undefined,
      systemType: p.system_type as 'gravity' | 'pressure' | 'non_hydraulic' | undefined,
      alignment: p.alignment ?? undefined,
      sourceLayer: p.source_layer ?? undefined,
      sourceEntity: p.source_entity ?? undefined,
      flowDirection: p.flow_direction ?? undefined,
      innerDiameterMm: p.inner_diameter_mm ?? undefined,
      sdr: p.sdr ?? undefined,
      sn: p.sn ?? undefined,
      pn: p.pn ?? undefined,
      roughnessMm: p.roughness_mm ?? undefined,
      slope: p.slope ?? undefined,
      startInvertM: p.start_invert_m ?? undefined,
      endInvertM: p.end_invert_m ?? undefined,
      coverM: p.cover_m ?? undefined,
      designFlowLps: p.design_flow_lps ?? undefined,
      velocityMs: p.velocity_mps ?? undefined,
      fillingRatio: p.filling_ratio ?? undefined,
      pressureM: p.pressure_m ?? undefined,
      calculationStatus: p.calculation_status ?? undefined,
      dataSource: p.data_source ?? undefined,
    })),
    totalLengthM: pipes.reduce((sum, p) => sum + (p.length_m ?? 0), 0),
  }
}

export interface RoutePersistence {
  status?: EngineeringRouteStatus
  algorithmVersion?: string
  inputHash?: string
  warnings?: string[]
  blockers?: unknown[]
  report?: unknown
}

/** Stable SHA-256 used to detect a route calculated from obsolete inputs. */
export async function routeInputHash(value: unknown): Promise<string> {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable)
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]))
    }
    return input
  }
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Replace nodes, pipes and route metadata in one PostgreSQL transaction. */
export async function replaceNetwork(
  projectId: string,
  network: TracedNetwork,
  route: RoutePersistence = {},
): Promise<void> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const invalidBuildingLinks = network.nodes
    .filter((node) => node.buildingId && !uuidPattern.test(node.buildingId))
    .map((node) => `${node.id} → ${node.buildingId}`)
  if (invalidBuildingLinks.length > 0) {
    throw new Error(`Некорректные связи узлов со зданиями: ${invalidBuildingLinks.join(', ')}. Ожидаются UUID из таблицы buildings.`)
  }
  const inputHash = route.inputHash ?? await routeInputHash(network)
  const { error } = await supabase.rpc('replace_project_network', {
    p_project_id: projectId,
    p_nodes: network.nodes,
    p_pipes: network.pipes,
    p_route_status: route.status ?? 'calculated',
    p_algorithm_version: route.algorithmVersion ?? ROUTE_ALGORITHM_VERSION,
    p_input_hash: inputHash,
    p_warnings: route.warnings ?? [],
    p_blockers: route.blockers ?? [],
    p_report: route.report ?? {},
  })
  if (error) {
    if (/replace_project_network|schema cache|function/i.test(error.message)) {
      throw new Error('Требуется применить миграцию backend/migrations/0012_engineering_route.sql в Supabase.')
    }
    throw error
  }
}
