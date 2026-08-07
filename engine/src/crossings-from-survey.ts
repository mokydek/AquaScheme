import { clearanceNote, crossingClearance } from './crossing-clearance'
import type { DxfConstraintData, DxfNetworkData } from './dxfread'
import type { CrossingRecord } from './working-drawings'

/**
 * Crossing cards built from what a topographic survey actually draws.
 *
 * The survey shows every buried utility it crossed and captions the ones it
 * levelled, so the geometric part of a crossing card — where the design axis
 * meets which utility, and at what elevation — is recoverable. What the survey
 * cannot supply is the administrative part: owner, agreed method, approval.
 * Those stay empty and the card stays unapproved, because a crossing signed off
 * on inferred data is exactly the failure a profile must not hide.
 */

export interface SurveyCrossingOptions {
  /** How far a levelling label may sit from the intersection to describe it. */
  labelRadiusM?: number
  /** Design invert at a chainage, for the clearance column. */
  designInvertAtM?: (stationM: number) => number | null
  /**
   * Проектный диаметр, мм: просвет считается от ВЕРХА проектной трубы, а верх
   * отстоит от лотка ровно на диаметр. Без диаметра колонка просвета остаётся
   * пустой — прежде она заполнялась разностью до лотка и завышала просвет.
   */
  designDiameterMm?: number
  /**
   * Chainages of the axis's own chambers. A reconstruction is laid along an
   * existing main, so the axis inevitably "crosses" that main at every chamber.
   * Those are the chambers themselves — network topology, not crossings — and a
   * card there would report a meaningless few-centimetre clearance against the
   * pipe's own invert.
   */
  ownChamberStationsM?: number[]
  /** Radius around an own chamber in which an intersection is not a crossing. */
  ownChamberRadiusM?: number
}

const ELEVATION = /^\d{2,4}[.,]\d{1,3}$/

/** Utility family from the layer name, for the card's «вид» column. */
function utilityKind(layer: string): string {
  const name = layer.toLocaleLowerCase('ru-RU')
  if (/канализ/.test(name)) return 'канализация'
  if (/водопро|водоснаб/.test(name)) return 'водопровод'
  if (/теплотр|теплос/.test(name)) return 'теплосеть'
  if (/газопро|газоснаб/.test(name)) return 'газопровод'
  if (/лин_свя|связи/.test(name)) return 'кабель связи'
  if (/лэп|электро|кабел/.test(name)) return 'кабель электроснабжения'
  if (/дренаж/.test(name)) return 'дренаж'
  return 'коммуникация'
}

interface Point { x: number; y: number }

/** Intersection of two segments, or null when they do not cross. */
function intersect(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const rx = a2.x - a1.x
  const ry = a2.y - a1.y
  const sx = b2.x - b1.x
  const sy = b2.y - b1.y
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) < 1e-12) return null
  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denominator
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a1.x + t * rx, y: a1.y + t * ry }
}

/**
 * Cards for every place the axis crosses an imported utility. `axis` is the
 * design alignment in drawing coordinates; chainage is measured along it.
 */
export function crossingsFromSurvey(
  axis: Point[],
  constraints: DxfConstraintData,
  data: DxfNetworkData,
  options: SurveyCrossingOptions = {},
): CrossingRecord[] {
  if (axis.length < 2) return []
  const labelRadius = options.labelRadiusM ?? 6

  const labels = (data.textEntities ?? [])
    .map((entity) => ({
      layer: entity.layer ?? '',
      x: entity.x,
      y: entity.y,
      value: Number(String(entity.text ?? '').trim().replace(',', '.')),
      raw: String(entity.text ?? '').trim(),
    }))
    .filter((label) => ELEVATION.test(label.raw)
      && Number.isFinite(label.x) && Number.isFinite(label.y) && Number.isFinite(label.value))

  // Cumulative chainage of each axis vertex.
  const chainage: number[] = [0]
  for (let i = 1; i < axis.length; i++) {
    chainage.push(chainage[i - 1] + Math.hypot(axis[i].x - axis[i - 1].x, axis[i].y - axis[i - 1].y))
  }

  const records: CrossingRecord[] = []
  const accepted: Array<{ kind: string; stationM: number }> = []
  /**
   * A single main is drawn as several parallel strokes, so intersections of the
   * same family that sit within a stroke-width of each other describe one
   * crossing. Distance is compared directly — bucketing by a rounded chainage
   * would split a cluster that happens to straddle a bucket edge.
   */
  const MERGE_RADIUS_M = 2

  for (const utility of constraints.utilityLines) {
    const layer = utility.layer ?? ''
    const kind = utilityKind(layer)
    for (let u = 1; u < utility.points.length; u++) {
      for (let a = 1; a < axis.length; a++) {
        const hit = intersect(axis[a - 1], axis[a], utility.points[u - 1], utility.points[u])
        if (!hit) continue
        const stationM = chainage[a - 1] + Math.hypot(hit.x - axis[a - 1].x, hit.y - axis[a - 1].y)

        if (accepted.some((card) => card.kind === kind && Math.abs(card.stationM - stationM) <= MERGE_RADIUS_M)) {
          continue
        }
        const atOwnChamber = (options.ownChamberStationsM ?? [])
          .some((chamber) => Math.abs(chamber - stationM) <= (options.ownChamberRadiusM ?? 3))
        if (atOwnChamber) continue
        accepted.push({ kind, stationM })

        let elevation: number | undefined
        let best = labelRadius
        for (const label of labels) {
          if (utilityKind(label.layer) !== kind) continue
          const distance = Math.hypot(label.x - hit.x, label.y - hit.y)
          if (distance < best) {
            best = distance
            elevation = label.value
          }
        }
        const designInvert = options.designInvertAtM?.(stationM) ?? null
        // Просвет считается от верха проектной трубы и со знаком: сеть внутри
        // её габарита даёт отрицательное число, а не мнимый запас.
        const clearance = crossingClearance({
          existingElevationM: elevation,
          designInvertElevationM: designInvert ?? undefined,
          designDiameterMm: options.designDiameterMm,
        })
        records.push({
          id: `X-${records.length + 1}`,
          stationM: Number(stationM.toFixed(2)),
          kind,
          source: `топосъёмка, слой «${layer}»`
            + (clearance ? `; просвет ${clearanceNote(clearance)}` : ''),
          ...(elevation !== undefined ? { existingElevationM: elevation } : {}),
          ...(designInvert !== null ? { designInvertElevationM: designInvert } : {}),
          ...(clearance ? { clearanceM: clearance.clearanceM } : {}),
          // Owner, method and approval are administrative facts a survey does
          // not carry; the card stays unapproved until an engineer fills them.
          approved: false,
        })
        break
      }
    }
  }
  return records.sort((left, right) => left.stationM - right.stationM)
}
