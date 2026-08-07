import type { DxfConstraintData } from './dxfread'
import { clearanceNote, crossingClearance, crownElevationM } from './crossing-clearance'
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
  /** Отметка снята, и просвет по ней обеспечен. */
  | 'levelled'
  /**
   * Отметка снята, и просвет по ней МЕНЬШЕ требуемого.
   *
   * Отдельно от `conflict_certain`: тот выводится из диапазона глубин, а этот —
   * из замера. Прежде такого исхода не было вовсе: любое отнивелированное
   * пересечение получало `levelled` и уходило в сводку как благополучное, даже
   * когда просвет не добирал до требуемого. Вскрывать здесь нечего — решается
   * проектом, поэтому попадает в `conflicts`.
   */
  | 'levelled_insufficient'
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

const ELEVATION_LABEL = /^\d{2,4}[.,]\d{1,3}$/
/** Подписи одной точки: крышка и труба стоят рядом. */
const PAIR_RADIUS_M = 2.5

/** Вид сети по имени слоя — те же корни, что и в классификаторе. */
function utilityKind(layer: string): string | null {
  const name = layer.toLocaleLowerCase('ru-RU')
  if (/канализ/.test(name)) return 'канализация'
  if (/водопро/.test(name)) return 'водопровод'
  if (/теплотр|теплос/.test(name)) return 'теплосеть'
  if (/газопро|газоснаб/.test(name)) return 'газопровод'
  if (/лин_свя|связи/.test(name)) return 'кабель связи'
  if (/лэп|электро/.test(name)) return 'кабель электроснабжения'
  if (/дренаж/.test(name)) return 'дренаж'
  return null
}

export interface DerivedDepthBands {
  bands: Record<string, DepthBand>
  /** Сколько пар нашлось по каждому виду. */
  samples: Record<string, number>
  /** Виды, для которых замеров не хватило. */
  insufficient: string[]
  reason: string
}

/**
 * Выводит диапазоны глубин из самой съёмки.
 *
 * Геодезист подписывает пересекаемую сеть парой отметок в одной точке: сверху
 * крышка или поверхность, снизу труба. Разность пары — фактическая глубина
 * залегания, измеренная на этой площадке этим же исполнителем. Это снимает
 * нужду и в таблице «по опыту», и в отметках земли: диапазон строится из
 * измерений, а не из допущения.
 *
 * Одиночные подписи пропускаются: по одному числу нельзя сказать, крышка это
 * или труба.
 */
export function deriveDepthBandsFromSurvey(
  constraints: DxfConstraintData,
  options: { minSamples?: number } = {},
): DerivedDepthBands {
  const minSamples = options.minSamples ?? 2
  const depthsByKind = new Map<string, number[]>()

  const byLayer = new Map<string, Array<{ x: number; y: number; v: number }>>()
  for (const entity of constraints.textEntities) {
    const raw = String(entity.text ?? '').trim()
    if (!ELEVATION_LABEL.test(raw)) continue
    const layer = entity.layer ?? ''
    if (utilityKind(layer) === null) continue
    if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue
    const list = byLayer.get(layer) ?? []
    list.push({ x: entity.x, y: entity.y, v: Number(raw.replace(',', '.')) })
    byLayer.set(layer, list)
  }

  for (const [layer, marks] of byLayer) {
    const kind = utilityKind(layer)
    if (kind === null) continue
    const used = new Set<number>()
    for (let i = 0; i < marks.length; i++) {
      if (used.has(i)) continue
      const group = [marks[i]]
      used.add(i)
      for (let j = i + 1; j < marks.length; j++) {
        if (used.has(j)) continue
        if (Math.hypot(marks[j].x - marks[i].x, marks[j].y - marks[i].y) <= PAIR_RADIUS_M) {
          group.push(marks[j])
          used.add(j)
        }
      }
      if (group.length < 2) continue
      const depth = Math.max(...group.map((m) => m.v)) - Math.min(...group.map((m) => m.v))
      // Ноль означает две подписи одной и той же отметки, а не залегание.
      if (depth <= 0.05 || depth > 12) continue
      const list = depthsByKind.get(kind) ?? []
      list.push(round(depth))
      depthsByKind.set(kind, list)
    }
  }

  const bands: Record<string, DepthBand> = {}
  const samples: Record<string, number> = {}
  const insufficient: string[] = []
  for (const [kind, depths] of depthsByKind) {
    samples[kind] = depths.length
    if (depths.length < minSamples) {
      insufficient.push(kind)
      continue
    }
    const sorted = [...depths].sort((a, b) => a - b)
    bands[kind] = {
      minM: sorted[0],
      maxM: sorted[sorted.length - 1],
      source: `измерено на площадке, ${sorted.length} замеров по парам отметок`,
    }
  }

  const kinds = Object.keys(bands)
  return {
    bands,
    samples,
    insufficient,
    // Различаем «пар нет вовсе» и «пары есть, но их мало»: во втором случае
    // замеры на площадке велись, и сообщать о пустоте было бы неверно.
    reason: kinds.length === 0 && insufficient.length === 0
      ? 'Парных отметок на слоях коммуникаций не найдено: диапазоны глубин из съёмки не выводятся.'
      : kinds.length === 0
        ? `Замеров не хватило ни по одному виду сетей: ${insufficient.join(', ')}.`
        : `Диапазоны выведены из съёмки для ${kinds.length} видов сетей`
          + (insufficient.length > 0 ? `; замеров не хватило: ${insufficient.join(', ')}.` : '.'),
  }
}

