import type { DemandBuildingInput } from '@aquascheme/engine'
import { supabase } from './supabase'

/**
 * Water → drainage linking (requirements update 3, change 4). A sewer project
 * can pull its flows from an existing water project (the single source of
 * truth). These helpers list the user's water projects, set the link, and read
 * the source project's buildings and latest calc timestamp so the drainage
 * side can detect when the water calc changed ("требует пересчёта").
 */

export interface WaterProjectRef {
  id: string
  name: string
}

/** Content of the dataset row of kind 'drainage'. */
export interface DrainageContent {
  waterSourceProjectId: string | null
  /** created_at of the source water calc when the flows were last accepted. */
  snapshotCalcAt: string | null
}

export async function listWaterProjects(excludeId: string): Promise<WaterProjectRef[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id,name,system_type')
    .eq('system_type', 'water')
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return (data as Array<{ id: string; name: string }>).filter((p) => p.id !== excludeId)
}

export async function setWaterSource(projectId: string, waterProjectId: string | null): Promise<void> {
  await supabase.from('projects').update({ water_source_project_id: waterProjectId }).eq('id', projectId)
}

export interface WaterSourceDemand {
  buildings: DemandBuildingInput[]
  /** created_at of the latest calc_run of the water project, or null. */
  latestCalcAt: string | null
}

export async function fetchWaterSourceDemand(waterProjectId: string): Promise<WaterSourceDemand> {
  const [buildingsRes, runRes] = await Promise.all([
    supabase.from('buildings').select('id,residents,specific_demand_lpd').eq('project_id', waterProjectId),
    supabase
      .from('calc_runs')
      .select('created_at')
      .eq('project_id', waterProjectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const buildings = (buildingsRes.data ?? []).map((b: { id: string; residents: number | null; specific_demand_lpd: number | null }) => ({
    id: b.id,
    residents: b.residents ?? 0,
    specificDemandLpd: b.specific_demand_lpd ?? undefined,
  }))
  return { buildings, latestCalcAt: (runRes.data?.created_at as string | undefined) ?? null }
}
