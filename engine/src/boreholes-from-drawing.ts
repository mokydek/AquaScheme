import { compareDesignations } from './units'
import type { DxfNetworkData } from './dxfread'
import type { Borehole } from './geology'

/**
 * Положение скважин из геологического чертежа.
 *
 * Отчёт по изысканиям выдаётся комплектом, в котором координаты и свойства
 * живут порознь: ведомости — это лабораторные таблицы (номер образца, глубина
 * отбора, гранулометрия) и координат в них нет вовсе, а привязка есть только
 * на чертеже, подписью «скв-1» у соответствующей точки. Без неё скважина не
 * ложится на трассу и геология остаётся общими словами о площадке.
 *
 * Сложность одна и она системная: на том же листе обычно есть врезка «План
 * расположения скважин», где те же метки повторены в другом масштабе. Модуль
 * не угадывает, какой набор настоящий, — он принимает границы площадки от
 * вызывающего и сообщает о неоднозначности, если метка встретилась дважды.
 */

export interface DrawingBorehole {
  label: string
  x: number
  y: number
  /** Слой, на котором стоит подпись. */
  layer: string
}

export interface BoreholeExtraction {
  boreholes: DrawingBorehole[]
  /** Метки, встреченные более одного раза внутри границ. */
  ambiguous: Array<{ label: string; positions: Array<{ x: number; y: number }> }>
  /** Подписи, отброшенные как лежащие вне границ площадки. */
  outsideBounds: number
  reason: string
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface BoreholeExtractionOptions {
  /**
   * Границы площадки — обычно охват топосъёмки. Подписи снаружи относятся к
   * врезкам и штампу, а не к местности.
   */
  bounds?: Bounds
  /** Своя маска метки, если в комплекте принято иное обозначение. */
  pattern?: RegExp
  /**
   * Слои, на которых ГОЛОЕ ЧИСЛО означает номер выработки.
   *
   * На съёмке Станкевича номера скважин подписаны просто «1», «2», «3» — без
   * слова «скв», — и маска по умолчанию их не берёт. Брать голые числа по всему
   * чертежу нельзя: числами подписаны отметки, длины и годы. Основанием служит
   * СЛОЙ, роль которому назначил инженер, а не близость к чему-либо: на слое
   * «номер скв» число — это номер выработки по определению слоя.
   *
   * Прочие подписи того же слоя (дата бурения, отметка устья) числом-номером не
   * притворяются: принимается только целое от 1 до 999 без разделителей.
   */
  numberLayers?: readonly string[]
}

/** «скв-1», «Скв. 2», «скв №3», «с-1». */
const DEFAULT_PATTERN = /^(?:скв|с)[\s.№-]*(\d{1,3})[а-я]?$/i

/** Голый номер выработки на «номерном» слое: только целое, без хвостов. */
const BARE_NUMBER = /^(\d{1,3})$/

/** Нормализует метку к виду «скв-1», чтобы связать чертёж с ведомостью. */
export function normalizeBoreholeLabel(text: string): string | null {
  const match = DEFAULT_PATTERN.exec(text.trim())
  return match ? `скв-${Number(match[1])}` : null
}

const inside = (bounds: Bounds, x: number, y: number) =>
  x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY

/**
 * Собирает положения скважин из текстовых подписей чертежа.
 */
export function boreholesFromDrawing(
  data: DxfNetworkData,
  options: BoreholeExtractionOptions = {},
): BoreholeExtraction {
  const pattern = options.pattern ?? DEFAULT_PATTERN
  let outsideBounds = 0

  const numberLayers = new Set((options.numberLayers ?? []).map((name) => name.trim().toLowerCase()))
  const found: DrawingBorehole[] = []
  for (const entity of data.textEntities ?? []) {
    const raw = String(entity.text ?? '').trim()
    const onNumberLayer = numberLayers.has(String(entity.layer ?? '').trim().toLowerCase())
    const match = pattern.exec(raw) ?? (onNumberLayer ? BARE_NUMBER.exec(raw) : null)
    if (!match || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue
    if (options.bounds && !inside(options.bounds, entity.x, entity.y)) {
      outsideBounds += 1
      continue
    }
    found.push({
      label: `скв-${Number(match[1])}`,
      x: entity.x,
      y: entity.y,
      layer: entity.layer ?? '0',
    })
  }

  const byLabel = new Map<string, DrawingBorehole[]>()
  for (const item of found) {
    const list = byLabel.get(item.label)
    if (list) list.push(item)
    else byLabel.set(item.label, [item])
  }

  const boreholes: DrawingBorehole[] = []
  const ambiguous: BoreholeExtraction['ambiguous'] = []
  for (const [label, items] of [...byLabel].sort((a, b) => compareDesignations(a[0], b[0]))) {
    // Одна и та же метка в двух местах на одном листе почти всегда означает,
    // что одна из них во врезке. Какая — решает инженер, а не эвристика.
    const distinct = items.filter((item, index) => items.findIndex((other) =>
      Math.hypot(other.x - item.x, other.y - item.y) < 1) === index)
    if (distinct.length > 1) {
      ambiguous.push({ label, positions: distinct.map(({ x, y }) => ({ x, y })) })
      continue
    }
    boreholes.push(distinct[0])
  }

  const reason = boreholes.length === 0 && ambiguous.length === 0
    ? 'Подписи скважин на чертеже не найдены.'
    : `Привязано скважин: ${boreholes.length}`
      + (ambiguous.length > 0
        ? `; неоднозначны ${ambiguous.length} (метка встречается дважды — вероятно, врезка).`
        : '.')
      + (outsideBounds > 0 ? ` Вне границ площадки отброшено подписей: ${outsideBounds}.` : '')

  return { boreholes, ambiguous, outsideBounds, reason }
}

export interface BoreholeMergeResult {
  boreholes: Borehole[]
  /** Скважины из ведомости, которым не нашлось координат. */
  unlocated: string[]
  /** Координаты, которым не нашлось скважины в ведомости. */
  unmatched: string[]
}

/**
 * Переносит координаты с чертежа в скважины ведомости, связывая по метке.
 * Ведомости изысканий координат не содержат, поэтому это единственный способ
 * положить геологию на трассу, не вводя точки руками.
 */
export function mergeBoreholePositions(
  boreholes: Borehole[],
  positions: DrawingBorehole[],
): BoreholeMergeResult {
  const byLabel = new Map(positions.map((item) => [item.label, item]))
  const used = new Set<string>()

  const merged = boreholes.map((borehole) => {
    const key = normalizeBoreholeLabel(borehole.label) ?? borehole.label
    const position = byLabel.get(key)
    if (!position) return borehole
    used.add(key)
    // Координаты из ведомости, если они там были, приоритетнее: их ввёл человек.
    return {
      ...borehole,
      x: borehole.x ?? position.x,
      y: borehole.y ?? position.y,
    }
  })

  return {
    boreholes: merged,
    unlocated: merged
      .filter((borehole) => borehole.x === undefined || borehole.y === undefined)
      .map((borehole) => borehole.label),
    unmatched: [...byLabel.keys()].filter((label) => !used.has(label)),
  }
}
