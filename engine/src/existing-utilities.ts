import type { DxfNetworkData, DxfTextEntity } from './dxfread'

/**
 * Existing utility network recovered from a topographic survey's annotation.
 *
 * Surveys draw a buried line as a cartographic symbol — dashes with tick marks
 * — which carries no usable centreline: on a real municipal sheet 1466 of 1476
 * segment ends are free, so the strokes cannot be chained into an alignment.
 * The engineering content lives in the annotation layer instead:
 *
 *   - a manhole appears as two elevation labels at one spot, rim above invert;
 *   - the run between manholes is captioned with material and bore («кер.300»).
 *
 * That is enough to rebuild the chamber chain a reconstruction project is laid
 * out along, without inventing geometry the drawing does not contain.
 */

export interface ExistingManhole {
  x: number
  y: number
  /** Ground / cover elevation, m. */
  rimElevationM: number
  /** Invert (лоток) elevation, m. */
  invertElevationM: number
  depthM: number
}

export interface ExistingPipeLabel {
  x: number
  y: number
  /** Material as captioned: керамика, чугун, сталь, полиэтилен, асбестоцемент, бетон. */
  material: string
  diameterMm: number
  raw: string
}

export interface ExistingUtilityNetwork {
  manholes: ExistingManhole[]
  pipeLabels: ExistingPipeLabel[]
  /** Longest continuous run, ordered from the highest invert downstream. */
  chain: ExistingManhole[]
  /** Length of the chain polyline, m. */
  chainLengthM: number
  /** Chambers left outside `chain` because a gap broke the run. */
  detachedCount: number
  /** Longest step inside `chain`, m — a sanity check on the ordering. */
  maxStepM: number
  reason: string
}

const ELEVATION = /^\d{2,4}[.,]\d{1,3}$/
/** «кер.300», «чуг 200», «ст.100», «пэ.160», «а/ц 150», «ж/б 400». */
const PIPE_LABEL = /^(кер|чуг|ст|пэ|пнд|пвх|а\/ц|ац|ж\/б|жб|бет|кир)\.?\s*(\d{2,4})$/i

const MATERIALS: Record<string, string> = {
  кер: 'керамика',
  чуг: 'чугун',
  ст: 'сталь',
  пэ: 'полиэтилен',
  пнд: 'полиэтилен',
  пвх: 'поливинилхлорид',
  'а/ц': 'асбестоцемент',
  ац: 'асбестоцемент',
  'ж/б': 'железобетон',
  жб: 'железобетон',
  бет: 'бетон',
  кир: 'кирпич',
}

/** Labels close enough to describe the same chamber. */
const PAIR_RADIUS_M = 2.5
/** A chamber deeper than this is not a gravity manhole caption pair. */
const MAX_DEPTH_M = 12
const MIN_DEPTH_M = 0.4

