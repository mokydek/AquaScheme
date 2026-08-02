import type { ImportPoint } from './importnet'

/**
 * Design axis recovered from the engineering corridor.
 *
 * A master plan often ships the corridor and not the alignment: the DWG for a
 * 15.8 km collector carried no polyline that is the route, and the longest
 * candidate on layer «0» turned out to zigzag with a median turn of 58.8°.
 * What it did carry was a closed corridor ring of 33.1 km perimeter enclosing
 * 24.97 ha — a 15 m strip folded along the route. The route is that strip's
 * centreline.
 *
 * The strip is recognised from its own geometry: for a long thin band of
 * length L and width w the perimeter is about 2L and the area about L·w, so
 * 2·area/perimeter estimates the width and the ratio to the extent says
 * whether «thin» is true at all. Nothing here assumes a particular project.
 *
 * The axis stops short of the strip's ends by roughly three widths at each
 * end, because a point there has no partner far enough along the ring to
 * measure a cross-section against. On a 15 m corridor that is about 45 m out
 * of 16 km; the head and outlet are fixed from the project data, not from the
 * corridor outline.
 */

export interface CorridorAxisOptions {
  /** Spacing the ring is resampled at before pairing, m. */
  stepM?: number
  /** Douglas-Peucker tolerance for the returned axis, m. */
  toleranceM?: number
  /** A ring wider than this fraction of its length is not a routing corridor. */
  maxWidthRatio?: number
}

export interface CorridorAxis {
  ok: boolean
  points: ImportPoint[]
  lengthM: number
  /** Width measured from the paired boundary points, m. */
  widthM: number
  /** Width implied by area and perimeter, m — an independent check. */
  estimatedWidthM: number
  perimeterM: number
  areaM2: number
  reason: string
}

const failed = (reason: string, extra: Partial<CorridorAxis> = {}): CorridorAxis => ({
  ok: false, points: [], lengthM: 0, widthM: 0, estimatedWidthM: 0,
  perimeterM: 0, areaM2: 0, reason, ...extra,
})

function ringPerimeter(ring: ImportPoint[]): number {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const next = ring[(i + 1) % ring.length]
    total += Math.hypot(next.x - ring[i].x, next.y - ring[i].y)
  }
  return total
}

function ringArea(ring: ImportPoint[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const next = ring[(i + 1) % ring.length]
    sum += ring[i].x * next.y - next.x * ring[i].y
  }
  return Math.abs(sum) / 2
}

/** Douglas-Peucker, iterative so a dense ring cannot overflow the stack. */
function simplify(points: ImportPoint[], toleranceM: number): ImportPoint[] {
  if (points.length <= 2) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [from, to] = stack.pop()!
    const a = points[from]
    const b = points[to]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const norm = dx * dx + dy * dy
    let worst = -1
    let worstIndex = -1
    for (let i = from + 1; i < to; i++) {
      const px = points[i].x - a.x
      const py = points[i].y - a.y
      const t = norm === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / norm))
      const distance = Math.hypot(px - t * dx, py - t * dy)
      if (distance > worst) {
        worst = distance
        worstIndex = i
      }
    }
    if (worst > toleranceM && worstIndex > 0) {
      keep[worstIndex] = true
      stack.push([from, worstIndex], [worstIndex, to])
    }
  }
  return points.filter((_, index) => keep[index])
}

/**
 * Centreline of a corridor ring. Each resampled boundary point is paired with
 * the nearest point that lies far away *along the ring* — its partner on the
 * opposite side rather than its neighbour — and the midpoints of one side,
 * taken in walking order, are the axis. Ordering by the walk matters: a
 * corridor that doubles back defeats any nearest-neighbour chase, but never
 * defeats the walk along its own boundary.
 */
