/**
 * Reconstruction and the technical survey act (requirements update 1,
 * change 2). Existing pipes get their ACTUAL equivalent roughness from the
 * survey (material, wear, overgrowth), which drives their head loss, and a
 * per segment decision: keep, rehabilitate or replace.
 *
 * The roughness model below is an engineering estimate flagged for
 * confirmation against the Shevelev tables for old pipes; it is not treated
 * as a final normative value.
 */

import { justified, type Justified } from './normregistry'
import roughnessTable from './norms/data/table-5-18-roughness.json'

export type ExistingMaterial =
  'steel' | 'cast_iron' | 'concrete' | 'asbestos' | 'ceramic' | 'pe' | 'pvc' | 'unknown'

export type PipeDecision = 'keep' | 'rehabilitate' | 'replace'

/**
 * Equivalent absolute roughness, mm: new pipe and fully worn (wear 100%).
 *
 * Ряд ОЦЕНОЧНЫЙ, а не нормативный: норма (табл. 5.18) даёт одну величину на
 * материал и износа не описывает вовсе, а здесь нужна зависимость от износа.
 * Значения `fresh` с табл. 5.18 не сверены и от неё отличаются — нормативную
 * величину со ссылкой отдаёт `normativeRoughnessMm`, и путать их нельзя.
 *
 * `null` означает: кривой износа для материала НЕТ. Тихого падения в `unknown`
 * при этом не происходит — расчёт возвращает отсутствие величины, и принимает
 * её инженер с источником.
 */
const ROUGHNESS_PROFILE: Record<ExistingMaterial, { fresh: number; worn: number } | null> = {
  steel: { fresh: 0.1, worn: 2.0 },
  cast_iron: { fresh: 0.3, worn: 2.5 },
  concrete: { fresh: 0.5, worn: 3.0 },
  asbestos: { fresh: 0.6, worn: 3.0 },
  // Керамика названа актом технического обследования по ул. Станкевича, и это
  // настоящий материал самотёчных сетей: СН РК 4.01-03-2013* п. 7.3.1 а) прямо
  // разрешает керамические трубы для самотёчных трубопроводов.
  //
  // Кривой износа у неё нет, и выдумать её нельзя. Нормативная величина
  // 1,35 мм (табл. 5.18) относится к трубе как таковой, а сеть на Станкевича
  // эксплуатируется больше 70 лет при износе 80 % и категории III. Поставить
  // сюда пару оценочных чисел значило бы выдать догадку за расчёт, а взять
  // 1,35 мм как есть — посчитать столетнюю трубу новой.
  ceramic: null,
  pe: { fresh: 0.02, worn: 0.2 },
  pvc: { fresh: 0.02, worn: 0.2 },
  unknown: { fresh: 0.5, worn: 2.0 },
}

/** Названия строк табл. 5.18 для материалов существующей сети. */
const TABLE_5_18_NAMES: Partial<Record<ExistingMaterial, string>> = {
  concrete: 'бетонные и железобетонные',
  ceramic: 'керамические',
  cast_iron: 'чугунные',
  steel: 'стальные',
  asbestos: 'асбестоцементные',
  pvc: 'ПВХ с клееными соединениями',
  pe: 'полиэтиленовые со сваркой встык',
}

/**
 * Нормативная эквивалентная шероховатость трубы, мм — табл. 5.18.
 *
 * Величина относится к трубе МАТЕРИАЛА, а не к изношенной трубе: износа норма
 * не описывает. Поэтому она отдаётся отдельно и со ссылкой — как ориентир для
 * инженера, а не как принятое значение расчёта. Для материала, которого в
 * таблице нет, возвращается `null`: ближайшая строка «на глаз» не берётся.
 */
export function normativeRoughnessMm(material: ExistingMaterial): Justified<number> | null {
  const name = TABLE_5_18_NAMES[material]
  if (!name) return null
  const row = (roughnessTable.pipes as Array<{ material: string; deltaCm: number }>)
    .find((pipe) => pipe.material === name)
  if (!row) return null
  return justified(
    Math.round(row.deltaCm * 10 * 1000) / 1000,
    ['sewer.roughness'],
    'normative',
    `${row.deltaCm} см по ${roughnessTable.table} (${roughnessTable.document}), строка «${row.material}»`,
  )
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

/**
 * Estimated equivalent roughness of an existing pipe, mm. Interpolates
 * between the fresh and worn roughness by wear, then adds an increment for
 * internal overgrowth (incrustation).
 *
 * `null` — у материала нет кривой износа. Раньше здесь стояло падение в
 * `unknown`, то есть керамике молча выдавались бы чужие 0,5…2,0 мм; теперь
 * отсутствие величины называется отсутствием, и её вводит инженер с источником.
 */
export function estimateRoughnessMm(
  material: ExistingMaterial,
  wearPercent: number,
  overgrowthPercent = 0,
): number | null {
  const profile = ROUGHNESS_PROFILE[material]
  if (!profile) return null
  const wear = clamp(wearPercent, 0, 100) / 100
  const overgrowth = clamp(overgrowthPercent, 0, 100) / 100
  const base = profile.fresh + (profile.worn - profile.fresh) * wear
  const withOvergrowth = base * (1 + 0.5 * overgrowth)
  return Math.round(withOvergrowth * 1000) / 1000
}

export interface ExistingSegment {
  id: string
  lengthM: number
  diameterMm?: number
  decision: PipeDecision
}

export interface ActSummary {
  totalLengthM: number
  keepLengthM: number
  rehabilitateLengthM: number
  replaceLengthM: number
  counts: Record<PipeDecision, number>
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Totals of the survey act by per segment decision. */
export function summarizeAct(segments: ExistingSegment[]): ActSummary {
  const summary: ActSummary = {
    totalLengthM: 0,
    keepLengthM: 0,
    rehabilitateLengthM: 0,
    replaceLengthM: 0,
    counts: { keep: 0, rehabilitate: 0, replace: 0 },
  }
  for (const segment of segments) {
    const length = segment.lengthM || 0
    summary.totalLengthM += length
    summary.counts[segment.decision]++
    if (segment.decision === 'keep') summary.keepLengthM += length
    else if (segment.decision === 'rehabilitate') summary.rehabilitateLengthM += length
    else summary.replaceLengthM += length
  }
  summary.totalLengthM = round2(summary.totalLengthM)
  summary.keepLengthM = round2(summary.keepLengthM)
  summary.rehabilitateLengthM = round2(summary.rehabilitateLengthM)
  summary.replaceLengthM = round2(summary.replaceLengthM)
  return summary
}
