import { toPipeSizeOptions } from '@aquascheme/engine'
import type { CatalogItem, CatalogSizes } from '@aquascheme/engine'
import { supabase } from './supabase'
import { formatAppError } from './errorFormatting'

export interface CatalogRow {
  id: string
  project_id: string
  name: string
  source_file: string | null
  created_at: string
}

interface CatalogItemRow {
  item_type: CatalogItem['itemType']
  material: string | null
  standard: string | null
  dn: number | null
  outer_mm: number | null
  wall_mm: number | null
  sdr: number | null
  pn: number | null
  roughness_mm: number | null
  price: number | null
}

function rowToItem(row: CatalogItemRow): CatalogItem {
  return {
    itemType: row.item_type,
    material: row.material ?? undefined,
    standard: row.standard ?? undefined,
    dn: row.dn ?? undefined,
    outerMm: row.outer_mm ?? undefined,
    wallMm: row.wall_mm ?? undefined,
    sdr: row.sdr ?? undefined,
    pn: row.pn ?? undefined,
    roughnessMm: row.roughness_mm ?? undefined,
    price: row.price ?? undefined,
  }
}

export async function fetchCatalogs(projectId: string): Promise<CatalogRow[]> {
  const { data, error } = await supabase
    .from('catalogs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CatalogRow[]
}

export async function saveCatalog(
  projectId: string,
  name: string,
  fileName: string,
  items: CatalogItem[],
): Promise<string> {
  const { data, error } = await supabase
    .from('catalogs')
    .insert({ project_id: projectId, name, source_file: fileName })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('catalog insert failed')
  const catalogId = data.id as string
  const rows = items.map((item) => ({
    catalog_id: catalogId,
    item_type: item.itemType,
    material: item.material ?? null,
    standard: item.standard ?? null,
    dn: item.dn ?? null,
    outer_mm: item.outerMm ?? null,
    wall_mm: item.wallMm ?? null,
    sdr: item.sdr ?? null,
    pn: item.pn ?? null,
    roughness_mm: item.roughnessMm ?? null,
    price: item.price ?? null,
  }))
  const itemsInsert = await supabase.from('catalog_items').insert(rows)
  if (itemsInsert.error) {
    // Avoid leaving a catalog header that looks selectable but has no items.
    await supabase.from('catalogs').delete().eq('id', catalogId)
    throw itemsInsert.error
  }
  return catalogId
}

export async function setActiveCatalog(projectId: string, catalogId: string | null): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ active_catalog_id: catalogId, route_status: 'stale' })
    .eq('id', projectId)
  if (error) {
    throw new Error(`Не удалось активировать каталог материалов: ${formatAppError(error)}`)
  }
}

export async function deleteCatalog(projectId: string, catalogId: string): Promise<void> {
  const removed = await supabase.from('catalogs').delete().eq('id', catalogId)
  if (removed.error) throw removed.error
  const projectUpdate = await supabase
    .from('projects')
    .update({ active_catalog_id: null })
    .eq('id', projectId)
    .eq('active_catalog_id', catalogId)
  if (projectUpdate.error) throw projectUpdate.error
}

/** Pipe sizes of the active catalog, or null for the built in series. */
export async function loadActiveCatalogSizes(activeCatalogId: string | null): Promise<CatalogSizes | null> {
  if (!activeCatalogId) return null
  const { data, error } = await supabase
    .from('catalog_items')
    .select('item_type,material,standard,dn,outer_mm,wall_mm,sdr,pn,roughness_mm,price')
    .eq('catalog_id', activeCatalogId)
  if (error) {
    throw new Error(`Не удалось прочитать активный каталог материалов: ${formatAppError(error)}`)
  }
  if (!data) throw new Error('Не удалось прочитать активный каталог материалов: сервер не вернул данные.')
  return toPipeSizeOptions((data as CatalogItemRow[]).map(rowToItem))
}

/** Nominal gravity-pipe diameters; DN is sufficient for free-surface catalog selection. */
export async function loadActiveCatalogNominalDiameters(activeCatalogId: string | null): Promise<number[] | null> {
  if (!activeCatalogId) return null
  const { data, error } = await supabase
    .from('catalog_items')
    .select('dn')
    .eq('catalog_id', activeCatalogId)
    .eq('item_type', 'pipe')
  if (error) {
    throw new Error(`Не удалось прочитать диаметры активного каталога: ${formatAppError(error)}`)
  }
  if (!data) throw new Error('Не удалось прочитать диаметры активного каталога: сервер не вернул данные.')
  return [...new Set(data.flatMap((row: { dn: number | null }) => row.dn && row.dn > 0 ? [row.dn] : []))]
    .sort((a, b) => a - b)
}

export interface GravityCatalogResolution {
  /** False means the hydraulic solver must not run; this prevents synthetic Ø0 rows. */
  ready: boolean
  allowedDiametersMm?: readonly number[]
  blocker?: string
}

/**
 * Resolves the async active-catalog state before a gravity calculation starts.
 * An absent active catalog intentionally selects the built-in series. An
 * explicitly selected catalog, however, must be loaded and contain positive
 * DN pipe rows; loading/error/empty states are blocking rather than `[]`.
 */
export function resolveGravityCatalog(
  activeCatalogId: string | null | undefined,
  diameters: readonly number[] | undefined,
  loadError: string | null = null,
): GravityCatalogResolution {
  if (!activeCatalogId) return { ready: true }
  if (loadError) {
    return {
      ready: false,
      blocker: `Гидравлический расчёт остановлен: ${loadError}`,
    }
  }
  if (diameters === undefined) {
    return {
      ready: false,
      blocker: 'Гидравлический расчёт ожидает загрузку активного каталога труб.',
    }
  }
  const usable = [...new Set(diameters.filter((dn) => Number.isFinite(dn) && dn > 0))]
    .sort((a, b) => a - b)
  if (usable.length === 0) {
    return {
      ready: false,
      blocker: 'Гидравлический расчёт остановлен: в активном каталоге нет труб с положительным DN.',
    }
  }
  return { ready: true, allowedDiametersMm: usable }
}
