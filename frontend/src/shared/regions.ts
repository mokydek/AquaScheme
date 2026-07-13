import { REGIONS_KZ } from '@aquascheme/engine'
import type { HazardKind } from '@aquascheme/engine'
import { supabase } from './supabase'

/**
 * Regions of Kazakhstan (requirements update 3, change 3). The engine list
 * REGIONS_KZ is the source of truth (like the norm registry); this module
 * mirrors it into the regions table best effort and defines the per project
 * region dataset content. Official values arrive as a code update that flips
 * rows to verified.
 */

/** Content of the dataset row of kind 'region'. */
export interface RegionDatasetContent {
  regionId: string
  name: string
  source: 'manual' | 'auto'
  /** Snapshot of the regional defaults at selection time (may be null = TODO). */
  seismicPoints: number | null
  freezingDepthM: number | null
  hazards: HazardKind[]
}

let synced = false

/** Mirror the code owned region list into the DB (upsert, best effort). */
export async function syncRegions(): Promise<void> {
  if (synced) return
  synced = true
  try {
    await supabase.from('regions').upsert(
      REGIONS_KZ.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        center_lon: r.center.lon,
        center_lat: r.center.lat,
        seismic_points: r.seismicPoints,
        freezing_depth_m: r.freezingDepthM,
        rain_params: r.rainParams,
        hazards: r.hazards,
        status: r.status,
      })),
    )
  } catch {
    synced = false
  }
}
