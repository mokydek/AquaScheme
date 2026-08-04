/**
 * Набросок слоя чертежа.
 *
 * Роль слою инженер назначает по имени и по списку признаков — сколько
 * сегментов, какие типы линий, какой цвет. Самого чертежа он при этом не
 * видит, а имя слоя на муниципальной основе обрезано и часто не говорит
 * ничего: на Талдыколе слой «0» несёт напорную канализацию вперемешку с
 * оградами, а по имени это «прочее».
 *
 * Здесь строится минимальный набросок: геометрия слоя, прореженная до
 * обозримого числа сегментов. Это не чертёж и не замена ему — это ответ на
 * вопрос «длинные линии вдоль улиц или мелочь, рассыпанная по площадке».
 *
 * Кадр берётся общий на весь чертёж, а не по габариту слоя. Иначе одно здание
 * и вся сеть выглядели бы одинаково: оба растянуты на всю картинку. В общем
 * кадре здание — точка в углу, сеть — линии через всю площадку, и это ровно то
 * различие, ради которого набросок и делается.
 *
 * Размер картинки повторяет пропорции чертежа. Талдыколь — полоса 3,6 × 10,1 км,
 * и в поле постоянных пропорций она занимала треть ширины, а две трети уходили
 * в пустые поля. Пропорции чертежа делают поля не нужными вовсе.
 */

export interface PreviewSegment {
  layer?: string
  points: Array<{ x: number; y: number }>
}

export interface PreviewExtent {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface LayerPreview {
  /** Пути в координатах viewBox 0..width, 0..height. */
  paths: string[]
  width: number
  height: number
  /** Габарит слоя внутри кадра: по нему рисуется подсветка мелкого слоя. */
  box: { x: number; y: number; width: number; height: number }
  /** Сегментов на слое всего и сколько показано. */
  totalSegments: number
  shownSegments: number
  /** Габарит самого слоя в метрах: подпись под наброском. */
  spanXM: number
  spanYM: number
  /** По какому габариту построен кадр — по всему чертежу или по слою. */
  frame: 'drawing' | 'layer'
}

const round1 = (value: number) => Math.round(value * 10) / 10
const finitePoint = (point: { x: number; y: number }) =>
  Number.isFinite(point.x) && Number.isFinite(point.y)

/** Габарит всех линий чертежа: общий кадр для набросков всех слоёв. */
export function segmentsExtent(segments: PreviewSegment[]): PreviewExtent | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const segment of segments) {
    for (const point of segment.points) {
      if (!finitePoint(point)) continue
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

/** Наименьшая сторона картинки: полоса тоньше этого уже не читается. */
const MIN_SIDE_PX = 10

/** Ближе этого точки на картинке неразличимы и в разметку не идут. */
const MIN_STEP_PX = 0.5

/** Размер картинки в пропорциях кадра, вписанный в отведённые границы. */
export function frameSize(
  extent: PreviewExtent,
  max: { width: number; height: number },
): { width: number; height: number } {
  const spanX = extent.maxX - extent.minX
  const spanY = extent.maxY - extent.minY
  // Вырожденный кадр: чертёж в одну точку или одну прямую. Пропорций у него
  // нет, берутся отведённые границы целиком.
  if (!(spanX > 0) || !(spanY > 0)) return { ...max }
  const scale = Math.min(max.width / spanX, max.height / spanY)
  return {
    width: Math.max(MIN_SIDE_PX, Math.round(spanX * scale)),
    height: Math.max(MIN_SIDE_PX, Math.round(spanY * scale)),
  }
}

export function layerPreview(
  segments: PreviewSegment[],
  layerName: string,
  options: {
    /** Границы, в которые вписывается картинка. Сама она принимает пропорции
     * чертежа, поэтому обычно занимает не всю отведённую площадь. */
    maxSize?: { width: number; height: number }
    /** Верхний предел на число линий. Ставится ради худшего случая: после
     * прореживания точек полная топооснова Талдыколя обходится в 310 КБ
     * разметки, и предел срабатывает лишь на трёх слоях из 98. Урезание
     * заметно на глаз — сплошная сеть становится пунктиром, — поэтому предел
     * взят с запасом и его срабатывание подписывается. */
    maxSegments?: number
    /** Кадр всего чертежа. Без него кадром становится сам слой, и набросок
     * говорит только о форме, но не о размере и не о месте. */
    extent?: PreviewExtent | null
  } = {},
): LayerPreview | null {
  const maxSize = options.maxSize ?? { width: 120, height: 80 }
  const maxSegments = options.maxSegments ?? 2000

  const own = segments.filter((segment) =>
    (segment.layer ?? '') === layerName
    && segment.points.filter(finitePoint).length >= 2)
  if (own.length === 0) return null

  const layerExtent = segmentsExtent(own)
  if (!layerExtent) return null
  const extent = options.extent ?? layerExtent
  const frame = options.extent ? 'drawing' : 'layer'

  const size = frameSize(extent, maxSize)
  const spanX = extent.maxX - extent.minX
  const spanY = extent.maxY - extent.minY
  const scaleX = spanX > 0 ? size.width / spanX : 0
  const scaleY = spanY > 0 ? size.height / spanY : 0

  // Пропорции картинки уже равны пропорциям кадра, поля не нужны: чертёж
  // занимает её целиком. По вырожденной оси всё сваливается на середину.
  const toX = (x: number) => scaleX > 0 ? (x - extent.minX) * scaleX : size.width / 2
  // Ось Y чертежа направлена вверх, ось SVG — вниз.
  const toY = (y: number) =>
    scaleY > 0 ? size.height - (y - extent.minY) * scaleY : size.height / 2

  // Прореживание равномерное по всему списку, а не первые N: иначе набросок
  // показал бы один угол площадки и соврал бы о её форме.
  const step = Math.max(1, Math.ceil(own.length / maxSegments))
  const paths = own
    .filter((_, index) => index % step === 0)
    .map((segment) => {
      // Точки прореживаются по расстоянию на картинке, а не по счёту: горизонталь
      // в 500 вершин на картинке в 90 точек ничем не отличается от полусотни, а
      // разметки требует в десять раз больше. Порог ниже различимого — картинка
      // не меняется, поэтому это не потеря сведений.
      const points = segment.points.filter(finitePoint)
      const kept: string[] = []
      let lastX = Number.NaN
      let lastY = Number.NaN
      points.forEach((point, index) => {
        const x = round1(toX(point.x))
        const y = round1(toY(point.y))
        const far = Math.abs(x - lastX) >= MIN_STEP_PX || Math.abs(y - lastY) >= MIN_STEP_PX
        // Последняя точка сохраняется всегда: иначе линия не дойдёт до конца.
        if (index === 0 || far || index === points.length - 1) {
          kept.push(`${kept.length === 0 ? 'M' : 'L'}${x} ${y}`)
          lastX = x
          lastY = y
        }
      })
      return kept.length >= 2 ? kept.join(' ') : ''
    })
    .filter((path) => path !== '')

  const boxTop = toY(layerExtent.maxY)
  const boxLeft = toX(layerExtent.minX)
  return {
    paths,
    width: size.width,
    height: size.height,
    box: {
      x: round1(boxLeft),
      y: round1(boxTop),
      width: round1(toX(layerExtent.maxX) - boxLeft),
      height: round1(toY(layerExtent.minY) - boxTop),
    },
    totalSegments: own.length,
    shownSegments: paths.length,
    spanXM: round1(layerExtent.maxX - layerExtent.minX),
    spanYM: round1(layerExtent.maxY - layerExtent.minY),
    frame,
  }
}
