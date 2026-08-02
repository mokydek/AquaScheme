import type { DxfNetworkData } from './dxfread'

/**
 * Coordinate grid of a topographic survey (координатная сетка). Municipal
 * surveys draw it as crossing ticks on a regular lattice, and it is the only
 * georeferencing evidence many drawings carry: the title block often names
 * neither the coordinate system nor the height system.
 *
 * What the lattice proves on its own is worth stating precisely. A uniform
 * round pitch with axis-aligned ticks establishes that the drawing is metric,
 * unrotated and to scale, leaving only the origin unknown — a much smaller
 * question for the engineer than "which CRS is this". When the grid lines are
 * labelled with their survey coordinates, the origin follows too and the
 * drawing is fully referenced.
 */

export interface SurveyGridFinding {
  detected: boolean
  /** Layer the lattice was found on. */
  layer: string | null
  nodeCount: number
  /** Lattice pitch in drawing units along each axis. */
  pitchX: number | null
  pitchY: number | null
  /** Tick rotation relative to the drawing axes, degrees in [0, 90). */
  rotationDeg: number | null
  /**
   * The pitch is a round metric interval and the ticks are axis-aligned, so
   * drawing units are metres and no rotation has to be undone.
   */
  metricConfirmed: boolean
  /** Drawing -> survey translation, when grid labels resolve it. */
  offset: { dx: number; dy: number } | null
  offsetSource: 'grid_labels' | 'none'
  /** Lattice extent in drawing units. */
  extent: { minX: number; minY: number; maxX: number; maxY: number } | null
  reason: string
}

const GRID_LAYER = /grid|сетк|коорд/i
/** Survey grids are drawn at round intervals; 10…500 m covers 1:500…1:5000. */
const PLAUSIBLE_PITCH = [10, 20, 25, 50, 100, 200, 250, 500]
/** A grid tick is a short mark, not a road or a contour. */
const MAX_TICK_LENGTH = 12

function modal(values: number[], tolerance = 1e-6): number | null {
  if (values.length === 0) return null
  const counts = new Map<number, number>()
  for (const value of values) {
    const key = Math.round(value / tolerance) * tolerance
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return bestCount >= 3 ? best : null
}

function uniqueSorted(values: number[], decimals = 2): number[] {
  const factor = 10 ** decimals
  return [...new Set(values.map((v) => Math.round(v * factor) / factor))].sort((a, b) => a - b)
}

/**
 * The candidate pitch that puts the most tick centres on one lattice. Marks
 * that do not belong to the grid simply fail to share a residual and drop out,
 * so a grid drawn on a busy layer is still found.
 */
function bestLattice(
  ticks: Array<{ x: number; y: number }>,
): { pitch: number; nodes: Array<{ x: number; y: number }> } | null {
  const TOLERANCE = 0.15
  const found: Array<{ pitch: number; nodes: Array<{ x: number; y: number }> }> = []

  for (const pitch of PLAUSIBLE_PITCH) {
    const residual = (value: number) => {
      const r = value - Math.floor(value / pitch) * pitch
      return Math.round(r * 100) / 100
    }
    const pick = (values: number[]): number | null => {
      const counts = new Map<number, number>()
      for (const value of values) {
        // Residuals near 0 and near `pitch` describe the same lattice line.
        const key = Math.min(value, Math.abs(value - pitch)) < TOLERANCE ? 0 : value
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      let chosen: number | null = null
      let bestCount = 0
      for (const [value, count] of counts) {
        if (count > bestCount) {
          bestCount = count
          chosen = value
        }
      }
      return bestCount >= 8 ? chosen : null
    }

    const rx = pick(ticks.map((t) => residual(t.x)))
    const ry = pick(ticks.map((t) => residual(t.y)))
    if (rx === null || ry === null) continue

    const onLattice = (value: number, target: number) => {
      const r = residual(value)
      return Math.min(Math.abs(r - target), Math.abs(Math.abs(r - target) - pitch)) < TOLERANCE
    }
    const nodes = ticks.filter((t) => onLattice(t.x, rx) && onLattice(t.y, ry))
    if (nodes.length < 12) continue
    found.push({ pitch, nodes })
  }
  if (found.length === 0) return null

  // A 50 m grid is also a valid 10 m grid, so the finest pitch always matches
  // at least as many nodes. The real interval is the coarsest one that still
  // explains essentially the same set.
  const maxNodes = Math.max(...found.map((candidate) => candidate.nodes.length))
  return found
    .filter((candidate) => candidate.nodes.length >= maxNodes * 0.9)
    .sort((left, right) => right.pitch - left.pitch)[0]
}

const empty = (reason: string): SurveyGridFinding => ({
  detected: false,
  layer: null,
  nodeCount: 0,
  pitchX: null,
  pitchY: null,
  rotationDeg: null,
  metricConfirmed: false,
  offset: null,
  offsetSource: 'none',
  extent: null,
  reason,
})

/**
 * Finds the survey coordinate grid and reports what it establishes. Layers are
 * tried by name first; a drawing that hides the grid on an unnamed layer still
 * qualifies if its short ticks form a regular lattice.
 */
export function detectSurveyGrid(data: DxfNetworkData): SurveyGridFinding {
  const byLayer = new Map<string, Array<{ x: number; y: number; angle: number; length: number }>>()
  for (const segment of data.segments) {
    if (segment.points.length !== 2) continue
    const [a, b] = segment.points
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (!(length > 0) || length > MAX_TICK_LENGTH) continue
    const layer = segment.layer ?? '0'
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 90
    if (!byLayer.has(layer)) byLayer.set(layer, [])
    byLayer.get(layer)!.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle, length })
  }
  if (byLayer.size === 0) return empty('В чертеже нет коротких штрихов, из которых состоит координатная сетка.')

  const ranked = [...byLayer.entries()].sort((left, right) => {
    const named = Number(GRID_LAYER.test(right[0])) - Number(GRID_LAYER.test(left[0]))
    return named !== 0 ? named : right[1].length - left[1].length
  })

  for (const [layer, ticks] of ranked) {
    if (ticks.length < 12) continue

    // A drawing inserted at an angle still carries a regular grid, just not in
    // the drawing axes. The ticks give that angle, so the lattice is measured
    // in the grid's own frame and the rotation is reported rather than lost.
    const tickAngle = modal(ticks.map((t) => Number(t.angle.toFixed(1))), 0.1) ?? 0
    const theta = (tickAngle * Math.PI) / 180
    const cos = Math.cos(-theta)
    const sin = Math.sin(-theta)
    const aligned = ticks.map((t) => ({ x: t.x * cos - t.y * sin, y: t.x * sin + t.y * cos }))

    // Layer «0» habitually mixes grid ticks with stray linework, so the pitch
    // is chosen by how many ticks actually land on a lattice rather than by the
    // spacing of all unique coordinates, which the strays would scramble.
    const lattice = bestLattice(aligned)
    if (!lattice) continue
    const { pitch, nodes } = lattice
    const pitchX = pitch
    const pitchY = pitch

    const xs = uniqueSorted(nodes.map((t) => t.x))
    const ys = uniqueSorted(nodes.map((t) => t.y))
    if (xs.length < 3 || ys.length < 3) continue

    const rotation = Math.min(tickAngle, 90 - tickAngle)
    const axisAligned = rotation < 0.5

    const offset = gridLabelOffset(data, layer, xs, ys)
    // The pitch is round by construction — it comes from PLAUSIBLE_PITCH — so
    // alignment is the only remaining condition.
    const metricConfirmed = axisAligned
    return {
      detected: true,
      layer,
      nodeCount: nodes.length,
      pitchX,
      pitchY,
      rotationDeg: Number(rotation.toFixed(3)),
      metricConfirmed,
      offset,
      offsetSource: offset ? 'grid_labels' : 'none',
      extent: { minX: xs[0], minY: ys[0], maxX: xs[xs.length - 1], maxY: ys[ys.length - 1] },
      reason: offset
        ? `Сетка ${pitchX}×${pitchY} м на слое «${layer}»; подписи линий задают привязку.`
        : axisAligned
          ? `Сетка ${pitchX}×${pitchY} м на слое «${layer}»: единицы метрические, разворота нет. `
            + 'Начало координат не подписано — требуется одна известная точка или паспорт системы координат.'
          : `Сетка ${pitchX}×${pitchY} м на слое «${layer}» развёрнута на ${rotation.toFixed(2)}°. `
            + 'Перед использованием координат разворот нужно снять.',
    }
  }
  return empty('Регулярная координатная сетка не обнаружена: подтвердить масштаб и разворот по чертежу нельзя.')
}

