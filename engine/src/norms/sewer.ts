import type { Justified } from '../normregistry'
import { justified } from '../normregistry'
import kgenTable from './data/table-5-13-kgen.json'
import roughnessTable from './data/table-5-18-roughness.json'
import minVelocityTable from './data/table-5-19-min-velocity.json'
import minSlopeOpenTable from './data/table-5-22-min-slope-open.json'
import manholeSpacingTable from './data/clause-7-4-1-manhole-spacing.json'
import inletSpacingTable from './data/clause-7-6-6-inlet-spacing.json'

/**
 * Verified lookups for sewer (К1) and storm (К2) networks from
 * СН РК 4.01-03-2013* «Водоотведение. Наружные сети и сооружения».
 * Every value is transcribed verbatim from the official PDF
 * (docs/norms/sn-rk-4-01-03-2013-vodootvedenie.pdf); the bulky tables live in
 * ./data/*.json with document, clause and PDF page recorded next to the rows.
 */

export { kgenTable, roughnessTable, minVelocityTable, minSlopeOpenTable, manholeSpacingTable, inletSpacingTable }

export type SewerNetworkLevel = 'street' | 'intraquarter'

/** 5.9.1: наименьшие диаметры труб самотечных сетей. */
export function minGravityDiameterMm(system: 'sewer' | 'storm', level: SewerNetworkLevel): Justified<number> {
  const value = system === 'storm' ? (level === 'street' ? 250 : 200) : level === 'street' ? 200 : 150
  const ref = system === 'storm' ? 'storm.minDiameter' : 'sewer.minDiameter'
  return justified(value, [ref])
}

/**
 * 5.11.1: наименьшие уклоны 150 мм — 0.008, 200 мм — 0.007. Для диаметров
 * более 200 мм норматив прямо значения не задаёт (отсылка к [1]); возвращаем
 * null, уклон подбирается из условия минимальной самоочищающей скорости.
 */
export function minSlopeForDiameter(diameterMm: number): Justified<number> | null {
  if (diameterMm <= 150) return justified(0.008, ['sewer.slope.min'])
  if (diameterMm <= 200) return justified(0.007, ['sewer.slope.min'])
  return null
}

export interface MinVelocityRow {
  dMinMm: number
  dMaxMm: number | null
  filling: number
  vMinMps: number
}

function velocityRow(diameterMm: number): MinVelocityRow {
  const rows = minVelocityTable.rows as MinVelocityRow[]
  for (const row of rows) {
    if (diameterMm >= row.dMinMm && (row.dMaxMm === null || diameterMm <= row.dMaxMm)) return row
  }
  return diameterMm < rows[0].dMinMm ? rows[0] : rows[rows.length - 1]
}

/**
 * Таблица 5.19 (5.10.1): наименьшая скорость при наибольшем расчётном
 * наполнении. Для дождевой сети действует примечание 3 к таблице: при
 * Р = 0,33 года наименьшую скорость следует принимать 0,6 м/сек (стр. 40
 * PDF) — поэтому storm получает 0,6 независимо от диаметра. Если проект
 * принимает другой период однократного превышения Р, значение уточняется.
 */
export function minVelocityMps(
  diameterMm: number,
  system: 'sewer' | 'storm' = 'sewer',
  stormRainPeriodYears?: number,
): Justified<number> {
  if (system === 'storm' && stormRainPeriodYears != null && Math.abs(stormRainPeriodYears - 0.33) < 1e-9) {
    return justified(0.6, ['sewer.velocity.min'], 'normative', 'дождевая сеть при Р=0,33 года — примечание 3 к таблице 5.19')
  }
  return justified(
    velocityRow(diameterMm).vMinMps,
    ['sewer.velocity.min'],
    'normative',
    system === 'storm'
      ? 'таблица 5.19; исключение 0,6 м/с не применяется без подтверждённого Р=0,33 года'
      : undefined,
  )
}

