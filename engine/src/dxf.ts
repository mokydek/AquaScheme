import { Colors, DxfWriter, LineTypes, point3d, TextHorizontalAlignment } from '@tarikjabiri/dxf'
import type { ExportInput, SituationInput } from './exportdata'
import { materialLabel, MATERIAL_LABELS } from './exportdata'
import type { NetworkNode, TracedNetwork } from './trace'
import { getClause, NORM_DOCUMENTS } from './normregistry'
import { buildSpecification } from './specification'
import type { SpecItem } from './specification'
import type { GravityProfile } from './norms/gravity'
import { manholeLabels, picketLabel } from './norms/gravity'
import type { SewerSchedule } from './norms/gravity'
import { planWindows, profileSheetSpecs } from './norms/sheetset'
import type { SelectedManholeConstruction } from './manhole-catalog'
import type { CrossingRecord, ProtectiveGridDesign } from './working-drawings'
import type { Borehole } from './geology'

/**
 * DXF drawing of the water supply network, in real local coordinates
 * (meters). Layers follow the spirit of GOST 21.704 for outdoor water
 * supply working documentation (network W1). The file opens in AutoCAD;
 * DWG is a closed format and is deliberately not produced.
 *
 * Contents:
 *  - plan: buildings, ring and cross mains, service connections, wells,
 *    source, fittings and pipe annotations, over a light survey base;
 *  - longitudinal profile of the ring main below the plan.
 */

const LAYERS = {
  survey: 'В1-рельеф',
  network: 'В1-сеть',
  service: 'В1-вводы',
  wells: 'В1-колодцы',
  buildings: 'В1-здания',
  source: 'В1-источник',
  fittings: 'В1-арматура',
  annotation: 'В1-аннотации',
  profile: 'В1-профиль',
  geology: 'В1-геология',
} as const

function p3(x: number, y: number) {
  return point3d(x, y, 0)
}

function ringNodesInOrder(input: ExportInput): NetworkNode[] {
  return input.network.nodes
    .filter((n) => n.kind === 'ring')
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
}

