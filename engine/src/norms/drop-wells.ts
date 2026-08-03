import type { GravityProfile } from './gravity'
import { justified } from '../normregistry'
import type { Justified } from '../normregistry'

/**
 * Перепадные колодцы на трассе.
 *
 * П. 7.5.1: перепадные колодцы устраивают «для уменьшения глубины заложения, во
 * избежание превышения максимальной скорости, при пересечении с подземными
 * сооружениями, при затопленных выпусках»; перепады до 0,5 м на трубах до
 * 600 мм допускаются сливом в смотровом колодце.
 *
 * Перепады в профиле уже есть и появляются сами: решатель ведёт лоток по
 * уклону, но не даёт ему подняться выше минимального заглубления, и там, где
 * земля падает быстрее трубы, лоток прижимается к поверхности — образуется
 * ступень. До сих пор эти ступени никто не называл перепадами: в ведомость они
 * не попадали, конструкцию под них никто не подбирал, а на профиле они
 * выглядели изломом линии лотка.
 *
 * Модуль ничего не пересчитывает: он читает уже решённый профиль и отделяет
 * ступень от обычного падения по уклону.
 */

export type DropKind = 'слив в смотровом колодце' | 'перепадный колодец'

export interface DropWell {
  nodeId: string
  chainageM: number
  /** Высота перепада, м: сверх падения по уклону участка. */
  dropM: number
  /** Диаметр трубы в узле, мм. */
  diameterMm: number
  /**
   * Вид решения по п. 7.5.1: до 0,5 м на трубах до 600 мм — слив в обычном
   * смотровом колодце, иначе перепадный колодец.
   */
  kind: Justified<DropKind>
}

export interface DropWellPlan {
  wells: DropWell[]
  /** Из них требуют именно перепадного колодца, а не слива. */
  structureCount: number
  totalDropM: number
  reason: string
}

/**
 * Ступень меньше сантиметра — след округления отметок, а не решение. Порог
 * задан явно: молчаливое сравнение с нулём выдало бы перепад на каждом узле.
 */
export const DROP_EPSILON_M = 0.01

/** Предел слива в обычном колодце по п. 7.5.1. */
export const SPILL_MAX_DROP_M = 0.5
/** Предел диаметра для слива в обычном колодце по п. 7.5.1. */
export const SPILL_MAX_DIAMETER_MM = 600

const round2 = (value: number) => Math.round(value * 100) / 100

export function planDropWells(
  profile: GravityProfile,
  design: Map<string, { diameterMm: number; slope: number }>,
): DropWellPlan {
  const stations = profile.stations ?? []
  if (stations.length < 2) {
    return { wells: [], structureCount: 0, totalDropM: 0, reason: 'Профиль без участков: перепады выявлять не по чему.' }
  }

  const wells: DropWell[] = []
  for (let index = 1; index < stations.length; index++) {
    const from = stations[index - 1]
    const to = stations[index]
    const span = Math.abs(to.chainageM - from.chainageM)
    const pipeId = profile.pipeIds?.[index - 1]
    const slope = (pipeId ? design.get(pipeId)?.slope : undefined) ?? 0
    // Падение, объяснённое уклоном участка. Всё, что упало сверх него, —
    // ступень, то есть перепад в узле.
    const expectedFallM = slope * span
    const actualFallM = from.invertElevationM - to.invertElevationM
    const dropM = actualFallM - expectedFallM
    if (!(dropM > DROP_EPSILON_M)) continue

    const diameterMm = to.diameterMm ?? from.diameterMm ?? 0
    const spillAllowed = dropM <= SPILL_MAX_DROP_M && diameterMm > 0 && diameterMm <= SPILL_MAX_DIAMETER_MM
    wells.push({
      nodeId: to.nodeId,
      chainageM: round2(to.chainageM),
      dropM: round2(dropM),
      diameterMm,
      kind: justified(
        spillAllowed ? 'слив в смотровом колодце' : 'перепадный колодец',
        ['sewer.drop.wells'],
        'normative',
        spillAllowed
          ? `перепад ${round2(dropM)} м на трубе Ø${diameterMm} мм: до ${SPILL_MAX_DROP_M} м `
            + `на трубах до ${SPILL_MAX_DIAMETER_MM} мм допускается сливом в смотровом колодце`
          : `перепад ${round2(dropM)} м на трубе Ø${diameterMm || '—'} мм: слив в смотровом колодце не подходит `
            + `(предел ${SPILL_MAX_DROP_M} м и Ø${SPILL_MAX_DIAMETER_MM} мм)`,
      ),
    })
  }

  const structureCount = wells.filter((well) => well.kind.value === 'перепадный колодец').length
  const totalDropM = round2(wells.reduce((sum, well) => sum + well.dropM, 0))

  return {
    wells,
    structureCount,
    totalDropM,
    reason: wells.length === 0
      ? 'Перепадов на трассе нет: лоток везде падает ровно по уклону участка.'
      : `Перепадов ${wells.length} общей высотой ${totalDropM} м; из них перепадных колодцев ${structureCount}, `
        + `остальные допускаются сливом в смотровом колодце (п. 7.5.1). `
        + `Пикеты: ${wells.map((well) => well.chainageM.toFixed(0)).join(', ')} м.`,
  }
}