const numeric = (entity: DxfTextEntity): number | null => {
  const raw = String(entity.text ?? '').trim()
  if (!ELEVATION.test(raw)) return null
  const value = Number(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/**
 * Rebuilds the existing network annotated on `layerPattern` layers. Elevation
 * labels are paired into chambers only when one sits above the other by a
 * plausible manhole depth, so a pair of unrelated spot heights is not read as a
 * chamber.
 */
export function extractExistingUtilities(
  data: DxfNetworkData,
  layerPattern: RegExp = /канализ/i,
): ExistingUtilityNetwork {
  const onLayer = (data.textEntities ?? []).filter((entity) => layerPattern.test(entity.layer ?? ''))

  const pipeLabels: ExistingPipeLabel[] = []
  for (const entity of onLayer) {
    const match = PIPE_LABEL.exec(String(entity.text ?? '').trim())
    if (!match || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue
    pipeLabels.push({
      x: entity.x,
      y: entity.y,
      material: MATERIALS[match[1].toLowerCase()] ?? match[1],
      diameterMm: Number(match[2]),
      raw: String(entity.text).trim(),
    })
  }

  const elevations = onLayer
    .map((entity) => ({ entity, value: numeric(entity) }))
    .filter((item): item is { entity: DxfTextEntity; value: number } =>
      item.value !== null && Number.isFinite(item.entity.x) && Number.isFinite(item.entity.y))

  const used = new Set<number>()
  const manholes: ExistingManhole[] = []
  for (let i = 0; i < elevations.length; i++) {
    if (used.has(i)) continue
    let bestIndex = -1
    let bestDistance = Infinity
    for (let j = 0; j < elevations.length; j++) {
      if (i === j || used.has(j)) continue
      const distance = Math.hypot(
        elevations[i].entity.x - elevations[j].entity.x,
        elevations[i].entity.y - elevations[j].entity.y,
      )
      if (distance > PAIR_RADIUS_M) continue
      const depth = Math.abs(elevations[i].value - elevations[j].value)
      if (depth < MIN_DEPTH_M || depth > MAX_DEPTH_M) continue
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = j
      }
    }
    if (bestIndex < 0) continue
    used.add(i)
    used.add(bestIndex)
    const a = elevations[i]
    const b = elevations[bestIndex]
    const rim = Math.max(a.value, b.value)
    const invert = Math.min(a.value, b.value)
    manholes.push({
      // The rim label is the one drawn on the chamber, so it anchors the point.
      x: (a.value === rim ? a.entity.x : b.entity.x),
      y: (a.value === rim ? a.entity.y : b.entity.y),
      rimElevationM: rim,
      invertElevationM: invert,
      depthM: Number((rim - invert).toFixed(3)),
    })
  }

  const ordered = orderByFlow(manholes)
  const chain = longestRun(ordered)
  let chainLengthM = 0
  let maxStepM = 0
  for (let i = 1; i < chain.length; i++) {
    const step = Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y)
    chainLengthM += step
    maxStepM = Math.max(maxStepM, step)
  }
  const detachedCount = manholes.length - chain.length

  return {
    manholes,
    pipeLabels,
    chain,
    chainLengthM: Number(chainLengthM.toFixed(2)),
    detachedCount,
    maxStepM: Number(maxStepM.toFixed(2)),
    reason: manholes.length === 0
      ? 'Пары отметок «крышка/лоток» не найдены: существующие колодцы по чертежу не восстанавливаются.'
      : `Восстановлено колодцев: ${manholes.length}; марок труб: ${pipeLabels.length}; `
        + `непрерывная цепочка ${chain.length} шт., ${chainLengthM.toFixed(1)} м`
        + (detachedCount > 0
          ? `; вне цепочки ${detachedCount} — вероятно, другая ветвь, участок выбирает инженер.`
          : '.'),
  }
}

/**
 * Splits the ordered chambers where the step is implausibly long and keeps the
 * longest surviving run. A street run has fairly even spacing, so a jump many
 * times the typical one means the ordering has crossed to a different branch —
 * better to hand back one honest run than a polyline stitched across the block.
 */
function longestRun(ordered: ExistingManhole[]): ExistingManhole[] {
  if (ordered.length < 3) return [...ordered]
  const steps: number[] = []
  for (let i = 1; i < ordered.length; i++) {
    steps.push(Math.hypot(ordered[i].x - ordered[i - 1].x, ordered[i].y - ordered[i - 1].y))
  }
  const sorted = [...steps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  // п. 7.4.1 spaces manholes 35..300 m by bore, so 200 m is a generous floor
  // before the multiple of the local spacing decides.
  const limit = Math.max(median * 3, 200)

  const runs: ExistingManhole[][] = [[ordered[0]]]
  for (let i = 1; i < ordered.length; i++) {
    if (steps[i - 1] > limit) runs.push([])
    runs[runs.length - 1].push(ordered[i])
  }
  return runs.reduce((best, run) => (run.length > best.length ? run : best), runs[0])
}

/**
 * Orders chambers along the flow. A gravity run falls monotonically, so the
 * highest invert is the head; from there each step takes the nearest chamber
 * that is not higher, which follows the pipe instead of jumping across the
 * street to a neighbouring branch.
 */
function orderByFlow(manholes: ExistingManhole[]): ExistingManhole[] {
  if (manholes.length < 2) return [...manholes]
  const remaining = [...manholes]
  remaining.sort((a, b) => b.invertElevationM - a.invertElevationM)
  const chain: ExistingManhole[] = [remaining.shift()!]

  while (remaining.length > 0) {
    const current = chain[chain.length - 1]
    let bestIndex = -1
    let bestDistance = Infinity
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].invertElevationM > current.invertElevationM + 1e-9) continue
      const distance = Math.hypot(remaining[i].x - current.x, remaining[i].y - current.y)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    if (bestIndex < 0) break
    chain.push(remaining.splice(bestIndex, 1)[0])
  }
  return chain
}
