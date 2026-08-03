/**
 * Горизонтали рельефа по точкам съёмки.
 *
 * Топоплан показывает рельеф горизонталями, и строятся они по триангуляции
 * съёмки, а не интерполяцией на регулярную сетку. Разница принципиальная:
 *
 *  - Триангуляция проходит ровно через снятые отметки. Горизонталь пересекает
 *    рёбра треугольников по линейной интерполяции между двумя измерениями, то
 *    есть в каждой точке опирается на конкретные пикеты. Сеточная интерполяция
 *    (IDW) сглаживает и уводит поверхность от фактических отметок.
 *  - Триангуляция ограничена снятой площадью. Регулярная сетка заполняет весь
 *    габаритный прямоугольник: для коридора Талдыколя 3,5 × 10 км это 35 км²
 *    «рельефа» вместо снятой полосы — выдумка на большей части листа.
 *  - Стоимость. Сетка стоит O(ячейки × точки); горизонтали по треугольникам —
 *    O(треугольники × сечения), то есть на порядки дешевле.
 *
 * Модуль ничего не знает о географии и работает в местных метрах: горизонтали
 * нужны и на листах плана (метры), и на карте (после перевода в градусы).
 */

export interface TerrainPoint {
  x: number
  y: number
  z: number
}

export interface ContourPoint {
  x: number
  y: number
}

export interface ContourLine {
  /** Отметка горизонтали, м. */
  levelM: number
  points: ContourPoint[]
  /** Замкнутая линия — вершина или котловина внутри снятой площади. */
  closed: boolean
  /**
   * Утолщённая горизонталь. На топопланах каждую пятую проводят толще и
   * подписывают отметкой — приём оформления, не требование норматива из
   * имеющегося комплекта.
   */
  index: boolean
}

export interface ContourOptions {
  /** Шаг сечения рельефа, м. По умолчанию — по перепаду отметок. */
  stepM?: number
  /**
   * Наибольшее ребро треугольника, м. Триангуляция Делоне затягивает выпуклую
   * оболочку, поэтому на невыпуклой съёмке — вырезах кварталов, изгибах
   * коридора — появляются треугольники, накрывающие неснятые места.
   * Горизонталь через такой треугольник была бы проведена по территории, где
   * съёмки не было. По умолчанию порог берётся из самих данных.
   */
  maxEdgeM?: number
}

export interface ContourResult {
  lines: ContourLine[]
  stepM: number
  zMinM: number
  zMaxM: number
  /** Треугольников в модели после отбраковки. */
  triangles: number
  /** Отброшено как накрывающие неснятые участки. */
  skippedTriangles: number
  maxEdgeM: number
  reason: string
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/**
 * Шаг сечения рельефа по перепаду отметок: 0,5 / 1 / 2 м — обычные сечения
 * планов 1:500 и 1:1000.
 */
export function contourStepFor(rangeM: number): number {
  if (rangeM > 20) return 2
  if (rangeM > 8) return 1
  return 0.5
}

interface Triangle {
  a: number
  b: number
  c: number
}

interface Circum {
  cx: number
  cy: number
  r2: number
}

function circumcircle(points: TerrainPoint[], a: number, b: number, c: number): Circum | null {
  const { x: ax, y: ay } = points[a]
  const { x: bx, y: by } = points[b]
  const { x: cx, y: cy } = points[c]
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-9) return null // три точки на одной прямой
  const a2 = ax * ax + ay * ay
  const b2 = bx * bx + by * by
  const c2 = cx * cx + cy * cy
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  return { cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 }
}

/**
 * Триангуляция Делоне (Бойер — Ватсон).
 *
 * Своя, а не из turf: горизонтали нужны и на листах плана, а тянуть turf.js в
 * основной бандл ради одной триангуляции незачем — он оставлен для воркера
 * карты.
 *
 * Возвращает индексы в исходном массиве. Точки, совпадающие в плане,
 * отбрасываются: две отметки в одной координате вырождают окружность.
 */
