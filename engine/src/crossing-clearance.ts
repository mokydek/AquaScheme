/**
 * Вертикальный просвет в пересечении — одна формула на весь проект.
 *
 * Формула жила в трёх копиях, и они расходились. Карточка пересечения считала
 * просвет от ЛОТКА проектной трубы и брала модуль разности: просвет выходил
 * завышенным ровно на диаметр, а знак терялся, поэтому сеть, лежащая внутри
 * габарита проектной трубы, печаталась на профиле как имеющая просвет. На
 * объекте по ул. Станкевича так расходились все семь отнивелированных
 * пересечений, а X-25 печатался как «+0,111 м» при фактических −0,561 м.
 *
 * Здесь просвет считается от той поверхности проектной трубы, которая обращена
 * к пересекаемой сети, и сторона возвращается явно.
 *
 * ЧЕГО ЭТА ФУНКЦИЯ НЕ ЗНАЕТ. Отметка снята с пересекаемой сети, но чем она
 * является — лотком или верхом её трубы — в условных обозначениях съёмки не
 * установлено, и диаметра пересекаемой сети карточка не несёт. Поэтому
 * возвращается просвет до СНЯТОЙ ОТМЕТКИ, а не до тела чужой трубы; для сети,
 * проходящей ниже, это верхняя оценка. Занижать её догадкой о диаметре нельзя,
 * а молчать о разнице — тем более: `measuredToLabel` называет это прямо.
 */

export type CrossingSide = 'above' | 'below' | 'within'

export interface CrossingClearance {
  /** Где проходит пересекаемая сеть относительно габарита проектной трубы. */
  side: CrossingSide
  /**
   * Просвет, м. Для `above` — от верха проектной трубы вверх, для `below` — от
   * её лотка вниз. Для `within` отрицателен и равен глубине захода сети в
   * габарит трубы.
   */
  clearanceM: number
  /**
   * Всегда `true`: просвет отсчитан до снятой отметки, а не до тела чужой
   * трубы, потому что её диаметр в съёмке не подписан.
   */
  measuredToLabel: true
}

/** Верх проектной трубы: лоток плюс диаметр. */
export function crownElevationM(designInvertElevationM: number, designDiameterMm: number): number {
  return designInvertElevationM + designDiameterMm / 1000
}

const round = (value: number): number => Math.round(value * 1000) / 1000

/**
 * Просвет между проектной трубой и пересекаемой сетью.
 *
 * `null`, когда чего-то не хватает. Раньше недостающий диаметр молча заменялся
 * нулём, и лоток выдавался за верх трубы; пустая колонка честнее подставленной.
 */
export function crossingClearance(input: {
  existingElevationM?: number
  designInvertElevationM?: number
  designDiameterMm?: number
}): CrossingClearance | null {
  const { existingElevationM, designInvertElevationM, designDiameterMm } = input
  if (!Number.isFinite(existingElevationM) || !Number.isFinite(designInvertElevationM)) return null
  if (!Number.isFinite(designDiameterMm) || (designDiameterMm as number) <= 0) return null

  const invert = designInvertElevationM as number
  const existing = existingElevationM as number
  const crown = crownElevationM(invert, designDiameterMm as number)

  if (existing >= crown) return { side: 'above', clearanceM: round(existing - crown), measuredToLabel: true }
  if (existing <= invert) return { side: 'below', clearanceM: round(invert - existing), measuredToLabel: true }
  // Отметка между лотком и верхом: сеть проходит сквозь габарит проектной
  // трубы. Просвета нет ни сверху, ни снизу — возвращается заход со знаком.
  return {
    side: 'within',
    clearanceM: round(-Math.min(crown - existing, existing - invert)),
    measuredToLabel: true,
  }
}

/** Пояснение к просвету для карточки и выноски профиля. */
export function clearanceNote(clearance: CrossingClearance): string {
  if (clearance.side === 'within') {
    return `сеть заходит в габарит проектной трубы на ${Math.abs(clearance.clearanceM).toFixed(3)} м`
  }
  const where = clearance.side === 'above' ? 'над верхом трубы' : 'под лотком трубы'
  return `${clearance.clearanceM.toFixed(3)} м ${where}; отсчитано до снятой отметки — `
    + 'диаметр пересекаемой сети в съёмке не подписан'
}
