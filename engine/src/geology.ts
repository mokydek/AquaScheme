/**
 * Geology module data model and spreadsheet parsing (requirements update 3,
 * change 1). Geology is a full module, not a couple of form fields: boreholes
 * with coordinates and mouth elevations, layers tied to engineering geological
 * elements (ИГЭ), and the groundwater table with aggressiveness per material.
 *
 * Parsing is pure (this module stays free of the DOM and SheetJS): the
 * frontend reads XLSX/CSV rows and passes them here, the same convention as
 * catalog.ts. The spreadsheet is a flat layer table — one row per layer,
 * grouped by borehole label; the borehole coordinates, mouth elevation and
 * water record repeat on the rows and the first non empty value wins.
 */

export type Aggressiveness = 'low' | 'medium' | 'high'

export interface GeoLayer {
  igeCode?: string
  soilName?: string
  /** Layer top depth below the borehole mouth, m. */
  topDepthM: number
  /** Layer bottom depth below the borehole mouth, m. */
  bottomDepthM: number
  densityGCm3?: number
  moisturePercent?: number
  frictionAngleDeg?: number
  cohesionKpa?: number
  deformationModulusMpa?: number
  filtrationMDay?: number
}

export interface GeoWater {
  /** Groundwater table depth below the mouth, m. */
  depthM?: number
  aggressivenessSteel?: Aggressiveness
  aggressivenessConcrete?: Aggressiveness
  aggressivenessPe?: Aggressiveness
}

export interface Borehole {
  label: string
  x?: number
  y?: number
  mouthElevationM?: number
  layers: GeoLayer[]
  water: GeoWater
}

export interface GeologyData {
  boreholes: Borehole[]
}

/** Project level geology attributes edited alongside the boreholes. */
export interface GeologyAttributes {
  /** Collapsible soil type: null (none), 'I' or 'II'. */
  subsidenceType: 'I' | 'II' | null
  /** Frost heaving soils. */
  heaving: boolean
  /** Swelling soils. */
  swelling: boolean
  /** Design freezing depth, m. */
  freezingDepthM: number | null
}

/** Canonical template columns, in order. Headers are matched loosely. */
export const GEOLOGY_TEMPLATE_HEADERS = [
  'Скважина',
  'X',
  'Y',
  'Отметка устья, м',
  'ИГЭ',
  'Грунт',
  'Кровля слоя, м',
  'Подошва слоя, м',
  'Плотность, г/см3',
  'Влажность, %',
  'Угол трения, град',
  'Сцепление, кПа',
  'Модуль деформации, МПа',
  'Коэффициент фильтрации, м/сут',
  'УГВ, м',
  'Агрессивность к стали',
  'Агрессивность к бетону',
  'Агрессивность к ПЭ',
] as const

