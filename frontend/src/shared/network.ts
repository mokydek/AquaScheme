import { supabase } from './supabase'
import type { TracedNetwork } from '@aquascheme/engine'

export interface NodeRow {
  id: string
  kind: string
  label: string | null
  x: number
  y: number
  ground_elevation: number | null
  building_id: string | null
  meta: { engineKind?: string } | null
}

export interface PipeRow {
  id: string
  from_node: string
  to_node: string
  length_m: number | null
  diameter_mm: number | null
  material: string | null
  meta: { kind?: string; engineId?: string } | null
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