/** Таблица 5.19: наибольшее расчётное наполнение H/D, при котором нормирована скорость. */
export function designFilling(diameterMm: number): Justified<number> {
  return justified(velocityRow(diameterMm).filling, ['sewer.velocity.min'])
}

/**
 * 5.10.7: предельное наполнение — 0.8 диаметра (высоты) для сечений любой
 * формы, кроме прямоугольного (0.75 высоты); дождевая сеть — полное наполнение.
 */
export function maxFilling(system: 'sewer' | 'storm', rectangular = false): Justified<number> {
  if (system === 'storm') return justified(1, ['sewer.filling.max'])
  return justified(rectangular ? 0.75 : 0.8, ['sewer.filling.max'])
}

/** 5.10.3: наибольшие расчётные скорости движения сточных вод. */
export function maxVelocityMps(system: 'sewer' | 'storm', material: 'metal' | 'nonmetal'): Justified<number> {
  if (system === 'storm') return justified(
    material === 'metal' ? 10 : 7,
    ['sewer.velocity.max'],
    'normative',
    'для дождевой сети: 10 м/с для металлических и 7 м/с для неметаллических труб',
  )
  return justified(material === 'metal' ? 8 : 4, ['sewer.velocity.max'])
}

/** 7.4.1: расстояние между смотровыми колодцами на прямых участках. */
export function manholeSpacingM(diameterMm: number): Justified<number> {
  const rows = manholeSpacingTable.rows as { dMinMm: number; dMaxMm: number | null; spacingM: number }[]
  for (const row of rows) {
    if (diameterMm >= row.dMinMm && (row.dMaxMm === null || diameterMm <= row.dMaxMm)) {
      return justified(row.spacingM, ['sewer.manhole.spacing'])
    }
  }
  return justified(rows[0].spacingM, ['sewer.manhole.spacing'])
}

/** 7.6.6: расстояние между дождеприёмниками по продольному уклону лотка. */
export function stormInletSpacingM(lotSlope: number, streetWidthM: number): Justified<number> {
  if (streetWidthM > inletSpacingTable.wideStreet.widthOverM) {
    return justified(inletSpacingTable.wideStreet.spacingMaxM, ['storm.inlet.spacing'])
  }
  const rows = inletSpacingTable.rows as { slopeMax: number; spacingM: number }[]
  for (const row of rows) {
    if (lotSlope <= row.slopeMax) return justified(row.spacingM, ['storm.inlet.spacing'])
  }
  return justified(rows[rows.length - 1].spacingM, ['storm.inlet.spacing'])
}

/**
 * Таблица 5.13 (5.5.7): общий коэффициент неравномерности притока, линейная
 * интерполяция по среднему расходу. При расходе менее 5 л/с максимальный
 * коэффициент принимается 3 (примечание 2 к таблице).
 */
export function kGenMax(meanFlowLps: number, availability: '1pct' | '5pct' = '1pct'): Justified<number> {
  const flows = kgenTable.meanFlowLps as number[]
  const values = (availability === '1pct' ? kgenTable.kGenMax1pct : kgenTable.kGenMax5pct) as number[]
  if (meanFlowLps < flows[0]) return justified(3, ['sewer.kgen'], 'normative', 'примечание 2 к Таблице 5.13')
  if (meanFlowLps >= flows[flows.length - 1]) return justified(values[values.length - 1], ['sewer.kgen'])
  for (let i = 0; i < flows.length - 1; i++) {
    if (meanFlowLps <= flows[i + 1]) {
      const share = (meanFlowLps - flows[i]) / (flows[i + 1] - flows[i])
      const value = values[i] + share * (values[i + 1] - values[i])
      return justified(Math.round(value * 100) / 100, ['sewer.kgen'])
    }
  }
  return justified(values[values.length - 1], ['sewer.kgen'])
}

/** 5.8.1: коэффициент шероховатости n1 для гидравлического расчёта. */
export function sewerRoughnessN(kind: 'gravity' | 'pressure'): Justified<number> {
  const value = kind === 'gravity' ? roughnessTable.roughnessN.gravityCircular : roughnessTable.roughnessN.pressure
  return justified(value, ['sewer.roughness'])
}