/** Two boreholes of two layers each for the downloadable template. */
export const GEOLOGY_TEMPLATE_EXAMPLE: Array<Record<string, string | number>> = [
  {
    'Скважина': 'С-1', 'X': 0, 'Y': 0, 'Отметка устья, м': 351.2,
    'ИГЭ': '1', 'Грунт': 'суглинок', 'Кровля слоя, м': 0, 'Подошва слоя, м': 2.5,
    'Плотность, г/см3': 1.95, 'Влажность, %': 18, 'Угол трения, град': 21,
    'Сцепление, кПа': 24, 'Модуль деформации, МПа': 14, 'Коэффициент фильтрации, м/сут': 0.1,
    'УГВ, м': 3.4, 'Агрессивность к стали': 'средняя', 'Агрессивность к бетону': 'низкая', 'Агрессивность к ПЭ': 'низкая',
  },
  {
    'Скважина': 'С-1', 'X': 0, 'Y': 0, 'Отметка устья, м': 351.2,
    'ИГЭ': '2', 'Грунт': 'песок средней крупности', 'Кровля слоя, м': 2.5, 'Подошва слоя, м': 6,
    'Плотность, г/см3': 1.98, 'Влажность, %': 22, 'Угол трения, град': 32,
    'Сцепление, кПа': 2, 'Модуль деформации, МПа': 28, 'Коэффициент фильтрации, м/сут': 5,
    'УГВ, м': '', 'Агрессивность к стали': '', 'Агрессивность к бетону': '', 'Агрессивность к ПЭ': '',
  },
  {
    'Скважина': 'С-2', 'X': 110, 'Y': 20, 'Отметка устья, м': 352.8,
    'ИГЭ': '1', 'Грунт': 'суглинок', 'Кровля слоя, м': 0, 'Подошва слоя, м': 3,
    'Плотность, г/см3': 1.96, 'Влажность, %': 19, 'Угол трения, град': 20,
    'Сцепление, кПа': 25, 'Модуль деформации, МПа': 13, 'Коэффициент фильтрации, м/сут': 0.08,
    'УГВ, м': 4.1, 'Агрессивность к стали': 'высокая', 'Агрессивность к бетону': 'средняя', 'Агрессивность к ПЭ': 'низкая',
  },
]

type LayerField =
  | 'igeCode' | 'soilName' | 'topDepthM' | 'bottomDepthM' | 'densityGCm3'
  | 'moisturePercent' | 'frictionAngleDeg' | 'cohesionKpa' | 'deformationModulusMpa' | 'filtrationMDay'
type BoreholeField = 'label' | 'x' | 'y' | 'mouthElevationM'
type WaterField = 'depthM' | 'aggressivenessSteel' | 'aggressivenessConcrete' | 'aggressivenessPe'
type Field = LayerField | BoreholeField | WaterField

const HEADER_FIELDS: Array<{ field: Field; aliases: string[] }> = [
  { field: 'label', aliases: ['скважина', 'borehole', 'well', '№ скважины'] },
  { field: 'x', aliases: ['x', 'х'] },
  { field: 'y', aliases: ['y', 'у'] },
  { field: 'mouthElevationM', aliases: ['отметка устья, м', 'отметка устья', 'устье', 'mouth'] },
  { field: 'igeCode', aliases: ['игэ', 'ige', 'элемент'] },
  { field: 'soilName', aliases: ['грунт', 'наименование грунта', 'soil'] },
  { field: 'topDepthM', aliases: ['кровля слоя, м', 'кровля', 'кровля, м', 'top'] },
  { field: 'bottomDepthM', aliases: ['подошва слоя, м', 'подошва', 'подошва, м', 'bottom'] },
  { field: 'densityGCm3', aliases: ['плотность, г/см3', 'плотность', 'density'] },
  { field: 'moisturePercent', aliases: ['влажность, %', 'влажность', 'moisture'] },
  { field: 'frictionAngleDeg', aliases: ['угол трения, град', 'угол трения', 'угол внутреннего трения', 'friction'] },
  { field: 'cohesionKpa', aliases: ['сцепление, кпа', 'сцепление', 'cohesion'] },
  { field: 'deformationModulusMpa', aliases: ['модуль деформации, мпа', 'модуль деформации', 'deformation'] },
  { field: 'filtrationMDay', aliases: ['коэффициент фильтрации, м/сут', 'коэффициент фильтрации', 'кф', 'filtration'] },
  { field: 'depthM', aliases: ['угв, м', 'угв', 'уровень грунтовых вод', 'groundwater'] },
  { field: 'aggressivenessSteel', aliases: ['агрессивность к стали', 'агрессивность сталь', 'steel'] },
  { field: 'aggressivenessConcrete', aliases: ['агрессивность к бетону', 'агрессивность бетон', 'concrete'] },
  { field: 'aggressivenessPe', aliases: ['агрессивность к пэ', 'агрессивность пэ', 'pe'] },
]

/** Fields a PDF column can be mapped to (G2). Same set as the parser reads. */
export type GeologyFieldId = Field