/** Делит пересечения по необходимости вскрытия. */
export function triageCrossings(input: CrossingTriageInput): CrossingTriage {
  const items = input.crossings.map((crossing): TriagedCrossing => {
    // Уже отнивелированное вскрывать незачем — но замер надо ещё сравнить с
    // требуемым просветом. Прежде сравнения не было: `requiredClearanceM` в
    // этой ветке не читался вовсе, и просвет 0,08 м при требуемых 0,4 уходил в
    // сводку как «отнивелировано», не блокируя выпуск.
    if (crossing.existingElevationM !== undefined) {
      const measured = crossingClearance({
        existingElevationM: crossing.existingElevationM,
        designInvertElevationM: crossing.designInvertElevationM,
        designDiameterMm: input.designDiameterMm,
      })
      if (measured === null) {
        return {
          crossing,
          verdict: 'levelled',
          worstClearanceM: null,
          bestClearanceM: null,
          reason: 'Отметка снята; проектный лоток на этом пикете неизвестен.',
        }
      }
      const enough = measured.side !== 'within' && measured.clearanceM >= input.requiredClearanceM
      return {
        crossing,
        verdict: enough ? 'levelled' : 'levelled_insufficient',
        worstClearanceM: measured.clearanceM,
        bestClearanceM: measured.clearanceM,
        reason: enough
          ? `Отметка снята: ${clearanceNote(measured)} при требуемых ${input.requiredClearanceM} м.`
          : `Отметка снята: ${clearanceNote(measured)} — меньше требуемых `
            + `${input.requiredClearanceM} м. Измерение уже выполнено, вскрывать нечего: `
            + 'требуется футляр, перекладка или изменение проектных отметок.',
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
    const crown = crownElevationM(crossing.designInvertElevationM, input.designDiameterMm)
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
  // Замеренный недобор просвета — тоже конфликт: вскрытие его не снимет.
  const conflicts = items.filter((item) =>
    item.verdict === 'conflict_certain' || item.verdict === 'levelled_insufficient')
  const cleared = items.filter((item) => item.verdict === 'clears_by_margin').length
  const levelled = items.filter((item) => item.verdict === 'levelled').length
  const insufficient = items.filter((item) => item.verdict === 'levelled_insufficient').length

  return {
    items,
    needLevelling,
    conflicts,
    // «Отнивелировано» больше не значит «благополучно»: замеры разведены на
    // обеспечившие просвет и не обеспечившие.
    summary: `Пересечений ${items.length}: замерено ${levelled + insufficient} `
      + `(просвет обеспечен ${levelled}, недостаточен ${insufficient}), `
      + `просвет обеспечен расчётом ${cleared}, вскрывать ${needLevelling.length}, `
      + `неустранимых измерением ${conflicts.length}.`,
  }
}