export function triangulateSurvey(points: TerrainPoint[]): Triangle[] {
  const unique: TerrainPoint[] = []
  const index: number[] = []
  const seen = new Map<string, number>()
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue
    const key = `${round3(p.x)}|${round3(p.y)}`
    if (seen.has(key)) continue
    seen.set(key, unique.length)
    unique.push(p)
    index.push(i)
  }
  if (unique.length < 3) return []

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of unique) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const span = Math.max(spanX, spanY)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  // Объемлющий треугольник — заведомо накрывает все точки; его вершины уходят
  // в конец массива и в результат не попадают.
  const work: TerrainPoint[] = [
    ...unique,
    { x: midX - 20 * span, y: midY - span, z: 0 },
    { x: midX, y: midY + 20 * span, z: 0 },
    { x: midX + 20 * span, y: midY - span, z: 0 },
  ]
  const n = unique.length
  let tris: Triangle[] = [{ a: n, b: n + 1, c: n + 2 }]
  let circles: Array<Circum | null> = [circumcircle(work, n, n + 1, n + 2)]

  // Вставка по возрастанию x: соседние точки попадают в соседние треугольники,
  // и оболочка «плохих» треугольников остаётся небольшой.
  const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => work[p].x - work[q].x)

  const edgeCount = new Map<number, number>()
  for (const pi of order) {
    const p = work[pi]
    edgeCount.clear()
    const kept: Triangle[] = []
    const keptCircles: Array<Circum | null> = []

    for (let t = 0; t < tris.length; t++) {
      const circle = circles[t]
      const bad = circle !== null
        && (p.x - circle.cx) ** 2 + (p.y - circle.cy) ** 2 <= circle.r2 * (1 + 1e-12)
      if (!bad) {
        kept.push(tris[t])
        keptCircles.push(circle)
        continue
      }
      const { a, b, c } = tris[t]
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
        const key = u < v ? u * 100_000_000 + v : v * 100_000_000 + u
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      }
    }

    // Граница дыры — рёбра, встретившиеся ровно один раз.
    for (const [key, count] of edgeCount) {
      if (count !== 1) continue
      const u = Math.floor(key / 100_000_000)
      const v = key % 100_000_000
      const circle = circumcircle(work, u, v, pi)
      if (circle === null) continue
      kept.push({ a: u, b: v, c: pi })
      keptCircles.push(circle)
    }
    tris = kept
    circles = keptCircles
  }

  const result: Triangle[] = []
  for (const t of tris) {
    if (t.a >= n || t.b >= n || t.c >= n) continue
    result.push({ a: index[t.a], b: index[t.b], c: index[t.c] })
  }
  return result
}

function edgeKey(u: number, v: number): number {
  return u < v ? u * 100_000_000 + v : v * 100_000_000 + u
}

/**
 * Порог длины ребра по самим данным: медиана плюс запас.
 *
 * Съёмка ведётся с более-менее равномерной плотностью, поэтому ребро, сильно
 * длиннее типичного, почти всегда перекрывает место, где съёмки не было.
 */
function defaultMaxEdge(points: TerrainPoint[], tris: Triangle[]): number {
  const lengths: number[] = []
  for (const t of tris) {
    for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as const) {
      lengths.push(Math.hypot(points[u].x - points[v].x, points[u].y - points[v].y))
    }
  }
  if (lengths.length === 0) return Infinity
  lengths.sort((a, b) => a - b)
  const median = lengths[Math.floor(lengths.length / 2)]
  return median > 0 ? median * 4 : Infinity
}

