/**
 * Limit-intensity storm-runoff calculation from СН РК 4.01-03-2013*, 5.4.
 * Climate values are explicit verified inputs: this module never reads q20
 * from a reference project or guesses it from a city name.
 */

export type StormSurfaceClass =
  | 'impervious'
  | 'paved_block'
  | 'cobblestone'
  | 'unbound_crushed_stone'
  | 'gravel_path'
  | 'graded_soil'
  | 'lawn'

export interface VerifiedSource {
  source: string
  verified: boolean
}

export interface StormSurface extends VerifiedSource {
  id: string
  kind: StormSurfaceClass
  areaHa: number
  /** Optional confirmed override; required only when the normative table is not applicable. */
  coefficientZ?: number
}

export interface StormRainParameters extends VerifiedSource {
  q20LpsPerHa: number
  exponentN: number
  rainEventsPerYearMr: number
  exponentGamma: number
  designPeriodYears: number
}

export interface StormTravelSegment {
  lengthM: number
  velocityMps: number
}

export interface StormRunoffInput {
  id: string
  surfaces: StormSurface[]
  rain: StormRainParameters
  surfaceConcentrationMin: number
  gutterSegments?: StormTravelSegment[]
  pipeSegments?: StormTravelSegment[]
  meanTerrainSlope?: number
  /** Required in the 0.01..0.03 slope band; N05 permits 10..15%, but does not choose for us. */
  slopeBetaIncreaseFraction?: number
  /** N05 permits, but does not require, a 10/15% beta reduction for a small network. */
  applySmallNetworkBetaReduction?: boolean
  networkSectionCount?: number
  /** Required for durations below 10 min except the explicitly stated 5 and 7 minute cases. */
  shortDurationCorrection?: VerifiedSource & { value: number }
  /** Explicit sourced value used only when table 5.9 cannot be applied as written. */
  areaCorrectionKOverride?: VerifiedSource & { value: number }
  outsideSettlement?: boolean
}

export type StormRunoffProvenanceMethod =
  | 'table_exact'
  | 'linear_interpolation'
  | 'normative_boundary'
  | 'verified_override'

export interface StormRunoffProvenance {
  parameter: string
  method: StormRunoffProvenanceMethod
  input: number
  value: number
  normRef: string
  lower?: { input: number; value: number }
  upper?: { input: number; value: number }
  source?: string
}

export interface StormRunoffResult {
  catchmentId: string
  areaHa: number
  coefficientZMid: number | null
  parameterA: number | null
  durationMin: number | null
  areaCorrectionK: number | null
  beta: number | null
  rainFlowLps: number | null
  calculatedFlowLps: number | null
  blockers: string[]
  warnings: string[]
  verified: boolean
  refs: string[]
  provenance: StormRunoffProvenance[]
}

const FIXED_SURFACE_Z: Partial<Record<StormSurfaceClass, number>> = {
  paved_block: 0.224,
  cobblestone: 0.145,
  unbound_crushed_stone: 0.125,
  gravel_path: 0.09,
  graded_soil: 0.064,
  lawn: 0.038,
}

const IMPERVIOUS_A = [300, 400, 500, 600, 700, 800, 1000, 1200, 1500] as const
const IMPERVIOUS_Z_LOW_N = [0.32, 0.30, 0.29, 0.28, 0.27, 0.26, 0.25, 0.24, 0.23] as const
const IMPERVIOUS_Z_HIGH_N = [0.33, 0.31, 0.30, 0.29, 0.28, 0.27, 0.26, 0.25, 0.24] as const
const AREA_K_POINTS = [
  [500, 0.95], [1000, 0.90], [2000, 0.85], [4000, 0.80],
  [6000, 0.70], [8000, 0.60], [10000, 0.55],
] as const
const BETA_POINTS = [[0.4, 0.8], [0.5, 0.75], [0.6, 0.7], [0.7, 0.65]] as const

interface TableLookup {
  value: number
  provenance: StormRunoffProvenance
  interpolated: boolean
}