export function buildNetworkDxf(input: ExportInput): string {
  const dxf = new DxfWriter()
  dxf.addLayer(LAYERS.survey, 8, LineTypes.Continuous)
  dxf.addLayer(LAYERS.network, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(LAYERS.service, Colors.Cyan, LineTypes.Continuous)
  dxf.addLayer(LAYERS.wells, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(LAYERS.buildings, Colors.Black, LineTypes.Continuous)
  dxf.addLayer(LAYERS.source, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(LAYERS.fittings, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(LAYERS.annotation, Colors.Black, LineTypes.Continuous)
  dxf.addLayer(LAYERS.profile, Colors.Black, LineTypes.Continuous)
  dxf.addLayer(LAYERS.geology, Colors.Green, LineTypes.Continuous)

  const nodeById = new Map(input.network.nodes.map((n) => [n.id, n]))

  // Survey base: light plus markers at survey points.
  if (input.surveyPoints && input.surveyPoints.length > 0) {
    dxf.setCurrentLayerName(LAYERS.survey)
    for (const p of input.surveyPoints) {
      dxf.addLine(p3(p.x - 1.2, p.y), p3(p.x + 1.2, p.y))
      dxf.addLine(p3(p.x, p.y - 1.2), p3(p.x, p.y + 1.2))
    }
  }

  // Buildings.
  dxf.setCurrentLayerName(LAYERS.buildings)
  for (const b of input.buildings) {
    dxf.addRectangle({ x: b.x - 7, y: b.y - 5 }, { x: b.x + 7, y: b.y + 5 })
    if (b.label) {
      dxf.addText(p3(b.x, b.y + 7), 2.2, b.label, {
        horizontalAlignment: TextHorizontalAlignment.Center,
        secondAlignmentPoint: p3(b.x, b.y + 7),
      })
    }
  }

  // Pipes.
  const matShort = MATERIAL_LABELS[input.material.primary] ?? input.material.primary
  for (const pipe of input.sizing.pipes) {
    const a = nodeById.get(pipe.fromNode)
    const b = nodeById.get(pipe.toNode)
    if (!a || !b) continue
    dxf.setCurrentLayerName(pipe.kind === 'service' ? LAYERS.service : LAYERS.network)
    dxf.addLine(p3(a.x, a.y), p3(b.x, b.y))
    if (pipe.kind !== 'service') {
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
      const rotation = angle > 90 || angle < -90 ? angle + 180 : angle
      dxf.setCurrentLayerName(LAYERS.annotation)
      dxf.addText(p3(mx, my + 1.5), 1.8, `d${pipe.nominalMm} ${matShort} L${pipe.lengthM.toFixed(1)}`, {
        rotation,
        secondAlignmentPoint: p3(mx, my + 1.5),
      })
    }
  }

  // Wells and fittings.
  const wellByNode = new Map(input.fittings.wells.map((w) => [w.nodeId, w.label]))
  const FITTING_MARK: Record<string, string> = {
    hydrant: 'ПГ',
    valve: 'З',
    airValve: 'В',
    washout: 'ВП',
  }
  for (const item of input.fittings.items) {
    const node = nodeById.get(item.nodeId)
    if (!node) continue
    dxf.setCurrentLayerName(LAYERS.wells)
    dxf.addCircle(p3(node.x, node.y), 1.6)
    const well = wellByNode.get(item.nodeId)
    const marks = item.types.map((t) => FITTING_MARK[t] ?? t).join(' ')
    dxf.setCurrentLayerName(LAYERS.fittings)
    dxf.addText(p3(node.x + 2.5, node.y + 2.5), 1.8, well ? `${well} ${marks}` : marks, {
      secondAlignmentPoint: p3(node.x + 2.5, node.y + 2.5),
    })
  }

  // Source.
  const src = input.network.nodes.find((n) => n.kind === 'source')
  if (src) {
    dxf.setCurrentLayerName(LAYERS.source)
    dxf.addRectangle({ x: src.x - 5, y: src.y - 5 }, { x: src.x + 5, y: src.y + 5 })
    dxf.addText(p3(src.x, src.y + 7), 2.4, 'ВОС', {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(src.x, src.y + 7),
    })
  }

  drawProfile(dxf, input)

  // Title.
  const minX = Math.min(...input.buildings.map((b) => b.x), src?.x ?? 0)
  const maxY = Math.max(...input.buildings.map((b) => b.y)) + 30
  dxf.setCurrentLayerName(LAYERS.annotation)
  dxf.addText(p3(minX, maxY), 4, `AquaScheme. Сеть В1. План и профиль. ${input.projectName}`, {
    secondAlignmentPoint: p3(minX, maxY),
  })
  dxf.addText(p3(minX, maxY - 6), 2.2, `Материал ${materialLabel(input)}. Глубина заложения ${input.material.burialDepthM.toFixed(2)} м`, {
    secondAlignmentPoint: p3(minX, maxY - 6),
  })

  return dxf.stringify()
}

// ============================================================
// General data and specification sheets (requirements update 3, change 5).
// Common SPDS frame used by the vector sheets. Project-specific participants
// are supplied through project metadata rather than copied from a reference.
// ============================================================

const SHEET_LAYER = 'Оформление'
const SHEET_W = 297
const SHEET_H = 210
const SHEET_MARGIN = 10

/** Frame, inner border and a simplified title block; returns the top y for content. */
function drawSheetFrame(dxf: DxfWriter, sheetTitle: string, projectName: string): number {
  dxf.addLayer(SHEET_LAYER, Colors.Black, LineTypes.Continuous)
  dxf.setCurrentLayerName(SHEET_LAYER)
  // Outer sheet edge and inner drawing border.
  dxf.addRectangle({ x: 0, y: 0 }, { x: SHEET_W, y: SHEET_H })
  dxf.addRectangle({ x: SHEET_MARGIN, y: SHEET_MARGIN }, { x: SHEET_W - SHEET_MARGIN, y: SHEET_H - SHEET_MARGIN })
  // Simplified title block, bottom-right.
  const tbW = 120
  const tbH = 30
  const tbX = SHEET_W - SHEET_MARGIN - tbW
  const tbY = SHEET_MARGIN
  dxf.addRectangle({ x: tbX, y: tbY }, { x: tbX + tbW, y: tbY + tbH })
  const txt = (x: number, y: number, h: number, s: string) =>
    dxf.addText(p3(x, y), h, s, { secondAlignmentPoint: p3(x, y) })
  txt(tbX + 3, tbY + tbH - 8, 3.2, sheetTitle)
  txt(tbX + 3, tbY + tbH - 15, 2.4, projectName)
  txt(tbX + 3, tbY + 4, 2, 'Основная надпись · реквизиты проекта')
  // Title above content.
  txt(SHEET_MARGIN + 2, SHEET_H - SHEET_MARGIN - 6, 4, sheetTitle)
  return SHEET_H - SHEET_MARGIN - 16
}

/**
 * Draw a text table with a header row. colX are the left x of each column,
 * relative to originX. Returns the y below the table.
 */
function drawTextTable(
  dxf: DxfWriter,
  originX: number,
  topY: number,
  colX: number[],
  rightX: number,
  header: string[],
  rows: string[][],
): number {
  const rowH = 6
  const textH = 2.2
  const total = rows.length + 1
  const bottomY = topY - total * rowH
  // Horizontal lines.
  for (let i = 0; i <= total; i++) {
    const y = topY - i * rowH
    dxf.addLine(p3(originX, y), p3(rightX, y))
  }
  // Vertical lines.
  const bounds = [...colX.map((c) => originX + c), rightX]
  for (const x of bounds) dxf.addLine(p3(x, topY), p3(x, bottomY))
  // Cells.
  const put = (cells: string[], y: number, h: number) => {
    cells.forEach((cell, i) => {
      const x = originX + colX[i] + 1.5
      dxf.addText(p3(x, y), h, cell, { secondAlignmentPoint: p3(x, y) })
    })
  }
  put(header, topY - rowH + 1.8, textH)
  rows.forEach((r, i) => put(r, topY - (i + 2) * rowH + 1.8, textH))
  return bottomY
}

/** Reference to a registry clause for the general notes (short form). */
function shortClause(id: string): string {
  const c = getClause(id)
  if (!c) return ''
  const clause = c.clause ? `п. ${c.clause}` : 'пункт уточняется'
  return ` (${c.documentCode} ${clause}${c.status === 'unverified' ? ', требует проверки' : ''})`
}

/**
 * Sheet "Общие данные" — the first sheet of the working set (GOST 21.101 /
 * 21.704 spirit): list of working drawings, referenced documents, legend and
 * general notes with the key decisions and their normative basis.
 */
export function buildGeneralDataDxf(input: ExportInput): string {
  const dxf = new DxfWriter()
  let y = drawSheetFrame(dxf, 'Общие данные', input.projectName)
  const x0 = SHEET_MARGIN + 4
  const rightX = SHEET_W - SHEET_MARGIN - 4
  const sub = (s: string): number => {
    dxf.addText(p3(x0, y), 3, s, { secondAlignmentPoint: p3(x0, y) })
    return y - 6
  }
  const line = (s: string, h = 2.2): number => {
    dxf.addText(p3(x0 + 2, y), h, s, { secondAlignmentPoint: p3(x0 + 2, y) })
    return y - 5
  }

  y = sub('Ведомость рабочих чертежей основного комплекта')
  y = drawTextTable(
    dxf, x0, y, [0, 20], rightX,
    ['Лист', 'Наименование'],
    [
      ['1', 'Общие данные'],
      ['2', 'План и продольный профиль сети В1'],
      ['3', 'Спецификация оборудования, изделий и материалов'],
    ],
  ) - 6

  y = sub('Ведомость ссылочных и прилагаемых документов')
  y = drawTextTable(
    dxf, x0, y, [0, 70], rightX,
    ['Обозначение', 'Наименование'],
    NORM_DOCUMENTS.map((d) => [d.code, `${d.title}${d.status === 'unverified' ? ' (требует проверки)' : ''}`]),
  ) - 6

  y = sub('Условные обозначения')
  for (const s of [
    'сплошная линия — магистраль (кольцо, перемычка), водовод;',
    'пунктир — ввод в здание; ○ — колодец ВК;',
    'ПГ — пожарный гидрант; З — задвижка; В — вантуз; ВП — выпуск.',
  ]) y = line(s)
  y -= 3

  y = sub('Общие указания')
  const notes: string[] = [
    `Состав листа и общих указаний принят по ГОСТ 21.704${shortClause('drawing.generalData')}.`,
    `Сеть В1 запроектирована кольцевой${shortClause('main.looped')}.`,
    `Материал труб ${materialLabel(input)}; глубина заложения до низа трубы ${input.material.burialDepthM.toFixed(2)} м${shortClause('burial.depth')}.`,
    `Свободные напоры у зданий приняты по норме${shortClause('freeHead.base')}.`,
  ]
  if (input.seismicity.siteIntensityPoints >= 7) {
    notes.push(`Сейсмичность площадки ${input.seismicity.siteIntensityPoints} баллов: сварные стыки и компенсаторы${shortClause('seismic.joints')}.`)
  }
  if (input.region) notes.push(`Регион: ${input.region.name}; региональные параметры приняты со ссылкой на источник${shortClause('region.seismicMap')}.`)
  notes.push(`Основная надпись листов — по форме 3${shortClause('drawing.stamp')}.`)
  notes.push('Проект подлежит экспертизе. Часть ссылок на пункты нормативов требует проверки по официальному изданию.')
  for (const n of notes) y = line(n)

  return dxf.stringify()
}

/**
 * Specification sheet per the GOST 21.110 form 1 (columns transcribed from the
 * official standard, НБ3), filled from a specification source (built-in by
 * default).
 */
export function buildSpecSheetDxf(
  input: { projectName: string } & Partial<ExportInput>,
  items?: SpecItem[],
): string {
  const dxf = new DxfWriter()
  // Without explicit items the full ExportInput is required to derive them.
  const spec = items ?? buildSpecification(input as ExportInput)
  let y = drawSheetFrame(
    dxf,
    'Спецификация оборудования, изделий и материалов наружных сетей водоснабжения и канализации',
    input.projectName,
  )
  const x0 = SHEET_MARGIN + 4
  const rightX = SHEET_W - SHEET_MARGIN - 4
  dxf.addText(p3(x0, y), 2.4, `Форма 1${shortClause('spec.form')}`, { secondAlignmentPoint: p3(x0, y) })
  y -= 8
  drawTextTable(
    dxf, x0, y, [0, 15, 120, 175, 205], rightX,
    ['Поз.', 'Наименование и техническая характеристика', 'Тип, марка, обозн. документа', 'Код продукции', 'Ед. изм.', 'Кол.'],
    spec.map((i) => [String(i.pos), i.name, i.spec, i.code ?? '', i.unit, String(i.quantity)]),
  )
  return dxf.stringify()
}

/** Longitudinal profile of the ring main, placed below the plan. */
function drawProfile(dxf: DxfWriter, input: ExportInput): void {
  const ring = ringNodesInOrder(input)
  if (ring.length < 2) return
  const path = [...ring, ring[0]]

  const minY = Math.min(...input.network.nodes.map((n) => n.y))
  const minX = Math.min(...input.network.nodes.map((n) => n.x))
  const originX = minX
  const originY = minY - 140
  const vScale = 10 // vertical exaggeration for readability

  const elevations = path.map((n) => n.groundElevation)
  const datum = Math.floor(Math.min(...elevations) - 1)
  const burial = input.material.burialDepthM

  const yFor = (elev: number) => originY + (elev - datum) * vScale

  // Chainage.
  const chain: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    chain.push(chain[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
  }

  dxf.setCurrentLayerName(LAYERS.profile)
  // Datum line.
  const totalLen = chain[chain.length - 1]
  dxf.addLine(p3(originX, originY), p3(originX + totalLen, originY))
  dxf.addText(p3(originX - 4, originY), 1.8, `${datum.toFixed(1)}`, {
    horizontalAlignment: TextHorizontalAlignment.Right,
    secondAlignmentPoint: p3(originX - 4, originY),
  })

  // Ground line.
  const ground = path.map((n, i) => ({ point: { x: originX + chain[i], y: yFor(n.groundElevation) } }))
  dxf.addLWPolyline(ground)
  // Pipe invert line.
  const invert = path.map((n, i) => ({ point: { x: originX + chain[i], y: yFor(n.groundElevation - burial) } }))
  dxf.addLWPolyline(invert)

  // Node ticks and elevation labels.
  for (let i = 0; i < path.length; i++) {
    const x = originX + chain[i]
    dxf.addLine(p3(x, originY), p3(x, yFor(path[i].groundElevation)))
    dxf.addText(p3(x, yFor(path[i].groundElevation) + 1.5), 1.6, path[i].groundElevation.toFixed(1), {
      rotation: 90,
      secondAlignmentPoint: p3(x, yFor(path[i].groundElevation) + 1.5),
    })
  }

  drawBoreholeColumns(dxf, input, path, chain, originX, yFor)

  dxf.setCurrentLayerName(LAYERS.annotation)
  dxf.addText(p3(originX, yFor(Math.max(...elevations)) + 6), 2.4, 'Продольный профиль магистрали В1', {
    secondAlignmentPoint: p3(originX, yFor(Math.max(...elevations)) + 6),
  })
}

/** Chainage of the point on the route path nearest to (bx, by). */
function chainageOfNearest(path: NetworkNode[], chain: number[], bx: number, by: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x
    const ay = path[i - 1].y
    const dx = path[i].x - ax
    const dy = path[i].y - ay
    const segLen2 = dx * dx + dy * dy
    const t = segLen2 === 0 ? 0 : Math.max(0, Math.min(1, ((bx - ax) * dx + (by - ay) * dy) / segLen2))
    const px = ax + t * dx
    const py = ay + t * dy
    const d = Math.hypot(bx - px, by - py)
    if (d < bestDist) {
      bestDist = d
      best = chain[i - 1] + t * Math.hypot(dx, dy)
    }
  }
  return best
}

/**
 * Geology cross-section on the longitudinal profile (requirements update 3,
 * change 1, G3): each borehole is drawn as a column at its chainage along the
 * route, with layer boundaries and the water table, so the profile carries
 * the geology it was designed against.
 */
function drawBoreholeColumns(
  dxf: DxfWriter,
  input: ExportInput,
  path: NetworkNode[],
  chain: number[],
  originX: number,
  yFor: (elev: number) => number,
): void {
  const boreholes = (input.boreholes ?? []).filter(
    (b) => b.x !== undefined && b.y !== undefined && b.mouthElevationM !== undefined && b.layers.length > 0,
  )
  if (boreholes.length === 0) return

  dxf.setCurrentLayerName(LAYERS.geology)
  for (const b of boreholes) {
    const x = originX + chainageOfNearest(path, chain, b.x as number, b.y as number)
    const mouth = b.mouthElevationM as number
    const deepest = Math.max(...b.layers.map((l) => l.bottomDepthM))
    // Column from mouth down to the deepest layer bottom.
    dxf.addLine(p3(x, yFor(mouth)), p3(x, yFor(mouth - deepest)))
    // Layer boundary ticks.
    for (const layer of b.layers) {
      const yb = yFor(mouth - layer.bottomDepthM)
      dxf.addLine(p3(x - 2, yb), p3(x + 2, yb))
      if (layer.igeCode) {
        dxf.addText(p3(x + 2.5, yFor(mouth - (layer.topDepthM + layer.bottomDepthM) / 2)), 1.4, `ИГЭ-${layer.igeCode}`, {
          secondAlignmentPoint: p3(x + 2.5, yFor(mouth - (layer.topDepthM + layer.bottomDepthM) / 2)),
        })
      }
    }
    // Water table marker.
    if (b.water.depthM !== undefined) {
      const yw = yFor(mouth - b.water.depthM)
      dxf.addLine(p3(x - 3, yw), p3(x + 3, yw))
      dxf.addText(p3(x - 3.5, yw), 1.4, 'УГВ', {
        horizontalAlignment: TextHorizontalAlignment.Right,
        secondAlignmentPoint: p3(x - 3.5, yw),
      })
    }
    // Borehole label above the column.
    dxf.addText(p3(x, yFor(mouth) + 2), 1.6, b.label, {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(x, yFor(mouth) + 2),
    })
  }
}

// ============================================================
// Sewer (К1) longitudinal profile sheet. The боковик (side table) follows the
// full GOST 21.704-2011 form 2 (verified, НБ3), aligned to professional
// practice reviewed against a real НК collector album: проектная отметка лотка,
// проектная и натурная отметки земли, обозначение трубы, основание и тип
// изоляции, уклон в ‰ и длина, расстояние, номер колодца с пикетажем (ПК).
// ============================================================

const SEWER_PROFILE_LAYER = 'К1-профиль'

export interface ProfileSheetGeologyContext {
  boreholes: readonly Borehole[]
  /** Source-backed plan alignment for this profile, with matching absolute chainage. */
  path: ReadonlyArray<{ x: number; y: number; chainageM: number }>
  maxOffsetM: number
}

export interface ProfileSheetRenderContext {
  /** Full-project schedule labels keyed by network node id. */
  nodeLabels?: ReadonlyMap<string, string>
  geology?: ProfileSheetGeologyContext
}

function nearestProfileAxisProjection(
  path: ProfileSheetGeologyContext['path'],
  x: number,
  y: number,
): { chainageM: number; distanceM: number } | null {
  if (path.length < 2) return null
  let best: { chainageM: number; distanceM: number } | null = null
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]
    const b = path[index]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const ratio = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared))
    const projectedX = a.x + ratio * dx
    const projectedY = a.y + ratio * dy
    const distanceM = Math.hypot(x - projectedX, y - projectedY)
    const chainageM = a.chainageM + ratio * (b.chainageM - a.chainageM)
    if (!best || distanceM < best.distanceM) best = { chainageM, distanceM }
  }
  return best
}

