import type { ContourResult } from '@aquascheme/engine'

/**
 * Горизонтали съёмки для карты ситуации.
 *
 * Подготовка отделена от Leaflet намеренно: здесь решается, что рисовать и что
 * подписывать, и это можно проверить тестом, а карте остаётся только вывод.
 *
 * Точки не переводятся в градусы: их кладёт на карту та же проекция, что и
 * остальные слои. Отдельный перевод по якорю поставил бы рельеф непривязанного
 * чертежа за сотни километров от самой трассы, потому что карта в этом случае
 * остаётся в координатной плоскости.
 */

/** Сколько отметок подписывать: план на несколько километров иначе зарастает текстом. */
export const CONTOUR_LABEL_LIMIT = 60
/** Короткие обрывки утолщённой линии не подписываются — подпись негде поставить. */
export const CONTOUR_LABEL_MIN_POINTS = 12

export interface ContourShape<P> {
  points: P[]
  levelM: number
  /** Утолщённая (каждая пятая) горизонталь. */
  index: boolean
  weight: number
  opacity: number
}

export interface ContourLabel<P> {
  at: P
  text: string
}

export interface ContourShapes<P> {
  lines: Array<ContourShape<P>>
  labels: Array<ContourLabel<P>>
}

/**
 * Переводит результат построения горизонталей в линии и подписи для карты.
 *
 * @param project проекция местных метров в координаты карты.
 */
export function contourMapShapes<P>(
  relief: ContourResult | null | undefined,
  project: (point: { x: number; y: number }) => P,
): ContourShapes<P> {
  const lines: Array<ContourShape<P>> = []
  const labels: Array<ContourLabel<P>> = []
  // Шаг мельче метра пишется с десятыми: на пологом участке отметки 0,5 м
  // округлились бы до одинаковых, и подписи перестали бы различаться.
  const digits = relief && relief.stepM < 1 ? 1 : 0

  for (const line of relief?.lines ?? []) {
    if (line.points.length < 2) continue
    const points = line.points.map(project)
    lines.push({
      points,
      levelM: line.levelM,
      index: line.index,
      weight: line.index ? 1.6 : 0.8,
      opacity: line.index ? 0.75 : 0.5,
    })
    if (!line.index) continue
    if (line.points.length < CONTOUR_LABEL_MIN_POINTS) continue
    if (labels.length >= CONTOUR_LABEL_LIMIT) continue
    labels.push({ at: points[Math.floor(points.length / 2)], text: line.levelM.toFixed(digits) })
  }

  return { lines, labels }
}
