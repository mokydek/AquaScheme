/**
 * Flow unit conversions used across the engine.
 * 1 L/s = 3.6 m3/h (exact).
 */

export function litersPerSecondToCubicMetersPerHour(flowLps: number): number {
  return flowLps * 3.6
}

export function cubicMetersPerHourToLitersPerSecond(flowM3h: number): number {
  return flowM3h / 3.6
}

export function cubicMetersPerDayToLitersPerSecond(flowM3d: number): number {
  return (flowM3d * 1000) / 86400
}

/**
 * Сравнение обозначений с номерами: ВК-2 раньше ВК-10, а не наоборот.
 *
 * Обычное строковое сравнение ставит «ВК-10» между «ВК-1» и «ВК-2», потому что
 * сравнивает посимвольно. В ведомости, спецификации и на профиле это выглядит
 * как ошибка нумерации, хотя порядок детерминирован — и подрывает доверие к
 * документу вернее, чем расхождение в цифре.
 */
export const compareDesignations = (left: string, right: string): number =>
  left.localeCompare(right, 'ru', { numeric: true })

/**
 * Наименьшее и наибольшее по массиву без раскрытия аргументов.
 *
 * `Math.max(...массив)` передаёт каждый элемент отдельным доводом и на большом
 * массиве падает с `RangeError: Maximum call stack size exceeded`. Порог
 * зависит от размера стека — в браузере он меньше, чем в рабочем потоке Node, —
 * поэтому проверить его числом нельзя, а положиться на него тем более. На
 * чертеже такой размер достижим: у Станкевича 24 478 вершин коммуникаций, и это
 * одна улица. Отказ при этом не опознать: он приходит из середины построения
 * трассы без указания на размер данных.
 *
 * Второе, что чинится заодно: `Math.max` с `NaN` в массиве возвращает `NaN` —
 * одна испорченная отметка обнуляет весь габарит.
 *
 * Пустой массив даёт `null`, а не ±Infinity: бесконечность, попав в габарит
 * или в отметку, выглядит как значение и расходится дальше по расчёту.
 */
export function minOf(values: readonly number[]): number | null {
  let best: number | null = null
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (best === null || value < best) best = value
  }
  return best
}

export function maxOf(values: readonly number[]): number | null {
  let best: number | null = null
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (best === null || value > best) best = value
  }
  return best
}