function drawProfileSheetGeology(
  dxf: DxfWriter,
  context: ProfileSheetGeologyContext | undefined,
  xFor: (chainageM: number) => number,
  yFor: (elevationM: number) => number,
  fromChainageM: number,
  toChainageM: number,
): void {
  if (!context || !(context.maxOffsetM > 0) || context.path.length < 2) return
  dxf.setCurrentLayerName(LAYERS.geology)
  for (const borehole of context.boreholes) {
    if (!Number.isFinite(borehole.x) || !Number.isFinite(borehole.y) || !Number.isFinite(borehole.mouthElevationM) || borehole.layers.length === 0) continue
    const projection = nearestProfileAxisProjection(context.path, borehole.x!, borehole.y!)
    if (!projection || projection.distanceM > context.maxOffsetM + 1e-9) continue
    if (projection.chainageM < fromChainageM - 1e-6 || projection.chainageM > toChainageM + 1e-6) continue
    const x = xFor(projection.chainageM)
    const mouth = borehole.mouthElevationM!
    const deepest = Math.max(...borehole.layers.map((layer) => layer.bottomDepthM))
    dxf.addLine(p3(x, yFor(mouth)), p3(x, yFor(mouth - deepest)))
    for (const layer of borehole.layers) {
      const boundaryY = yFor(mouth - layer.bottomDepthM)
      dxf.addLine(p3(x - 2, boundaryY), p3(x + 2, boundaryY))
      if (layer.igeCode) {
        const labelY = yFor(mouth - (layer.topDepthM + layer.bottomDepthM) / 2)
        dxf.addText(p3(x + 2.5, labelY), 1.4, `ИГЭ-${layer.igeCode}`, {
          secondAlignmentPoint: p3(x + 2.5, labelY),
        })
      }
    }
    if (Number.isFinite(borehole.water.depthM)) {
      const waterY = yFor(mouth - borehole.water.depthM!)
      dxf.addLine(p3(x - 3, waterY), p3(x + 3, waterY))
    }
    dxf.addText(p3(x, yFor(mouth) + 2), 1.6, borehole.label, {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(x, yFor(mouth) + 2),
    })
  }
}

/**
 * Longitudinal profile of the main gravity collector (К1) as a standalone A4
 * sheet: the ground and invert lines with a GOST 21.704 form 2 side table.
 * Everything is taken from the computed profile — no invented values.
 */
export function buildSewerProfileDxf(input: {
  projectName: string
  profile: GravityProfile
  /** Sheet caption; defaults to the whole-collector title. Per-picket sheets pass «Профиль К2 ПК…-ПК…». */
  sheetTitle?: string
  /** Surveyed utility/road/water crossings located by absolute route chainage. */
  crossings?: CrossingRecord[]
  renderContext?: ProfileSheetRenderContext
}): string {
  const dxf = new DxfWriter()
  dxf.addLayer(SEWER_PROFILE_LAYER, Colors.Black, LineTypes.Continuous)
  dxf.addLayer(LAYERS.geology, Colors.Green, LineTypes.Continuous)
  const topY = drawSheetFrame(dxf, input.sheetTitle ?? 'Продольный профиль сети К1', input.projectName)
  const stations = input.profile.stations
  if (stations.length < 2) {
    dxf.addText(p3(SHEET_MARGIN + 4, topY - 8), 3, 'Недостаточно данных для профиля', {
      secondAlignmentPoint: p3(SHEET_MARGIN + 4, topY - 8),
    })
    return dxf.stringify()
  }

  const fallbackLabels = manholeLabels(stations.length)
  const labels = stations.map((station, index) => input.renderContext?.nodeLabels?.get(station.nodeId) ?? fallbackLabels[index])
  const gutterX = SHEET_MARGIN + 52 // left column for form-2 row captions
  const plotLeft = gutterX
  const plotRight = SHEET_W - SHEET_MARGIN - 3
  const plotWidth = plotRight - plotLeft
  // A sliced profile keeps absolute project chainages. Each sheet must still
  // begin at plotLeft; chainage / fragmentLength moved later sheets off-frame.
  const fromChainageM = stations[0].chainageM
  const toChainageM = stations[stations.length - 1].chainageM
  const total = Math.max(toChainageM - fromChainageM, 1)
  const xFor = (chainage: number) => plotLeft + ((chainage - fromChainageM) / total) * plotWidth
  const crossings = (input.crossings ?? [])
    .filter((item) => item.stationM >= fromChainageM - 1e-6 && item.stationM <= toChainageM + 1e-6)
    .sort((a, b) => a.stationM - b.stationM)

  // Vertical band for the profile graph, sitting above the form-2 table.
  const tableTopY = SHEET_MARGIN + 48
  const profileBottom = tableTopY + 8
  const profileTop = topY - 8
  const grounds = [
    ...stations.map((s) => s.groundElevationM),
    ...crossings.flatMap((item) => item.existingElevationM === undefined ? [] : [item.existingElevationM]),
  ]
  const inverts = [
    ...stations.map((s) => s.invertElevationM),
    ...crossings.flatMap((item) => item.designInvertElevationM === undefined ? [] : [item.designInvertElevationM]),
  ]
  const datum = Math.floor(Math.min(...inverts) - 0.5)
  const maxElev = Math.max(...grounds)
  const span = Math.max(maxElev - datum, 0.5)
  const vScale = (profileTop - profileBottom) / span
  const yFor = (elev: number) => profileBottom + (elev - datum) * vScale

  dxf.setCurrentLayerName(SEWER_PROFILE_LAYER)
  // Ground line (natural surface) and invert line (лоток).
  dxf.addLWPolyline(stations.map((s) => ({ point: { x: xFor(s.chainageM), y: yFor(s.groundElevationM) } })))
  dxf.addLWPolyline(stations.map((s) => ({ point: { x: xFor(s.chainageM), y: yFor(s.invertElevationM) } })))

  // Station verticals from invert to ground, manhole labels and picket (ПК) marks.
  for (let i = 0; i < stations.length; i++) {
    const x = xFor(stations[i].chainageM)
    dxf.addLine(p3(x, yFor(stations[i].invertElevationM)), p3(x, yFor(stations[i].groundElevationM)))
    dxf.addText(p3(x, yFor(stations[i].groundElevationM) + 2), 1.8, labels[i], {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(x, yFor(stations[i].groundElevationM) + 2),
    })
  }

  // Diameter annotation on each segment (gravity, безнапорная), above the invert.
  for (let i = 1; i < stations.length; i++) {
    const xm = (xFor(stations[i - 1].chainageM) + xFor(stations[i].chainageM)) / 2
    const ym = (yFor(stations[i - 1].invertElevationM) + yFor(stations[i].invertElevationM)) / 2
    dxf.addText(p3(xm, ym + 1.5), 1.4, `Ø${stations[i].diameterMm} безн.`, {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(xm, ym + 1.5),
    })
  }

  // Draw only source-backed crossing elevations and clearances. Missing
  // attributes remain working-drawing blockers instead of being guessed.
  for (const crossing of crossings) {
    const x = xFor(crossing.stationM)
    const existingY = crossing.existingElevationM === undefined ? undefined : yFor(crossing.existingElevationM)
    const designY = crossing.designInvertElevationM === undefined ? undefined : yFor(crossing.designInvertElevationM)
    if (existingY !== undefined && designY !== undefined) {
      dxf.addLine(p3(x, designY), p3(x, existingY))
      dxf.addLine(p3(x - 2, existingY), p3(x + 2, existingY))
      dxf.addLine(p3(x - 2, designY), p3(x + 2, designY))
    }
    const labelY = Math.min(profileTop - 1, (existingY ?? designY ?? profileBottom) + 2.5)
    const details = [
      crossing.id,
      crossing.kind,
      crossing.clearanceM === undefined ? undefined : `просвет ${crossing.clearanceM.toFixed(2)} м`,
    ].filter((value): value is string => Boolean(value)).join('; ')
    dxf.addText(p3(x, labelY), 1.4, details, {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(x, labelY),
    })
  }

  drawProfileSheetGeology(
    dxf,
    input.renderContext?.geology,
    xFor,
    yFor,
    fromChainageM,
    toChainageM,
  )

  drawSewerProfileTable(dxf, input.profile, labels, xFor, gutterX, tableTopY)

  dxf.setCurrentLayerName(SHEET_LAYER)
  dxf.addText(p3(SHEET_MARGIN + 2, topY - 3), 2, `Наибольшая глубина заложения ${input.profile.maxDepthM.toFixed(2)} м${shortClause('sewer.depth.min')}. Масштаб: гор. 1:500, верт. 1:100`, {
    secondAlignmentPoint: p3(SHEET_MARGIN + 2, topY - 3),
  })
  return dxf.stringify()
}

