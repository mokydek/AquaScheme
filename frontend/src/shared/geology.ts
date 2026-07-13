import type { Aggressiveness, Borehole, GeoLayer, GeoWater } from '@aquascheme/engine'
import { supabase } from './supabase'

/**
 * Geology boreholes/layers/water persistence (requirements update 3,
 * change 1). The engine owns the types and parsing (geology.ts); this module
 * maps between them and the geo_boreholes / geo_layers / geo_water tables.
 * replaceGeology does a delete + insert per project, the same convention as
 * replaceNetwork, so re-uploading a file replaces the whole geology.
 */

interface BoreholeRow {
  id: string
  label: string
  x: number | null
  y: number | null
  mouth_elevation_m: number | null
}

interface LayerRow {
  borehole_id: string
  top_depth_m: number
  bottom_depth_m: number
  ige_code: string | null
  soil_name: string | null
  density_g_cm3: number | null
  moisture_percent: number | null
  friction_angle_deg: number | null
  cohesion_kpa: number | null
  deformation_modulus_mpa: number | null
  filtration_m_day: number | null
}

interface WaterRow {
  borehole_id: string
  depth_m: number | null
  aggressiveness_steel: Aggressiveness | null
  aggressiveness_concrete: Aggressiveness | null
  aggressiveness_pe: Aggressiveness | null
}

function layerToRow(boreholeId: string, layer: GeoLayer): LayerRow {
  return {
    borehole_id: boreholeId,
    top_depth_m: layer.topDepthM,
    bottom_depth_m: layer.bottomDepthM,
    ige_code: layer.igeCode ?? null,
    soil_name: layer.soilName ?? null,
    density_g_cm3: layer.densityGCm3 ?? null,
    moisture_percent: layer.moisturePercent ?? null,
    friction_angle_deg: layer.frictionAngleDeg ?? null,
    cohesion_kpa: layer.cohesionKpa ?? null,
    deformation_modulus_mpa: layer.deformationModulusMpa ?? null,
    filtration_m_day: layer.filtrationMDay ?? null,
  }
}

function rowToLayer(row: LayerRow): GeoLayer {
  const layer: GeoLayer = { topDepthM: row.top_depth_m, bottomDepthM: row.bottom_depth_m }
  if (row.ige_code) layer.igeCode = row.ige_code
  if (row.soil_name) layer.soilName = row.soil_name
  if (row.density_g_cm3 != null) layer.densityGCm3 = row.density_g_cm3
  if (row.moisture_percent != null) layer.moisturePercent = row.moisture_percent
  if (row.friction_angle_deg != null) layer.frictionAngleDeg = row.friction_angle_deg
  if (row.cohesion_kpa != null) layer.cohesionKpa = row.cohesion_kpa
  if (row.deformation_modulus_mpa != null) layer.deformationModulusMpa = row.deformation_modulus_mpa
  if (row.filtration_m_day != null) layer.filtrationMDay = row.filtration_m_day
  return layer
}

function rowToWater(row: WaterRow): GeoWater {
  const water: GeoWater = {}
  if (row.depth_m != null) water.depthM = row.depth_m
  if (row.aggressiveness_steel) water.aggressivenessSteel = row.aggressiveness_steel
  if (row.aggressiveness_concrete) water.aggressivenessConcrete = row.aggressiveness_concrete
  if (row.aggressiveness_pe) water.aggressivenessPe = row.aggressiveness_pe
  return water
}

/** All boreholes with their layers and water for a project. */
export async function fetchGeology(projectId: string): Promise<Borehole[]> {
  const { data: boreholes, error } = await supabase
    .from('geo_boreholes')
    .select('id,label,x,y,mouth_elevation_m')
    .eq('project_id', projectId)
    .order('label', { ascending: true })
  if (error || !boreholes || boreholes.length === 0) return []
  const ids = (boreholes as BoreholeRow[]).map((b) => b.id)
  const [layersRes, waterRes] = await Promise.all([
    supabase.from('geo_layers').select('*').in('borehole_id', ids).order('top_depth_m', { ascending: true }),
    supabase.from('geo_water').select('*').in('borehole_id', ids),
  ])
  const layersByBorehole = new Map<string, GeoLayer[]>()
  for (const row of (layersRes.data ?? []) as LayerRow[]) {
    layersByBorehole.set(row.borehole_id, [...(layersByBorehole.get(row.borehole_id) ?? []), rowToLayer(row)])
  }
  const waterByBorehole = new Map<string, GeoWater>()
  for (const row of (waterRes.data ?? []) as WaterRow[]) {
    waterByBorehole.set(row.borehole_id, rowToWater(row))
  }
  return (boreholes as BoreholeRow[]).map((b) => ({
    label: b.label,
    x: b.x ?? undefined,
    y: b.y ?? undefined,
    mouthElevationM: b.mouth_elevation_m ?? undefined,
    layers: layersByBorehole.get(b.id) ?? [],
    water: waterByBorehole.get(b.id) ?? {},
  }))
}

/** Replace the whole geology of a project (delete + insert). */
export async function replaceGeology(projectId: string, boreholes: Borehole[]): Promise<void> {
  const del = await supabase.from('geo_boreholes').delete().eq('project_id', projectId)
  if (del.error) throw del.error
  for (const borehole of boreholes) {
    const { data, error } = await supabase
      .from('geo_boreholes')
      .insert({
        project_id: projectId,
        label: borehole.label,
        x: borehole.x ?? null,
        y: borehole.y ?? null,
        mouth_elevation_m: borehole.mouthElevationM ?? null,
      })
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('borehole insert failed')
    const boreholeId = data.id as string
    if (borehole.layers.length > 0) {
      const layersInsert = await supabase
        .from('geo_layers')
        .insert(borehole.layers.map((l) => layerToRow(boreholeId, l)))
      if (layersInsert.error) throw layersInsert.error
    }
    const w = borehole.water
    if (w.depthM !== undefined || w.aggressivenessSteel || w.aggressivenessConcrete || w.aggressivenessPe) {
      const waterInsert = await supabase.from('geo_water').insert({
        borehole_id: boreholeId,
        depth_m: w.depthM ?? null,
        aggressiveness_steel: w.aggressivenessSteel ?? null,
        aggressiveness_concrete: w.aggressivenessConcrete ?? null,
        aggressiveness_pe: w.aggressivenessPe ?? null,
      })
      if (waterInsert.error) throw waterInsert.error
    }
  }
}