export type SewerBurialGoverningConstraint = 'frost' | 'crown-cover' | 'both'

/** All 7.2.4 limits expressed from finished ground down to the pipe invert. */
export interface SewerBurialDepthConstraints {
  diameterM: number
  frostReductionM: number
  /** Minimum depth from ground to invert derived from freezing depth. */
  frostInvertDepthM: number
  /** Minimum cover from ground to pipe crown (top), not to invert. */
  minimumCrownCoverM: number
  /** Crown-cover constraint converted to ground-to-invert depth. */
  crownCoverInvertDepthM: number
  /** Governing minimum depth from ground to invert. */
  minimumInvertDepthM: number
  governingConstraint: SewerBurialGoverningConstraint
}

const roundDepth = (value: number): number => Math.round(value * 1000) / 1000

function assertBurialInput(name: string, value: number, allowZero: boolean): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} finite number`)
  }
}

/** 7.2.4: invert-depth constraint derived only from the design freezing depth. */
export function minSewerInvertDepthFromFrostM(
  diameterMm: number,
  freezingDepthM: number,
): Justified<number> {
  assertBurialInput('diameterMm', diameterMm, false)
  assertBurialInput('freezingDepthM', freezingDepthM, true)
  const reductionM = diameterMm <= 500 ? 0.3 : 0.5
  return justified(
    roundDepth(Math.max(0, freezingDepthM - reductionM)),
    ['sewer.depth.min'],
    'normative',
    `глубина лотка не менее глубины промерзания минус ${reductionM.toFixed(1)} м`,
  )
}

/** 7.2.4: minimum cover measured from ground to the pipe crown (top). */
export function minSewerCrownCoverM(): Justified<number> {
  return justified(0.7, ['sewer.depth.min'], 'normative', 'не менее 0,7 м до верха трубы')
}

/** Resolve unlike frost/invert and crown-cover limits into one invert-depth contract. */
export function sewerBurialDepthConstraints(
  diameterMm: number,
  freezingDepthM: number,
): SewerBurialDepthConstraints {
  const diameterM = roundDepth(diameterMm / 1000)
  const frost = minSewerInvertDepthFromFrostM(diameterMm, freezingDepthM)
  const crownCover = minSewerCrownCoverM()
  const crownCoverInvertDepthM = roundDepth(crownCover.value + diameterM)
  const minimumInvertDepthM = Math.max(frost.value, crownCoverInvertDepthM)
  const difference = frost.value - crownCoverInvertDepthM
  const governingConstraint: SewerBurialGoverningConstraint = Math.abs(difference) < 1e-9
    ? 'both'
    : difference > 0 ? 'frost' : 'crown-cover'
  return {
    diameterM,
    frostReductionM: diameterMm <= 500 ? 0.3 : 0.5,
    frostInvertDepthM: frost.value,
    minimumCrownCoverM: crownCover.value,
    crownCoverInvertDepthM,
    minimumInvertDepthM: roundDepth(minimumInvertDepthM),
    governingConstraint,
  }
}

/** 7.2.4: governing minimum depth from ground to pipe invert. */
export function minSewerInvertDepthM(diameterMm: number, freezingDepthM: number): Justified<number> {
  const limits = sewerBurialDepthConstraints(diameterMm, freezingDepthM)
  return justified(
    limits.minimumInvertDepthM,
    ['sewer.depth.min'],
    'normative',
    `max(промерзание: ${limits.frostInvertDepthM.toFixed(3)} м; покрытие до верха + диаметр: ${limits.crownCoverInvertDepthM.toFixed(3)} м)`,
  )
}

/** @deprecated Use minSewerInvertDepthM; the returned value is depth to invert. */
export function minSewerDepthM(diameterMm: number, freezingDepthM: number): Justified<number> {
  return minSewerInvertDepthM(diameterMm, freezingDepthM)
}
