import type { Borehole } from './geology'

/**
 * Достоверность геологии в точке трассы.
 *
 * Интерполяция сама по себе всегда даёт ответ: чем дальше скважины, тем он
 * глаже и тем меньше значит. Отчёт о недостающих данных (M09) требует не
 * допустить, «чтобы удалённая скважина проецировалась на продольный профиль,
 * будто она характеризует трассу», — то есть значение обязано приходить вместе
 * с тем, откуда оно взято и насколько ему можно верить.
 *
 * Модуль отвечает на три вопроса о точке: попадает ли она в допуск по
 * удалению, лежит ли внутри контура скважин (интерполяция) или снаружи
 * (экстраполяция), и сколько скважин её реально описывают.
 */

export type GeoConfidence =
  /** Скважина стоит в самой точке. */
  | 'measured'
  /** Точка внутри контура скважин и в допуске по удалению. */
  | 'interpolated'
  /** Точка вне контура: значение продолжено за пределы изысканий. */
  | 'extrapolated'
  /** Ближайшая скважина дальше допуска — значение не характеризует трассу. */
  | 'out_of_range'
  /** Скважин с координатами нет вовсе. */
  | 'none'

export interface GeoCoverage {
  confidence: GeoConfidence
  /** Расстояние до ближайшей скважины, м. */
  nearestDistanceM: number | null
  /** Скважины в допуске, по возрастанию расстояния. */
  boreholesInRange: number
  /** Допуск, по которому вынесено решение, м. */
  maxOffsetM: number
  reason: string
}

/** Точка внутри выпуклой оболочки скважин? */
function insideHull(points: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  if (points.length < 3) return false
  const hull = convexHull(points)
  if (hull.length < 3) return false
  let sign = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
    if (Math.abs(cross) < 1e-9) continue
    const current = cross > 0 ? 1 : -1
    if (sign === 0) sign = current
    else if (sign !== current) return false
  }
  return true
}

/** Обход Эндрю: нижняя и верхняя цепи по отсортированным точкам. */
function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const sorted = [...points].sort((left, right) => (left.x - right.x) || (left.y - right.y))
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const build = (source: Array<{ x: number; y: number }>) => {
    const chain: Array<{ x: number; y: number }> = []
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) {
        chain.pop()
      }
      chain.push(point)
    }
    chain.pop()
    return chain
  }
  return [...build(sorted), ...build([...sorted].reverse())]
}

/**
 * Оценивает покрытие точки скважинами.
 *
 * `maxOffsetM` — подтверждённый критерий максимального поперечного удаления.
 * Значения по умолчанию нет намеренно: критерий задаёт программа изысканий или
 * ответственный инженер, и подставлять сюда произвольное число значило бы
 * решить за него.
 */
export function geologyCoverageAt(
  boreholes: Borehole[],
  x: number,
  y: number,
  maxOffsetM: number,
): GeoCoverage {
  const located = boreholes
    .filter((borehole) => Number.isFinite(borehole.x) && Number.isFinite(borehole.y))
    .map((borehole) => ({
      x: borehole.x as number,
      y: borehole.y as number,
      distance: Math.hypot((borehole.x as number) - x, (borehole.y as number) - y),
    }))
    .sort((left, right) => left.distance - right.distance)

  if (located.length === 0) {
    return {
      confidence: 'none', nearestDistanceM: null, boreholesInRange: 0, maxOffsetM,
      reason: 'Скважины без координат: геология по трассе не привязывается.',
    }
  }

  const nearest = located[0]
  const inRange = located.filter((borehole) => borehole.distance <= maxOffsetM)

  if (nearest.distance < 1e-6) {
    return {
      confidence: 'measured', nearestDistanceM: 0, boreholesInRange: inRange.length, maxOffsetM,
      reason: 'Скважина стоит в этой точке.',
    }
  }
  if (inRange.length === 0) {
    return {
      confidence: 'out_of_range',
      nearestDistanceM: Number(nearest.distance.toFixed(2)),
      boreholesInRange: 0,
      maxOffsetM,
      reason: `Ближайшая скважина в ${nearest.distance.toFixed(0)} м при допуске ${maxOffsetM} м: `
        + 'значение не характеризует трассу.',
    }
  }
  const inside = insideHull(located, x, y)
  return {
    confidence: inside ? 'interpolated' : 'extrapolated',
    nearestDistanceM: Number(nearest.distance.toFixed(2)),
    boreholesInRange: inRange.length,
    maxOffsetM,
    reason: inside
      ? `Точка внутри контура скважин; в допуске ${inRange.length}, ближайшая в ${nearest.distance.toFixed(0)} м.`
      : `Точка вне контура скважин: значение продолжено за пределы изысканий, `
        + `ближайшая скважина в ${nearest.distance.toFixed(0)} м.`,
  }
}

export interface RouteCoverageSummary {
  stations: number
  measured: number
  interpolated: number
  extrapolated: number
  outOfRange: number
  none: number
  /** Доля станций, описанных изысканиями, 0…1. */
  covered: number
  worstGapM: number | null
  blockers: string[]
}

/**
 * Сводка покрытия по всей трассе. Станции вне допуска и экстраполированные
 * перечисляются как блокеры: продольный профиль на них опирать нельзя, пока
 * инженер не подтвердит критерий или не назначит доизыскания.
 */
export function summarizeRouteCoverage(
  boreholes: Borehole[],
  path: Array<{ x: number; y: number }>,
  maxOffsetM: number,
): RouteCoverageSummary {
  const counts = { measured: 0, interpolated: 0, extrapolated: 0, out_of_range: 0, none: 0 }
  let worstGapM: number | null = null
  for (const point of path) {
    const coverage = geologyCoverageAt(boreholes, point.x, point.y, maxOffsetM)
    counts[coverage.confidence] += 1
    if (coverage.nearestDistanceM !== null) {
      worstGapM = worstGapM === null ? coverage.nearestDistanceM : Math.max(worstGapM, coverage.nearestDistanceM)
    }
  }
  const stations = path.length
  const described = counts.measured + counts.interpolated
  const blockers: string[] = []
  if (counts.none > 0) {
    blockers.push('Скважины не имеют координат: геология к трассе не привязана.')
  }
  if (counts.out_of_range > 0) {
    blockers.push(`Станций вне допуска ${maxOffsetM} м: ${counts.out_of_range} из ${stations} — `
      + 'требуются доизыскания или подтверждение критерия удаления.')
  }
  if (counts.extrapolated > 0) {
    blockers.push(`Станций за контуром скважин: ${counts.extrapolated} из ${stations} — `
      + 'значения продолжены за пределы изысканий.')
  }
  return {
    stations,
    measured: counts.measured,
    interpolated: counts.interpolated,
    extrapolated: counts.extrapolated,
    outOfRange: counts.out_of_range,
    none: counts.none,
    covered: stations === 0 ? 0 : Number((described / stations).toFixed(4)),
    worstGapM,
    blockers,
  }
}