/** Mappable fields with their canonical template header, in template order. */
export const GEOLOGY_FIELDS: Array<{ id: GeologyFieldId; header: string }> = [
  { id: 'label', header: 'Скважина' },
  { id: 'x', header: 'X' },
  { id: 'y', header: 'Y' },
  { id: 'mouthElevationM', header: 'Отметка устья, м' },
  { id: 'igeCode', header: 'ИГЭ' },
  { id: 'soilName', header: 'Грунт' },
  { id: 'topDepthM', header: 'Кровля слоя, м' },
  { id: 'bottomDepthM', header: 'Подошва слоя, м' },
  { id: 'densityGCm3', header: 'Плотность, г/см3' },
  { id: 'moisturePercent', header: 'Влажность, %' },
  { id: 'frictionAngleDeg', header: 'Угол трения, град' },
  { id: 'cohesionKpa', header: 'Сцепление, кПа' },
  { id: 'deformationModulusMpa', header: 'Модуль деформации, МПа' },
  { id: 'filtrationMDay', header: 'Коэффициент фильтрации, м/сут' },
  { id: 'depthM', header: 'УГВ, м' },
  { id: 'aggressivenessSteel', header: 'Агрессивность к стали' },
  { id: 'aggressivenessConcrete', header: 'Агрессивность к бетону' },
  { id: 'aggressivenessPe', header: 'Агрессивность к ПЭ' },
]

const HEADER_BY_FIELD = new Map(GEOLOGY_FIELDS.map((f) => [f.id, f.header]))

/** Guess the model field a column header refers to, or null if unclear. */
export function guessGeologyField(header: string): GeologyFieldId | null {
  const normalized = normalizeHeader(header)
  if (normalized === '') return null
  const exact = HEADER_FIELDS.find((f) => f.aliases.includes(normalized))
  if (exact) return exact.field
  // Loose contains match as a fallback (e.g. "угол внутр. трения, град").
  const loose = HEADER_FIELDS.find((f) => f.aliases.some((a) => a.length >= 3 && normalized.includes(a)))
  return loose ? loose.field : null
}

/**
 * Turn an extracted grid plus a column → field mapping into parser rows (keyed
 * by canonical header). Unmapped columns (null) are dropped; the header row is
 * skipped when hasHeaderRow is true.
 */
export function gridToGeologyRows(
  grid: string[][],
  mapping: Array<GeologyFieldId | null>,
  hasHeaderRow: boolean,
): Array<Record<string, string>> {
  const dataRows = hasHeaderRow ? grid.slice(1) : grid
  return dataRows.map((cells) => {
    const record: Record<string, string> = {}
    mapping.forEach((field, col) => {
      if (!field) return
      const header = HEADER_BY_FIELD.get(field)
      if (header) record[header] = (cells[col] ?? '').trim()
    })
    return record
  })
}

const AGGRESSIVENESS_ALIASES: Record<string, Aggressiveness> = {
  low: 'low', низкая: 'low', неагрессивная: 'low', слабая: 'low', слабоагрессивная: 'low',
  medium: 'medium', средняя: 'medium', среднеагрессивная: 'medium',
  high: 'high', высокая: 'high', сильная: 'high', сильноагрессивная: 'high',
}

export type GeologyIssueCode = 'noBorehole' | 'badNumber' | 'badDepths' | 'badAggressiveness'

export interface GeologyIssue {
  row: number
  code: GeologyIssueCode
}

export interface GeologyParseResult {
  boreholes: Borehole[]
  issues: GeologyIssue[]
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

function parseAggressiveness(value: unknown): Aggressiveness | undefined | null {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '') return undefined
  return AGGRESSIVENESS_ALIASES[text] ?? null // null = unrecognized
}

/**
 * Parse spreadsheet rows (keyed by header text) into boreholes with layers and
 * a water record, with row level validation issues. Rows are grouped by
 * borehole label in first appearance order.
 */
