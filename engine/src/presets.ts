/**
 * Ready made objects for the map library (requirements update 1, change 4).
 *
 * Buildings carry a per unit daily demand norm. Residential is fully covered
 * by the global residential per capita norm (NORMATIVE_DEFAULTS). For non
 * residential types the values below are REFERENCE figures from
 * SNiP 2.04.01-85* appendix 3 (the methodology SP RK 4.01-101 mirrors); they
 * are marked normPending until confirmed against the SP RK local edition, and
 * the engineer can edit them per building. Do not treat them as final.
 */

export type BuildingPresetId =
  | 'residential'
  | 'school'
  | 'kindergarten'
  | 'hospital'
  | 'administrative'
  | 'industrial'

export interface BuildingPreset {
  id: BuildingPresetId
  /** Short label prefix for placed buildings (e.g. Ж, Ш, Д). */
  labelPrefix: string
  /** Default number of consumption units. */
  defaultUnits: number
  defaultFloors: number
  /**
   * Per unit daily norm, L/day. null means "use the global residential per
   * capita norm" (residential only).
   */
  specificDemandLpd: number | null
  /** The value still needs confirmation against SP RK 4.01-101. */
  normPending: boolean
  /** Source reference for the note. */
  sourceNote: string
}

export const BUILDING_PRESETS: BuildingPreset[] = [
  {
    id: 'residential',
    labelPrefix: 'Ж',
    defaultUnits: 80,
    defaultFloors: 5,
    specificDemandLpd: null,
    normPending: false,
    sourceNote: 'СП РК 4.01-101 (удельное водопотребление на жителя)',
  },
  {
    id: 'school',
    labelPrefix: 'Ш',
    defaultUnits: 400,
    defaultFloors: 3,
    specificDemandLpd: 11.5,
    normPending: true,
    sourceNote: 'СНиП 2.04.01-85* прил. 3 (справочно, на учащегося); уточнить по СП РК',
  },
  {
    id: 'kindergarten',
    labelPrefix: 'ДС',
    defaultUnits: 120,
    defaultFloors: 2,
    specificDemandLpd: 75,
    normPending: true,
    sourceNote: 'СНиП 2.04.01-85* прил. 3 (справочно, на место); уточнить по СП РК',
  },
  {
    id: 'hospital',
    labelPrefix: 'Б',
    defaultUnits: 100,
    defaultFloors: 5,
    specificDemandLpd: 250,
    normPending: true,
    sourceNote: 'СНиП 2.04.01-85* прил. 3 (справочно, на койку); уточнить по СП РК',
  },
  {
    id: 'administrative',
    labelPrefix: 'А',
    defaultUnits: 150,
    defaultFloors: 4,
    specificDemandLpd: 12,
    normPending: true,
    sourceNote: 'СНиП 2.04.01-85* прил. 3 (справочно, на работающего); уточнить по СП РК',
  },
  {
    id: 'industrial',
    labelPrefix: 'П',
    defaultUnits: 200,
    defaultFloors: 1,
    specificDemandLpd: 25,
    normPending: true,
    sourceNote:
      'СНиП 2.04.01-85* прил. 3 (справочно, хозбытовые на работающего); технологический расход задаётся отдельно; уточнить по СП РК',
  },
]

export type SourcePresetId =
  | 'treatment'
  | 'filtration_station'
  | 'pump_station'
  | 'reservoir'
  | 'water_tower'
  | 'intake'

export interface SourcePreset {
  id: SourcePresetId
  /** Default available head above ground, m. Engineer confirms per project. */
  defaultAvailableHeadM: number
  mark: string
}

export const SOURCE_PRESETS: SourcePreset[] = [
  { id: 'treatment', defaultAvailableHeadM: 45, mark: 'ВОС' },
  { id: 'filtration_station', defaultAvailableHeadM: 50, mark: 'НФС' },
  { id: 'pump_station', defaultAvailableHeadM: 55, mark: 'НС' },
  { id: 'reservoir', defaultAvailableHeadM: 30, mark: 'РЧВ' },
  { id: 'water_tower', defaultAvailableHeadM: 25, mark: 'ВБ' },
  { id: 'intake', defaultAvailableHeadM: 40, mark: 'ВЗ' },
]

export function buildingPreset(id: string): BuildingPreset | undefined {
  return BUILDING_PRESETS.find((p) => p.id === id)
}

export function sourcePreset(id: string): SourcePreset | undefined {
  return SOURCE_PRESETS.find((p) => p.id === id)
}
