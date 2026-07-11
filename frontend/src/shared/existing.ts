import { estimateRoughnessMm, importNetwork } from '@aquascheme/engine'
import type { ExistingMaterial, ImportSegment, PipeDecision, SurveyPoint } from '@aquascheme/engine'
import { supabase } from './supabase'

export interface ExistingPipeMeta {
  ax: number
  ay: number
  bx: number
  by: number
  overgrowthPercent?: number
  defects?: string
}

export interface ExistingPipeRow {
  id: string
  project_id: string
  length_m: number | null
  diameter_mm: number | null
  material: string | null
  laid_year: number | null
  wear_percent: number | null
  roughness_mm: number | null
  decision: PipeDecision
  meta: ExistingPipeMeta | null
}

export async function fetchExisting(projectId: string): Promise<ExistingPipeRow[]> {
  const { data, error } = await supabase
    .from('existing_pipes')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ExistingPipeRow[]
}

/**
 * Import an existing network from route segments: stitch endpoints (reusing
 * the tested importer), then store each main as an isolated existing pipe
 * with its endpoint coordinates in meta.
 */
export async function replaceExisting(
  projectId: string,
  segments: ImportSegment[],
  surveyPoints: SurveyPoint[],
): Promise<number> {
  const first = segments[0]?.points[0] ?? { x: 0, y: 0 }
  const { network } = importNetwork(segments, [], first, surveyPoints)
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]))

  const rows = network.pipes
    .filter((p) => p.kind === 'main')
    .flatMap((p) => {
      const a = nodeById.get(p.fromNode)
      const b = nodeById.get(p.toNode)
      if (!a || !b) return []
      return [
        {
          project_id: projectId,
          length_m: p.lengthM,
          material: 'steel',
          wear_percent: 50,
          roughness_mm: estimateRoughnessMm('steel', 50, 0),
          decision: 'keep' as PipeDecision,
          meta: { ax: a.x, ay: a.y, bx: b.x, by: b.y },
        },
      ]
    })

  const del = await supabase.from('existing_pipes').delete().eq('project_id', projectId)
  if (del.error) throw del.error
  if (rows.length === 0) return 0
  const ins = await supabase.from('existing_pipes').insert(rows)
  if (ins.error) throw ins.error
  return rows.length
}

export interface ExistingPipePatch {
  material?: ExistingMaterial
  laid_year?: number | null
  diameter_mm?: number | null
  wear_percent?: number | null
  decision?: PipeDecision
  overgrowthPercent?: number | null
  defects?: string
}

/** Update one existing pipe and recompute its equivalent roughness. */
export async function updateExistingPipe(
  row: ExistingPipeRow,
  patch: ExistingPipePatch,
): Promise<void> {
  const material = (patch.material ?? (row.material as ExistingMaterial) ?? 'unknown') as ExistingMaterial
  const wear = patch.wear_percent ?? row.wear_percent ?? 0
  const overgrowth = patch.overgrowthPercent ?? row.meta?.overgrowthPercent ?? 0
  const roughness = estimateRoughnessMm(material, wear, overgrowth)
  const meta: ExistingPipeMeta = {
    ax: row.meta?.ax ?? 0,
    ay: row.meta?.ay ?? 0,
    bx: row.meta?.bx ?? 0,
    by: row.meta?.by ?? 0,
    overgrowthPercent: overgrowth,
    defects: patch.defects ?? row.meta?.defects,
  }
  const { error } = await supabase
    .from('existing_pipes')
    .update({
      material,
      laid_year: patch.laid_year ?? row.laid_year,
      diameter_mm: patch.diameter_mm ?? row.diameter_mm,
      wear_percent: wear,
      decision: patch.decision ?? row.decision,
      roughness_mm: roughness,
      meta,
    })
    .eq('id', row.id)
  if (error) throw error
}

export async function deleteExistingAll(projectId: string): Promise<void> {
  await supabase.from('existing_pipes').delete().eq('project_id', projectId)
}
