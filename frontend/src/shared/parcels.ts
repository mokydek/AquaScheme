import { assignBuildingsToParcels, ringFromGeoJsonGeometry } from '@aquascheme/engine'
import type { ParcelKind, ParcelPolygon, Vec2 } from '@aquascheme/engine'
import { supabase } from './supabase'

export interface ParcelRow {
  id: string
  project_id: string
  building_id: string | null
  label: string | null
  kind: ParcelKind
  geometry: { type: 'Polygon'; coordinates: number[][][] }
  meta: unknown
}

/** GeoJSON Polygon (local meters) from a ring of vertices. */
export function ringToGeometry(ring: Vec2[]): { type: 'Polygon'; coordinates: number[][][] } {
  const closed = [...ring]
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first && last && (first.x !== last.x || first.y !== last.y)) closed.push(first)
  return { type: 'Polygon', coordinates: [closed.map((p) => [p.x, p.y])] }
}

export function parcelPolygons(rows: ParcelRow[]): ParcelPolygon[] {
  return rows.flatMap((row) => {
    const ring = ringFromGeoJsonGeometry(row.geometry)
    if (!ring) return []
    return [{ id: row.id, kind: row.kind, buildingId: row.building_id ?? undefined, ring }]
  })
}

export async function fetchParcels(projectId: string): Promise<ParcelRow[]> {
  const { data, error } = await supabase
    .from('parcels')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ParcelRow[]
}

export async function insertParcel(
  projectId: string,
  kind: ParcelKind,
  ring: Vec2[],
  label: string | null,
): Promise<void> {
  const { error } = await supabase.from('parcels').insert({
    project_id: projectId,
    kind,
    label,
    geometry: ringToGeometry(ring),
  })
  if (error) throw error
}

/** Replaces the active engineering right-of-way after a new master plan is processed. */
export async function replaceRightOfWay(projectId: string, ring: Vec2[], label: string): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from('parcels')
    .select('id')
    .eq('project_id', projectId)
    .eq('kind', 'right_of_way')
    .limit(1)
  if (selectError) throw selectError
  if (existing?.[0]) {
    const { error } = await supabase
      .from('parcels')
      .update({ geometry: ringToGeometry(ring), label })
      .eq('id', existing[0].id)
    if (error) throw error
  } else {
    await insertParcel(projectId, 'right_of_way', ring, label)
  }
}

export async function deleteParcel(parcelId: string): Promise<void> {
  await supabase.from('parcels').delete().eq('id', parcelId)
}

/** Auto assign buildings to the parcels that contain them. */
export async function autoAssignParcels(
  rows: ParcelRow[],
  buildings: Array<{ id: string; x: number; y: number }>,
): Promise<void> {
  const map = assignBuildingsToParcels(buildings, parcelPolygons(rows))
  const updates: Array<PromiseLike<unknown>> = []
  for (const row of rows) {
    if (row.kind !== 'parcel') continue
    const desired =
      [...map.entries()].find(([, parcelId]) => parcelId === row.id)?.[0] ?? null
    if ((row.building_id ?? null) !== desired) {
      updates.push(supabase.from('parcels').update({ building_id: desired }).eq('id', row.id))
    }
  }
  await Promise.all(updates)
}
