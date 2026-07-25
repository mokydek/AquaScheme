import { supabase } from './supabase'

export type DatasetKind =
  | 'topography'
  | 'buildings'
  | 'source'
  | 'geology'
  | 'seismic'
  | 'normative'
  | 'equipment'
  | 'region'
  | 'drainage'
  | 'basis'
  | 'route_constraints'
  | 'route_audit'

export interface DatasetRow {
  id: string
  project_id: string
  kind: DatasetKind
  file_name: string | null
  content: unknown
  meta: unknown
  created_at: string
}

export interface BuildingRow {
  id: string
  label: string | null
  x: number
  y: number
  floors: number
  residents: number | null
  specific_demand_lpd?: number | null
  /** Explicit engineering inflow. Never store L/s in a consumption-per-day field. */
  design_flow_lps?: number | null
}

/** The 'source' dataset content (water source or sewer outlet point). */
export interface SourceData {
  x: number
  y: number
  groundElevation?: number
  availableHead?: number
}

/** Insert or update the single dataset row of the given kind for a project. */
export async function saveDataset(
  projectId: string,
  kind: DatasetKind,
  content: unknown,
  meta: unknown = null,
  fileName: string | null = null,
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from('datasets')
    .select('id')
    .eq('project_id', projectId)
    .eq('kind', kind)
    .maybeSingle()
  if (selectError) throw selectError

  if (existing) {
    const { error } = await supabase
      .from('datasets')
      .update({ content, meta, file_name: fileName })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('datasets')
      .insert({ project_id: projectId, kind, content, meta, file_name: fileName })
    if (error) throw error
  }
  if (['topography', 'buildings', 'source', 'geology', 'basis', 'route_constraints', 'route_audit'].includes(kind)) {
    // Best effort for installations that have not applied migration 0012 yet.
    await supabase.from('projects').update({ route_status: 'stale' }).eq('id', projectId)
  }
}