/** GOST 21.704 form 2 side table under the sewer profile. */
function drawSewerProfileTable(
  dxf: DxfWriter,
  profile: GravityProfile,
  labels: string[],
  xFor: (chainage: number) => number,
  gutterX: number,
  tableTopY: number,
): void {
  const stations = profile.stations
  const rows = [
    'Проектная отметка лотка, м',
    'Проектная отметка земли, м',
    'Натурная отметка земли, м',
    'Обозначение трубы',
    'Основание и тип изоляции',
    'Уклон, ‰; длина, м',
    'Расстояние, м',
    'Номер колодца; ПК',
  ]
  const bandH = 5
  const leftX = SHEET_MARGIN + 2
  const rightX = SHEET_W - SHEET_MARGIN - 3
  const bottomY = tableTopY - rows.length * bandH

  dxf.setCurrentLayerName(SHEET_LAYER)
  // Horizontal band lines and the caption gutter separator.
  for (let i = 0; i <= rows.length; i++) {
    const y = tableTopY - i * bandH
    dxf.addLine(p3(leftX, y), p3(rightX, y))
  }
  dxf.addLine(p3(gutterX, tableTopY), p3(gutterX, bottomY))
  dxf.addLine(p3(leftX, tableTopY), p3(leftX, bottomY))
  dxf.addLine(p3(rightX, tableTopY), p3(rightX, bottomY))
  rows.forEach((caption, i) => {
    dxf.addText(p3(leftX + 1.5, tableTopY - (i + 1) * bandH + 1.6), 1.5, caption, {
      secondAlignmentPoint: p3(leftX + 1.5, tableTopY - (i + 1) * bandH + 1.6),
    })
  })

  const yAt = (rowIndex: number) => tableTopY - (rowIndex + 1) * bandH + 1.6
  const centered = (x: number, y: number, s: string, h = 1.4) =>
    dxf.addText(p3(x, y), h, s, {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(x, y),
    })

  // Per-station values: invert, design ground, natural ground, manhole № + ПК.
  for (let i = 0; i < stations.length; i++) {
    const x = xFor(stations[i].chainageM)
    dxf.addLine(p3(x, tableTopY), p3(x, bottomY))
    centered(x, yAt(0), stations[i].invertElevationM.toFixed(2))
    centered(x, yAt(1), stations[i].groundElevationM.toFixed(2))
    centered(x, yAt(2), stations[i].groundElevationM.toFixed(2))
    centered(x, yAt(7), labels[i])
    centered(x, yAt(7) - 2, picketLabel(stations[i].chainageM))
  }
  // Per-segment values: pipe designation, bedding, slope (‰) and length.
  for (let i = 1; i < stations.length; i++) {
    const xm = (xFor(stations[i - 1].chainageM) + xFor(stations[i].chainageM)) / 2
    const len = stations[i].chainageM - stations[i - 1].chainageM
    const drop = stations[i - 1].invertElevationM - stations[i].invertElevationM
    const slopePermille = len > 0 ? (drop / len) * 1000 : 0
    centered(xm, yAt(3), `Ø${stations[i].diameterMm} безн.`)
    centered(xm, yAt(4), 'по проекту')
    centered(xm, yAt(5), `${slopePermille.toFixed(1)}; ${len.toFixed(0)}`)
    centered(xm, yAt(6), len.toFixed(0))
  }
}

// ============================================================
// Sewer (К1) network plan. Drawn in real local coordinates (meters); follows
// GOST 21.704-2011 5.1 (verified, НБ3): manholes, diameters, structures and
// flow toward the outlet.
// ============================================================

const K1_LAYERS = {
  network: 'К1-сеть',
  wells: 'К1-колодцы',
  buildings: 'К1-здания',
  outlet: 'К1-выпуск',
  annotation: 'К1-аннотации',
} as const

/** Distance (m) of each node from the outlet along the BFS tree. */
function distancesFromOutlet(network: TracedNetwork, outletId: string): Map<string, number> {
  const adj = new Map<string, Array<{ to: string; len: number }>>()
  for (const p of network.pipes) {
    if (!adj.has(p.fromNode)) adj.set(p.fromNode, [])
    if (!adj.has(p.toNode)) adj.set(p.toNode, [])
    adj.get(p.fromNode)!.push({ to: p.toNode, len: p.lengthM })
    adj.get(p.toNode)!.push({ to: p.fromNode, len: p.lengthM })
  }
  const dist = new Map<string, number>([[outletId, 0]])
  const queue = [outletId]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const edge of adj.get(cur) ?? []) {
      if (dist.has(edge.to)) continue
      dist.set(edge.to, (dist.get(cur) ?? 0) + edge.len)
      queue.push(edge.to)
    }
  }
  return dist
}

/**
 * Sewer (К1) network plan as an A0-free real-scale drawing: buildings, gravity
 * mains with diameter labels and flow arrows toward the outlet, manholes ВК-n
 * and the outlet «Вып.».
 */
export interface ProfileSheetFile {
  /** Sheet title, doubles as the file base name: «Профиль К2 ПК0 - ПК8+50». */
  title: string
  dxf: string
}

/**
 * The per-picket profile sheet set (нарезка листов профиля как в
 * профессиональном комплекте НК): the gravity profile is cut at manhole
 * stations into ~targetPerSheetM fragments and each fragment becomes its own
 * sheet through buildSewerProfileDxf, titled «Профиль К2 ПК…-ПК…».
 */
export function buildProfileSheetSetDxf(
  projectName: string,
  profile: GravityProfile,
  system: 'sewer' | 'storm' = 'storm',
  targetPerSheetM = 850,
  crossings: CrossingRecord[] = [],
  renderContext: ProfileSheetRenderContext = {},
): ProfileSheetFile[] {
  return profileSheetSpecs(profile, system, targetPerSheetM).map((spec) => ({
    title: spec.title,
    dxf: buildSewerProfileDxf({
      projectName,
      profile: spec.profile,
      sheetTitle: spec.title,
      crossings: crossings.filter((item) => (
        item.stationM >= spec.interval.fromM - 1e-6 && item.stationM <= spec.interval.toM + 1e-6
      )),
      renderContext,
    }),
  }))
}

