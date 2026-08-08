import type { Justified } from '../normregistry'
import { justified } from '../normregistry'
import { GRAVITY_DIAMETERS } from './gravity'

/**
 * Comparison of the designed network against the master-plan scheme
 * (предварительная схема с диаметрами от генплана). The design task requires
 * taking the master-plan scheme as the basis and justifying deviations by
 * calculation, so the product never silently overrides the plan: every
 * segment where our computed diameter differs from the plan step lands in an
 * explicit report (matches the benchmark honesty rule — discrepancies are
 * reported, not hidden).
 */

export interface PlanSegment {
  /** Segment key shared with the design (e.g. 'участок 6 — узел 1'). */
  id: string
  /** Diameter from the master-plan scheme, mm. 2х800 is two parallel 800s. */
  planDiameterMm: number
  parallelLines?: number
  /** Flow the plan assigns to the segment, L/s, when stated. */
  planFlowLps?: number
}

export interface DesignSegmentInput {
  id: string
  designDiameterMm: number
  parallelLines?: number
  designFlowLps?: number
  /**
   * Диаметр принят от безысходности, а не подобран расчётом.
   *
   * Ставится там же, где возникает замечание `noDesignFlow`: расчётного
   * расхода нет, и в план идёт наименьший диаметр ряда. Сравнивать такой
   * диаметр с генпланом бессмысленно — расхождение говорит не о проекте, а об
   * отсутствии исходных данных.
   */
  diameterAdoptedWithoutFlow?: boolean
}

export type SchemeVerdict =
  | 'match'
  | 'stepDiffers'
  | 'linesDiffer'
  | 'missingInDesign'
  | 'extraInDesign'
  /** Сравнение не выполнялось: диаметр принят без расчётного расхода. */
  | 'notComparable'

export interface SchemeComparisonRow {
  id: string
  planDiameterMm: number | null
  designDiameterMm: number | null
  planLines: number
  designLines: number
  /** Difference in series steps (design − plan); 0 when equal. */
  stepDelta: number | null
  verdict: SchemeVerdict
}

export interface SchemeComparison {
  rows: SchemeComparisonRow[]
  matched: number
  differing: number
  /**
   * Участки, по которым сравнение не выполнялось.
   *
   * Считаются отдельно и НЕ входят в расхождения: рапортовать «расхождений 13»
   * там, где сравнивать было нечем, значит выдать отсутствие данных за вывод о
   * проекте. На реконструкции по ул. Станкевича без ТУ так и получалось.
   */
  notComparable: number
  /** True when every plan segment is present and matches the plan step. */
  agreesWithPlan: Justified<boolean>
}

function stepIndex(diameterMm: number): number {
  const idx = GRAVITY_DIAMETERS.findIndex((d) => d >= diameterMm)
  return idx === -1 ? GRAVITY_DIAMETERS.length - 1 : idx
}

export function compareWithMasterPlan(
  design: DesignSegmentInput[],
  plan: PlanSegment[],
): SchemeComparison {
  const rows: SchemeComparisonRow[] = []
  const designById = new Map(design.map((d) => [d.id, d]))
  const planIds = new Set(plan.map((p) => p.id))

  for (const p of plan) {
    const d = designById.get(p.id)
    if (!d) {
      rows.push({
        id: p.id,
        planDiameterMm: p.planDiameterMm,
        designDiameterMm: null,
        planLines: p.parallelLines ?? 1,
        designLines: 0,
        stepDelta: null,
        verdict: 'missingInDesign',
      })
      continue
    }
    const planLines = p.parallelLines ?? 1
    const designLines = d.parallelLines ?? 1
    const stepDelta = stepIndex(d.designDiameterMm) - stepIndex(p.planDiameterMm)
    const verdict: SchemeVerdict = d.diameterAdoptedWithoutFlow === true
      ? 'notComparable'
      : designLines !== planLines ? 'linesDiffer' : stepDelta === 0 ? 'match' : 'stepDiffers'
    rows.push({
      id: p.id,
      planDiameterMm: p.planDiameterMm,
      designDiameterMm: d.designDiameterMm,
      planLines,
      designLines,
      stepDelta,
      verdict,
    })
  }

  for (const d of design) {
    if (!planIds.has(d.id)) {
      rows.push({
        id: d.id,
        planDiameterMm: null,
        designDiameterMm: d.designDiameterMm,
        planLines: 0,
        designLines: d.parallelLines ?? 1,
        stepDelta: null,
        verdict: d.diameterAdoptedWithoutFlow === true ? 'notComparable' : 'extraInDesign',
      })
    }
  }

  const matched = rows.filter((r) => r.verdict === 'match').length
  const notComparable = rows.filter((r) => r.verdict === 'notComparable').length
  const differing = rows.length - matched - notComparable
  return {
    rows,
    matched,
    differing,
    notComparable,
    // Согласие с генпланом нельзя объявлять, пока часть участков вообще не
    // сравнивалась: отсутствие расхождений там, где не сравнивали, — не
    // согласие, а неведение.
    agreesWithPlan: justified(differing === 0 && notComparable === 0, ['scheme.masterPlanBasis']),
  }
}
