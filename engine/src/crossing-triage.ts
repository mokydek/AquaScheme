import type { CrossingRecord } from './working-drawings'

/**
 * Какие пересечения действительно требуют контрольного вскрытия.
 *
 * Отметку неотнивелированной сети программа выдать не может: это выемка грунта
 * и нивелир. Но «вскрыть 27 пересечений» — почти всегда завышенное задание.
 * Магистральный коллектор идёт на 3–4 м, а кабель связи лежит под тротуаром:
 * при таком разносе просвет обеспечен, как бы точно ни легла кабельная линия,
 * и вскрывать её незачем. И наоборот — там, где исход зависит от сантиметров,
 * вскрытие обязательно.
 *
 * Модуль делит пересечения на три исхода по диапазону правдоподобных глубин.
 * Диапазоны — вход проекта, а не встроенная таблица: нормативных требований к
 * просветам между сетями в имеющемся комплекте нет, и подставлять сюда цифры
 * «по опыту» значило бы выдать догадку за норму. Без заданного диапазона
 * пересечение остаётся требующим вскрытия.
 */

export type CrossingVerdict =
  /** Отметка снята — исход считается по факту. */
  | 'levelled'
  /** Просвет обеспечен даже при самом глубоком правдоподобном залегании. */
  | 'clears_by_margin'
  /** Просвета нет даже при самом мелком: нужна перекладка или футляр. */
  | 'conflict_certain'
  /** Исход зависит от фактической отметки — вскрывать. */
  | 'needs_levelling'
  /** Для этого вида сети диапазон глубин не задан. */
  | 'unknown_band'

export interface DepthBand {
  /** Наименьшая правдоподобная глубина заложения от поверхности, м. */
  minM: number
  /** Наибольшая, м. */
  maxM: number
  /** Откуда взят диапазон: ТУ владельца, паспорт сети, решение инженера. */
  source: string
}

export interface CrossingTriageInput {
  crossings: CrossingRecord[]
  /** Диапазоны по виду сети: «водопровод», «газопровод», «кабель связи»… */
  depthBands: Record<string, DepthBand>
  /** Требуемый вертикальный просвет, м — из применимой нормы или ТУ владельца. */
  requiredClearanceM: number
  /** Отметка земли на пикете. */
  groundElevationAtM: (stationM: number) => number | null
  /** Диаметр проектируемой трубы, мм — верх трубы считается от лотка. */
  designDiameterMm: number
}

export interface TriagedCrossing {
  crossing: CrossingRecord
  verdict: CrossingVerdict
  /** Наименьший возможный просвет, м — при самом глубоком залегании. */
  worstClearanceM: number | null
  /** Наибольший возможный, м. */
  bestClearanceM: number | null
  reason: string
}

export interface CrossingTriage {
  items: TriagedCrossing[]
  /** Пересечения, для которых вскрытие обязательно. */
  needLevelling: TriagedCrossing[]
  /** Пересечения с неизбежным конфликтом: решается проектом, не измерением. */
  conflicts: TriagedCrossing[]
  summary: string
}

const round = (value: number) => Number(value.toFixed(3))

/** Делит пересечения по необходимости вскрытия. */
export function triageCrossings(input: CrossingTriageInput): CrossingTriage {
  const items = input.crossings.map((crossing): TriagedCrossing => {
    // Уже отнивелированное вскрывать незачем.
    if (crossing.existingElevationM !== undefined) {
      const clearance = crossing.designInvertElevationM === undefined
        ? null
        : round(crossing.existingElevationM - (crossing.designInvertElevationM + input.designDiameterMm / 1000))
      return {
        crossing,
        verdict: 'levelled',
        worstClearanceM: clearance,
        bestClearanceM: clearance,
        reason: clearance === null
          ? 'Отметка снята; проектный лоток на этом пикете неизвестен.'
          : `Отметка снята: просвет ${clearance.toFixed(2)} м.`,
      }
    }

    const band = input.depthBands[crossing.kind]
    const ground = input.groundElevationAtM(crossing.stationM)
    if (!band || ground === null || crossing.designInvertElevationM === undefined) {
      return {
        crossing,
        verdict: 'unknown_band',
        worstClearanceM: null,
        bestClearanceM: null,
        reason: !band
          ? `Диапазон глубин для «${crossing.kind}» не задан: исход не оценивается, требуется вскрытие.`
          : 'Нет отметки земли или проектного лотка на этом пикете.',
      }
    }

    // Верх проектируемой трубы — от него считается просвет до сети сверху.
    const crown = crossing.designInvertElevationM + input.designDiameterMm / 1000
    // Чем глубже лежит пересекаемая сеть, тем меньше просвет.
    const worst = round((ground - band.maxM) - crown)
    const best = round((ground - band.minM) - crown)

    if (worst >= input.requiredClearanceM) {
      return {
        crossing, verdict: 'clears_by_margin', worstClearanceM: worst, bestClearanceM: best,
        reason: `Даже при залегании на ${band.maxM} м просвет ${worst.toFixed(2)} м ≥ `
          + `${input.requiredClearanceM} м: вскрытие не требуется. Диапазон: ${band.source}.`,
      }
    }
    if (best < input.requiredClearanceM) {
      return {
        crossing, verdict: 'conflict_certain', worstClearanceM: worst, bestClearanceM: best,
        reason: `Даже при залегании на ${band.minM} м просвет ${best.toFixed(2)} м < `
          + `${input.requiredClearanceM} м: измерение не поможет, нужен футляр, перекладка или изменение отметок.`,
      }
    }
    return {
      crossing, verdict: 'needs_levelling', worstClearanceM: worst, bestClearanceM: best,
      reason: `Просвет от ${worst.toFixed(2)} до ${best.toFixed(2)} м при требуемом `
        + `${input.requiredClearanceM} м: исход зависит от фактической отметки — вскрывать.`,
    }
  })

  const needLevelling = items.filter((item) =>
    item.verdict === 'needs_levelling' || item.verdict === 'unknown_band')
  const conflicts = items.filter((item) => item.verdict === 'conflict_certain')
  const cleared = items.filter((item) => item.verdict === 'clears_by_margin').length
  const levelled = items.filter((item) => item.verdict === 'levelled').length

  return {
    items,
    needLevelling,
    conflicts,
    summary: `Пересечений ${items.length}: отнивелировано ${levelled}, `
      + `просвет обеспечен расчётом ${cleared}, вскрывать ${needLevelling.length}, `
      + `неустранимых измерением ${conflicts.length}.`,
  }
}
