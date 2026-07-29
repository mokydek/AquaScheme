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
  | 'manhole_catalog'

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

async function updateDatasetRows(
  projectId: string,
  kind: DatasetKind,
  values: { content: unknown; meta: unknown; file_name: string | null },
): Promise<number> {
  // Updating every matching row also makes legacy duplicates consistent until
  // migration 0014 deterministically keeps one canonical row.
  const { data, error } = await supabase
    .from('datasets')
    .update(values)
    .eq('project_id', projectId)
    .eq('kind', kind)
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

/** Insert or update the single dataset row of the given kind for a project. */
export async function saveDataset(
  projectId: string,
  kind: DatasetKind,
  content: unknown,
  meta: unknown = null,
  fileName: string | null = null,
): Promise<void> {
  const values = { content, meta, file_name: fileName }
  const updated = await updateDatasetRows(projectId, kind, values)
  if (updated === 0) {
    const { error: insertError } = await supabase
      .from('datasets')
      .insert({ project_id: projectId, kind, ...values })
    if (insertError) {
      // With migration 0014, two concurrent creators cannot leave duplicates.
      // The request that loses the insert race updates the winner instead.
      if (insertError.code !== '23505') throw insertError
      const retryUpdated = await updateDatasetRows(projectId, kind, values)
      if (retryUpdated === 0) throw insertError
    }
  }

  if (['topography', 'buildings', 'source', 'geology', 'basis', 'route_constraints', 'route_audit', 'manhole_catalog'].includes(kind)) {
    // Best effort for installations that have not applied migration 0012 yet.
    await supabase.from('projects').update({ route_status: 'stale' }).eq('id', projectId)
  }
}
