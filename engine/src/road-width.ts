/**
 * Ширина проезжей части — измерением по съёмке.
 *
 * Ширину спрашивали у инженера, и он вводил её глядя на тот же чертёж, который
 * программа уже разобрала. Между тем в съёмке дорога нарисована двумя
 * кромками, и расстояние между ними — измеримая величина, а не догадка.
 *
 * ПОЧЕМУ ПОПЕРЁК, А НЕ ВДОЛЬ ОСИ. Трасса пересекает дорогу под углом, и
 * расстояние между кромками ВДОЛЬ трассы — хорда, она длиннее ширины тем
 * сильнее, чем острее угол. Мерить надо по перпендикуляру к направлению
 * кромки; при пересечении под 30° разница двукратная, и в длину футляра она
 * ушла бы целиком.
 *
 * ЧТО СЧИТАЕТСЯ ВТОРОЙ КРОМКОЙ. Ближайшая линия дорожного слоя, идущая
 * ПАРАЛЛЕЛЬНО первой. Параллельность — свойство проезжей части, а не
 * подобранная величина: две кромки одной дороги идут рядом, а пересекающая
 * улица идёт поперёк. Порога расстояния здесь нет намеренно — любой такой
 * порог пришлось бы подбирать под желаемый результат.
 *
 * ОДНА ЛИНИЯ ШИРИНОЙ НЕ СЧИТАЕТСЯ. Ось дороги без второй кромки — это одна
 * линия, мерить нечего, и предложения не будет. Так же ведёт себя слой, где
 * дорог нет вовсе: на объекте по ул. Станкевича слой улиц несёт только
 * подписи названий, и ширина остаётся за ручным вводом.
 */

export interface Point { x: number; y: number }

export interface RoadEdge {
  id: string
  layer?: string
  points: Point[]
}

export interface RoadWidthMeasurement {
  /** Кромка, которую пересекла трасса. */
  roadId: string
  /** Противоположная кромка, до которой мерили. */
  oppositeId: string
  /** Пикет пересечения по трассе, м. */
  stationM: number
  /** Ширина по перпендикуляру, м. */
  widthM: number
  /** Слои обеих кромок — чтобы инженер видел, что именно измерено. */
  layers: string[]
}

export interface RoadWidthResult {
  measurements: RoadWidthMeasurement[]
  reason: string
}

/**
 * Наибольшее отклонение от параллельности, при котором линия ещё считается
 * противоположной кромкой той же дороги, в градусах.
 *
 * Не подгонка под результат: кромки настоящей дороги не идеально параллельны
 * (уширения, радиусы на перекрёстках), а пересекающая улица идёт под углом,
 * далёким от нуля. Величина разделяет эти два случая с большим запасом.
 */
const PARALLEL_TOLERANCE_DEG = 20

function segmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): { x: number; y: number; t: number } | null {
  const rx = a2.x - a1.x
  const ry = a2.y - a1.y
  const sx = b2.x - b1.x
  const sy = b2.y - b1.y
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) < 1e-12) return null
  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denominator
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a1.x + t * rx, y: a1.y + t * ry, t }
}

/** Угол между направлениями, приведённый к 0…90°: у кромок направление без знака. */
function angleBetweenDeg(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.hypot(ax, ay)
  const lb = Math.hypot(bx, by)
  if (la < 1e-9 || lb < 1e-9) return 90
  const cosine = Math.min(1, Math.max(-1, Math.abs((ax * bx + ay * by) / (la * lb))))
  return (Math.acos(cosine) * 180) / Math.PI
}

