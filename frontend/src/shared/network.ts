import { supabase } from './supabase'
import type { NetworkNodeKind, NetworkPipeKind, TracedNetwork } from '@aquascheme/engine'

export interface NodeMeta {
  engineKind?: string
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
  meta: NodeMeta | null
}

export interface PipeRow {
  id: string
  from_node: string
  to_node: string
  length_m: number | null
  diameter_mm: number | null
  material: string | null
  meta: PipeMeta | null
}

/** Rebuild the engine network from database rows (labels are engine ids). */
export function networkFromRows(nodes: NodeRow[], pipes: PipeRow[]): TracedNetwork {
  const labelById = new Map(nodes.map((n) => [n.id, n.label ?? n.id]))
  return {
    nodes: nodes.map((n) => ({
      id: n.label ?? n.id,
      kind: (n.meta?.engineKind ?? (n.kind === 'source' ? 'source' : 'ring')) as NetworkNodeKind,
      x: n.x,
      y: n.y,
      groundElevation: n.ground_elevation ?? 0,
      buildingId: n.building_id ?? undefined,
    })),
    pipes: pipes.map((p) => ({
      id: p.meta?.engineId ?? p.id,
      kind: (p.meta?.kind ?? 'ring') as NetworkPipeKind,
      fromNode: labelById.get(p.from_node) ?? p.from_node,
      toNode: labelById.get(p.to_node) ?? p.to_node,
      lengthM: p.length_m ?? 0,
    })),
    totalLengthM: pipes.reduce((sum, p) => sum + (p.length_m ?? 0), 0),
  }
}

/** Replace the project network with a freshly traced one. */
export async function replaceNetwork(projectId: string, network: TracedNetwork): Promise<void> {
  const pipesDelete = await supabase.from('pipes').delete().eq('project_id', projectId)
  if (pipesDelete.error) throw pipesDelete.error
  const nodesDelete = await supabase.from('nodes').delete().eq('project_id', projectId)
  if (nodesDelete.error) throw nodesDelete.error
  if (network.nodes.length === 0) return

  const { data: inserted, error: nodesError } = await supabase
    .from('nodes')
    .insert(
      network.nodes.map((n) => ({
        project_id: projectId,
        kind: n.kind === 'source' ? 'source' : 'junction',
        label: n.id,
        x: n.x,
        y: n.y,
        ground_elevation: n.groundElevation,
        building_id: n.buildingId ?? null,
        meta: { engineKind: n.kind },
      })),
    )
    .select('id,label')
  if (nodesError || !inserted) throw nodesError ?? new Error('nodes insert failed')

  const idByLabel = new Map(inserted.map((row) => [row.label as string, row.id as string]))
  const pipeRows = network.pipes.map((p) => ({
    project_id: projectId,
    from_node: idByLabel.get(p.fromNode),
    to_node: idByLabel.get(p.toNode),
    length_m: p.lengthM,
    meta: { kind: p.kind, engineId: p.id },
  }))
  const pipesInsert = await supabase.from('pipes').insert(pipeRows)
  if (pipesInsert.error) throw pipesInsert.error
}