/** Строит горизонтали по точкам съёмки. */
export function contoursFromSurvey(
  points: TerrainPoint[],
  options: ContourOptions = {},
): ContourResult {
  const usable = points.filter((p) =>
    Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))

  const empty = (reason: string): ContourResult => ({
    lines: [], stepM: options.stepM ?? 0, zMinM: 0, zMaxM: 0,
    triangles: 0, skippedTriangles: 0, maxEdgeM: options.maxEdgeM ?? 0, reason,
  })

  if (usable.length < 3) {
    return empty('Точек съёмки меньше трёх: поверхность не строится.')
  }

  const zs = usable.map((p) => p.z)
  const zMinM = Math.min(...zs)
  const zMaxM = Math.max(...zs)
  const range = zMaxM - zMinM
  const stepM = options.stepM ?? contourStepFor(range)

  const allTris = triangulateSurvey(usable)
  if (allTris.length === 0) {
    return { ...empty('Точки съёмки лежат на одной прямой: поверхность не строится.'), zMinM, zMaxM, stepM }
  }

  const maxEdgeM = options.maxEdgeM ?? defaultMaxEdge(usable, allTris)
  const tris = allTris.filter((t) => {
    const ab = Math.hypot(usable[t.a].x - usable[t.b].x, usable[t.a].y - usable[t.b].y)
    const bc = Math.hypot(usable[t.b].x - usable[t.c].x, usable[t.b].y - usable[t.c].y)
    const ca = Math.hypot(usable[t.c].x - usable[t.a].x, usable[t.c].y - usable[t.a].y)
    return Math.max(ab, bc, ca) <= maxEdgeM
  })
  const skippedTriangles = allTris.length - tris.length

  if (range < stepM / 2) {
    return {
      lines: [], stepM, zMinM, zMaxM, triangles: tris.length, skippedTriangles, maxEdgeM,
      reason: `Перепад отметок ${range.toFixed(2)} м меньше половины сечения ${stepM} м: `
        + 'горизонтали не проводятся.',
    }
  }

  const levels: number[] = []
  for (let level = Math.ceil(zMinM / stepM) * stepM; level < zMaxM; level += stepM) {
    levels.push(round3(level))
  }

  const lines: ContourLine[] = []
  for (const level of levels) {
    // Отметка ровно на сечении считается лежащей выше. Съёмка сплошь и рядом
    // даёт круглые отметки, попадающие точно в сечение, и подставлять сюда
    // сдвиг «на микрон» незачем: правило работает одинаково во всех
    // треугольниках, поэтому горизонталь проходит ровно через такую вершину —
    // где ей и место, — и на стыке треугольников не расходится.
    const below = (i: number) => usable[i].z < level

    /** Точка пересечения на ребре — считается от меньшего индекса, чтобы у
     *  соседних треугольников она получилась одинаковой. */
    const cut = new Map<number, ContourPoint>()
    const segments: Array<[number, number]> = []

    for (const t of tris) {
      const crossings: number[] = []
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as const) {
        if (below(u) === below(v)) continue
        const key = edgeKey(u, v)
        if (!cut.has(key)) {
          const [lo, hi] = u < v ? [u, v] : [v, u]
          const zlo = usable[lo].z
          const ratio = (level - zlo) / (usable[hi].z - zlo)
          cut.set(key, {
            x: usable[lo].x + (usable[hi].x - usable[lo].x) * ratio,
            y: usable[lo].y + (usable[hi].y - usable[lo].y) * ratio,
          })
        }
        crossings.push(key)
      }
      if (crossings.length === 2) segments.push([crossings[0], crossings[1]])
    }
    if (segments.length === 0) continue

    // Каждое ребро принадлежит не более чем двум треугольникам, поэтому у точки
    // пересечения не больше двух отрезков — цепочки собираются однозначно.
    const at = new Map<number, number[]>()
    for (let s = 0; s < segments.length; s++) {
      for (const key of segments[s]) {
        const list = at.get(key) ?? []
        list.push(s)
        at.set(key, list)
      }
    }
    const used = new Set<number>()

    const walk = (startKey: number): number[] => {
      const chain = [startKey]
      let key = startKey
      for (;;) {
        const next = (at.get(key) ?? []).find((s) => !used.has(s))
        if (next === undefined) return chain
        used.add(next)
        const [p, q] = segments[next]
        key = p === key ? q : p
        chain.push(key)
      }
    }

    const emit = (chain: number[], closed: boolean) => {
      if (chain.length < 2) return
      // Когда сечение проходит ровно через вершину, срезы соседних рёбер
      // сходятся в одну точку — отрезок нулевой длины чертежу не нужен.
      const pts: ContourPoint[] = []
      for (const key of chain) {
        const p = cut.get(key)
        if (p === undefined) continue
        const last = pts[pts.length - 1]
        if (last !== undefined && last.x === p.x && last.y === p.y) continue
        pts.push(p)
      }
      if (pts.length < 2) return
      lines.push({
        levelM: level,
        points: pts,
        closed,
        index: Math.round(level / stepM) % 5 === 0,
      })
    }

    // Сначала незамкнутые: их концы упираются в край снятой площади.
    for (const [key, list] of at) {
      if (list.length !== 1) continue
      if (used.has(list[0])) continue
      emit(walk(key), false)
    }
    // Оставшееся — замкнутые контуры вершин и котловин.
    for (const [key, list] of at) {
      if (list.every((s) => used.has(s))) continue
      const chain = walk(key)
      emit(chain, chain.length > 2 && chain[0] === chain[chain.length - 1])
    }
  }

  return {
    lines,
    stepM,
    zMinM,
    zMaxM,
    triangles: tris.length,
    skippedTriangles,
    maxEdgeM: round3(maxEdgeM),
    reason: `Горизонтали через ${stepM} м по ${tris.length} треугольникам съёмки`
      + (skippedTriangles > 0
        ? `; ${skippedTriangles} отброшено как накрывающие неснятые участки (ребро длиннее ${round3(maxEdgeM)} м).`
        : '.'),
  }
}