/** Измеряет ширину дороги в каждой точке, где трасса её пересекает. */
export function measureRoadWidths(
  route: Point[],
  roads: RoadEdge[],
  options: { parallelToleranceDeg?: number } = {},
): RoadWidthResult {
  const tolerance = options.parallelToleranceDeg ?? PARALLEL_TOLERANCE_DEG
  const measurements: RoadWidthMeasurement[] = []
  if (route.length < 2 || roads.length === 0) {
    return {
      measurements,
      reason: roads.length === 0
        ? 'Линий дорожного слоя в чертеже нет: ширину измерить не по чему.'
        : 'Трасса короче двух точек: пересечений с дорогами нет.',
    }
  }

  let chain = 0
  for (let i = 1; i < route.length; i++) {
    const a1 = route[i - 1]
    const a2 = route[i]
    const segmentLength = Math.hypot(a2.x - a1.x, a2.y - a1.y)

    for (const road of roads) {
      for (let j = 1; j < road.points.length; j++) {
        const edgeFrom = road.points[j - 1]
        const edgeTo = road.points[j]
        const hit = segmentIntersection(a1, a2, edgeFrom, edgeTo)
        if (!hit) continue

        // Перпендикуляр к КРОМКЕ, а не к трассе: вдоль трассы получалась бы
        // хорда, тем длиннее ширины, чем острее угол пересечения.
        const dx = edgeTo.x - edgeFrom.x
        const dy = edgeTo.y - edgeFrom.y
        const length = Math.hypot(dx, dy)
        if (length < 1e-9) continue
        const nx = -dy / length
        const ny = dx / length

        let best: { widthM: number; oppositeId: string; layer?: string } | null = null
        for (const other of roads) {
          if (other.id === road.id) continue
          for (let k = 1; k < other.points.length; k++) {
            const otherFrom = other.points[k - 1]
            const otherTo = other.points[k]
            const angle = angleBetweenDeg(dx, dy, otherTo.x - otherFrom.x, otherTo.y - otherFrom.y)
            // Пересекающая улица кромкой той же дороги не является.
            if (angle > tolerance) continue
            // Луч перпендикуляра в обе стороны: противоположная кромка лежит
            // с одной из них, а с какой — заранее неизвестно.
            for (const direction of [1, -1]) {
              const far = {
                x: hit.x + nx * direction * 1e6,
                y: hit.y + ny * direction * 1e6,
              }
              const cross = segmentIntersection(hit, far, otherFrom, otherTo)
              if (!cross) continue
              const widthM = Math.hypot(cross.x - hit.x, cross.y - hit.y)
              if (widthM < 1e-6) continue
              if (best === null || widthM < best.widthM) {
                best = { widthM, oppositeId: other.id, layer: other.layer }
              }
            }
          }
        }

        if (best === null) continue
        const stationM = chain + hit.t * segmentLength
        // Трасса пересекает дорогу дважды — входит через одну кромку и выходит
        // через другую, — но переход это ОДИН. Повтор отсеивается по паре
        // кромок и близости пикета: разнести их дальше ширины дороги трасса
        // не может, а второй настоящий переход через ту же дорогу окажется
        // заметно дальше.
        const pair = [road.id, best.oppositeId].sort().join('|')
        const duplicate = measurements.some((item) =>
          [item.roadId, item.oppositeId].sort().join('|') === pair
          && Math.abs(item.stationM - stationM) <= best!.widthM * 2 + 1)
        if (duplicate) continue
        measurements.push({
          roadId: road.id,
          oppositeId: best.oppositeId,
          stationM: Math.round(stationM * 100) / 100,
          widthM: Math.round(best.widthM * 100) / 100,
          layers: [...new Set([road.layer, best.layer].filter((value): value is string => !!value))],
        })
      }
    }
    chain += segmentLength
  }

  return {
    measurements,
    reason: measurements.length === 0
      ? 'Ширина не измерена: у пересечённых дорожных линий нет параллельной противоположной кромки. '
        + 'Одна линия шириной не считается — мерить нечего.'
      : `Ширина измерена в ${measurements.length} переходах по перпендикуляру к кромке: `
        + `${measurements.map((item) => item.widthM.toFixed(1)).join(', ')} м.`,
  }
}