export function corridorAxis(ring: ImportPoint[], options: CorridorAxisOptions = {}): CorridorAxis {
  const stepM = options.stepM ?? 5
  const toleranceM = options.toleranceM ?? 0.5
  // A routing corridor is orders of magnitude longer than it is wide (15 m in
  // 16.5 km on the source project); 0.15 rejects blocks and parcels while
  // staying far from anything a real corridor could reach.
  const maxWidthRatio = options.maxWidthRatio ?? 0.15

  if (ring.length < 8) return failed('Кольцо коридора слишком грубое, чтобы искать в нём ось.')
  const perimeterM = ringPerimeter(ring)
  const areaM2 = ringArea(ring)
  if (!(perimeterM > 0) || !(areaM2 > 0)) return failed('Кольцо коридора вырождено.')

  const estimatedWidthM = (2 * areaM2) / perimeterM
  const stripLengthM = perimeterM / 2
  if (estimatedWidthM > stripLengthM * maxWidthRatio) {
    return failed(
      `Контур не является узкой полосой: ширина ${estimatedWidthM.toFixed(1)} м при длине `
      + `${stripLengthM.toFixed(0)} м. Осевая линия из такого контура не выводится.`,
      { perimeterM, areaM2, estimatedWidthM },
    )
  }

  // Resample so pairing does not depend on where the draughtsman put vertices.
  const dense: ImportPoint[] = []
  const along: number[] = []
  let walked = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const span = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.round(span / stepM))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      dense.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
      along.push(walked + (span * s) / steps)
    }
    walked += span
  }

  const cell = Math.max(estimatedWidthM * 2, stepM * 4)
  const grid = new Map<string, number[]>()
  const key = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`
  dense.forEach((point, index) => {
    const bucket = key(point.x, point.y)
    const list = grid.get(bucket)
    if (list) list.push(index)
    else grid.set(bucket, [index])
  })

  // A partner must be at least this far along the ring, otherwise the nearest
  // point is simply the next one on the same side.
  const minGap = estimatedWidthM * 6
  const maxPair = estimatedWidthM * 3
  const half = perimeterM / 2
  const midpoints: ImportPoint[] = []
  const widths: number[] = []

  for (let i = 0; i < dense.length; i++) {
    if (along[i] >= half) continue
    const here = dense[i]
    let best = -1
    let bestDistance = Infinity
    const cx = Math.floor(here.x / cell)
    const cy = Math.floor(here.y / cell)
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx}:${gy}`) ?? []) {
          const raw = Math.abs(along[i] - along[j])
          if (Math.min(raw, perimeterM - raw) < minGap) continue
          const distance = Math.hypot(dense[j].x - here.x, dense[j].y - here.y)
          if (distance < bestDistance) {
            bestDistance = distance
            best = j
          }
        }
      }
    }
    if (best < 0 || bestDistance > maxPair) continue
    midpoints.push({ x: (here.x + dense[best].x) / 2, y: (here.y + dense[best].y) / 2 })
    widths.push(bestDistance)
  }

  if (midpoints.length < 4) {
    return failed('Противоположные стороны полосы не сопоставились: осевая линия не построена.',
      { perimeterM, areaM2, estimatedWidthM })
  }

  const sorted = [...widths].sort((a, b) => a - b)
  const widthM = sorted[Math.floor(sorted.length / 2)]
  const points = simplify(midpoints, toleranceM)
  let lengthM = 0
  for (let i = 1; i < points.length; i++) {
    lengthM += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }

  return {
    ok: true,
    points,
    lengthM: Number(lengthM.toFixed(2)),
    widthM: Number(widthM.toFixed(2)),
    estimatedWidthM: Number(estimatedWidthM.toFixed(2)),
    perimeterM: Number(perimeterM.toFixed(2)),
    areaM2: Number(areaM2.toFixed(1)),
    reason: `Ось выведена из коридора шириной ${widthM.toFixed(1)} м: `
      + `${points.length} вершин, ${lengthM.toFixed(0)} м. `
      + 'Это осевая линия коридора, а не утверждённая проектом ось — её подтверждает инженер.',
  }
}
