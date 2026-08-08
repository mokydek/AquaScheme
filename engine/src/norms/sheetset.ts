import type { GravityProfile, ProfileStation } from './gravity'

/**
 * Picket-based sheet pagination (нарезка листов «ПК… - ПК…»). Professional
 * НК sets cut the route into plan and profile sheets by chainage, with sheet
 * boundaries snapped to manholes (stations), e.g. «План К2 ПК6+10.53 -
 * ПК15+71.23. М1:500». This module is the pure core: it splits a chainage
 * range into intervals whose bounds sit on real stations, and slices a
 * gravity profile into per-sheet fragments; the DXF wrappers name the sheets
 * from these labels.
 */

export interface SheetInterval {
  fromM: number
  toM: number
  /** «ПК0 - ПК6+10.53» — picket labels of both bounds. */
  label: string
}

/**
 * Picket label in the professional set's notation: the remainder is omitted
 * when zero («ПК37») and keeps up to two decimals otherwise («ПК6+10.53»,
 * «ПК119+27.4») — matching how НК albums caption their plan/profile sheets.
 */
export function picketLabelExact(chainageM: number): string {
  const pk = Math.floor(chainageM / 100)
  const rest = Math.round((chainageM - pk * 100) * 100) / 100
  if (rest === 0) return `ПК${pk}`
  return `ПК${pk}+${rest}`
}

/**
 * Split a station list into sheet intervals of roughly targetPerSheetM,
 * snapping every boundary to an actual station so sheets meet at manholes.
 * The last interval absorbs a short tail instead of producing a sliver.
 */
export function paginateByStations(stationsM: number[], targetPerSheetM = 550): SheetInterval[] {
  const sorted = [...new Set(stationsM)].sort((a, b) => a - b)
  if (sorted.length < 2) return []
  const total = sorted[sorted.length - 1] - sorted[0]
  if (total <= 0) return []

  const intervals: SheetInterval[] = []
  let from = sorted[0]
  while (from < sorted[sorted.length - 1] - 1e-9) {
    const target = from + targetPerSheetM
    // Furthest station not beyond the target, but always advance ≥ 1 station.
    let to = sorted[sorted.length - 1]
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i] <= target + 1e-9 && sorted[i] > from + 1e-9) {
        to = sorted[i]
        break
      }
      if (sorted[i] <= from + 1e-9) {
        // No station inside the target reach: take the next one.
        to = sorted[Math.min(i + 1, sorted.length - 1)]
        break
      }
    }
    // Absorb a short tail (< 40% of the target) into the last sheet.
    const remaining = sorted[sorted.length - 1] - to
    if (remaining > 0 && remaining < targetPerSheetM * 0.4) {
      to = sorted[sorted.length - 1]
    }
    intervals.push({ fromM: from, toM: to, label: `${picketLabelExact(from)} - ${picketLabelExact(to)}` })
    from = to
  }
  return intervals
}

/** Stations of the profile inside [fromM, toM], bounds inclusive. */
export function sliceProfile(profile: GravityProfile, fromM: number, toM: number): GravityProfile {
  const stations: ProfileStation[] = profile.stations.filter(
    (s) => s.chainageM >= fromM - 1e-9 && s.chainageM <= toM + 1e-9,
  )
  return {
    stations,
    maxDepthM: stations.reduce((m, s) => Math.max(m, s.depthM), 0),
    outletInvertElevationM: profile.outletInvertElevationM,
    totalLengthM: toM - fromM,
    pipeIds: profile.pipeIds,
  }
}

