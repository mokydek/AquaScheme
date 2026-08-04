import type { Borehole, GeoLayer } from './geology'

/**
 * Геологический разрез вдоль трассы.
 *
 * На профиле стоят колонки отдельных скважин, а между ними — пусто. Инженеру
 * нужен разрез: где проходит подошва каждого слоя под трубой на всём участке, а
 * не только в трёх точках.
 *
 * Правило построения строгое и намеренно узкое. Разрез строится только между
 * соседними скважинами, у которых совпадает последовательность ИГЭ: тогда
 * кровля и подошва каждого слоя переносятся линейной интерполяцией по отметкам,
 * и это следует из измеренного. Если состав слоёв в соседних скважинах разный,
 * выклинивание слоя — инженерное решение, а не измерение: такой промежуток
 * остаётся пустым и прямо назван.
 *
 * За пределы крайних скважин разрез не продолжается. Экстраполяция слоя на
 * сотни метров выглядела бы на чертеже так же уверенно, как измеренное.
 */

export interface SectionLayer {
  igeCode: string
  soilName?: string
  /** Абсолютная отметка кровли слоя, м. */
  topElevationM: number
  /** Абсолютная отметка подошвы слоя, м. */
  bottomElevationM: number
}

export interface SectionStation {
  /** Пикетаж вдоль трассы, м. */
  chainageM: number
  /** Отметка устья (поверхности) в этой точке, м. */
  surfaceElevationM: number
  layers: SectionLayer[]
  /** Точка совпадает со скважиной: значения измерены, а не интерполированы. */
  measured: boolean
}

export interface SectionGap {
  fromChainageM: number
  toChainageM: number
  reason: string
}

export interface GeologySection {
  stations: SectionStation[]
  /** Промежутки, где разрез не построен, с причиной. */
  gaps: SectionGap[]
  /** Доля длины трассы, покрытая разрезом, %. */
  coveragePercent: number
  reason: string
}

/** Скважина, спроецированная на трассу. */
export interface ProjectedBorehole {
  borehole: Borehole
  /** Пикетаж проекции на ось, м. */
  chainageM: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

function usableLayers(layers: GeoLayer[]): GeoLayer[] {
  return layers
    .filter((layer) => (layer.igeCode ?? '').trim() !== ''
      && Number.isFinite(layer.topDepthM) && Number.isFinite(layer.bottomDepthM))
    .sort((left, right) => left.topDepthM - right.topDepthM)
}

function stationAt(projected: ProjectedBorehole): SectionStation | null {
  const mouth = projected.borehole.mouthElevationM
  if (!Number.isFinite(mouth)) return null
  const layers = usableLayers(projected.borehole.layers)
  if (layers.length === 0) return null
  return {
    chainageM: round2(projected.chainageM),
    surfaceElevationM: round2(mouth as number),
    measured: true,
    layers: layers.map((layer) => ({
      igeCode: (layer.igeCode as string).trim(),
      ...(layer.soilName ? { soilName: layer.soilName } : {}),
      topElevationM: round2((mouth as number) - layer.topDepthM),
      bottomElevationM: round2((mouth as number) - layer.bottomDepthM),
    })),
  }
}

/**
 * @param boreholes скважины, спроецированные на ось, в любом порядке
 * @param stepM шаг промежуточных точек разреза, м
 */
export function buildGeologySection(
  boreholes: ProjectedBorehole[],
  routeLengthM: number,
  stepM = 25,
): GeologySection {
  const ordered = boreholes
    .filter((item) => Number.isFinite(item.chainageM))
    .sort((left, right) => left.chainageM - right.chainageM)
  const anchors = ordered.map(stationAt).filter((item): item is SectionStation => item !== null)

  if (anchors.length === 0) {
    return {
      stations: [],
      gaps: [],
      coveragePercent: 0,
      reason: 'Разрез не построен: нет ни одной скважины с отметкой устья и слоями с кодом ИГЭ.',
    }
  }
  if (anchors.length === 1) {
    return {
      stations: anchors,
      gaps: [],
      coveragePercent: 0,
      reason: `Разрез не построен: скважина одна (ПК${(anchors[0].chainageM / 100).toFixed(2)}). `
        + 'Между чем интерполировать — нет; за пределы скважины разрез не продолжается.',
    }
  }

  const stations: SectionStation[] = [anchors[0]]
  const gaps: SectionGap[] = []
  let coveredM = 0

  for (let index = 0; index + 1 < anchors.length; index++) {
    const left = anchors[index]
    const right = anchors[index + 1]
    const spanM = right.chainageM - left.chainageM
    const leftCodes = left.layers.map((layer) => layer.igeCode)
    const rightCodes = right.layers.map((layer) => layer.igeCode)

    if (spanM <= 0) continue
    if (leftCodes.length !== rightCodes.length || leftCodes.some((code, i) => code !== rightCodes[i])) {
      gaps.push({
        fromChainageM: left.chainageM,
        toChainageM: right.chainageM,
        reason: `состав слоёв различается: [${leftCodes.join(', ')}] против [${rightCodes.join(', ')}];`
          + ' выклинивание слоя — решение инженера, а не измерение',
      })
      stations.push(right)
      continue
    }

    // Состав совпал: кровля и подошва каждого слоя переносятся линейно.
    const steps = Math.max(1, Math.ceil(spanM / stepM))
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      const chainageM = left.chainageM + spanM * t
      stations.push({
        chainageM: round2(chainageM),
        surfaceElevationM: round2(left.surfaceElevationM + (right.surfaceElevationM - left.surfaceElevationM) * t),
        measured: step === steps,
        layers: left.layers.map((layer, i) => ({
          igeCode: layer.igeCode,
          ...(layer.soilName ? { soilName: layer.soilName } : {}),
          topElevationM: round2(layer.topElevationM + (right.layers[i].topElevationM - layer.topElevationM) * t),
          bottomElevationM: round2(
            layer.bottomElevationM + (right.layers[i].bottomElevationM - layer.bottomElevationM) * t),
        })),
      })
    }
    coveredM += spanM
  }

