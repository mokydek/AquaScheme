/**
 * АГСК-3 (СҚҚК-3) — the official RK Architectural, Urban-planning and
 * Construction Catalogue: «Перечень строительных конструкций, изделий и
 * строительных материалов» (Комитет по делам строительства и ЖКХ МПиС РК,
 * по состоянию на 3 апреля 2026 года). It is the classifier that supplies the
 * «Код продукции» column of the ГОСТ 21.110 specification.
 *
 * The catalogue is ~14000 pages: code | наименование | стандарт | ед. изм.
 * Its exact 7-digit position codes are looked up per size by the engineer.
 * Here we register ONLY the verified подраздел (section) codes that classify
 * the material categories AquaScheme designs — transcribed from the catalogue
 * table of contents — and map each engine material/fitting to its section.
 * We deliberately do NOT invent per-size position codes.
 */

export const AGSK_DOCUMENT_CODE = 'АГСК-3'

export interface AgskSection {
  /** Подраздел code, e.g. '241-2'. */
  code: string
  title: string
}

/** Verified подразделы of АГСК-3 relevant to water supply and sewerage. */
export const AGSK_SECTIONS = {
  pipesSteel: { code: '241-1', title: 'Трубы и фитинги стальные' },
  pipesPolymer: { code: '241-2', title: 'Трубы и фитинги полимерные и сопутствующие' },
  pipesFiberglass: { code: '241-3', title: 'Трубы и фитинги стеклопластиковые' },
  pipesCoated: { code: '241-4', title: 'Трубы и фитинги с покрытием' },
  pipesCastIron: { code: '241-5', title: 'Трубы и фитинги чугунные' },
  pipesOther: { code: '241-7', title: 'Трубы и фитинги из других материалов, кроме полимерных' },
  valves: { code: '242-1', title: 'Задвижки, затворы' },
  regulatorsAirValves: { code: '242-4', title: 'Регуляторы, вантузы, компенсаторы, фильтры' },
  wells: { code: '244-2', title: 'Колодцы, колонки, емкости' },
  fireProducts: { code: '244-4', title: 'Изделия для системы пожаротушения' },
  drainageProducts: { code: '244-6', title: 'Изделия для систем водоотведения' },
} as const satisfies Record<string, AgskSection>

/** АГСК section for a pressure pipe material (engine MaterialSelection.primary). */
export function agskSectionForPipe(primary: string): AgskSection {
  switch (primary) {
    case 'STEEL':
      return AGSK_SECTIONS.pipesSteel
    case 'DUCTILE_IRON':
      return AGSK_SECTIONS.pipesCastIron
    case 'PE100_SDR17':
    case 'PE100_SDR11':
    case 'PVC':
      return AGSK_SECTIONS.pipesPolymer
    default:
      return AGSK_SECTIONS.pipesPolymer
  }
}

/** АГСК section for a gravity (sewer) pipe by material family. */
export function agskSectionForGravityPipe(material: 'concrete' | 'polymer' | 'ceramic' = 'concrete'): AgskSection {
  return material === 'polymer' ? AGSK_SECTIONS.pipesPolymer : AGSK_SECTIONS.pipesOther
}

/**
 * Position codes of группа 241-702 «Труба безнапорная цилиндрическая
 * раструбная типа ТС ГОСТ 6482-2011», transcribed verbatim from АГСК-3
 * PDF page 1705 — the pipe family professional НК albums specify for concrete
 * gravity collectors. Only the sizes read off that page are listed; the rest
 * of the series stays absent rather than guessed, because a wrong «Код
 * продукции» in a specification is worse than an empty one.
 */
export const AGSK_CONCRETE_GRAVITY_PIPE_CODES: Readonly<Record<number, string>> = {
  300: '241-702-0901',
  400: '241-702-0902',
  450: '241-702-0903',
  500: '241-702-0904',
  600: '241-702-0905',
  800: '241-702-0906',
}

/**
 * Catalogue code for a concrete gravity pipe of the given nominal diameter, or
 * null when that size is not among the transcribed positions. Callers fall back
 * to the подраздел code so the specification still carries a classifier value.
 */
export function agskConcreteGravityPipeCode(diameterMm: number): string | null {
  return AGSK_CONCRETE_GRAVITY_PIPE_CODES[diameterMm] ?? null
}

/** АГСК section for a fitting/appurtenance kind. */
export function agskSectionForFitting(kind: 'hydrant' | 'valve' | 'airValve' | 'washout' | 'well'): AgskSection {
  switch (kind) {
    case 'hydrant':
      return AGSK_SECTIONS.fireProducts
    case 'valve':
      return AGSK_SECTIONS.valves
    case 'airValve':
    case 'washout':
      return AGSK_SECTIONS.regulatorsAirValves
    case 'well':
      return AGSK_SECTIONS.wells
  }
}