/**
 * «Таблица расхода материалов по сборным канализационным колодцам» — the
 * per-manhole material sheets of a professional НК album. The model knows the
 * mark, picket, depth and pipe diameter of every manhole; the per-element
 * consumption (кольца КС, плиты, днища, скобы) comes from a типовой проект
 * whose series is confirmed by the engineer, so that column honestly says
 * «по типовому проекту (уточняется)» instead of invented ring marks.
 */
export function buildManholeMaterialSheetsDxf(
  projectName: string,
  schedule: SewerSchedule,
  constructions: SelectedManholeConstruction[] = [],
  perSheet = 30,
): ProfileSheetFile[] {
  const constructionByLabel = new Map(constructions.map((item) => [item.manholeLabel, item]))
  const sheets: ProfileSheetFile[] = []
  for (let start = 0; start < schedule.manholes.length; start += perSheet) {
    const part = schedule.manholes.slice(start, start + perSheet)
    const partNo = Math.floor(start / perSheet) + 1
    const title = `Таблица расхода материалов по сборным канализационным колодцам (лист ${partNo})`
    const dxf = new DxfWriter()
    let y = drawSheetFrame(dxf, title, projectName)
    const x0 = SHEET_MARGIN + 4
    const rightX = SHEET_W - SHEET_MARGIN - 4
    dxf.addText(p3(x0, y), 2.2, 'Расход элементов сформирован из параметрического каталога', {
      secondAlignmentPoint: p3(x0, y),
    })
    y -= 6
    drawTextTable(
      dxf, x0, y, [0, 30, 70, 110, 150], rightX,
      ['Марка', 'Пикет', 'Глубина, м', 'Ду, мм', 'Тип / расчётный состав'],
      part.map((m) => {
        const selected = constructionByLabel.get(m.label)
        return [
          m.label,
          m.picket,
          (m.depthMm / 1000).toFixed(2),
          String(m.pipeDiameterMm),
          selected
            ? `${selected.typeCode}: ${selected.components.map((item) => `${item.name} ${item.quantity} ${item.unit}`).join('; ')}`
            : 'не подобрано — выпуск заблокирован',
        ]
      }),
    )
    sheets.push({ title, dxf: dxf.stringify() })
  }
  return sheets
}

/** Parameter-driven well/chamber selection sheet with catalog provenance. */
export function buildManholeConstructionDetailDxf(
  projectName: string,
  schedule: SewerSchedule,
  constructions: SelectedManholeConstruction[],
): string {
  const dxf = new DxfWriter()
  const title = 'Колодцы и камеры. Параметрические решения'
  let y = drawSheetFrame(dxf, title, projectName)
  const x0 = SHEET_MARGIN + 4
  const rightX = SHEET_W - SHEET_MARGIN - 4
  const selectedByLabel = new Map(constructions.map((item) => [item.manholeLabel, item]))
  dxf.addText(p3(x0, y), 2.2, 'Тип выбран по расчётной глубине, диаметру трубы и подтверждённому каталогу', {
    secondAlignmentPoint: p3(x0, y),
  })
  y -= 6
  drawTextTable(
    dxf, x0, y, [0, 28, 57, 89, 120, 163], rightX,
    ['Марка', 'Пикет', 'Глубина, м', 'Ду, мм', 'Тип', 'Состав / источник'],
    schedule.manholes.map((manhole) => {
      const selected = selectedByLabel.get(manhole.label)
      return [
        manhole.label,
        manhole.picket,
        (manhole.depthMm / 1000).toFixed(2),
        String(manhole.pipeDiameterMm),
        selected?.typeCode ?? 'не подобрано',
        selected ? `${selected.components.map((item) => `${item.name} ${item.quantity} ${item.unit}`).join('; ')}; ${selected.source}` : 'выпуск заблокирован',
      ]
    }),
  )
  return dxf.stringify()
}

/** Structured crossing cards; missing values remain visible instead of being invented. */
export function buildCrossingDetailDxf(
  projectName: string,
  crossings: CrossingRecord[],
  title = 'Пересечения с существующими коммуникациями',
): string {
  const dxf = new DxfWriter()
  let y = drawSheetFrame(dxf, title, projectName)
  const x0 = SHEET_MARGIN + 4
  const rightX = SHEET_W - SHEET_MARGIN - 4
  dxf.addText(p3(x0, y), 2.2, 'Отметки и просветы выводятся только из карточек исходных данных', { secondAlignmentPoint: p3(x0, y) })
  y -= 6
  drawTextTable(
    dxf, x0, y, [0, 25, 52, 82, 111, 141, 170, 200, 230], rightX,
    ['ID', 'Пикет, м', 'Объект', 'Владелец', 'Размер', 'Отм. сети', 'Отм. трубы', 'Просвет', 'Решение / источник'],
    crossings.map((crossing) => [
      crossing.id,
      crossing.stationM.toFixed(2),
      crossing.kind,
      crossing.owner ?? 'нет данных',
      crossing.size ?? 'нет данных',
      crossing.existingElevationM?.toFixed(2) ?? 'нет данных',
      crossing.designInvertElevationM?.toFixed(2) ?? 'нет данных',
      crossing.clearanceM?.toFixed(2) ?? 'нет данных',
      `${crossing.method ?? 'нет данных'}; ${crossing.source ?? 'источник не указан'}`,
    ]),
  )
  return dxf.stringify()
}

/** Dynamic specification from the pipe schedule and selected well components. */
export function buildWorkingDrawingSpecificationDxf(
  projectName: string,
  schedule: SewerSchedule,
  constructions: SelectedManholeConstruction[],
  range?: { start: number; end: number; total?: number },
): string {
  const dxf = new DxfWriter()
  const title = 'Спецификация оборудования, изделий и материалов'
  let y = drawSheetFrame(dxf, title, projectName)
  const x0 = SHEET_MARGIN + 4
  const rightX = SHEET_W - SHEET_MARGIN - 4
  const totals = new Map<string, { name: string; code: string; unit: string; quantity: number }>()
  for (const construction of constructions) {
    for (const component of construction.components) {
      const key = `${component.catalogCode ?? ''}\u0000${component.name}\u0000${component.unit}`
      const current = totals.get(key)
      totals.set(key, {
        name: component.name,
        code: component.catalogCode ?? '—',
        unit: component.unit,
        quantity: (current?.quantity ?? 0) + component.quantity,
      })
    }
  }
  const rows = [
    ...schedule.pipes.map((pipe) => [pipe.designation, pipe.agskCode || '—', 'м', pipe.lengthM.toFixed(2)]),
    ...[...totals.values()].map((item) => [item.name, item.code, item.unit, item.quantity.toFixed(3)]),
  ]
  if (range?.total !== undefined && range.total !== rows.length) {
    throw new Error(`Реестр спецификации устарел: ${range.total} строк в реестре, ${rows.length} в модели.`)
  }
  const selectedRows = range ? rows.slice(range.start, range.end) : rows
  drawTextTable(
    dxf, x0, y, [0, 140, 205, 235], rightX,
    ['Наименование', 'Код', 'Ед.', 'Количество'],
    selectedRows,
  )
  return dxf.stringify()
}

/**
 * «Защитная сетка для колодцев» — the design task demands protective grilles
 * with an anti-corrosion coating in every inspection manhole and the album
 * carries a dedicated sheet for them. The exact product drawing comes from
 * the agreed изделие, so this sheet holds the sketch, the count and the
 * coating requirement, marked «чертёж изделия уточняется».
 */
export function buildProtectiveGrilleSheetDxf(projectName: string, quantity: number, source: string): string {
  const dxf = new DxfWriter()
  const title = 'Защитная сетка для колодцев'
  let y = drawSheetFrame(dxf, title, projectName)
  const x0 = SHEET_MARGIN + 4
  const line = (s: string, h = 2.4) => {
    dxf.addText(p3(x0, y), h, s, { secondAlignmentPoint: p3(x0, y) })
    y -= 6
  }
  line(`Количество: ${quantity.toFixed(3)} шт (по активному каталогу)`)
  line(`Источник: ${source}`, 2)
  line('Материал, покрытие и размеры — строго по указанному источнику', 2)
  line('Геометрический эскиз не сформирован: отсутствуют структурированные размеры изделия.', 2)
  return dxf.stringify()
}