export interface PlanWindow extends SheetInterval {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Rectangular windows for per-picket PLAN sheets: the main route is paginated
 * by its vertex chainage and each interval gets the bounding box of its
 * sub-path (with interpolated interval bounds) plus a margin — everything
 * inside the box belongs on the sheet «План К2 ПК…-ПК…».
 */
export function planWindows(
  mainPath: Array<{ x: number; y: number; chainageM?: number }>,
  targetPerSheetM = 550,
  marginM = 60,
  stationChainagesM?: number[],
): PlanWindow[] {
  if (mainPath.length < 2) return []
  const explicitChainage = mainPath.map((point) => point.chainageM)
  const hasCanonicalChainage = explicitChainage.every((value) => Number.isFinite(value))
    && explicitChainage.every((value, index) => index === 0 || Number(value) >= Number(explicitChainage[index - 1]))
    && Number(explicitChainage[explicitChainage.length - 1]) > Number(explicitChainage[0])
  const chain: number[] = hasCanonicalChainage ? explicitChainage.map(Number) : [0]
  if (!hasCanonicalChainage) {
    for (let i = 1; i < mainPath.length; i++) {
      chain.push(chain[i - 1] + Math.hypot(mainPath[i].x - mainPath[i - 1].x, mainPath[i].y - mainPath[i - 1].y))
    }
  }
  const pointAt = (m: number): { x: number; y: number } => {
    for (let i = 1; i < chain.length; i++) {
      if (m <= chain[i] + 1e-9) {
        const t = (m - chain[i - 1]) / Math.max(chain[i] - chain[i - 1], 1e-12)
        return {
          x: mainPath[i - 1].x + t * (mainPath[i].x - mainPath[i - 1].x),
          y: mainPath[i - 1].y + t * (mainPath[i].y - mainPath[i - 1].y),
        }
      }
    }
    return mainPath[mainPath.length - 1]
  }
  const boundaries = stationChainagesM?.filter((value) =>
    Number.isFinite(value) && value >= chain[0] - 1e-9 && value <= chain[chain.length - 1] + 1e-9)
  const paginationStations = boundaries && boundaries.length >= 2 ? boundaries : chain
  return paginateByStations(paginationStations, targetPerSheetM).map((interval) => {
    const pts = [
      pointAt(interval.fromM),
      ...mainPath.filter((_, i) => chain[i] > interval.fromM + 1e-9 && chain[i] < interval.toM - 1e-9),
      pointAt(interval.toM),
    ]
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    return {
      ...interval,
      minX: Math.min(...xs) - marginM,
      minY: Math.min(...ys) - marginM,
      maxX: Math.max(...xs) + marginM,
      maxY: Math.max(...ys) + marginM,
    }
  })
}

export interface ProfileSheetSpec {
  /** Sheet title, e.g. «Профиль К2 ПК0 - ПК6+10.53». */
  title: string
  interval: SheetInterval
  profile: GravityProfile
}

/** Per-sheet profile fragments named like the professional set. */
export interface ProfileSheetOptions {
  /**
   * Пикеты, на которых лист обязан начаться заново.
   *
   * Это границы самотёчных бассейнов: за перекачкой начинается другой бассейн
   * со своим условным горизонтом, и лист, пересекающий её, показывал бы две
   * несвязанные линии лотка как одну. Обычная разбивка по длине о бассейнах не
   * знает и режет где придётся.
   */
  basinBoundariesM?: number[]
  /** Подписи бассейнов для заголовка листа, по порядку. */
  basinLabels?: string[]
}

export function profileSheetSpecs(
  profile: GravityProfile,
  system: 'sewer' | 'storm' = 'storm',
  targetPerSheetM = 850,
  options: ProfileSheetOptions = {},
): ProfileSheetSpec[] {
  const mark = system === 'storm' ? 'К2' : 'К1'
  const stations = profile.stations.map((s) => s.chainageM)
  /**
   * Границы притягиваются к ближайшей станции профиля.
   *
   * Перекачка стоит в колодце, а не между колодцами, поэтому граница бассейна
   * — это станция. Пикет, не совпавший ни с одной, означает расхождение
   * данных; без притягивания такой бассейн молча терялся бы (в интервале
   * оставалось бы меньше двух станций), и лист просто не появлялся.
   */
  const snap = (value: number) => stations.length === 0
    ? value
    : stations.reduce((best, station) =>
      Math.abs(station - value) < Math.abs(best - value) ? station : best, stations[0])
  const boundaries = [...new Set((options.basinBoundariesM ?? [])
    .filter((value) => Number.isFinite(value))
    .map(snap)
    .filter((value) => value > stations[0] + 1e-9 && value < stations[stations.length - 1] - 1e-9))]
    .sort((a, b) => a - b)

  if (boundaries.length === 0) {
    return paginateByStations(stations, targetPerSheetM).map((interval) => ({
      title: `Профиль ${mark} ${interval.label}`,
      interval,
      profile: sliceProfile(profile, interval.fromM, interval.toM),
    }))
  }

  // Каждый бассейн разбивается на листы отдельно, поэтому граница всегда
  // приходится на стык листов, а не на середину.
  const edges = [...new Set([stations[0], ...boundaries, stations[stations.length - 1]])]
    .sort((a, b) => a - b)
  const specs: ProfileSheetSpec[] = []
  for (let index = 1; index < edges.length; index++) {
    const fromM = edges[index - 1]
    const toM = edges[index]
    const inside = stations.filter((value) => value >= fromM - 1e-9 && value <= toM + 1e-9)
    if (inside.length < 2) continue
    const label = options.basinLabels?.[index - 1]
    for (const interval of paginateByStations(inside, targetPerSheetM)) {
      specs.push({
        title: `Профиль ${mark}${label ? ` · ${label}` : ''} ${interval.label}`,
        interval,
        profile: sliceProfile(profile, interval.fromM, interval.toM),
      })
    }
  }
  return specs
}