/**
 * Survey coordinates of the grid lines, when the drawing labels them. The label
 * sits beside its line rather than on it, so each is matched to the nearest
 * lattice coordinate and the shift is accepted only if every label agrees.
 */
function gridLabelOffset(
  data: DxfNetworkData,
  gridLayer: string,
  xs: number[],
  ys: number[],
): { dx: number; dy: number } | null {
  const labels = (data.textEntities ?? [])
    .map((entity) => ({ ...entity, value: Number(String(entity.text ?? '').trim().replace(',', '.')) }))
    .filter((entity) => Number.isFinite(entity.value) && Number.isFinite(entity.x) && Number.isFinite(entity.y))
  if (labels.length === 0) return null

  const nearest = (value: number, grid: number[]): number | null => {
    let best: number | null = null
    let bestDistance = Infinity
    for (const candidate of grid) {
      const distance = Math.abs(candidate - value)
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }
    // The label must sit against its own line, not halfway to the next one.
    return bestDistance <= 5 ? best : null
  }

  const shifts: { dx: number[]; dy: number[] } = { dx: [], dy: [] }
  for (const label of labels) {
    const lineY = nearest(label.y, ys)
    if (lineY !== null && Math.abs(label.value - lineY) < 5) {
      shifts.dy.push(Number((label.value - lineY).toFixed(3)))
      continue
    }
    const lineX = nearest(label.x, xs)
    if (lineX !== null && Math.abs(label.value - lineX) < 5) {
      shifts.dx.push(Number((label.value - lineX).toFixed(3)))
    }
  }
  void gridLayer

  const agreed = (values: number[]): number | null => {
    if (values.length < 3) return null
    const value = modal(values)
    if (value === null) return null
    const matching = values.filter((v) => Math.abs(v - value) < 0.01).length
    return matching / values.length >= 0.8 ? value : null
  }

  const dx = agreed(shifts.dx)
  const dy = agreed(shifts.dy)
  if (dx === null && dy === null) return null
  return { dx: dx ?? 0, dy: dy ?? 0 }
}
