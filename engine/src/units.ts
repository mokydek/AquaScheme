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