/** A construction sheet built only from an explicit, verified product design. */
export function buildProtectiveGridDetailDxf(
  projectName: string,
  design: ProtectiveGridDesign,
): string {
  const numeric = [design.quantity, design.overallWidthMm, design.overallHeightMm, design.barSpacingMm]
  if (numeric.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Параметры защитной сетки должны быть положительными числами.')
  }
  if (!design.verified) throw new Error('Конструкция защитной сетки не подтверждена.')
  const required = [design.frameProfile, design.barProfile, design.material, design.coating, design.fixing, design.source]
  if (required.some((value) => !value.trim())) throw new Error('Конструкция защитной сетки заполнена не полностью.')

  const dxf = new DxfWriter()
  const title = 'Защитная сетка для смотровых колодцев'
  let y = drawSheetFrame(dxf, title, projectName)
  const x0 = SHEET_MARGIN + 4
  const line = (value: string, height = 2.2) => {
    dxf.addText(p3(x0, y), height, value, { secondAlignmentPoint: p3(x0, y) })
    y -= 6
  }
  line(`Количество: ${design.quantity.toFixed(3)} шт.`)
  line(`Габарит: ${design.overallWidthMm}×${design.overallHeightMm} мм; шаг стержней: ${design.barSpacingMm} мм`)
  line(`Рама: ${design.frameProfile}; стержни: ${design.barProfile}`)
  line(`Материал: ${design.material}; покрытие: ${design.coating}`)
  line(`Крепление: ${design.fixing}`)
  line(`Источник: ${design.source}`, 1.9)

  const maxDrawingWidth = 115
  const maxDrawingHeight = 90
  const scale = Math.min(maxDrawingWidth / design.overallWidthMm, maxDrawingHeight / design.overallHeightMm)
  const width = design.overallWidthMm * scale
  const height = design.overallHeightMm * scale
  const gx = x0 + 8
  const gy = Math.max(SHEET_MARGIN + 42, y - height - 8)
  dxf.addRectangle({ x: gx, y: gy }, { x: gx + width, y: gy + height })
  const verticalBars = Math.max(0, Math.floor(design.overallWidthMm / design.barSpacingMm) - 1)
  const horizontalBars = Math.max(0, Math.floor(design.overallHeightMm / design.barSpacingMm) - 1)
  for (let index = 1; index <= verticalBars; index++) {
    const offset = Math.min(index * design.barSpacingMm * scale, width)
    if (offset < width) dxf.addLine(p3(gx + offset, gy), p3(gx + offset, gy + height))
  }
  for (let index = 1; index <= horizontalBars; index++) {
    const offset = Math.min(index * design.barSpacingMm * scale, height)
    if (offset < height) dxf.addLine(p3(gx, gy + offset), p3(gx + width, gy + offset))
  }
  dxf.addText(p3(gx, gy - 5), 2, `Габарит ${design.overallWidthMm}×${design.overallHeightMm}; шаг ${design.barSpacingMm}`, {
    secondAlignmentPoint: p3(gx, gy - 5),
  })
  return dxf.stringify()
}

type DrawingWindow = { minX: number; minY: number; maxX: number; maxY: number }
type DrawingPoint = { x: number; y: number }

function orderedPipeAlignment(
  pipe: TracedNetwork['pipes'][number],
  from: NetworkNode,
  to: NetworkNode,
): DrawingPoint[] {
  let alignment = pipe.alignment && pipe.alignment.length >= 2
    ? pipe.alignment.map(({ x, y }) => ({ x, y }))
    : [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]
  const forward = Math.hypot(alignment[0].x - from.x, alignment[0].y - from.y)
    + Math.hypot(alignment[alignment.length - 1].x - to.x, alignment[alignment.length - 1].y - to.y)
  const reverse = Math.hypot(alignment[0].x - to.x, alignment[0].y - to.y)
    + Math.hypot(alignment[alignment.length - 1].x - from.x, alignment[alignment.length - 1].y - from.y)
  if (reverse < forward) alignment = [...alignment].reverse()
  if (Math.hypot(alignment[0].x - from.x, alignment[0].y - from.y) > 0.01) alignment.unshift({ x: from.x, y: from.y })
  if (Math.hypot(alignment[alignment.length - 1].x - to.x, alignment[alignment.length - 1].y - to.y) > 0.01) alignment.push({ x: to.x, y: to.y })
  return alignment
}

/** Return only a real alignment that is tied to both network nodes. */
function confirmedOrderedPipeAlignment(
  pipe: TracedNetwork['pipes'][number],
  from: NetworkNode,
  to: NetworkNode,
): DrawingPoint[] | null {
  if (!pipe.alignment || pipe.alignment.length < 2) return null
  let alignment = pipe.alignment
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map(({ x, y }) => ({ x, y }))
  if (alignment.length < 2) return null
  const forward = Math.hypot(alignment[0].x - from.x, alignment[0].y - from.y)
    + Math.hypot(alignment[alignment.length - 1].x - to.x, alignment[alignment.length - 1].y - to.y)
  const reverse = Math.hypot(alignment[0].x - to.x, alignment[0].y - to.y)
    + Math.hypot(alignment[alignment.length - 1].x - from.x, alignment[alignment.length - 1].y - from.y)
  if (reverse < forward) alignment = [...alignment].reverse()
  if (Math.hypot(alignment[0].x - from.x, alignment[0].y - from.y) > 0.01) return null
  if (Math.hypot(alignment[alignment.length - 1].x - to.x, alignment[alignment.length - 1].y - to.y) > 0.01) return null
  alignment[0] = { x: from.x, y: from.y }
  alignment[alignment.length - 1] = { x: to.x, y: to.y }
  return alignment
}

function pointInsideWindow(point: DrawingPoint, window: DrawingWindow): boolean {
  return point.x >= window.minX && point.x <= window.maxX && point.y >= window.minY && point.y <= window.maxY
}

/** Liang–Barsky segment clipping in model coordinates. */
function clipSegmentToWindow(a: DrawingPoint, b: DrawingPoint, window: DrawingWindow): [DrawingPoint, DrawingPoint] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - window.minX, window.maxX - a.x, a.y - window.minY, window.maxY - a.y]
  let t0 = 0
  let t1 = 1
  for (let index = 0; index < 4; index++) {
    if (Math.abs(p[index]) < 1e-12) {
      if (q[index] < 0) return null
      continue
    }
    const ratio = q[index] / p[index]
    if (p[index] < 0) t0 = Math.max(t0, ratio)
    else t1 = Math.min(t1, ratio)
    if (t0 > t1) return null
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ]
}

function sameDrawingPoint(a: DrawingPoint, b: DrawingPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-7
}

function clipPolylineToWindow(points: DrawingPoint[], window: DrawingWindow): DrawingPoint[][] {
  const fragments: DrawingPoint[][] = []
  for (let index = 1; index < points.length; index++) {
    const clipped = clipSegmentToWindow(points[index - 1], points[index], window)
    if (!clipped) continue
    const previous = fragments[fragments.length - 1]
    if (previous && sameDrawingPoint(previous[previous.length - 1], clipped[0])) previous.push(clipped[1])
    else fragments.push(clipped)
  }
  return fragments.filter((fragment) => fragment.length >= 2)
}

function polylineLength(points: DrawingPoint[]): number {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(
    point.x - points[index].x,
    point.y - points[index].y,
  ), 0)
}

function polylineMidpoint(points: DrawingPoint[]): DrawingPoint & { dx: number; dy: number } {
  const target = polylineLength(points) / 2
  let walked = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]
    const b = points[index]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + length >= target || index === points.length - 1) {
      const ratio = (target - walked) / Math.max(length, 1e-9)
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, dx: b.x - a.x, dy: b.y - a.y }
    }
    walked += length
  }
  return { ...points[0], dx: 0, dy: 0 }
}