export function parseGeologyRows(rows: Array<Record<string, unknown>>): GeologyParseResult {
  const issues: GeologyIssue[] = []
  const byLabel = new Map<string, Borehole>()
  const order: string[] = []

  rows.forEach((raw, index) => {
    const rowNumber = index + 2 // header is row 1
    const byField = new Map<Field, unknown>()
    for (const [key, value] of Object.entries(raw)) {
      const normalized = normalizeHeader(key)
      const match = HEADER_FIELDS.find((f) => f.aliases.includes(normalized))
      if (match) byField.set(match.field, value)
    }

    const label = String(byField.get('label') ?? '').trim()
    const hasAnyValue = [...byField.values()].some((v) => String(v ?? '').trim() !== '')
    if (label === '') {
      if (hasAnyValue) issues.push({ row: rowNumber, code: 'noBorehole' })
      return // fully empty rows are skipped silently
    }

    // Numeric fields; NaN (non numeric text) is a row issue.
    const numberFields: Field[] = [
      'x', 'y', 'mouthElevationM', 'topDepthM', 'bottomDepthM', 'densityGCm3',
      'moisturePercent', 'frictionAngleDeg', 'cohesionKpa', 'deformationModulusMpa',
      'filtrationMDay', 'depthM',
    ]
    const numbers = new Map<Field, number>()
    let badNumber = false
    for (const field of numberFields) {
      const parsed = parseNumber(byField.get(field))
      if (parsed !== undefined && Number.isNaN(parsed)) { badNumber = true; break }
      if (parsed !== undefined) numbers.set(field, parsed)
    }
    if (badNumber) { issues.push({ row: rowNumber, code: 'badNumber' }); return }

    const aggressiveness: Record<'aggressivenessSteel' | 'aggressivenessConcrete' | 'aggressivenessPe', Aggressiveness | undefined> = {
      aggressivenessSteel: undefined, aggressivenessConcrete: undefined, aggressivenessPe: undefined,
    }
    let badAgg = false
    for (const field of ['aggressivenessSteel', 'aggressivenessConcrete', 'aggressivenessPe'] as const) {
      const parsed = parseAggressiveness(byField.get(field))
      if (parsed === null) { badAgg = true; break }
      aggressiveness[field] = parsed
    }
    if (badAgg) { issues.push({ row: rowNumber, code: 'badAggressiveness' }); return }

    let borehole = byLabel.get(label)
    if (!borehole) {
      borehole = { label, layers: [], water: {} }
      const x = numbers.get('x'); if (x !== undefined) borehole.x = x
      const y = numbers.get('y'); if (y !== undefined) borehole.y = y
      const mouth = numbers.get('mouthElevationM'); if (mouth !== undefined) borehole.mouthElevationM = mouth
      byLabel.set(label, borehole)
      order.push(label)
    }

    // Water: first non empty value per borehole wins.
    const depth = numbers.get('depthM')
    if (depth !== undefined && borehole.water.depthM === undefined) borehole.water.depthM = depth
    for (const field of ['aggressivenessSteel', 'aggressivenessConcrete', 'aggressivenessPe'] as const) {
      if (aggressiveness[field] !== undefined && borehole.water[field] === undefined) {
        borehole.water[field] = aggressiveness[field]
      }
    }

    // A layer needs both depths; a row that only carries water/borehole data is fine.
    const top = numbers.get('topDepthM')
    const bottom = numbers.get('bottomDepthM')
    if (top !== undefined || bottom !== undefined) {
      if (top === undefined || bottom === undefined || bottom <= top) {
        issues.push({ row: rowNumber, code: 'badDepths' })
        return
      }
      const layer: GeoLayer = { topDepthM: top, bottomDepthM: bottom }
      const ige = String(byField.get('igeCode') ?? '').trim(); if (ige) layer.igeCode = ige
      const soil = String(byField.get('soilName') ?? '').trim(); if (soil) layer.soilName = soil
      for (const field of ['densityGCm3', 'moisturePercent', 'frictionAngleDeg', 'cohesionKpa', 'deformationModulusMpa', 'filtrationMDay'] as const) {
        const value = numbers.get(field); if (value !== undefined) layer[field] = value
      }
      borehole.layers.push(layer)
    }
  })

  // Sort each borehole's layers by depth for a stable presentation.
  for (const borehole of byLabel.values()) {
    borehole.layers.sort((a, b) => a.topDepthM - b.topDepthM)
  }

  return { boreholes: order.map((label) => byLabel.get(label) as Borehole), issues, total: rows.length }
}