function interpolateWithinTable(
  points: readonly (readonly [number, number])[],
  value: number,
  parameter: string,
  normRef: string,
): TableLookup {
  const first = points[0]
  const last = points[points.length - 1]
  if (value < first[0] || value > last[0]) {
    throw new Error(`${parameter} ${value} находится вне нормативного диапазона ${first[0]}–${last[0]}; экстраполяция или прижатие к границе таблицы запрещены.`)
  }
  const exact = points.find(([input]) => input === value)
  if (exact) {
    return {
      value: exact[1],
      interpolated: false,
      provenance: {
        parameter,
        method: 'table_exact',
        input: value,
        value: exact[1],
        normRef,
      },
    }
  }
  for (let index = 1; index < points.length; index++) {
    if (value <= points[index][0]) {
      const [x0, y0] = points[index - 1]
      const [x1, y1] = points[index]
      const interpolatedValue = y0 + (y1 - y0) * (value - x0) / (x1 - x0)
      return {
        value: interpolatedValue,
        interpolated: true,
        provenance: {
          parameter,
          method: 'linear_interpolation',
          input: value,
          value: interpolatedValue,
          normRef,
          lower: { input: x0, value: y0 },
          upper: { input: x1, value: y1 },
        },
      }
    }
  }
  throw new Error(`Не удалось определить ${parameter} по нормативной таблице.`)
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} должно быть положительным числом.`)
}

export function stormParameterA(rain: StormRainParameters): number {
  requirePositive('q20', rain.q20LpsPerHa)
  requirePositive('n', rain.exponentN)
  requirePositive('m_r', rain.rainEventsPerYearMr)
  requirePositive('gamma', rain.exponentGamma)
  requirePositive('P', rain.designPeriodYears)
  if (rain.rainEventsPerYearMr <= 1) throw new Error('m_r должно быть больше 1 для логарифмической формулы 5.10.')
  const recurrence = 1 + Math.log10(rain.designPeriodYears) / Math.log10(rain.rainEventsPerYearMr)
  if (recurrence <= 0) throw new Error('Параметры P и m_r дают недопустимый множитель формулы 5.10.')
  return rain.q20LpsPerHa * 20 ** rain.exponentN * recurrence ** rain.exponentGamma
}

export function imperviousSurfaceCoefficientZ(parameterA: number, exponentN: number): number {
  return imperviousCoefficientLookup(parameterA, exponentN).value
}

interface EvaluatedValue {
  value: number
  warnings: string[]
  provenance: StormRunoffProvenance[]
}

function imperviousCoefficientLookup(parameterA: number, exponentN: number): TableLookup {
  requirePositive('A', parameterA)
  requirePositive('n', exponentN)
  const row = exponentN < 0.65 ? IMPERVIOUS_Z_LOW_N : IMPERVIOUS_Z_HIGH_N
  return interpolateWithinTable(
    IMPERVIOUS_A.map((a, index) => [a, row[index]] as const),
    parameterA,
    'Параметр A для коэффициента z водонепроницаемой поверхности',
    'storm.runoff.surface',
  )
}

function validatedOverride(
  label: string,
  override: VerifiedSource & { value: number },
): number {
  if (!override.verified || !override.source.trim()) {
    throw new Error(`${label}: override должен иметь verified=true и непустой источник.`)
  }
  if (!Number.isFinite(override.value) || override.value <= 0 || override.value > 1) {
    throw new Error(`${label} должен находиться в диапазоне (0; 1].`)
  }
  return override.value
}

function evaluateStormSurfaceCoefficientZ(
  surface: StormSurface,
  parameterA: number,
  exponentN: number,
): EvaluatedValue {
  requirePositive(`Площадь поверхности ${surface.id}`, surface.areaHa)
  if (surface.coefficientZ !== undefined) {
    const value = validatedOverride(`Коэффициент z поверхности ${surface.id}`, {
      value: surface.coefficientZ,
      verified: surface.verified,
      source: surface.source,
    })
    return {
      value,
      warnings: [`Для поверхности ${surface.id} применён подтверждённый override z=${value} из источника «${surface.source}».`],
      provenance: [{
        parameter: `Коэффициент z поверхности ${surface.id}`,
        method: 'verified_override',
        input: parameterA,
        value,
        normRef: 'storm.runoff.surface',
        source: surface.source,
      }],
    }
  }
  if (surface.kind === 'impervious') {
    const lookup = imperviousCoefficientLookup(parameterA, exponentN)
    const provenance = {
      ...lookup.provenance,
      parameter: `Коэффициент z водонепроницаемой поверхности ${surface.id}`,
    }
    return {
      value: lookup.value,
      warnings: lookup.interpolated
        ? [`z поверхности ${surface.id} получен линейной интерполяцией по A между ${provenance.lower!.input} и ${provenance.upper!.input}.`]
        : [],
      provenance: [provenance],
    }
  }
  const value = FIXED_SURFACE_Z[surface.kind]
  if (value === undefined) throw new Error(`Для поверхности ${surface.id} отсутствует коэффициент z.`)
  return {
    value,
    warnings: [],
    provenance: [{
      parameter: `Коэффициент z поверхности ${surface.id}`,
      method: 'table_exact',
      input: value,
      value,
      normRef: 'storm.runoff.surface',
    }],
  }
}

export function stormSurfaceCoefficientZ(surface: StormSurface, parameterA: number, exponentN: number): number {
  return evaluateStormSurfaceCoefficientZ(surface, parameterA, exponentN).value
}

function evaluateWeightedStormCoefficientZ(
  surfaces: StormSurface[],
  parameterA: number,
  exponentN: number,
): { areaHa: number; coefficientZMid: number; warnings: string[]; provenance: StormRunoffProvenance[] } {
  if (surfaces.length === 0) throw new Error('Не задан состав поверхностей водосбора.')
  const areaHa = surfaces.reduce((sum, surface) => sum + surface.areaHa, 0)
  requirePositive('Площадь водосбора', areaHa)
  let weighted = 0
  const warnings: string[] = []
  const provenance: StormRunoffProvenance[] = []
  for (const surface of surfaces) {
    const evaluated = evaluateStormSurfaceCoefficientZ(surface, parameterA, exponentN)
    weighted += evaluated.value * surface.areaHa
    warnings.push(...evaluated.warnings)
    provenance.push(...evaluated.provenance)
  }
  return { areaHa, coefficientZMid: weighted / areaHa, warnings, provenance }
}

export function weightedStormCoefficientZ(
  surfaces: StormSurface[],
  parameterA: number,
  exponentN: number,
): { areaHa: number; coefficientZMid: number } {
  const evaluated = evaluateWeightedStormCoefficientZ(surfaces, parameterA, exponentN)
  return { areaHa: evaluated.areaHa, coefficientZMid: evaluated.coefficientZMid }
}

function segmentTravelTime(segments: StormTravelSegment[], factor: number): number {
  return factor * segments.reduce((sum, segment) => {
    requirePositive('Длина участка протекания', segment.lengthM)
    requirePositive('Скорость протекания', segment.velocityMps)
    return sum + segment.lengthM / segment.velocityMps
  }, 0)
}

export function stormTravelTimeMin(input: Pick<StormRunoffInput,
  'surfaceConcentrationMin' | 'gutterSegments' | 'pipeSegments'>): number {
  requirePositive('Время поверхностной концентрации', input.surfaceConcentrationMin)
  return input.surfaceConcentrationMin
    + segmentTravelTime(input.gutterSegments ?? [], 0.021)
    + segmentTravelTime(input.pipeSegments ?? [], 0.017)
}

export function stormAreaCorrectionK(areaHa: number): number {
  return areaCorrectionLookup(areaHa).value
}

export function stormBaseBeta(exponentN: number): number {
  return betaLookup(exponentN).value
}

function areaCorrectionLookup(areaHa: number): TableLookup {
  requirePositive('Площадь водосбора', areaHa)
  if (areaHa < 500) {
    return {
      value: 1,
      interpolated: false,
      provenance: {
        parameter: 'Коэффициент неравномерности дождя по площади K',
        method: 'normative_boundary',
        input: areaHa,
        value: 1,
        normRef: 'storm.runoff.limitIntensity',
      },
    }
  }
  return interpolateWithinTable(
    AREA_K_POINTS,
    areaHa,
    'Площадь водосбора для коэффициента K',
    'storm.runoff.limitIntensity',
  )
}

function betaLookup(exponentN: number): TableLookup {
  requirePositive('n', exponentN)
  if (exponentN <= 0.4) {
    return {
      value: 0.8,
      interpolated: false,
      provenance: {
        parameter: 'Базовый коэффициент beta',
        method: 'normative_boundary',
        input: exponentN,
        value: 0.8,
        normRef: 'storm.runoff.beta',
      },
    }
  }
  if (exponentN >= 0.7) {
    return {
      value: 0.65,
      interpolated: false,
      provenance: {
        parameter: 'Базовый коэффициент beta',
        method: 'normative_boundary',
        input: exponentN,
        value: 0.65,
        normRef: 'storm.runoff.beta',
      },
    }
  }
  const lookup = interpolateWithinTable(
    BETA_POINTS,
    exponentN,
    'Показатель степени n для коэффициента beta',
    'storm.runoff.beta',
  )
  return {
    ...lookup,
    provenance: { ...lookup.provenance, parameter: 'Базовый коэффициент beta' },
  }
}

function evaluateAreaCorrectionK(input: StormRunoffInput, areaHa: number): EvaluatedValue {
  if (input.areaCorrectionKOverride) {
    const override = input.areaCorrectionKOverride
    const value = validatedOverride('Коэффициент K', override)
    return {
      value,
      warnings: [`Применён подтверждённый override K=${value} из источника «${override.source}».`],
      provenance: [{
        parameter: 'Коэффициент неравномерности дождя по площади K',
        method: 'verified_override',
        input: areaHa,
        value,
        normRef: 'storm.runoff.limitIntensity',
        source: override.source,
      }],
    }
  }
  const lookup = areaCorrectionLookup(areaHa)
  return {
    value: lookup.value,
    warnings: lookup.interpolated
      ? [`K получен линейной интерполяцией по площади между ${lookup.provenance.lower!.input} и ${lookup.provenance.upper!.input} га.`]
      : [],
    provenance: [lookup.provenance],
  }
}

function durationCorrection(input: StormRunoffInput, durationMin: number, blockers: string[]): number | null {
  if (durationMin >= 10) return 1
  if (Math.abs(durationMin - 5) < 1e-6) return 0.8
  if (Math.abs(durationMin - 7) < 1e-6) return 0.9
  const correction = input.shortDurationCorrection
  if (!correction || !correction.verified || !correction.source.trim()) {
    blockers.push('Для t_r < 10 мин требуется подтверждённый поправочный коэффициент; N05 прямо задаёт только 0,8 при 5 мин и 0,9 при 7 мин.')
    return null
  }
  if (!(correction.value > 0 && correction.value <= 1)) {
    blockers.push('Поправочный коэффициент короткого дождя должен находиться в диапазоне (0; 1].')
    return null
  }
  return correction.value
}

function adjustedBeta(
  input: StormRunoffInput,
  blockers: string[],
  warnings: string[],
  provenance: StormRunoffProvenance[],
): number | null {
  const baseBeta = betaLookup(input.rain.exponentN)
  let beta = baseBeta.value
  provenance.push(baseBeta.provenance)
  if (baseBeta.interpolated) {
    warnings.push(`Базовый beta получен линейной интерполяцией по n между ${baseBeta.provenance.lower!.input} и ${baseBeta.provenance.upper!.input}.`)
  }
  const slope = input.meanTerrainSlope ?? 0
  if (!Number.isFinite(slope) || slope < 0) {
    blockers.push('Средний уклон местности должен быть неотрицательным числом.')
    return null
  }
  if (slope > 0.03) beta = 1
  else if (slope >= 0.01) {
    const increase = input.slopeBetaIncreaseFraction
    if (increase === undefined || increase < 0.10 || increase > 0.15) {
      blockers.push('Для уклона 0,01–0,03 требуется выбранное и подтверждённое увеличение beta от 10% до 15%.')
      return null
    }
    beta = Math.min(1, beta * (1 + increase))
  }
  if (input.applySmallNetworkBetaReduction) {
    const count = input.networkSectionCount
    if (!Number.isInteger(count) || Number(count) <= 0) {
      blockers.push('Для уменьшения beta необходимо положительное целое число участков сети.')
      return null
    }
    if (Number(count) < 4) beta *= 0.85
    else if (Number(count) <= 10) beta *= 0.90
  }
  return beta
}

export function calculateStormRunoff(input: StormRunoffInput): StormRunoffResult {
  const blockers: string[] = []
  const warnings: string[] = []
  const provenance: StormRunoffProvenance[] = []
  const refs = [
    'storm.runoff.limitIntensity',
    'storm.rain.parameters',
    'storm.runoff.travelTime',
    'storm.runoff.surface',
    'storm.runoff.beta',
  ]
  if (!input.rain.verified || !input.rain.source.trim()) blockers.push('Климатические параметры q20, n, m_r, gamma и P не подтверждены источником.')
  if (input.surfaces.some((surface) => !surface.verified || !surface.source.trim())) {
    blockers.push('Не все площади и типы поверхностей водосбора подтверждены источниками.')
  }
  if (input.outsideSettlement && input.surfaces.reduce((sum, surface) => sum + surface.areaHa, 0) > 1000) {
    blockers.push('Для незастроенного водосбора свыше 1000 га за пределами населённого пункта N05 требует иной нормативный метод.')
  }

  let parameterA: number | null = null
  let areaHa = input.surfaces.reduce((sum, surface) => sum + surface.areaHa, 0)
  let coefficientZMid: number | null = null
  let durationMin: number | null = null
  let areaCorrectionK: number | null = null
  let beta: number | null = null
  try {
    parameterA = stormParameterA(input.rain)
    const weighted = evaluateWeightedStormCoefficientZ(input.surfaces, parameterA, input.rain.exponentN)
    areaHa = weighted.areaHa
    coefficientZMid = weighted.coefficientZMid
    warnings.push(...weighted.warnings)
    provenance.push(...weighted.provenance)
    durationMin = stormTravelTimeMin(input)
    const evaluatedAreaCorrection = evaluateAreaCorrectionK(input, areaHa)
    areaCorrectionK = evaluatedAreaCorrection.value
    warnings.push(...evaluatedAreaCorrection.warnings)
    provenance.push(...evaluatedAreaCorrection.provenance)
    beta = adjustedBeta(input, blockers, warnings, provenance)
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error))
  }
  if (areaHa > 50) blockers.push('Водосбор свыше 50 га требует проверочных расчётов отдельных частей по 5.4.8; без них агрегированный расход нельзя подтвердить.')

  const correction = durationMin === null ? null : durationCorrection(input, durationMin, blockers)
  let rainFlowLps: number | null = null
  let calculatedFlowLps: number | null = null
  if (blockers.length === 0 && parameterA !== null && coefficientZMid !== null && durationMin !== null
    && areaCorrectionK !== null && beta !== null && correction !== null) {
    rainFlowLps = coefficientZMid * parameterA ** 1.2 * areaHa * areaCorrectionK * correction
      / durationMin ** (1.2 * input.rain.exponentN - 0.1)
    calculatedFlowLps = beta * rainFlowLps
  }
  return {
    catchmentId: input.id,
    areaHa,
    coefficientZMid,
    parameterA,
    durationMin,
    areaCorrectionK,
    beta,
    rainFlowLps,
    calculatedFlowLps,
    blockers,
    warnings,
    verified: blockers.length === 0,
    refs,
    provenance,
  }
}
