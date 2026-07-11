import type { PipeSizeOption } from './sizing'

// Kept local (not imported from ./sizing) so this module stays free of the
// EPANET runtime and can live in the main engine bundle.
const DEFAULT_ROUGHNESS_MM = 0.05

/**
 * User loadable material and fittings catalog (requirements update 1,
 * change 6). Diameter and material selection is done STRICTLY from the active
 * catalog; when no item fits, the engine says so (noSuitableItem) instead of
 * inventing a size. Parsing is pure; the frontend reads XLSX/CSV with SheetJS
 * and passes rows here.
 */

export type CatalogItemType = 'pipe' | 'valve' | 'hydrant' | 'air_valve' | 'check_valve' | 'fitting'

export interface CatalogItem {
  itemType: CatalogItemType
  material?: string
  standard?: string
  dn?: number
  outerMm?: number
  wallMm?: number
  sdr?: number
  pn?: number
  roughnessMm?: number
  price?: number
}

/** Canonical template columns, in order. Headers are matched loosely. */
export const CATALOG_TEMPLATE_HEADERS = [
  'Тип',
  'Материал',
  'Стандарт',
  'DN',
  'Наружный диаметр, мм',
  'Толщина стенки, мм',
  'SDR',
  'PN',
  'Шероховатость, мм',
  'Цена',
] as const

/** An example row for the downloadable template. */
export const CATALOG_TEMPLATE_EXAMPLE: Array<Record<string, string | number>> = [
  {
    'Тип': 'труба',
    'Материал': 'ПЭ100 SDR17',
    'Стандарт': 'ГОСТ 18599',
    'DN': 110,
    'Наружный диаметр, мм': 110,
    'Толщина стенки, мм': 6.6,
    'SDR': 17,
    'PN': 10,
    'Шероховатость, мм': 0.05,
    'Цена': 1200,
  },
  {
    'Тип': 'гидрант',
    'Материал': 'чугун',
    'Стандарт': 'ГОСТ 8220',
    'DN': 125,
    'Наружный диаметр, мм': '',
    'Толщина стенки, мм': '',
    'SDR': '',
    'PN': 10,
    'Шероховатость, мм': '',
    'Цена': 45000,
  },
]

const TYPE_ALIASES: Record<string, CatalogItemType> = {
  труба: 'pipe',
  pipe: 'pipe',
  задвижка: 'valve',
  valve: 'valve',
  гидрант: 'hydrant',
  hydrant: 'hydrant',
  вантуз: 'air_valve',
  air_valve: 'air_valve',
  'обратный клапан': 'check_valve',
  check_valve: 'check_valve',
  фитинг: 'fitting',
  fitting: 'fitting',
}

const HEADER_FIELDS: Array<{ field: keyof CatalogItem | 'type'; aliases: string[] }> = [
  { field: 'type', aliases: ['тип', 'type'] },
  { field: 'material', aliases: ['материал', 'material'] },
  { field: 'standard', aliases: ['стандарт', 'standard'] },
  { field: 'dn', aliases: ['dn', 'ду'] },
  { field: 'outerMm', aliases: ['наружный диаметр, мм', 'наружный диаметр', 'outer', 'outer_mm'] },
  { field: 'wallMm', aliases: ['толщина стенки, мм', 'толщина стенки', 'wall', 'wall_mm'] },
  { field: 'sdr', aliases: ['sdr'] },
  { field: 'pn', aliases: ['pn', 'pn/sdr'] },
  { field: 'roughnessMm', aliases: ['шероховатость, мм', 'шероховатость', 'roughness', 'roughness_mm'] },
  { field: 'price', aliases: ['цена', 'цена за метр', 'price'] },
]

export type CatalogIssueCode = 'unknownType' | 'noDiameter' | 'badNumber' | 'empty'

export interface CatalogIssue {
  row: number
  code: CatalogIssueCode
}

export interface CatalogParseResult {
  items: CatalogItem[]
  issues: CatalogIssue[]
  total: number
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : Number.NaN
}

/**
 * Parse spreadsheet rows (keyed by header text) into catalog items with row
 * level validation issues.
 */
export function parseCatalogRows(rows: Array<Record<string, unknown>>): CatalogParseResult {
  const items: CatalogItem[] = []
  const issues: CatalogIssue[] = []

  rows.forEach((raw, index) => {
    const rowNumber = index + 2 // header is row 1
    const byField = new Map<string, unknown>()
    for (const [key, value] of Object.entries(raw)) {
      const normalized = normalizeHeader(key)
      const match = HEADER_FIELDS.find((f) => f.aliases.includes(normalized))
      if (match) byField.set(match.field, value)
    }

    const rawType = String(byField.get('type') ?? '').trim().toLowerCase()
    if (rawType === '') return // skip fully empty rows silently
    const itemType = TYPE_ALIASES[rawType]
    if (!itemType) {
      issues.push({ row: rowNumber, code: 'unknownType' })
      return
    }

    const numberFields = ['dn', 'outerMm', 'wallMm', 'sdr', 'pn', 'roughnessMm', 'price'] as const
    const numbers: Partial<Record<(typeof numberFields)[number], number>> = {}
    let badNumber = false
    for (const field of numberFields) {
      const parsed = parseNumber(byField.get(field))
      if (parsed !== undefined && Number.isNaN(parsed)) {
        badNumber = true
        break
      }
      if (parsed !== undefined) numbers[field] = parsed
    }
    if (badNumber) {
      issues.push({ row: rowNumber, code: 'badNumber' })
      return
    }

    const item: CatalogItem = {
      itemType,
      material: String(byField.get('material') ?? '').trim() || undefined,
      standard: String(byField.get('standard') ?? '').trim() || undefined,
      ...numbers,
    }

    if (itemType === 'pipe' && internalDiameterMm(item) === null) {
      issues.push({ row: rowNumber, code: 'noDiameter' })
      return
    }

    items.push(item)
  })

  return { items, issues, total: rows.length }
}

/** Internal diameter of a pipe item, mm, from wall or SDR. */
export function internalDiameterMm(item: CatalogItem): number | null {
  if (item.outerMm && item.wallMm && item.wallMm > 0) {
    return Math.round((item.outerMm - 2 * item.wallMm) * 10) / 10
  }
  if (item.outerMm && item.sdr && item.sdr > 0) {
    return Math.round(item.outerMm * (1 - 2 / item.sdr) * 10) / 10
  }
  return null
}

export interface CatalogSizes {
  sizes: PipeSizeOption[]
  roughnessMm: number
}

/**
 * Build the pipe size series and a representative roughness from a catalog.
 * Returns null when the catalog holds no usable pipe items (the caller then
 * keeps the built in series). Sizes are sorted by internal diameter.
 */
export function toPipeSizeOptions(items: CatalogItem[]): CatalogSizes | null {
  const options: Array<PipeSizeOption & { roughness: number }> = []
  for (const item of items) {
    if (item.itemType !== 'pipe') continue
    const internal = internalDiameterMm(item)
    if (internal === null) continue
    const nominalMm = item.dn ?? Math.round(item.outerMm ?? internal)
    options.push({
      nominalMm,
      internalMm: internal,
      roughness: item.roughnessMm && item.roughnessMm > 0 ? item.roughnessMm : DEFAULT_ROUGHNESS_MM,
    })
  }
  if (options.length === 0) return null
  options.sort((a, b) => a.internalMm - b.internalMm)
  const roughnessMm = Math.max(...options.map((o) => o.roughness))
  return {
    sizes: options.map((o) => ({ nominalMm: o.nominalMm, internalMm: o.internalMm })),
    roughnessMm,
  }
}