/**
 * Real survey reports (отчёты ИГИ) rarely ship the flat per-borehole layer
 * table our template uses: the engineering-geological elements are described
 * in PROSE («ИГЭ 2 — суглинок… Вскрыт с глубины 0,0-3,0м. Мощность слоя
 * 3,0-5,6м.»), properties sit in a wide per-ИГЭ table, and the borehole logs
 * are drawings. These parsers read the prose part so a real report yields the
 * ИГЭ list and the groundwater range even before any table mapping.
 */
export interface IgeDescription {
  code: string
  name: string
  /** Shallowest reported opening depth, m (min of «Вскрыт с глубины»). */
  openedFromM: number | null
  /** Largest reported thickness, m (max of «Мощность слоя»). */
  thicknessM: number | null
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const RANGE = String.raw`${NUM}\s*(?:-\s*${NUM})?`

function ruNumber(text: string | undefined): number | null {
  if (!text) return null
  const n = Number(text.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** ИГЭ descriptions from report prose, in order of appearance. */
export function parseIgeDescriptions(text: string): IgeDescription[] {
  const out: IgeDescription[] = []
  const seen = new Set<string>()
  const igeRe = /ИГЭ\s*№?\s*(\d+(?:-\d+)?)\s*[–—-]\s*([^.\n]+)[.,]/g
  let match: RegExpExecArray | null
  while ((match = igeRe.exec(text)) !== null) {
    if (seen.has(match[1])) continue
    seen.add(match[1])
    const tail = text.slice(match.index, match.index + 600)
    const opened = new RegExp(String.raw`Вскрыт[аы]?\s+с\s+глубин[ыи]\s+${RANGE}\s*м`, 'i').exec(tail)
    const thickness = new RegExp(String.raw`Мощность\s+сло[яё][^\d]{0,10}${RANGE}\s*м`, 'i').exec(tail)
    out.push({
      code: match[1],
      name: match[2].trim().replace(/\s+/g, ' '),
      openedFromM: ruNumber(opened?.[1]),
      thicknessM: ruNumber(thickness?.[2] ?? thickness?.[1]),
    })
  }
  return out
}

export interface GroundwaterRange {
  minDepthM: number
  maxDepthM: number
}

/** Groundwater depth range from prose («вскрыты на глубине 0,5-5,6м»). */
export function parseGroundwaterRange(text: string): GroundwaterRange | null {
  const re = new RegExp(String.raw`вод[ыа]?[^.]{0,120}?(?:вскрыты|встречены|залегают)[^.]{0,60}?глубин[еы]\s+${RANGE}\s*м`, 'i')
  const m = re.exec(text)
  if (!m) return null
  const a = ruNumber(m[1])
  const b = ruNumber(m[2]) ?? a
  if (a === null || b === null) return null
  return { minDepthM: Math.min(a, b), maxDepthM: Math.max(a, b) }
}

export interface GeologyReportSummary {
  ige: IgeDescription[]
  groundwater: GroundwaterRange | null
  /** Conservative design value: the largest reported normative freezing depth. */
  freezingDepthM: number | null
  maxAggressiveness: Aggressiveness | null
  seismicInactive: boolean | null
}

/**
 * Extract the project-level facts that are normally written in prose rather
 * than in the borehole tables. Values remain a review proposal in the UI: a
 * prose report cannot reconstruct per-borehole layer boundaries honestly.
 */
export function parseGeologyReportSummary(text: string): GeologyReportSummary {
  const normalized = text.replace(/\s+/g, ' ')
  const freezingHeading = /нормативн[а-яё]*\s+глубин[а-яё]*\s+сезонн[а-яё]*\s+промерзан[а-яё]*/i.exec(normalized)
  let freezingDepthM: number | null = null
  if (freezingHeading) {
    const tail = normalized.slice(freezingHeading.index, freezingHeading.index + 700)
    const depthsCm = [...tail.matchAll(/-\s*(\d{2,3})\s*(?=;|\.|,|см|$)/gi)]
      .map((m) => Number(m[1]))
      .filter((value) => value >= 50 && value <= 500)
    if (depthsCm.length > 0) freezingDepthM = Math.max(...depthsCm) / 100
  }

  let maxAggressiveness: Aggressiveness | null = null
  const aggressionText = normalized
  if (/сильн[а-яё]*\s+(?:сульфатн[а-яё]*|хлоридн[а-яё]*|агресси[а-яё]*)|активност[а-яё]*\s+грунт[а-яё]*[\s\S]{0,500}высок/i.test(aggressionText)) {
    maxAggressiveness = 'high'
  } else if (/средн[а-яё]*\s+(?:сульфатн[а-яё]*|хлоридн[а-яё]*|агресси[а-яё]*)/i.test(aggressionText)) {
    maxAggressiveness = 'medium'
  } else if (/слаб[а-яё]*\s+(?:сульфатн[а-яё]*|хлоридн[а-яё]*|агресси[а-яё]*)/i.test(aggressionText)) {
    maxAggressiveness = 'low'
  }

  const seismicInactive = /район\s+не\s+сейсмоактивен/i.test(normalized)
    ? true
    : /сейсмичност|сейсмоактив/i.test(normalized) ? false : null

  return {
    ige: parseIgeDescriptions(text),
    groundwater: parseGroundwaterRange(text),
    freezingDepthM,
    maxAggressiveness,
    seismicInactive,
  }
}

const AGGRESSIVENESS_RANK: Record<Aggressiveness, number> = { low: 0, medium: 1, high: 2 }

export interface GeologySummary {
  boreholes: number
  layers: number
  igeCodes: string[]
  /** Shallowest groundwater across boreholes, m; null if none reported. */
  minWaterDepthM: number | null
  /** Worst aggressiveness across boreholes and materials; null if none. */
  maxAggressiveness: Aggressiveness | null
}

export function summarizeGeology(data: GeologyData): GeologySummary {
  const igeCodes = new Set<string>()
  let layers = 0
  let minWaterDepthM: number | null = null
  let maxRank = -1
  for (const borehole of data.boreholes) {
    layers += borehole.layers.length
    for (const layer of borehole.layers) if (layer.igeCode) igeCodes.add(layer.igeCode)
    if (borehole.water.depthM !== undefined) {
      minWaterDepthM = minWaterDepthM === null ? borehole.water.depthM : Math.min(minWaterDepthM, borehole.water.depthM)
    }
    for (const field of ['aggressivenessSteel', 'aggressivenessConcrete', 'aggressivenessPe'] as const) {
      const value = borehole.water[field]
      if (value !== undefined) maxRank = Math.max(maxRank, AGGRESSIVENESS_RANK[value])
    }
  }
  const maxAggressiveness = maxRank < 0 ? null : (['low', 'medium', 'high'] as Aggressiveness[])[maxRank]
  return {
    boreholes: data.boreholes.length,
    layers,
    igeCodes: [...igeCodes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    minWaterDepthM,
    maxAggressiveness,
  }
}
