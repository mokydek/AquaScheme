import type { NetworkDemand } from './demand'
import type { FittingsPlan, GeologyInput, MaterialSelection, SeismicInput } from './equipment'
import type { Borehole, GeologyAttributes } from './geology'
import type { NormativeParams } from './norms'
import type { TracedNetwork } from './trace'
import type { SizingResult } from './sizing'
import type { SurveyPoint, SystemType, WorkType } from './types'

/** Everything the export generators (DXF, PDF note, specification) need. */
export interface ExportInput {
  projectName: string
  /** ISO date string, supplied by the caller (the engine has no clock). */
  dateIso: string
  source: { x: number; y: number; groundElevation: number; availableHead: number }
  buildings: Array<{ id: string; label: string; x: number; y: number; floors: number; residents: number }>
  network: TracedNetwork
  sizing: SizingResult
  demand: NetworkDemand
  material: MaterialSelection
  fittings: FittingsPlan
  norms: NormativeParams
  geology: GeologyInput
  seismicity: SeismicInput
  surveyPoints?: SurveyPoint[]
  /** Selected region (requirements update 3, change 3), if any. */
  region?: { name: string; source: 'manual' | 'auto' } | null
  /** Boreholes for the geology cross-section on the profile (G3), if any. */
  boreholes?: Borehole[]
  /** Project level geology attributes (subsidence, heaving, swelling). */
  geologyAttributes?: Partial<GeologyAttributes>
  /** New build or reconstruction; fills the project documents (НБ2). */
  workType?: WorkType
  /** Water, sewer or storm; picks the wording in the project documents. */
  systemType?: SystemType
}

/** Input for the situational scheme sheet (ситуационная схема, без масштаба). */
export interface SituationInput {
  projectName: string
  systemType?: SystemType
  network: TracedNetwork
  buildings?: Array<{ x: number; y: number; label?: string }>
  surveyPoints?: Array<{ x: number; y: number }>
  /** pipeId → diameter, mm, for labels along the route. */
  pipeDiameterMm?: Map<string, number>
}

export const MATERIAL_LABELS: Record<string, string> = {
  PE100_SDR17: 'ПЭ100 SDR17',
  PE100_SDR11: 'ПЭ100 SDR11',
  DUCTILE_IRON: 'ВЧШГ',
  STEEL: 'Сталь',
  PVC: 'НПВХ',
}

export function materialLabel(input: ExportInput): string {
  return `${MATERIAL_LABELS[input.material.primary] ?? input.material.primary} PN${input.material.pnBar}`
}