export function buildSewerPlanDxf(input: {
  projectName: string
  network: TracedNetwork
  pipeDiameterMm: Map<string, number>
  buildingLabels?: Map<string, string>
  /** Sheet caption; per-picket sheets pass «План К2 ПК…-ПК…. М1:500». */
  sheetTitle?: string
  /** Model-space window used by per-picket plan sheets. */
  window?: DrawingWindow
}): string {
  const dxf = new DxfWriter()
  dxf.addLayer(K1_LAYERS.network, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(K1_LAYERS.wells, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(K1_LAYERS.buildings, Colors.Black, LineTypes.Continuous)
  dxf.addLayer(K1_LAYERS.outlet, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(K1_LAYERS.annotation, Colors.Black, LineTypes.Continuous)

  const nodeById = new Map(input.network.nodes.map((n) => [n.id, n]))
  const outlet = input.network.nodes.find((n) => n.kind === 'source')
  const dist = outlet ? distancesFromOutlet(input.network, outlet.id) : new Map<string, number>()

  // Buildings.
  dxf.setCurrentLayerName(K1_LAYERS.buildings)
  for (const n of input.network.nodes) {
    if (n.kind !== 'building') continue
    if (input.window && !pointInsideWindow(n, input.window)) continue
    dxf.addRectangle({ x: n.x - 7, y: n.y - 5 }, { x: n.x + 7, y: n.y + 5 })
    const label = n.buildingId ? input.buildingLabels?.get(n.buildingId) : undefined
    if (label) {
      dxf.addText(p3(n.x, n.y + 7), 2.2, label, {
        horizontalAlignment: TextHorizontalAlignment.Center,
        secondAlignmentPoint: p3(n.x, n.y + 7),
      })
    }
  }

  // Pipes with diameter labels and a flow arrow toward the outlet. A saved
  // alignment is the design axis and must never be replaced by the endpoint
  // chord: that shortcut can cut across buildings, water and other obstacles.
  for (const p of input.network.pipes) {
    const a = nodeById.get(p.fromNode)
    const b = nodeById.get(p.toNode)
    if (!a || !b) continue
    const alignment = confirmedOrderedPipeAlignment(p, a, b)
    if (!alignment) continue
    const fragments = input.window ? clipPolylineToWindow(alignment, input.window) : [alignment]
    if (fragments.length === 0) continue

    dxf.setCurrentLayerName(K1_LAYERS.network)
    for (const fragment of fragments) dxf.addLWPolyline(fragment.map(({ x, y }) => ({ point: { x, y } })))

    const visibleAlignment = [...fragments].sort((left, right) => polylineLength(right) - polylineLength(left))[0]
    const midpoint = polylineMidpoint(visibleAlignment)
    const mx = midpoint.x
    const my = midpoint.y
    const d = input.pipeDiameterMm.get(p.id)
    if (d) {
      const angle = (Math.atan2(midpoint.dy, midpoint.dx) * 180) / Math.PI
      const rotation = angle > 90 || angle < -90 ? angle + 180 : angle
      dxf.setCurrentLayerName(K1_LAYERS.annotation)
      dxf.addText(p3(mx, my + 1.5), 1.8, `Ø${d} безн. L${p.lengthM.toFixed(1)}`, {
        rotation,
        secondAlignmentPoint: p3(mx, my + 1.5),
      })
    }
    // Arrowhead at the midpoint pointing to the downstream (lower-dist) node.
    const downstream = (dist.get(a.id) ?? Infinity) < (dist.get(b.id) ?? Infinity) ? a : b
    const towardB = downstream.id === b.id
    drawFlowArrow(dxf, mx, my, towardB ? midpoint.dx : -midpoint.dx, towardB ? midpoint.dy : -midpoint.dy)
  }

  // Manholes: junctions ВК-n, outlet «Вып.».
  let wk = 0
  const junctions = input.network.nodes
    .filter((n) => n.kind !== 'building' && n.kind !== 'source')
    .sort((x, y) => (dist.get(y.id) ?? 0) - (dist.get(x.id) ?? 0)) // head first
  dxf.setCurrentLayerName(K1_LAYERS.wells)
  for (const n of junctions) {
    if (input.window && !pointInsideWindow(n, input.window)) continue
    dxf.addCircle(p3(n.x, n.y), 1.6)
    dxf.addText(p3(n.x + 2.5, n.y + 2.5), 1.8, `ВК-${++wk}`, {
      secondAlignmentPoint: p3(n.x + 2.5, n.y + 2.5),
    })
  }
  if (outlet && (!input.window || pointInsideWindow(outlet, input.window))) {
    dxf.setCurrentLayerName(K1_LAYERS.outlet)
    dxf.addRectangle({ x: outlet.x - 5, y: outlet.y - 5 }, { x: outlet.x + 5, y: outlet.y + 5 })
    dxf.addText(p3(outlet.x, outlet.y + 7), 2.4, 'Вып.', {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(outlet.x, outlet.y + 7),
    })
  }

  const xs = input.window ? [input.window.minX, input.window.maxX] : input.network.nodes.map((n) => n.x)
  const ys = input.window ? [input.window.minY, input.window.maxY] : input.network.nodes.map((n) => n.y)
  dxf.setCurrentLayerName(K1_LAYERS.annotation)
  const caption = input.sheetTitle ?? 'Сеть К1. План'
  dxf.addText(p3(Math.min(...xs), Math.max(...ys) + 12), 4, `AquaScheme. ${caption}. ${input.projectName}`, {
    secondAlignmentPoint: p3(Math.min(...xs), Math.max(...ys) + 12),
  })
  return dxf.stringify()
}

/**
 * The per-picket PLAN sheet set: the main route is windowed by chainage
 * (bounds on manhole stations, a margin around the sub-path) and each window
 * becomes its own plan sheet with only the network inside the box, titled
 * «План К2 ПК…-ПК…. М1:500» like the professional set.
 */
export function buildPlanSheetSetDxf(input: {
  projectName: string
  network: TracedNetwork
  pipeDiameterMm: Map<string, number>
  /** Vertices of the main collector in order, for chainage windows. */
  mainPath: Array<{ x: number; y: number; chainageM?: number }>
  buildingLabels?: Map<string, string>
  system?: 'sewer' | 'storm'
  targetPerSheetM?: number
  marginM?: number
  /** Approved manhole/profile stations used as the only legal sheet breaks. */
  stationChainagesM?: number[]
}): ProfileSheetFile[] {
  const mark = (input.system ?? 'storm') === 'storm' ? 'К2' : 'К1'
  return planWindows(
    input.mainPath,
    input.targetPerSheetM ?? 550,
    input.marginM ?? 60,
    input.stationChainagesM,
  ).map((w) => {
    const title = `План ${mark} ${w.label}. М1:500`
    return {
      title,
      dxf: buildSewerPlanDxf({
        projectName: input.projectName,
        network: input.network,
        pipeDiameterMm: input.pipeDiameterMm,
        buildingLabels: input.buildingLabels,
        sheetTitle: title,
        window: w,
      }),
    }
  })
}

/** A small arrowhead at (x, y) pointing along the (dx, dy) direction. */
function drawFlowArrow(dxf: DxfWriter, x: number, y: number, dx: number, dy: number): void {
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return
  const ux = dx / len
  const uy = dy / len
  const size = 2.2
  // Two barbs behind the tip.
  const tipX = x + ux * size
  const tipY = y + uy * size
  const leftX = tipX - ux * size - uy * (size * 0.5)
  const leftY = tipY - uy * size + ux * (size * 0.5)
  const rightX = tipX - ux * size + uy * (size * 0.5)
  const rightY = tipY - uy * size - ux * (size * 0.5)
  dxf.addLine(p3(tipX, tipY), p3(leftX, leftY))
  dxf.addLine(p3(tipX, tipY), p3(rightX, rightY))
}

// ============================================================
// Situational scheme (ситуационная схема). GOST 21.704-2011 п. 4.3: drawn
// WITHOUT scale, the designed route highlighted with a thick main line. Fits
// the whole network (and light context) into one A3 sheet; the interactive
// map already shows the route over a city basemap, this is the deliverable.
// ============================================================

const SITUATION_LAYERS = {
  route: 'Ситуация-трасса',
  context: 'Ситуация-подоснова',
  labels: 'Ситуация-подписи',
} as const

/** Draws a segment as a thick main line (three offset strokes). */
function thickLine(dxf: DxfWriter, ax: number, ay: number, bx: number, by: number, w: number): void {
  const len = Math.hypot(bx - ax, by - ay)
  if (len < 1e-9) return
  const px = (-(by - ay) / len) * w
  const py = ((bx - ax) / len) * w
  for (const s of [-1, 0, 1]) {
    dxf.addLine(p3(ax + px * s, ay + py * s), p3(bx + px * s, by + py * s))
  }
}

export function buildSituationDxf(input: SituationInput): string {
  const dxf = new DxfWriter()
  // Colours follow the генплановская «Схема ливневой канализации»: red street
  // context, the designed corridor as a thick BLUE line.
  dxf.addLayer(SITUATION_LAYERS.context, Colors.Red, LineTypes.Continuous)
  dxf.addLayer(SITUATION_LAYERS.route, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(SITUATION_LAYERS.labels, Colors.Black, LineTypes.Continuous)
  const topY = drawSheetFrame(dxf, 'Ситуационная схема', input.projectName)

  // Fit-to-sheet transform (без масштаба): bounding box of all geometry mapped
  // into the content area, preserving aspect ratio.
  const pts: Array<{ x: number; y: number }> = [
    ...input.network.nodes,
    ...input.network.pipes.flatMap((pipe) => pipe.alignment ?? []),
    ...(input.buildings ?? []),
    ...(input.surveyPoints ?? []),
  ]
  if (pts.length === 0) {
    dxf.addText(p3(SHEET_MARGIN + 4, topY - 8), 3, 'Нет данных для схемы', {
      secondAlignmentPoint: p3(SHEET_MARGIN + 4, topY - 8),
    })
    return dxf.stringify()
  }
  const minX = Math.min(...pts.map((p) => p.x))
  const maxX = Math.max(...pts.map((p) => p.x))
  const minY = Math.min(...pts.map((p) => p.y))
  const maxY = Math.max(...pts.map((p) => p.y))
  const boxL = SHEET_MARGIN + 6
  const boxR = SHEET_W - SHEET_MARGIN - 6
  const boxB = SHEET_MARGIN + 36 // leave room for the title block
  const boxT = topY - 8
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((boxR - boxL) / spanX, (boxT - boxB) / spanY)
  const cx = (boxL + boxR) / 2 - ((minX + maxX) / 2) * scale
  const cy = (boxB + boxT) / 2 - ((minY + maxY) / 2) * scale
  const tx = (x: number) => cx + x * scale
  const ty = (y: number) => cy + y * scale

  const nodeById = new Map(input.network.nodes.map((n) => [n.id, n]))

  // Light context: survey base and buildings.
  dxf.setCurrentLayerName(SITUATION_LAYERS.context)
  for (const s of input.surveyPoints ?? []) {
    const x = tx(s.x)
    const y = ty(s.y)
    dxf.addLine(p3(x - 0.8, y), p3(x + 0.8, y))
    dxf.addLine(p3(x, y - 0.8), p3(x, y + 0.8))
  }
  for (const b of input.buildings ?? []) {
    dxf.addRectangle({ x: tx(b.x) - 1.2, y: ty(b.y) - 0.9 }, { x: tx(b.x) + 1.2, y: ty(b.y) + 0.9 })
  }

  // Designed route: thick main line (проектируемый участок, п. 4.3).
  dxf.setCurrentLayerName(SITUATION_LAYERS.route)
  for (const p of input.network.pipes) {
    const a = nodeById.get(p.fromNode)
    const b = nodeById.get(p.toNode)
    if (!a || !b) continue
    const alignment = orderedPipeAlignment(p, a, b)
    for (let index = 1; index < alignment.length; index++) {
      thickLine(
        dxf,
        tx(alignment[index - 1].x), ty(alignment[index - 1].y),
        tx(alignment[index].x), ty(alignment[index].y),
        0.35,
      )
    }
  }
  // Diameter labels rotated along the route (генплановская manner).
  if (input.pipeDiameterMm) {
    dxf.setCurrentLayerName(SITUATION_LAYERS.labels)
    let last = 0
    for (const p of input.network.pipes) {
      const d = input.pipeDiameterMm.get(p.id)
      const a = nodeById.get(p.fromNode)
      const b = nodeById.get(p.toNode)
      if (!d || !a || !b || d === last) continue
      last = d
      const midpoint = polylineMidpoint(orderedPipeAlignment(p, a, b))
      const mx = tx(midpoint.x)
      const my = ty(midpoint.y)
      let angle = (Math.atan2(midpoint.dy, midpoint.dx) * 180) / Math.PI
      if (angle > 90 || angle < -90) angle += 180
      dxf.addText(p3(mx, my + 1.2), 2, `Ø${d}`, {
        rotation: angle,
        secondAlignmentPoint: p3(mx, my + 1.2),
      })
    }
  }

  // Source / outlet marker and label.
  const src = input.network.nodes.find((n) => n.kind === 'source')
  if (src) {
    const label = input.systemType === 'water' ? 'ВОС' : 'Выпуск'
    dxf.setCurrentLayerName(SITUATION_LAYERS.route)
    dxf.addCircle(p3(tx(src.x), ty(src.y)), 2)
    dxf.setCurrentLayerName(SITUATION_LAYERS.labels)
    dxf.addText(p3(tx(src.x) + 3, ty(src.y) + 3), 2.6, label, {
      secondAlignmentPoint: p3(tx(src.x) + 3, ty(src.y) + 3),
    })
  }

  // North arrow, top-left of the content area.
  const nx = boxL + 6
  const ny = boxT - 4
  dxf.setCurrentLayerName(SITUATION_LAYERS.labels)
  dxf.addLine(p3(nx, ny - 8), p3(nx, ny))
  dxf.addLine(p3(nx, ny), p3(nx - 1.6, ny - 2.4))
  dxf.addLine(p3(nx, ny), p3(nx + 1.6, ny - 2.4))
  dxf.addText(p3(nx, ny + 1.5), 2.4, 'С', {
    horizontalAlignment: TextHorizontalAlignment.Center,
    secondAlignmentPoint: p3(nx, ny + 1.5),
  })

  // Legend (условные обозначения), bottom-left as on the генплановская scheme.
  const lgX = boxL + 2
  let lgY = boxB + 16
  dxf.setCurrentLayerName(SITUATION_LAYERS.labels)
  dxf.addText(p3(lgX, lgY), 2.2, 'Условные обозначения', { secondAlignmentPoint: p3(lgX, lgY) })
  lgY -= 5
  dxf.setCurrentLayerName(SITUATION_LAYERS.context)
  dxf.addLine(p3(lgX, lgY + 0.8), p3(lgX + 10, lgY + 0.8))
  dxf.setCurrentLayerName(SITUATION_LAYERS.labels)
  dxf.addText(p3(lgX + 12, lgY), 1.8, 'подоснова (здания, красные линии)', { secondAlignmentPoint: p3(lgX + 12, lgY) })
  lgY -= 5
  dxf.setCurrentLayerName(SITUATION_LAYERS.route)
  thickLine(dxf, lgX, lgY + 0.8, lgX + 10, lgY + 0.8, 0.35)
  dxf.setCurrentLayerName(SITUATION_LAYERS.labels)
  dxf.addText(p3(lgX + 12, lgY), 1.8, 'коридор сетей (проектируемая трасса)', { secondAlignmentPoint: p3(lgX + 12, lgY) })
  lgY -= 5
  dxf.setCurrentLayerName(SITUATION_LAYERS.route)
  dxf.addRectangle({ x: lgX + 3, y: lgY - 0.5 }, { x: lgX + 7, y: lgY + 2 })
  dxf.setCurrentLayerName(SITUATION_LAYERS.labels)
  dxf.addText(p3(lgX + 12, lgY), 1.8, 'выпуск / очистные сооружения', { secondAlignmentPoint: p3(lgX + 12, lgY) })

  dxf.setCurrentLayerName(SHEET_LAYER)
  dxf.addText(p3(SHEET_MARGIN + 2, topY - 3), 2, `Без масштаба${shortClause('drawing.generalData')}. Проектируемый участок выделен толстой линией`, {
    secondAlignmentPoint: p3(SHEET_MARGIN + 2, topY - 3),
  })
  return dxf.stringify()
}

// ============================================================
// Sewer (К1) general data sheet. Mirrors the professional НК album's sheet 2:
// the working-drawing list, referenced documents, general notes and the
// «Перечень видов работ, для которых необходимо составление актов
// освидетельствования работ (согласно СП РК 4.01-103-2013)» — transcribed
// verbatim from the album (the norm regulates the acts; the list names them).
// ============================================================

const SEWER_SUPERVISION_ACTS: string[] = [
  'Подготовка оснований под трубопроводы.',
  'Величина зазоров и выполнение уплотнений стыковых соединений.',
  'Герметизация мест проходки труб через стенки колодцев и камер.',
  'Испытание колодцев безнапорной канализации на герметичность.',
  'Проверка прямолинейности безнапорных труб, а также инструментальная проверка лотков в колодцах.',
  'Проведение предварительного (до засыпки) гидравлического испытания безнапорного трубопровода на герметичность.',
  'Проведение приемочного гидравлического испытания безнапорного трубопровода на герметичность.',
  'Обратная засыпка трубопроводов с уплотнением.',
  'Обследование телевизионной инспекцией при помощи телеинспекционного комплекса.',
]

export interface SewerGeneralDataInput {
  projectName: string
  schedule: SewerSchedule
  outletFlowLps: number
  maxDepthM: number
}

/** «Общие данные» sheet for the К1 set: ведомости, показатели, указания, акты. */
export function buildSewerGeneralDataDxf(input: SewerGeneralDataInput): string {
  const dxf = new DxfWriter()
  let y = drawSheetFrame(dxf, 'Общие данные (К1)', input.projectName)
  const x0 = SHEET_MARGIN + 4
  const rightX = SHEET_W - SHEET_MARGIN - 4
  const midX = SHEET_MARGIN + 150
  const sub = (s: string, x = x0): number => {
    dxf.addText(p3(x, y), 3, s, { secondAlignmentPoint: p3(x, y) })
    return y - 6
  }
  const line = (s: string, x = x0, h = 2): number => {
    dxf.addText(p3(x + 2, y), h, s, { secondAlignmentPoint: p3(x + 2, y) })
    return y - 4.6
  }

  y = sub('Ведомость рабочих чертежей основного комплекта')
  y = drawTextTable(
    dxf, x0, y, [0, 20], midX - 8,
    ['Лист', 'Наименование'],
    [
      ['1', 'Общие данные'],
      ['2', 'Ситуационная схема'],
      ['3', 'План сети К1'],
      ['4', 'Продольный профиль сети К1'],
      ['5', 'Ведомость колодцев и труб'],
    ],
  ) - 6

  y = sub('Основные показатели сети К1')
  y = drawTextTable(
    dxf, x0, y, [0, 90], midX - 8,
    ['Показатель', 'Значение'],
    [
      ['Расчетный расход на выпуске, л/с', input.outletFlowLps.toFixed(2)],
      ['Протяженность сети, м', String(input.schedule.totalPipeLengthM)],
      ['Колодцев на главном коллекторе, шт', String(input.schedule.manholes.length)],
      ['Наибольшая глубина заложения, м', input.maxDepthM.toFixed(2)],
    ],
  ) - 6

  y = sub('Общие указания')
  for (const s of [
    `Гидравлический расчет выполнен по СН РК 4.01-03-2013${shortClause('sewer.velocity.min')}.`,
    `Наполнение не более 0,8; скорости самоочищающие${shortClause('sewer.filling.max')}.`,
    `Глубина заложения от промерзания${shortClause('sewer.depth.min')}.`,
    'Материал труб, основание и поэлементный расход колодцев принимаются по проекту',
    '(типовой проект ТПР 902-09-22.84). Код продукции — по каталогу АГСК-3.',
  ]) y = line(s)

  // Right column: referenced documents and the supervision acts list.
  let yr = SHEET_H - SHEET_MARGIN - 16
  const subR = (s: string): void => {
    dxf.addText(p3(midX, yr), 3, s, { secondAlignmentPoint: p3(midX, yr) })
    yr -= 6
  }
  const lineR = (s: string, h = 1.8): void => {
    dxf.addText(p3(midX + 2, yr), h, s, { secondAlignmentPoint: p3(midX + 2, yr) })
    yr -= 4.2
  }
  subR('Перечень видов работ, для которых необходимо составление')
  subR('актов освидетельствования работ (СП РК 4.01-103-2013)')
  SEWER_SUPERVISION_ACTS.forEach((act, i) => lineR(`${i + 1}. ${act}`))
  yr -= 3
  subR('Ссылочные и прилагаемые документы')
  for (const d of NORM_DOCUMENTS.filter((dd) => dd.status === 'verified').slice(0, 12)) {
    lineR(`${d.code} — ${d.title.slice(0, 70)}`)
  }
  void rightX
  return dxf.stringify()
}
