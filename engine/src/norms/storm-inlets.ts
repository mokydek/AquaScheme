import type { GravityProfile } from './gravity'
import { stormInletSpacingM } from './sewer'
import type { Justified } from '../normregistry'

/**
 * Расстановка дождеприёмников вдоль трассы К2.
 *
 * П. 7.6.6 задаёт шаг по продольному уклону лотка, а при ширине улицы более
 * 30 м — не более 60 м независимо от уклона. Правило было реализовано
 * (`stormInletSpacingM`) и проверено тестом против своего пункта, но вызвать
 * его было неоткуда: расстановки не существовало.
 *
 * Уклон берётся по земле между соседними станциями профиля — лоток улицы идёт
 * по поверхности, а не по трубе. Ширина улицы измеримой в съёмке величиной не
 * является и приходит от инженера: подставленное умолчание задало бы шаг,
 * который попал бы в ведомость как расчётный.
 *
 * П. 7.6.7 ограничивает длину присоединения от дождеприёмника до смотрового
 * колодца 40 метрами. Это ограничение проверяется, но само присоединение здесь
 * не трассируется: его геометрия зависит от плана улицы, которого у нас нет.
 */

export interface StormInletRun {
  /** Между какими узлами профиля идёт участок. */
  fromNodeId: string
  toNodeId: string
  fromChainageM: number
  toChainageM: number
  lengthM: number
  /** Продольный уклон лотка по земле, доли. */
  slope: number
  /** Допустимый шаг по п. 7.6.6. */
  spacing: Justified<number>
  /** Дождеприёмников на участке. */
  inletCount: number
  /** Фактический шаг после округления числа приёмников вверх. */
  actualSpacingM: number
  /** Пикетаж каждого приёмника от головы коллектора, м. */
  chainagesM: number[]
}

export interface StormInletPlan {
  ok: boolean
  runs: StormInletRun[]
  totalInlets: number
  /** Участки, где присоединение к колодцу заведомо длиннее 40 м (п. 7.6.7). */
  longConnectionRuns: string[]
  blockers: string[]
  notes: string[]
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** Длина присоединения от дождеприёмника до смотрового колодца, п. 7.6.7. */
export const MAX_INLET_CONNECTION_M = 40

export function planStormInlets(
  profile: GravityProfile,
  streetWidthM: number | null | undefined,
): StormInletPlan {
  const blockers: string[] = []
  const notes: string[] = []

  if (streetWidthM == null || !(streetWidthM > 0)) {
    blockers.push(
      'Не задана ширина улицы: шаг дождеприёмников по п. 7.6.6 зависит от неё'
      + ' (свыше 30 м — не более 60 м), а в топосъёмке ширины нет.',
    )
  }
  const stations = profile.stations ?? []
  if (stations.length < 2) blockers.push('Профиль не содержит участков: расставлять дождеприёмники не по чему.')
  if (blockers.length > 0) {
    return { ok: false, runs: [], totalInlets: 0, longConnectionRuns: [], blockers, notes }
  }

  const runs: StormInletRun[] = []
  const longConnectionRuns: string[] = []
  for (let index = 0; index + 1 < stations.length; index++) {
    const from = stations[index]
    const to = stations[index + 1]
    const lengthM = to.chainageM - from.chainageM
    if (!(lengthM > 0)) continue
    // Уклон лотка улицы — по земле. Знак не важен: приёмники ставят по обе
    // стороны перелома одинаково, а таблица дана по модулю уклона.
    const slope = Math.abs(to.groundElevationM - from.groundElevationM) / lengthM
    const spacing = stormInletSpacingM(slope, streetWidthM as number)
    // Число приёмников округляется вверх: шаг — предельный, превышать нельзя.
    const inletCount = Math.max(1, Math.ceil(lengthM / spacing.value))
    const actualSpacingM = lengthM / inletCount
    const chainagesM = Array.from({ length: inletCount }, (_, i) =>
      round2(from.chainageM + actualSpacingM * (i + 1)))

    // Присоединение идёт до ближайшего колодца участка; в худшем случае это
    // половина фактического шага. Больше 40 м — требуется промежуточный
    // колодец, и это решение инженера, а не расчёта.
    if (actualSpacingM / 2 > MAX_INLET_CONNECTION_M) {
      longConnectionRuns.push(`${from.nodeId} — ${to.nodeId}`)
    }

    runs.push({
      fromNodeId: from.nodeId,
      toNodeId: to.nodeId,
      fromChainageM: round2(from.chainageM),
      toChainageM: round2(to.chainageM),
      lengthM: round2(lengthM),
      slope: Math.round(slope * 1e5) / 1e5,
      spacing,
      inletCount,
      actualSpacingM: round2(actualSpacingM),
      chainagesM,
    })
  }

  if (longConnectionRuns.length > 0) {
    notes.push(
      `Присоединение длиннее ${MAX_INLET_CONNECTION_M} м на участках: ${longConnectionRuns.join('; ')}.`
      + ' П. 7.6.7 допускает не более одного промежуточного дождеприёмника;'
      + ' требуется дополнительный смотровой колодец.',
    )
  }

  return {
    ok: true,
    runs,
    totalInlets: runs.reduce((sum, run) => sum + run.inletCount, 0),
    longConnectionRuns,
    blockers,
    notes,
  }
}