  const coveragePercent = routeLengthM > 0 ? Math.round((coveredM / routeLengthM) * 1000) / 10 : 0
  const hull = `ПК${(anchors[0].chainageM / 100).toFixed(2)}…ПК${(anchors[anchors.length - 1].chainageM / 100).toFixed(2)}`

  return {
    stations,
    gaps,
    coveragePercent,
    reason: `Разрез построен по ${anchors.length} скважинам на ${round2(coveredM)} м `
      + `(${coveragePercent}% трассы), в пределах ${hull}. `
      + (gaps.length > 0
        ? `Не построен на ${gaps.length} промежутке(ах): состав слоёв в соседних скважинах различается. `
        : '')
      + 'За пределы крайних скважин разрез не продолжается: экстраполяция слоя выглядела бы на чертеже '
      + 'так же уверенно, как измеренное.',
  }
}

/**
 * Проекция скважин на ось трассы.
 *
 * Тот же расчёт был написан дважды — в построителе DXF профиля и в альбоме, — и
 * третья копия сделала бы расхождение делом времени.
 *
 * `maxOffsetM` — подтверждённое проектом предельное удаление скважины от оси.
 * Скважина дальше него не используется вовсе: спроецировать её на профиль
 * значило бы выдать чужую выработку за описание трассы. Без предела отбор не
 * выполняется и возвращается пусто — умолчания здесь нет по той же причине,
 * что и у прочих величин проекта.
 */
export function projectBoreholesOntoPath(
  boreholes: Borehole[],
  path: Array<{ x: number; y: number; chainageM: number }>,
  maxOffsetM: number | null | undefined,
): { projected: ProjectedBorehole[]; rejected: Array<{ label: string; offsetM: number }>; reason: string } {
  if (path.length < 2) {
    return { projected: [], rejected: [], reason: 'Ось трассы короче двух точек: проецировать не на что.' }
  }
  if (maxOffsetM == null || !(maxOffsetM > 0)) {
    return {
      projected: [],
      rejected: [],
      reason: 'Не задано предельное удаление скважины от оси: отбор не выполняется, '
        + 'иначе далёкая выработка была бы выдана за описание трассы.',
    }
  }

  const projected: ProjectedBorehole[] = []
  const rejected: Array<{ label: string; offsetM: number }> = []
  for (const borehole of boreholes) {
    if (!Number.isFinite(borehole.x) || !Number.isFinite(borehole.y)) continue
    let best: { chainageM: number; offsetM: number } | null = null
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]
      const b = path[index]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSquared = dx * dx + dy * dy
      const ratio = lengthSquared <= 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((borehole.x as number - a.x) * dx + (borehole.y as number - a.y) * dy) / lengthSquared))
      const offsetM = Math.hypot(
        (borehole.x as number) - (a.x + ratio * dx),
        (borehole.y as number) - (a.y + ratio * dy),
      )
      if (!best || offsetM < best.offsetM) {
        best = { chainageM: a.chainageM + ratio * (b.chainageM - a.chainageM), offsetM }
      }
    }
    if (!best) continue
    if (best.offsetM > maxOffsetM) {
      rejected.push({ label: borehole.label, offsetM: round2(best.offsetM) })
      continue
    }
    projected.push({ borehole, chainageM: best.chainageM })
  }

  return {
    projected,
    rejected,
    reason: `Спроецировано скважин: ${projected.length}`
      + (rejected.length > 0
        ? `; отброшено как удалённые более ${maxOffsetM} м: `
          + `${rejected.map((item) => `${item.label} (${item.offsetM} м)`).join(', ')}.`
        : '.'),
  }
}
