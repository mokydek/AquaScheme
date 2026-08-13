import type {
  GravityProfile,
  Borehole,
  CrossingRecord,
  RouteConstraintInput,
  SelectedManholeConstruction,
  SewerSchedule,
  SurveyPoint,
  TracedNetwork,
  WorkingDrawingAlbumPage,
  WorkingDrawingSet,
  WorkingDrawingSheet,
} from '@aquascheme/engine'
import { contoursFromSurvey } from '@aquascheme/engine'
import type { ContourResult } from '@aquascheme/engine'
import { buildPlanSheetScene, clipPlanPolyline } from './planScene'
import type { PlanPipeDesign } from './planScene'
import { buildTitleBlock } from './titleBlock'
import type { TitleBlockSignatory } from './titleBlock'

export interface ProjectAlbumInput {
  projectName: string
  projectCode: string
  system: 'sewer' | 'storm'
  network: TracedNetwork
  profile: GravityProfile
  schedule: SewerSchedule
  drawingSet: WorkingDrawingSet
  surveyPoints: SurveyPoint[]
  boreholes?: Borehole[]
  /** Confirmed maximum perpendicular distance from the design axis for profile geology. */
  geologyMaxOffsetM?: number
  constraints?: (RouteConstraintInput & { crossings?: CrossingRecord[] }) | null
  manholeConstructions: SelectedManholeConstruction[]
  pipeDiameterMm: Map<string, number>
  /** Calculated per-pipe values used by plan annotations. */
  pipeDesign?: Map<string, PlanPipeDesign>
  outletFlowLps: number
  buildingLabels?: Map<string, string>
  /** Графа 9 основной надписи: организация, разработавшая документ. */
  organisation?: string
  /** Графы 10, 11, 13: характер работы, фамилия и дата. Подписи не рисуются. */
  signatories?: TitleBlockSignatory[]
}

type PdfNode = Record<string, unknown>
type PathPoint = { x: number; y: number; chainageM: number }
type AlbumPageFormat = WorkingDrawingAlbumPage['pageFormat']
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type SvgPoint = { x: number; y: number }
type SvgProjector = (point: { x: number; y: number }) => SvgPoint

const PDF_POINTS_PER_MM = 72 / 25.4
const PAGE_MARGINS: [number, number, number, number] = [30, 28, 30, 52]
const PLAN_SCALE_DENOMINATOR = 500
const PROFILE_HORIZONTAL_SCALE_DENOMINATOR = 500
const PROFILE_VERTICAL_SCALE_DENOMINATOR = 100

/** Physical paper distance occupied by one model metre at the requested scale. */
export function scaleMillimetresPerMetre(denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) throw new Error('Знаменатель масштаба должен быть положительным числом.')
  return 1000 / denominator
}

/** Rotate source coordinates into a local sheet axis without changing distances. */
export function localAxisCoordinates(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): SvgPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const ux = length > 1e-9 ? dx / length : 1
  const uy = length > 1e-9 ? dy / length : 0
  const rx = point.x - start.x
  const ry = point.y - start.y
  return { x: rx * ux + ry * uy, y: -rx * uy + ry * ux }
}

function pdfPageSize(format: AlbumPageFormat): string | { width: number; height: number } {
  if (!Number.isFinite(format.widthMm) || !Number.isFinite(format.heightMm) || format.widthMm <= 0 || format.heightMm <= 0) {
    throw new Error('Некорректный формат листа в манифесте альбома.')
  }
  if (format.format === 'A3' && format.widthMm === 420 && format.heightMm === 297) return 'A3'
  return { width: format.widthMm * PDF_POINTS_PER_MM, height: format.heightMm * PDF_POINTS_PER_MM }
}

/**
 * Ориентация страницы — по объявленным сторонам листа.
 *
 * pdfmake нормализует явно заданный размер под объявленную ориентацию: у
 * «landscape» он делает ширину не меньше высоты. Постоянный «landscape»
 * поэтому переворачивал листы, которые по расчёту выше своей ширины.
 */
function pdfPageOrientation(format: AlbumPageFormat): 'portrait' | 'landscape' {
  return format.heightMm > format.widthMm ? 'portrait' : 'landscape'
}

function manifestPageForSheet(input: ProjectAlbumInput, sheet: WorkingDrawingSheet): WorkingDrawingAlbumPage {
  const page = input.drawingSet.manifest.pages.find((item) => item.sheetId === sheet.id)
  if (!page) throw new Error(`Лист ${sheet.id} отсутствует в манифесте альбома.`)
  return page
}

function drawingViewport(format: AlbumPageFormat) {
  const fitWidth = format.widthMm * PDF_POINTS_PER_MM - PAGE_MARGINS[0] - PAGE_MARGINS[2]
  const fitHeight = format.heightMm * PDF_POINTS_PER_MM - PAGE_MARGINS[1] - PAGE_MARGINS[3] - 36
  const canvasHeight = 500
  const canvasWidth = canvasHeight * fitWidth / Math.max(fitHeight, 1)
  const physicalHeightMm = fitHeight / PDF_POINTS_PER_MM
  const svgUnitsPerMm = canvasHeight / physicalHeightMm
  return { fitWidth, fitHeight, canvasWidth, canvasHeight, svgUnitsPerMm }
}

function intersectsBounds(points: Array<{ x: number; y: number }>, bounds: Bounds): boolean {
  if (points.length === 0) return false
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  return Number.isFinite(minX) && maxX >= bounds.minX && minX <= bounds.maxX && maxY >= bounds.minY && minY <= bounds.maxY
}

function sampled<T>(items: T[], maximum: number): T[] {
  const stride = Math.max(1, Math.ceil(items.length / Math.max(maximum, 1)))
  return items.filter((_, index) => index % stride === 0).slice(0, maximum)
}

function picket(chainageM: number): string {
  const pk = Math.floor(chainageM / 100)
  const rest = Math.round((chainageM - pk * 100) * 100) / 100
  return rest === 0 ? `ПК${pk}` : `ПК${pk}+${rest}`
}

function xmlText(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function cadContextSvg(
  constraints: ProjectAlbumInput['constraints'],
  project: SvgProjector,
  bounds: Bounds,
): string {
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => {
      const projected = project(point)
      return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
    })
    .join(' ')
  const contextLines = sampled(
    (constraints?.cadContextLines ?? []).filter((line) => intersectsBounds(line.points, bounds)),
    2400,
  ).map((line) => `<polyline data-cad-context="line" points="${linePoints(line.points)}" fill="none" stroke="#c7c7c7" stroke-width="0.65"/>`).join('')
  const terrainLines = sampled(
    (constraints?.terrainLines ?? []).filter((line) => intersectsBounds(line.points, bounds)),
    1400,
  ).map((line) => `<polyline data-cad-context="terrain" points="${linePoints(line.points)}" fill="none" stroke="#78906d" stroke-width="0.9"/>`).join('')
  const labels = sampled(
    (constraints?.cadTextEntities ?? []).filter((label) =>
      Number.isFinite(label.x) && Number.isFinite(label.y)
      && label.x >= bounds.minX && label.x <= bounds.maxX
      && label.y >= bounds.minY && label.y <= bounds.maxY),
    320,
  ).map((label) => {
    const projected = project(label)
    const tx = projected.x
    const ty = projected.y
    const rotation = Number.isFinite(label.rotationDeg) && label.rotationDeg
      ? ` transform="rotate(${-label.rotationDeg!} ${tx.toFixed(1)} ${ty.toFixed(1)})"`
      : ''
    return `<text data-cad-context="text" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="7" fill="#555"${rotation}>${xmlText(label.text.replaceAll('\\P', ' '))}</text>`
  }).join('')
  const blocks = sampled(
    (constraints?.cadBlockEntities ?? []).filter((block) =>
      Number.isFinite(block.x) && Number.isFinite(block.y)
      && block.x >= bounds.minX && block.x <= bounds.maxX
      && block.y >= bounds.minY && block.y <= bounds.maxY),
    240,
  ).map((block) => {
    const projected = project(block)
    const bx = projected.x
    const by = projected.y
    return `<g data-cad-context="block"><path d="M${(bx - 3).toFixed(1)} ${by.toFixed(1)}H${(bx + 3).toFixed(1)}M${bx.toFixed(1)} ${(by - 3).toFixed(1)}V${(by + 3).toFixed(1)}" stroke="#555" stroke-width="0.8"/><text x="${(bx + 4).toFixed(1)}" y="${(by - 3).toFixed(1)}" font-size="6.5" fill="#555">${xmlText(block.name)}</text></g>`
  }).join('')
  return contextLines + terrainLines + blocks + labels
}

/**
 * Горизонтали считаются один раз на альбом и сразу по всей съёмке.
 *
 * Полистный расчёт был бы неверен: треугольники на краю окна у соседних листов
 * получились бы разными, и горизонталь на склейке не сошлась бы. Поэтому
 * поверхность строится по всем точкам, а лист лишь вырезает своё окно.
 */
const albumContourCache = new WeakMap<SurveyPoint[], ContourResult>()

function albumContours(points: SurveyPoint[]): ContourResult {
  const cached = albumContourCache.get(points)
  if (cached) return cached
  const built = contoursFromSurvey(points)
  albumContourCache.set(points, built)
  return built
}

/**
 * Горизонтали на лист плана.
 *
 * Это единственные горизонтали с известной отметкой: линейная графика рельефа
 * из чертежа приходит без отметок (проверено на обоих реальных объектах — ни
 * кода 38, ни Z у вершин), поэтому подписать её нечем. Выведенные из съёмки
 * подписываются, и каждая пятая проводится утолщённой.
 */
function contourSvg(relief: ContourResult, project: SvgProjector, bounds: Bounds): string {
  if (relief.lines.length === 0) return ''
  const parts: string[] = []
  const labelled: Array<{ x: number; y: number }> = []
  for (const line of relief.lines) {
    for (const fragment of clipPlanPolyline(line.points, bounds)) {
      const projected = fragment.map(project)
      if (projected.length < 2) continue
      parts.push(
        `<polyline data-contour="${line.levelM}" points="${projected
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}"`
        + ` fill="none" stroke="#8a6b3d" stroke-width="${line.index ? 1.1 : 0.6}"`
        + ' stroke-linejoin="round" stroke-opacity="0.85"/>',
      )
      if (!line.index || projected.length < 3) continue
      // Подпись ставится на утолщённой горизонтали и разворачивается по её
      // направлению — как на топоплане. Рядом стоящие подписи пропускаются,
      // иначе на пологом участке они слипаются в кашу.
      const middle = projected[Math.floor(projected.length / 2)]
      if (labelled.some((mark) => Math.hypot(mark.x - middle.x, mark.y - middle.y) < 90)) continue
      labelled.push(middle)
      const before = projected[Math.floor(projected.length / 2) - 1]
      let angle = Math.atan2(middle.y - before.y, middle.x - before.x) * 180 / Math.PI
      if (angle > 90 || angle < -90) angle += 180
      parts.push(
        `<g transform="translate(${middle.x.toFixed(1)} ${middle.y.toFixed(1)}) rotate(${angle.toFixed(1)})">`
        + '<rect x="-11" y="-4.5" width="22" height="9" fill="#fff" fill-opacity="0.9"/>'
        + `<text x="0" y="2.5" text-anchor="middle" font-size="6.5" fill="#8a6b3d">${line.levelM.toFixed(2)}</text></g>`,
      )
    }
  }
  return parts.join('')
}

interface LabelBox { x: number; y: number; w: number; h: number }

/**
 * Учёт занятых мест на листе.
 *
 * Подписи размещались вслепую: у труб было разведение по расстоянию, у колодцев
 * — жёсткое чередование сторон, у пикетов ничего. На реальном листе Станкевича
 * это давало наложения — обозначение колодца поверх отметки съёмки, пикет
 * поверх подписи участка. Читать такой чертёж нельзя.
 *
 * Подписи исходной подосновы резервируются первыми: это данные съёмки, и
 * закрывать их своими надписями нельзя.
 */
function labelPlacer() {
  /** Наши подписи: перекрывать друг друга им нельзя. */
  const own: LabelBox[] = []
  /** Подписи подосновы: перекрывать нежелательно, но допустимо. */
  const source: LabelBox[] = []
  const overlaps = (box: LabelBox, list: LabelBox[]) => list.some((other) =>
    box.x < other.x + other.w && other.x < box.x + box.w
    && box.y < other.y + other.h && other.y < box.y + box.h)
  return {
    reserveSource(box: LabelBox) { source.push(box) },
    /**
     * Ставит подпись в первое место, не задевающее ничего; если такого нет —
     * в первое, не задевающее наши подписи.
     *
     * Два уровня, потому что обозначение участка и колодца — содержание листа,
     * а отметки подосновы — контекст под ним. Ронять подпись участка ради
     * отметки съёмки нельзя: чертёж без диаметра и длины участка дефектен, а
     * подписи идут на белой подложке и остаются читаемыми поверх.
     */
    place(candidates: LabelBox[]): LabelBox | null {
      for (const box of candidates) {
        if (!overlaps(box, own) && !overlaps(box, source)) { own.push(box); return box }
      }
      for (const box of candidates) {
        if (!overlaps(box, own)) { own.push(box); return box }
      }
      return null
    },
  }
}

function planSvg(
  input: ProjectAlbumInput,
  sheet: WorkingDrawingSheet,
  canvasWidth = 1000,
  svgUnitsPerMm = 1,
): string {
  const window = sheet.window
  if (!window) {
    throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая геометрия плана.`)
  }
  const topo = input.surveyPoints.filter((point) =>
    point.x >= window.minX && point.x <= window.maxX && point.y >= window.minY && point.y <= window.maxY)
  const scene = buildPlanSheetScene({
    sheet,
    drawingSet: input.drawingSet,
    network: input.network,
    schedule: input.schedule,
    pipeDiameterMm: input.pipeDiameterMm,
    pipeDesign: input.pipeDesign,
    buildingLabels: input.buildingLabels,
    constraints: input.constraints,
    surveyPointCountInWindow: topo.length,
  })
  if (!scene) throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая геометрия плана.`)
  const sourcePath = scene.sourcePath
  const path = scene.selectedPath
  const axisStart = path[0]
  const axisEnd = path[path.length - 1]
  const windowCorners = [
    { x: window.minX, y: window.minY },
    { x: window.minX, y: window.maxY },
    { x: window.maxX, y: window.minY },
    { x: window.maxX, y: window.maxY },
  ].map((point) => localAxisCoordinates(point, axisStart, axisEnd))
  const localMinX = Math.min(...windowCorners.map((point) => point.x))
  const localMinY = Math.min(...windowCorners.map((point) => point.y))
  const localMaxY = Math.max(...windowCorners.map((point) => point.y))
  const unitsPerMetre = scaleMillimetresPerMetre(PLAN_SCALE_DENOMINATOR) * svgUnitsPerMm
  const project: SvgProjector = (point) => {
    const local = localAxisCoordinates(point, axisStart, axisEnd)
    return {
      x: 45 + (local.x - localMinX) * unitsPerMetre,
      y: 235 - (local.y - (localMinY + localMaxY) / 2) * unitsPerMetre,
    }
  }
  const route = path.map((point) => {
    const projected = project(point)
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
  }).join(' ')
  const linePoints = (points: Array<{ x: number; y: number }>) => points.map((point) => {
    const projected = project(point)
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
  }).join(' ')
  const context = cadContextSvg(input.constraints, project, {
    minX: window.minX,
    maxX: window.maxX,
    minY: window.minY,
    maxY: window.maxY,
  })
  const constraints = [
    context,
    ...(input.constraints?.hardObstacleRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d7d7d7" stroke="#555"/>`),
    ...(input.constraints?.buildingPolygons ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d7d7d7" stroke="#555"/>`),
    ...(input.constraints?.parcelRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" stroke="#777" stroke-width="0.8" stroke-dasharray="3 2"/>`),
    ...(input.constraints?.forbiddenRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#f6d7d7" fill-opacity="0.5" stroke="#b42318" stroke-width="1.2"/>`),
    ...[...(input.constraints?.protectionZoneRings ?? []), ...(input.constraints?.protectionZones ?? [])].map((ring) => `<polygon points="${linePoints(ring)}" fill="#fff1d6" fill-opacity="0.35" stroke="#c07800" stroke-width="1" stroke-dasharray="7 4"/>`),
    ...[...(input.constraints?.approvedCrossingRings ?? []), ...(input.constraints?.approvedCrossingZones ?? [])].map((ring) => `<polygon points="${linePoints(ring)}" fill="#dff5e7" fill-opacity="0.4" stroke="#168047" stroke-width="1.2" stroke-dasharray="5 3"/>`),
    ...(input.constraints?.waterRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d8f1f8" stroke="#2685b5"/>`),
    ...(input.constraints?.corridorRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" stroke="#d33232" stroke-width="1.5" stroke-dasharray="8 5"/>`),
    ...(input.constraints?.roadLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#8b734f" stroke-width="3"/>`),
    ...(input.constraints?.waterLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#2685b5" stroke-width="2"/>`),
    ...(input.constraints?.utilityLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#9b2c8c" stroke-width="1.5" stroke-dasharray="6 4"/>`),
    ...(input.constraints?.redLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#d22" stroke-width="2"/>`),
    ...(input.constraints?.guideLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#168047" stroke-width="1.3" stroke-dasharray="7 3"/>`),
    ...(input.constraints?.hardObstacles ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#333" stroke-width="2"/>`),
  ].join('')
  const relief = albumContours(input.surveyPoints)
  const contours = contourSvg(relief, project, {
    minX: window.minX,
    maxX: window.maxX,
    minY: window.minY,
    maxY: window.maxY,
  })
  const stride = Math.max(1, Math.ceil(topo.length / 360))
  const topoSvg = topo.filter((_, index) => index % stride === 0).map((point, index) => {
    const projected = project(point)
    const label = index % 14 === 0
      ? `<text x="${(projected.x + 3).toFixed(1)}" y="${(projected.y - 3).toFixed(1)}" font-size="7" fill="#666">${point.z.toFixed(2)}</text>`
      : ''
    return `<circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="1" fill="#666"/>${label}`
  }).join('')
  const networkPipes = scene.pipes.map((pipe) => pipe.fragments.map((fragment) => {
    const points = linePoints(fragment)
    const stroke = pipe.active ? '#1746b5' : '#4776bd'
    const width = pipe.active ? 3.2 : 1.6
    return `<polyline data-plan-pipe="${xmlText(pipe.pipeId)}" points="${points}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`
  }).join('')).join('')
  const placer = labelPlacer()
  // Подписи съёмки и обозначения блоков занимают место первыми: это исходные
  // данные, и закрывать их своими надписями нельзя.
  for (const entity of (input.constraints?.cadTextEntities ?? [])) {
    if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue
    if (entity.x < window.minX || entity.x > window.maxX) continue
    if (entity.y < window.minY || entity.y > window.maxY) continue
    const projected = project(entity)
    placer.reserveSource({
      x: projected.x, y: projected.y - 7,
      w: Math.max(18, String(entity.text ?? '').length * 3.6), h: 9,
    })
  }

  const nodeMarks = scene.nodes.map((node) => {
    const projected = project(node)
    const label = xmlText(node.label)
    const labelWidth = Math.max(28, node.label.length * 5.2)
    const symbol = node.kind === 'source'
      ? `<rect x="${(projected.x - 4).toFixed(1)}" y="${(projected.y - 4).toFixed(1)}" width="8" height="8" fill="#fff" stroke="#1746b5" stroke-width="2"/>`
      : `<circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="4" fill="#fff" stroke="#1746b5" stroke-width="2"/>`
    // Восемь мест вокруг колодца: справа-сверху, слева-сверху, справа-снизу и
    // так далее. Обозначение колодца обязано остаться на листе, поэтому если
    // свободного места нет, подпись ставится в первое предложенное — лучше
    // наложение, чем неопознанный колодец.
    const candidates = [
      { dx: 8, dy: -22 }, { dx: -labelWidth - 8, dy: -22 },
      { dx: 8, dy: 10 }, { dx: -labelWidth - 8, dy: 10 },
      { dx: 8, dy: -36 }, { dx: -labelWidth - 8, dy: -36 },
      { dx: 8, dy: 24 }, { dx: -labelWidth - 8, dy: 24 },
    ].map((offset) => ({
      x: projected.x + offset.dx, y: projected.y + offset.dy, w: labelWidth, h: 13,
    }))
    // Колодец обязан быть опознан, поэтому при полной тесноте подпись всё
    // равно ставится в первое предложенное место.
    const box = placer.place(candidates) ?? candidates[0]
    const leaderY = box.y + (box.y < projected.y ? 13 : 0)
    return `<g data-plan-node="${xmlText(node.id)}">${symbol}<path d="M${projected.x.toFixed(1)} ${projected.y.toFixed(1)}L${(box.x + labelWidth / 2).toFixed(1)} ${leaderY.toFixed(1)}" stroke="#333" stroke-width="0.7"/><rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${labelWidth.toFixed(1)}" height="13" fill="#fff" stroke="#555" stroke-width="0.6"/><text x="${(box.x + 3).toFixed(1)}" y="${(box.y + 9).toFixed(1)}" font-size="7.5">${label}</text></g>`
  }).join('')
  const pipeLabels = scene.pipes.map((pipe) => {
    const projected = project(pipe.labelPoint)
    const w = Math.max(44, pipe.label.length * 4.6)
    // Подпись повёрнута вдоль трубы, поэтому занимает габарит повёрнутого
    // прямоугольника, а не квадрат по большей стороне: у вертикального участка
    // это полоса 13 × 44, и квадрат 44 × 44 отнимал бы у обозначения колодца
    // всё место вокруг.
    const radians = pipe.labelAngleDeg * Math.PI / 180
    const cos = Math.abs(Math.cos(radians))
    const sin = Math.abs(Math.sin(radians))
    const boxW = w * cos + 13 * sin
    const boxH = w * sin + 13 * cos
    // Подпись участка несёт диаметр, уклон и длину — без неё лист дефектен,
    // поэтому при полной тесноте она ставится поверх подосновы, на белой
    // подложке.
    const candidates = [-8, 13, -24, 29, -40, 45].map((dy) => ({
      x: projected.x - boxW / 2, y: projected.y + dy - boxH / 2, w: boxW, h: boxH,
    }))
    const box = placer.place(candidates) ?? candidates[0]
    const dy = box.y + boxH / 2 - projected.y
    return `<g data-plan-pipe-label="${xmlText(pipe.pipeId)}" transform="translate(${projected.x.toFixed(1)} ${(projected.y + dy).toFixed(1)}) rotate(${-pipe.labelAngleDeg.toFixed(2)})"><rect x="-3" y="-9" width="${w.toFixed(1)}" height="13" fill="#fff" fill-opacity="0.9" stroke="#1746b5" stroke-width="0.5"/><text x="1" y="0" font-size="7.5" fill="#1746b5">${xmlText(pipe.label)}</text></g>`
  }).join('')

  const stationMarks = scene.stations.map((station) => {
    const projected = project(station)
    const matchLine = station.boundary
      ? `<line x1="${projected.x.toFixed(1)}" y1="55" x2="${projected.x.toFixed(1)}" y2="425" stroke="#d33" stroke-width="0.8" stroke-dasharray="5 4"/>`
      : ''
    const mark = `${matchLine}<g data-plan-station="${station.chainageM.toFixed(2)}"><line x1="${projected.x.toFixed(1)}" y1="${(projected.y - 6).toFixed(1)}" x2="${projected.x.toFixed(1)}" y2="${(projected.y + 6).toFixed(1)}" stroke="#111" stroke-width="0.8"/><circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="2.2" fill="#fff" stroke="#1746b5"/>`
    // Штрих пикета остаётся всегда, подпись — только если для неё есть место:
    // пикетаж читается и по соседним подписям, а мешанина не читается вовсе.
    const width = Math.max(24, station.label.length * 4.6)
    const box = placer.place([
      { x: projected.x + 4, y: projected.y - 15, w: width, h: 10 },
      { x: projected.x - width - 4, y: projected.y - 15, w: width, h: 10 },
      { x: projected.x + 4, y: projected.y + 6, w: width, h: 10 },
      { x: projected.x - width - 4, y: projected.y + 6, w: width, h: 10 },
    ])
    if (box === null) return `${mark}</g>`
    return `${mark}<text x="${box.x.toFixed(1)}" y="${(box.y + 8).toFixed(1)}" font-size="7.5" font-weight="700">${xmlText(station.label)}</text></g>`
  }).join('')
  const missingContext = scene.hasPlanContext ? '' : `<g data-plan-context-missing="true"><rect x="${(canvasWidth / 2 - 170).toFixed(1)}" y="27" width="340" height="30" fill="#fff4dc" stroke="#c07800" stroke-width="1.2"/><text x="${(canvasWidth / 2).toFixed(1)}" y="40" text-anchor="middle" font-size="9" font-weight="700" fill="#8a4c00">НЕПОЛНЫЙ ПЛАН: топографическая/CAD-подоснова отсутствует</text><text x="${(canvasWidth / 2).toFixed(1)}" y="51" text-anchor="middle" font-size="7" fill="#8a4c00">Показана расчётная сеть; финальный выпуск должен оставаться заблокированным</text></g>`
  const overview = sourcePath
  const minX = Math.min(...overview.map((point) => point.x))
  const maxX = Math.max(...overview.map((point) => point.x))
  const minY = Math.min(...overview.map((point) => point.y))
  const maxY = Math.max(...overview.map((point) => point.y))
  const overviewScale = Math.min(135 / Math.max(maxX - minX, 1), 78 / Math.max(maxY - minY, 1))
  const ox = (value: number) => canvasWidth - 175 + (value - minX) * overviewScale
  const oy = (value: number) => 110 - (value - minY) * overviewScale
  const axisRotationDeg = Math.atan2(axisEnd.y - axisStart.y, axisEnd.x - axisStart.x) * 180 / Math.PI

  /**
   * Врезка положения листа.
   *
   * Показывает ВСЮ трассу и прямоугольник границ текущего листа: инженер по
   * ней понимает, какой кусок объекта перед ним. Прежде во врезке была только
   * ломаная текущего участка — по ней положение читается плохо, а подосновы не
   * было вовсе.
   *
   * Подоснова во врезке прорежена жёстко: она здесь фон, а не чертёж, и полные
   * четырнадцать тысяч линий сделали бы её чёрным пятном.
   */
  const insetBounds = {
    minX: Math.min(...path.map((point) => point.x)),
    maxX: Math.max(...path.map((point) => point.x)),
    minY: Math.min(...path.map((point) => point.y)),
    maxY: Math.max(...path.map((point) => point.y)),
  }
  const INSET_CONTEXT_LIMIT = 400
  const insetSource = input.constraints?.cadContextLines ?? []
  const insetStride = Math.max(1, Math.ceil(insetSource.length / INSET_CONTEXT_LIMIT))
  const insetContext = insetSource
    .filter((_, index) => index % insetStride === 0)
    .map((line) => line.points)
    .filter((points) => points.length >= 2)
    .map((points) => `<polyline points="${points.map((point) => `${ox(point.x).toFixed(1)},${oy(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#dcdcdc" stroke-width="0.4"/>`)
    .join('')
  const insetFrame = `<rect data-inset-sheet-bounds="true" x="${Math.min(ox(insetBounds.minX), ox(insetBounds.maxX)).toFixed(1)}" y="${Math.min(oy(insetBounds.minY), oy(insetBounds.maxY)).toFixed(1)}" width="${Math.max(2, Math.abs(ox(insetBounds.maxX) - ox(insetBounds.minX))).toFixed(1)}" height="${Math.max(2, Math.abs(oy(insetBounds.maxY) - oy(insetBounds.minY))).toFixed(1)}" fill="none" stroke="#d33" stroke-width="1.2" stroke-dasharray="3 2"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} 500" data-horizontal-scale-denominator="${PLAN_SCALE_DENOMINATOR}" data-horizontal-mm-per-meter="${scaleMillimetresPerMetre(PLAN_SCALE_DENOMINATOR)}" data-svg-units-per-mm="${svgUnitsPerMm}" data-local-axis-rotation-deg="${axisRotationDeg.toFixed(6)}"><defs><clipPath id="work-${sheet.sheetNumber}"><rect x="35" y="15" width="${canvasWidth - 70}" height="445"/></clipPath></defs><rect width="${canvasWidth}" height="500" fill="#fff"/><rect x="35" y="15" width="${canvasWidth - 70}" height="445" fill="none" stroke="#111"/><g clip-path="url(#work-${sheet.sheetNumber})">${constraints}${contours}${topoSvg}${networkPipes}<polyline data-plan-route="true" points="${route}" fill="none" stroke="#1746b5" stroke-width="4.8" stroke-linejoin="round"/>${stationMarks}${nodeMarks}${pipeLabels}</g>${missingContext}<g transform="translate(55 45)"><path d="M0 28 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/><text x="0" y="-5" text-anchor="middle" font-size="10">С</text></g><g transform="translate(0 -20)"><rect x="${canvasWidth - 190}" y="35" width="150" height="90" fill="#fff" stroke="#111"/>${insetContext}<polyline points="${overview.map((point) => `${ox(point.x).toFixed(1)},${oy(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#999" stroke-width="1"/><polyline points="${path.map((point) => `${ox(point.x).toFixed(1)},${oy(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#1746b5" stroke-width="3"/>${insetFrame}<text x="${canvasWidth - 183}" y="120" font-size="7">Положение листа</text></g><g transform="translate(42 414)" font-size="7"><rect x="0" y="0" width="310" height="39" fill="#fff" fill-opacity="0.94" stroke="#888"/><line x1="8" y1="11" x2="34" y2="11" stroke="#1746b5" stroke-width="4"/><text x="40" y="14">проектная ось</text><circle cx="132" cy="11" r="3" fill="#fff" stroke="#1746b5"/><text x="140" y="14">колодец / камера</text><line x1="222" y1="11" x2="248" y2="11" stroke="#d33" stroke-dasharray="5 4"/><text x="254" y="14">граница листа</text><line x1="8" y1="28" x2="34" y2="28" stroke="#9b2c8c" stroke-dasharray="5 3"/><text x="40" y="31">существующая сеть</text><line x1="132" y1="28" x2="158" y2="28" stroke="#78906d"/><text x="164" y="31">рельеф / подоснова</text><line x1="222" y1="28" x2="248" y2="28" stroke="#8a6b3d" stroke-width="1.1"/><text x="254" y="31">${relief.lines.length > 0 ? `горизонтали, сечение ${relief.stepM} м` : 'горизонтали не построены'}</text></g><text x="40" y="485" font-size="8">Основание: ${scene.contextFeatureCount} объектов CAD/топоподосновы; ${topo.length} отметок в окне; ${scene.pipes.length} участков сети. ${relief.lines.length > 0 ? `Горизонтали через ${relief.stepM} м выведены по ${input.surveyPoints.length} отметкам съёмки.` : xmlText(relief.reason)} Масштаб 1:${PLAN_SCALE_DENOMINATOR}.</text></svg>`
}

function networkPlanSvg(input: ProjectAlbumInput, sheet: WorkingDrawingSheet): string {
  const networkPaths = input.drawingSet.networkPaths
  const routePoints = networkPaths.flatMap((path) => path.points)
  if (routePoints.length < 2) throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая геометрия сети.`)
  // Fit to the confirmed network, not to remote DWG frames/title blocks.
  // Context is clipped to this engineering viewport below.
  const rawMinX = Math.min(...routePoints.map((point) => point.x))
  const rawMaxX = Math.max(...routePoints.map((point) => point.x))
  const rawMinY = Math.min(...routePoints.map((point) => point.y))
  const rawMaxY = Math.max(...routePoints.map((point) => point.y))
  const margin = Math.max(Math.max(rawMaxX - rawMinX, rawMaxY - rawMinY) * 0.04, 60)
  const minX = rawMinX - margin
  const maxX = rawMaxX + margin
  const minY = rawMinY - margin
  const maxY = rawMaxY + margin
  const scale = Math.min(900 / Math.max(maxX - minX, 1), 410 / Math.max(maxY - minY, 1))
  const x = (value: number) => 45 + (value - minX) * scale
  const y = (value: number) => 445 - (value - minY) * scale
  const project: SvgProjector = (point) => ({ x: x(point.x), y: y(point.y) })
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .map((point) => `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`)
    .join(' ')
  const context = cadContextSvg(input.constraints, project, { minX, maxX, minY, maxY })
  const constraints = [
    context,
    ...(input.constraints?.hardObstacleRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#e2e2e2" stroke="#555"/>`),
    ...(input.constraints?.waterRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d8f1f8" stroke="#2685b5"/>`),
    ...(input.constraints?.corridorRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" stroke="#d33232" stroke-width="1.5" stroke-dasharray="8 5"/>`),
    ...(input.constraints?.roadLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#8b734f" stroke-width="3"/>`),
    ...(input.constraints?.waterLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#2685b5" stroke-width="2"/>`),
    ...(input.constraints?.utilityLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#9b2c8c" stroke-width="1.5" stroke-dasharray="6 4"/>`),
    ...(input.constraints?.redLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#d22" stroke-width="2"/>`),
  ].join('')
  const topo = input.surveyPoints.filter((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)
  const topoStride = Math.max(1, Math.ceil(topo.length / 420))
  const topoSvg = topo.filter((_, index) => index % topoStride === 0)
    .map((point) => `<circle cx="${x(point.x).toFixed(1)}" cy="${y(point.y).toFixed(1)}" r="1" fill="#777"/>`)
    .join('')
  let lastLabel: { x: number; y: number; diameterMm?: number } | null = null
  const minimumLabelDistance = 72
  const networkSvg = networkPaths.map((path, index) => {
    const middle = path.points[Math.floor(path.points.length / 2)]
    const diameter = input.pipeDiameterMm.get(path.pipeId)
    const labelX = x(middle.x)
    const labelY = y(middle.y)
    const distanceFromLastLabel = lastLabel ? Math.hypot(labelX - lastLabel.x, labelY - lastLabel.y) : Number.POSITIVE_INFINITY
    const diameterChanged = lastLabel !== null && diameter !== lastLabel.diameterMm
    const showLabel = index === 0 || diameterChanged || distanceFromLastLabel >= minimumLabelDistance
    if (showLabel) lastLabel = { x: labelX, y: labelY, diameterMm: diameter }
    const label = showLabel
      ? `<text data-network-label="true" x="${(labelX + 5).toFixed(1)}" y="${(labelY - 5).toFixed(1)}" font-size="8" fill="#1746b5">${xmlText(path.pipeId)}${diameter ? ` · Ø${diameter}` : ''}</text>`
      : ''
    return `<polyline data-network-pipe="${xmlText(path.pipeId)}" points="${linePoints(path.points)}" fill="none" stroke="#1746b5" stroke-width="4" stroke-linejoin="round"/>${label}`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><defs><clipPath id="network-${sheet.sequence}"><rect x="35" y="15" width="930" height="445"/></clipPath></defs><rect width="1000" height="500" fill="#fff"/><rect x="35" y="15" width="930" height="445" fill="none" stroke="#111"/><g clip-path="url(#network-${sheet.sequence})">${constraints}${topoSvg}${networkSvg}</g><g transform="translate(55 45)"><path d="M0 28 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/><text x="0" y="-5" text-anchor="middle" font-size="10">С</text></g><text x="40" y="485" font-size="8">Сводный план построен по ${networkPaths.length} подтверждённым полилиниям сети; прямые хорды не используются в финальном выпуске.</text></svg>`
}

function profileStationAt(profile: GravityProfile, chainageM: number) {
  const exact = profile.stations.find((station) => Math.abs(station.chainageM - chainageM) <= 1e-6)
  if (exact) return { ...exact }
  if (chainageM <= profile.stations[0].chainageM) return { ...profile.stations[0], chainageM }
  for (let index = 1; index < profile.stations.length; index++) {
    const b = profile.stations[index]
    if (b.chainageM >= chainageM) {
      const a = profile.stations[index - 1]
      const ratio = (chainageM - a.chainageM) / Math.max(b.chainageM - a.chainageM, 1e-9)
      return {
        ...a,
        nodeId: `${a.nodeId}:${b.nodeId}:${chainageM}`,
        chainageM,
        groundElevationM: a.groundElevationM + (b.groundElevationM - a.groundElevationM) * ratio,
        invertElevationM: a.invertElevationM + (b.invertElevationM - a.invertElevationM) * ratio,
        depthM: a.depthM + (b.depthM - a.depthM) * ratio,
        diameterMm: ratio < 0.5 ? a.diameterMm : b.diameterMm,
      }
    }
  }
  return { ...profile.stations[profile.stations.length - 1], chainageM }
}

function nearestPathProjection(
  path: PathPoint[],
  x: number,
  y: number,
): { chainageM: number; distanceM: number } | null {
  if (path.length < 2) return null
  let nearest: { distance: number; chainageM: number } | null = null
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]
    const b = path[index]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const ratio = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared))
    const projectedX = a.x + ratio * dx
    const projectedY = a.y + ratio * dy
    const distance = Math.hypot(x - projectedX, y - projectedY)
    const chainageM = a.chainageM + ratio * (b.chainageM - a.chainageM)
    if (!nearest || distance < nearest.distance) nearest = { distance, chainageM }
  }
  return nearest ? { chainageM: nearest.chainageM, distanceM: nearest.distance } : null
}

function boreholeProfileProjection(
  input: ProjectAlbumInput,
  borehole: Borehole,
  profilePath: PathPoint[],
): { chainageM: number; distanceM: number } | null {
  const maxOffsetM = input.geologyMaxOffsetM
  if (!Number.isFinite(maxOffsetM) || Number(maxOffsetM) <= 0) return null
  if (!Number.isFinite(borehole.x) || !Number.isFinite(borehole.y) || borehole.layers.length === 0) return null
  const projection = nearestPathProjection(profilePath, borehole.x!, borehole.y!)
  if (!projection || projection.distanceM > Number(maxOffsetM) + 1e-9) return null
  return projection
}

function profilePlanPath(input: ProjectAlbumInput, sheet: WorkingDrawingSheet, profile: GravityProfile): PathPoint[] {
  const expectedId = sheet.profileId ? `branch:${sheet.profileId}` : 'main'
  const exact = input.drawingSet.planPaths.find((path) => path.id === expectedId)
  if (exact?.points.length && exact.points.length >= 2) return exact.points

  const profilePipeIds = new Set(profile.pipeIds)
  const matching = input.drawingSet.planPaths.filter((path) => (
    path.points.length >= 2
    && path.pipeIds.length === profilePipeIds.size
    && path.pipeIds.every((pipeId) => profilePipeIds.has(pipeId))
  ))
  if (matching.length === 1) return matching[0].points
  // Legacy sets did not expose planPaths; only the governing main profile may
  // use their mainPath. A branch must never borrow main-profile geometry.
  return sheet.profileId ? [] : input.drawingSet.mainPath
}

export function crossingBelongsToProfile(
  crossing: CrossingRecord,
  profileId: string | undefined,
  pipeIds: readonly string[],
): boolean {
  const taggedByProfile = Boolean(crossing.profileId)
  const taggedByPipe = Boolean(crossing.pipeId)
  if (!taggedByProfile && !taggedByPipe) return profileId === undefined
  const activeProfileId = profileId ?? 'main'
  if (taggedByProfile && crossing.profileId !== activeProfileId) return false
  if (taggedByPipe && !pipeIds.includes(crossing.pipeId!)) return false
  return true
}

function profileCrossings(input: ProjectAlbumInput, sheet: WorkingDrawingSheet, profile: GravityProfile): CrossingRecord[] {
  return (input.constraints?.crossings ?? []).filter((crossing) => (
    crossingBelongsToProfile(crossing, sheet.profileId, profile.pipeIds)
  ))
}

function profileSvg(
  input: ProjectAlbumInput,
  sheet: WorkingDrawingSheet,
  canvasWidth = 1000,
  svgUnitsPerMm = 1,
): string {
  const profile = sheet.profileData ?? input.profile
  const fromM = sheet.interval?.fromM ?? 0
  const toM = sheet.interval?.toM ?? profile.totalLengthM
  const stations = [
    profileStationAt(profile, fromM),
    ...profile.stations.filter((station) => station.chainageM > fromM && station.chainageM < toM),
    profileStationAt(profile, toM),
  ]
  if (stations.length < 2) throw new Error(`Лист ${sheet.sheetNumber}: недостаточно станций профиля.`)
  const profilePath = profilePlanPath(input, sheet, profile)
  const activeCrossings = profileCrossings(input, sheet, profile)
    .filter((crossing) => crossing.stationM >= fromM && crossing.stationM <= toM)
  const activeBoreholes = (input.boreholes ?? []).flatMap((borehole) => {
    if (!Number.isFinite(borehole.mouthElevationM)) return []
    const projection = boreholeProfileProjection(input, borehole, profilePath)
    if (!projection || projection.chainageM < fromM || projection.chainageM > toM) return []
    return [{ borehole, projection }]
  })
  // Диапазон условного горизонта считается по станциям профиля. Пересечения
  // и колонки скважин, выходящие за полосу, обрезаются рамкой чертежа: их
  // включение в подбор базы дробило бы лист на десятки горизонтов.
  const horizontalUnitsPerMetre = scaleMillimetresPerMetre(PROFILE_HORIZONTAL_SCALE_DENOMINATOR) * svgUnitsPerMm
  const verticalUnitsPerMetre = scaleMillimetresPerMetre(PROFILE_VERTICAL_SCALE_DENOMINATOR) * svgUnitsPerMm
  const x = (chainageM: number) => 185 + (chainageM - fromM) * horizontalUnitsPerMetre
  if (x(toM) > canvasWidth - 35 + 1e-6) {
    throw new Error(`Лист ${sheet.sheetNumber}: ширины рулонного листа недостаточно для масштаба профиля 1:${PROFILE_HORIZONTAL_SCALE_DENOMINATOR}.`)
  }

  /**
   * Смена условного горизонта внутри листа.
   *
   * Высота рулонного листа постоянна (297 мм у эталона), а вертикальный
   * масштаб — 1:100, поэтому графическая полоса вмещает ограниченный перепад
   * отметок. Когда трасса выходит за него, чертёж НЕ растягивают и лист не
   * растят: базовая отметка ступенью переходит на новую круглую величину,
   * линия профиля разрывается вертикальным скачком, и рядом подписывается
   * новый условный горизонт. Это обычный приём продольного профиля.
   *
   * Базы кратны пяти метрам — так они читаются и так подписаны у эталона
   * (330, 333, 335 на разных листах его альбома).
   */
  const bandMetres = (330 - 35) / verticalUnitsPerMetre
  const DATUM_STEP_M = 5
  const roundDatum = (elevationM: number) => Math.floor(elevationM / DATUM_STEP_M) * DATUM_STEP_M
  type DatumSegment = {
    fromM: number; toM: number; datumM: number; lowM: number; highM: number; stations: typeof stations
  }
  const segments: DatumSegment[] = []
  for (const station of stations) {
    const low = Math.min(station.invertElevationM, station.groundElevationM)
    const high = Math.max(station.invertElevationM, station.groundElevationM)
    const current = segments[segments.length - 1]
    if (current !== undefined) {
      // База берётся по САМОЙ НИЗКОЙ точке участка, а не по первой станции:
      // иначе нисходящий профиль выпадал бы из полосы на второй же станции и
      // горизонт менялся бы там, где перепад ещё помещается.
      const lowM = Math.min(current.lowM, low)
      const highM = Math.max(current.highM, high)
      if (highM - roundDatum(lowM - 1) <= bandMetres + 1e-9) {
        current.toM = station.chainageM
        current.lowM = lowM
        current.highM = highM
        current.datumM = roundDatum(lowM - 1)
        current.stations.push(station)
        continue
      }
    }
    segments.push({
      fromM: station.chainageM,
      toM: station.chainageM,
      datumM: roundDatum(low - 1),
      lowM: low,
      highM: high,
      stations: [station],
    })
  }
  const datumAt = (chainageM: number) => {
    for (const segment of segments) {
      if (chainageM >= segment.fromM - 1e-9 && chainageM <= segment.toM + 1e-9) return segment.datumM
    }
    return segments[0]?.datumM ?? 0
  }
  const y = (elevationM: number, chainageM: number) =>
    330 - (elevationM - datumAt(chainageM)) * verticalUnitsPerMetre

  // Каждый сегмент — своя ломаная: разрыв между ними и есть скачок горизонта.
  const polyline = (pick: (station: typeof stations[number]) => number) => segments
    .map((segment) => segment.stations
      .map((station) => `${x(station.chainageM).toFixed(1)},${y(pick(station), station.chainageM).toFixed(1)}`)
      .join(' '))
    .filter((points) => points.trim() !== '')
  const ground = polyline((station) => station.groundElevationM)
  const invert = polyline((station) => station.invertElevationM)
  const datumMarks = segments.map((segment) => {
    const markX = x(segment.fromM)
    return `<line data-datum-break="true" x1="${markX.toFixed(1)}" y1="35" x2="${markX.toFixed(1)}" y2="330" stroke="#c07800" stroke-width="0.8" stroke-dasharray="4 3"/>`
      + `<text data-datum-label="true" x="${(markX + 3).toFixed(1)}" y="46" font-size="7" fill="#8a4c00">УГ ${segment.datumM.toFixed(2)}</text>`
  }).join('')
  const manholeByNodeId = new Map(input.schedule.manholes.flatMap((manhole) => (
    manhole.nodeId ? [[manhole.nodeId, manhole.label] as const] : []
  )))
  const columns = stations.map((station) => {
    const stationPicket = picket(station.chainageM)
    const label = manholeByNodeId.get(station.nodeId) ?? station.nodeId
    return `<line x1="${x(station.chainageM)}" y1="${y(station.groundElevationM, station.chainageM)}" x2="${x(station.chainageM)}" y2="${y(station.invertElevationM, station.chainageM)}" stroke="#111"/><line x1="${x(station.chainageM)}" y1="350" x2="${x(station.chainageM)}" y2="500" stroke="#bbb"/><text x="${x(station.chainageM)}" y="367" text-anchor="middle" font-size="8">${station.invertElevationM.toFixed(2)}</text><text x="${x(station.chainageM)}" y="392" text-anchor="middle" font-size="8">${station.groundElevationM.toFixed(2)}</text><text x="${x(station.chainageM)}" y="417" text-anchor="middle" font-size="8">${station.diameterMm}</text><text x="${x(station.chainageM)}" y="484" text-anchor="middle" font-size="7">${xmlText(label)}</text><text x="${x(station.chainageM)}" y="496" text-anchor="middle" font-size="7">${stationPicket}</text>`
  }).join('')
  const segmentValues = stations.slice(1).map((station, index) => {
    const previous = stations[index]
    const lengthM = Math.max(station.chainageM - previous.chainageM, 0)
    const slopePermille = lengthM > 0 ? ((previous.invertElevationM - station.invertElevationM) / lengthM) * 1000 : 0
    const centerX = x((previous.chainageM + station.chainageM) / 2)
    return `<text x="${centerX}" y="442" text-anchor="middle" font-size="7">${slopePermille.toFixed(2)}‰ / ${lengthM.toFixed(2)} м</text><text x="${centerX}" y="467" text-anchor="middle" font-size="7">${lengthM.toFixed(2)}</text>`
  }).join('')
  // Выноски пересечений разводятся по ярусам.
  //
  // Обе строки писались на постоянной высоте, поэтому на плотном участке
  // соседние выноски накладывались: на профиле Станкевича 36 пересечений
  // сливались в нечитаемую полосу. Ярусы — обычный приём профиля: подпись
  // отъезжает вверх по своей же выносной линии.
  const crossingPlacer = labelPlacer()
  const crossings = activeCrossings
    .map((crossing) => {
      const crossingX = x(crossing.stationM)
      const designY = Number.isFinite(crossing.designInvertElevationM) ? y(crossing.designInvertElevationM!, crossing.stationM) : 315
      const existingY = Number.isFinite(crossing.existingElevationM) ? y(crossing.existingElevationM!, crossing.stationM) : 65
      const title = `${crossing.id} · ${crossing.kind}`
      const clearance = `просвет ${Number.isFinite(crossing.clearanceM) ? crossing.clearanceM!.toFixed(2) + ' м' : 'нет данных'}`
      const width = Math.max(title.length, clearance.length) * 3.5 + 6
      const lanes = [48, 72, 96, 120, 144, 168]
      const candidates = lanes.map((top) => ({ x: crossingX + 5, y: top, w: width, h: 22 }))
      const box = crossingPlacer.place(candidates) ?? candidates[0]
      return `<line x1="${crossingX}" y1="45" x2="${crossingX}" y2="335" stroke="#9b2c8c" stroke-width="1.5" stroke-dasharray="5 4"/>`
        + `<circle cx="${crossingX}" cy="${designY}" r="4" fill="#fff" stroke="#9b2c8c"/>`
        + `<path d="M${crossingX - 5} ${existingY} L${crossingX + 5} ${existingY}" stroke="#9b2c8c" stroke-width="2"/>`
        // Белая подложка под ярусом: выносные линии соседних пересечений
        // проходят сквозь подпись и без неё её не прочесть.
        + `<rect x="${(box.x - 2).toFixed(1)}" y="${(box.y - 1).toFixed(1)}" width="${width.toFixed(1)}" height="21" fill="#fff" fill-opacity="0.88"/>`
        + `<text x="${box.x.toFixed(1)}" y="${(box.y + 7).toFixed(1)}" font-size="7" fill="#7c226f">${xmlText(title)}</text>`
        + `<text x="${box.x.toFixed(1)}" y="${(box.y + 18).toFixed(1)}" font-size="7" fill="#7c226f">${xmlText(clearance)}</text>`
    }).join('')
  const geology = activeBoreholes.flatMap(({ borehole, projection }) => {
    const chainageM = projection.chainageM
    const boreholeX = x(chainageM)
    const mouthElevationM = borehole.mouthElevationM!
    const deepest = Math.max(...borehole.layers.map((layer) => layer.bottomDepthM))
    const layerLines = borehole.layers.map((layer) => {
      const boundaryY = y(mouthElevationM - layer.bottomDepthM, chainageM)
      const middleY = y(mouthElevationM - (layer.topDepthM + layer.bottomDepthM) / 2, chainageM)
      return `<line x1="${boreholeX - 5}" y1="${boundaryY}" x2="${boreholeX + 5}" y2="${boundaryY}" stroke="#7a5a32"/><text x="${boreholeX + 6}" y="${middleY}" font-size="6" fill="#6b4c2b">ИГЭ-${xmlText(layer.igeCode ?? '—')}</text>`
    }).join('')
    const water = Number.isFinite(borehole.water.depthM)
      ? `<line x1="${boreholeX - 7}" y1="${y(mouthElevationM - borehole.water.depthM!, chainageM)}" x2="${boreholeX + 7}" y2="${y(mouthElevationM - borehole.water.depthM!, chainageM)}" stroke="#2685b5" stroke-width="2"/><text x="${boreholeX - 9}" y="${y(mouthElevationM - borehole.water.depthM!, chainageM) - 2}" text-anchor="end" font-size="6" fill="#2685b5">УГВ</text>`
      : ''
    return [`<line x1="${boreholeX}" y1="${y(mouthElevationM, chainageM)}" x2="${boreholeX}" y2="${y(mouthElevationM - deepest, chainageM)}" stroke="#7a5a32" stroke-width="2"/>${layerLines}${water}<text x="${boreholeX}" y="${y(mouthElevationM, chainageM) - 5}" text-anchor="middle" font-size="7" fill="#6b4c2b">${xmlText(borehole.label)}</text>`]
  }).join('')
  const rows = ['Отметка лотка, м', 'Отметка земли, м', 'Диаметр, мм', 'Уклон / длина', 'Расстояние, м', 'Колодец / ПК']
  const table = rows.map((label, index) => `<rect x="35" y="${350 + index * 25}" width="${canvasWidth - 70}" height="25" fill="none" stroke="#111"/><line x1="160" y1="${350 + index * 25}" x2="160" y2="${375 + index * 25}" stroke="#111"/><text x="42" y="${367 + index * 25}" font-size="8">${label}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} 500" data-horizontal-scale-denominator="${PROFILE_HORIZONTAL_SCALE_DENOMINATOR}" data-horizontal-mm-per-meter="${scaleMillimetresPerMetre(PROFILE_HORIZONTAL_SCALE_DENOMINATOR)}" data-vertical-scale-denominator="${PROFILE_VERTICAL_SCALE_DENOMINATOR}" data-vertical-mm-per-meter="${scaleMillimetresPerMetre(PROFILE_VERTICAL_SCALE_DENOMINATOR)}" data-svg-units-per-mm="${svgUnitsPerMm}"><defs><clipPath id="profile-${sheet.sheetNumber}"><rect x="160" y="35" width="${canvasWidth - 195}" height="300"/></clipPath></defs><rect width="${canvasWidth}" height="500" fill="#fff"/><text x="35" y="22" font-size="9">Условный горизонт ${segments.map((segment) => segment.datumM.toFixed(2)).join(', ')} м · масштаб гор. 1:${PROFILE_HORIZONTAL_SCALE_DENOMINATOR}, верт. 1:${PROFILE_VERTICAL_SCALE_DENOMINATOR}</text><g clip-path="url(#profile-${sheet.sheetNumber})">${ground.map((points) => `<polyline data-profile-ground="true" points="${points}" fill="none" stroke="#6c5134" stroke-width="2.5"/>`).join('')}${invert.map((points) => `<polyline data-profile-invert="true" points="${points}" fill="none" stroke="#1746b5" stroke-width="3.5"/>`).join('')}${datumMarks}${geology}${crossings}</g>${columns}${table}${segmentValues}</svg>`
}

function basicTable(headers: string[], rows: Array<Array<string | number>>, widths?: Array<number | string>): PdfNode {
  return {
    table: {
      headerRows: 1,
      widths: widths ?? headers.map(() => '*'),
      body: [headers.map((text) => ({ text, bold: true, fillColor: '#eeeeee' })), ...rows.map((row) => row.map((text) => ({ text: String(text) })))],
    },
    layout: 'lightHorizontalLines',
    fontSize: 8,
  }
}

function generalDataOverviewSvg(input: ProjectAlbumInput): string {
  const path = input.drawingSet.mainPath
  if (path.length < 2) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 430"><rect width="420" height="430" fill="#fff" stroke="#111"/><text x="210" y="215" text-anchor="middle" font-size="12">Нет подтверждённой геометрии трассы</text></svg>'
  }
  const constraintPoints = [
    ...(input.constraints?.hardObstacleRings ?? []).flat(),
    ...(input.constraints?.waterRings ?? []).flat(),
    ...(input.constraints?.corridorRings ?? []).flat(),
    ...(input.constraints?.roadLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.waterLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.utilityLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.redLines ?? []).flatMap((line) => line.points),
  ]
  const allPoints = [...path, ...constraintPoints]
  const minX = Math.min(...allPoints.map((point) => point.x))
  const maxX = Math.max(...allPoints.map((point) => point.x))
  const minY = Math.min(...allPoints.map((point) => point.y))
  const maxY = Math.max(...allPoints.map((point) => point.y))
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const scale = Math.min(365 / width, 350 / height)
  const x = (value: number) => 28 + (value - minX) * scale
  const y = (value: number) => 385 - (value - minY) * scale
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .map((point) => `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`)
    .join(' ')
  const constraints = [
    ...(input.constraints?.hardObstacleRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#e5e5e5" stroke="#555"/>`),
    ...(input.constraints?.waterRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d8f1f8" stroke="#2685b5"/>`),
    ...(input.constraints?.corridorRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" stroke="#d33232" stroke-width="1.5" stroke-dasharray="7 4"/>`),
    ...(input.constraints?.roadLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#8b734f" stroke-width="3"/>`),
    ...(input.constraints?.waterLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#2685b5" stroke-width="2"/>`),
    ...(input.constraints?.utilityLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#9b2c8c" stroke-width="1.5" stroke-dasharray="5 3"/>`),
    ...(input.constraints?.redLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#d22" stroke-width="2"/>`),
  ].join('')
  const route = linePoints(path)
  const first = path[0]
  const last = path[path.length - 1]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 430"><rect x="1" y="1" width="418" height="428" fill="#fff" stroke="#111"/><text x="210" y="22" text-anchor="middle" font-size="13" font-weight="700">Ситуационная схема</text><g>${constraints}<polyline points="${route}" fill="none" stroke="#1746b5" stroke-width="5" stroke-linejoin="round"/><circle cx="${x(first.x)}" cy="${y(first.y)}" r="5" fill="#fff" stroke="#1746b5" stroke-width="2"/><circle cx="${x(last.x)}" cy="${y(last.y)}" r="5" fill="#1746b5"/><text x="${x(first.x) + 7}" y="${y(first.y) - 7}" font-size="9">Начало трассы</text><text x="${x(last.x) - 7}" y="${y(last.y) - 7}" text-anchor="end" font-size="9">Выпуск</text></g><g transform="translate(26 44)"><path d="M0 28 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/><text x="0" y="-5" text-anchor="middle" font-size="10">С</text></g><g transform="translate(16 398)"><line x1="0" y1="0" x2="24" y2="0" stroke="#1746b5" stroke-width="4"/><text x="31" y="3" font-size="8">проектная ось</text><line x1="130" y1="0" x2="154" y2="0" stroke="#d33232" stroke-dasharray="6 3"/><text x="161" y="3" font-size="8">ограничения</text></g></svg>`
}

function generalDataPage(input: ProjectAlbumInput): PdfNode {
  const spatialBoreholes = (input.boreholes ?? []).filter((borehole) =>
    boreholeProfileProjection(input, borehole, input.drawingSet.mainPath) !== null)
  const crossings = input.constraints?.crossings ?? []
  const verifiedSources = new Map<string, { label: string; available: boolean; verified: boolean; detail: string }>()
  for (const sheet of input.drawingSet.sheets) {
    for (const source of sheet.sources) {
      const current = verifiedSources.get(source.requirement)
      verifiedSources.set(source.requirement, {
        label: source.label,
        available: current ? current.available && source.available : source.available,
        verified: current ? current.verified && source.verified : source.verified,
        detail: source.detail ?? current?.detail ?? '—',
      })
    }
  }
  const sourceRows = [...verifiedSources.values()].map((source) => [
    source.label,
    source.detail,
    source.available ? 'есть' : 'нет',
    source.verified ? 'проверено' : 'не проверено',
  ])
  const generalNotes = [
    'Плановое положение сети формируется только по подтверждённым полилиниям оси и пространственным ограничениям исходного проекта.',
    'Отметки земли принимаются из топографической поверхности; отметки лотка, уклоны и диаметры — из текущего расчёта.',
    'Планы, профили, ведомости и спецификации используют одну инженерную модель и пересчитываются совместно после изменения входных данных.',
    'Неподтверждённые исходные данные не заменяются значениями из эталонного альбома и блокируют зависимые листы.',
    'Окончательные проектные решения подлежат проверке ответственным инженером и согласованию в установленном порядке.',
  ]
  return {
    pageBreak: 'before',
    stack: [
      {
        table: {
          widths: [920, 70],
          body: [[
            { text: 'Общие данные', bold: true, fontSize: 13 },
            { text: 'Лист 2', alignment: 'right', fontSize: 9 },
          ]],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 8],
      },
      {
        columns: [
          {
            width: 640,
            stack: [
              { text: 'Общие указания', bold: true, fontSize: 11, margin: [0, 0, 0, 6] },
              { ul: generalNotes, fontSize: 8.5, margin: [0, 0, 0, 10] },
              { text: 'Основные показатели', bold: true, fontSize: 11, margin: [0, 2, 0, 6] },
              basicTable(['Показатель', 'Значение'], [
                ['Система', input.system === 'storm' ? 'ливневая канализация К2' : 'бытовая канализация К1'],
                ['Участки сети', input.network.pipes.length],
                ['Протяжённость, м', input.schedule.totalPipeLengthM.toFixed(2)],
                ['Расход на выпуске, л/с', input.outletFlowLps.toFixed(2)],
                ['Точки топографической съёмки', input.surveyPoints.length],
                ['Скважины с координатами', spatialBoreholes.length],
                ['Карточки пересечений', crossings.length],
                ['Хэш расчётных исходных данных', input.drawingSet.inputHash],
              ], [260, '*']),
              { text: 'Готовность источников', bold: true, fontSize: 11, margin: [0, 10, 0, 6] },
              basicTable(['Раздел', 'Состав', 'Наличие', 'Проверка'], sourceRows, [145, '*', 65, 82]),
            ],
          },
          {
            width: '*',
            stack: [{ svg: generalDataOverviewSvg(input), fit: [370, 430] }],
          },
        ],
        columnGap: 18,
      },
    ],
  }
}

function sheetPage(sheet: WorkingDrawingSheet, body: PdfNode[], format: AlbumPageFormat): PdfNode {
  const designation = `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}`
  const header = {
    table: {
      widths: ['*', 90],
      body: [[
        { text: sheet.title, bold: true, fontSize: 12 },
        { text: designation, alignment: 'right', fontSize: 9 },
      ]],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 8],
  }
  return {
    section: {
      stack: [
        header,
        ...body,
      ],
    },
    pageSize: pdfPageSize(format),
    pageOrientation: pdfPageOrientation(format),
    pageMargins: PAGE_MARGINS,
  }
}

function servicePage(page: WorkingDrawingAlbumPage, section: PdfNode): PdfNode {
  const normalizedSection = { ...section }
  delete normalizedSection.pageBreak
  return {
    section: normalizedSection,
    pageSize: pdfPageSize(page.pageFormat),
    pageOrientation: pdfPageOrientation(page.pageFormat),
    pageMargins: PAGE_MARGINS,
  }
}

function engineeringFrame(_currentPage: number, pageSize: { width: number; height: number }): PdfNode {
  return {
    canvas: [{
      type: 'rect',
      x: 14,
      y: 14,
      w: Math.max(0, pageSize.width - 28),
      h: Math.max(0, pageSize.height - 28),
      lineWidth: 0.8,
      lineColor: '#222',
    }],
  }
}

/**
 * Основная надпись по форме 3 ГОСТ Р 21.101-2020, прижатая к правому нижнему
 * углу листа — как требует п. 5.2. Прежний вариант был таблицей из пяти
 * колонок без граф изменений и подписей; форма 3 обязательна для листов
 * основного комплекта рабочих чертежей.
 */
function engineeringStamp(
  input: ProjectAlbumInput,
  designation: string,
  currentPage: number,
  totalPages: number,
): PdfNode {
  const sheet = input.drawingSet.manifest.pages[currentPage - 1]
  return {
    margin: [0, 0, 30, 8],
    alignment: 'right',
    columns: [
      { text: '', width: '*' },
      {
        width: 'auto',
        ...buildTitleBlock({
          designation: `${input.projectCode} ${designation}`,
          objectName: input.projectName,
          sheetTitle: sheet?.title ?? input.projectName,
          stage: 'Р',
          sheetNumber: currentPage,
          // Графа 8 заполняется только на первом листе.
          totalSheets: currentPage === 1 ? totalPages : undefined,
          organisation: input.organisation,
          signatories: input.signatories,
        }),
      },
    ],
  }
}

function rangeFor(sheets: WorkingDrawingSheet[], kind: WorkingDrawingSheet['kind']): string {
  const matches = sheets.filter((sheet) => sheet.kind === kind)
  if (matches.length === 0) return '—'
  const code = matches[0].documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'
  return matches.length === 1
    ? `${code}/${matches[0].sheetNumber}`
    : `${code}/${matches[0].sheetNumber}–${matches[matches.length - 1].sheetNumber}`
}

function drawingSheetBody(input: ProjectAlbumInput, sheet: WorkingDrawingSheet, format: AlbumPageFormat): PdfNode[] {
  const viewport = drawingViewport(format)
  if (sheet.kind === 'plan') return [{ svg: planSvg(input, sheet, viewport.canvasWidth, viewport.svgUnitsPerMm), fit: [viewport.fitWidth, viewport.fitHeight] }]
  if (sheet.kind === 'network_plan') return [{ svg: networkPlanSvg(input, sheet), fit: [viewport.fitWidth, viewport.fitHeight] }]
  if (sheet.kind === 'profile') {
    // Лист профиля без интервала — это лист, включённый в состав комплекта, для
    // которого ещё нет данных: например, профиль существующего участка
    // примыкания до загрузки нивелировки. Рисовать нечего, но и обрушивать
    // сборку всего альбома одним незаполненным листом нельзя — печатается лист,
    // честно называющий, чего в нём нет. То же правило, что у плана без
    // подосновы и у защитной сетки без конструкции.
    if (!sheet.interval) {
      return [
        {
          text: 'ЛИСТ НЕ ЗАПОЛНЕН: данных для профиля нет.',
          fontSize: 12, bold: true, color: '#8a4c00', margin: [0, 0, 0, 6],
        },
        {
          text: sheet.blockers[0]?.message
            ?? 'Профиль строится по станциям с отметками; станции не заданы.',
          fontSize: 9, margin: [0, 0, 0, 8],
        },
      ]
    }
    return [{ svg: profileSvg(input, sheet, viewport.canvasWidth, viewport.svgUnitsPerMm), fit: [viewport.fitWidth, viewport.fitHeight] }]
  }
  if (sheet.kind === 'material_table') {
    const range = sheet.dataRange ?? { start: 0, end: input.schedule.manholes.length, total: input.schedule.manholes.length }
    const rows = input.schedule.manholes.slice(range.start, range.end)
    const selectedByLabel = new Map(input.manholeConstructions.map((item) => [item.manholeLabel, item]))
    return [
      { text: 'Количества сформированы из текущей расчётной ведомости и подтверждённого каталога конструкций.', fontSize: 9, margin: [0, 0, 0, 10] },
      basicTable(['Колодец', 'Пикет', 'Глубина, мм', 'Ø трубы, мм', 'Конструкция'], rows.map((row) => [row.label, row.picket, row.depthMm, row.pipeDiameterMm, selectedByLabel.get(row.label)?.typeCode ?? 'не подобрано']), [90, 100, 90, 90, 130]),
    ]
  }
  if (sheet.kind === 'detail') {
    if (sheet.variant === 'protective_grid') {
      const design = input.drawingSet.protectiveGridDesign
      if (!design || !design.verified) {
        // Лист входит в состав комплекта, но чертить нечего: конструкция
        // изделия не подтверждена. Раньше здесь бросалось исключение, и один
        // незаполненный лист обрушивал сборку ВСЕГО альбома — при том что
        // прочие незавершённые листы выпускаются со своим стоп-фактором. Тот
        // же приём, что у плана без подосновы: лист печатается и честно
        // говорит, чего в нём нет.
        return [
          {
            text: 'ЛИСТ НЕ ЗАПОЛНЕН: конструкция защитной сетки не подтверждена.',
            fontSize: 12, bold: true, color: '#8a4c00', margin: [0, 0, 0, 6],
          },
          {
            text: 'Габариты, шаг прутка и количество задаются в составе проектного комплекта '
              + 'и берутся из каталога конструкций. Пока их нет, чертить нечего, и лист '
              + 'остаётся в ведомости незаполненным — он не выдаётся за готовый.',
            fontSize: 9, margin: [0, 0, 0, 8],
          },
        ]
      }
      const drawingWidth = Math.min(650, 320 * design.overallWidthMm / Math.max(design.overallHeightMm, 1))
      const drawingHeight = Math.min(320, 650 * design.overallHeightMm / Math.max(design.overallWidthMm, 1))
      const x0 = 80
      const y0 = 50
      const verticalBars = Math.max(0, Math.floor(design.overallWidthMm / design.barSpacingMm) - 1)
      const horizontalBars = Math.max(0, Math.floor(design.overallHeightMm / design.barSpacingMm) - 1)
      const vertical = Array.from({ length: verticalBars }, (_, index) => {
        const x = x0 + (index + 1) * design.barSpacingMm / design.overallWidthMm * drawingWidth
        return `<line x1="${x.toFixed(2)}" y1="${y0}" x2="${x.toFixed(2)}" y2="${(y0 + drawingHeight).toFixed(2)}" stroke="#111" stroke-width="1"/>`
      }).join('')
      const horizontal = Array.from({ length: horizontalBars }, (_, index) => {
        const y = y0 + (index + 1) * design.barSpacingMm / design.overallHeightMm * drawingHeight
        return `<line x1="${x0}" y1="${y.toFixed(2)}" x2="${(x0 + drawingWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#111" stroke-width="1"/>`
      }).join('')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="430" viewBox="0 0 900 430"><rect width="900" height="430" fill="white"/><rect x="${x0}" y="${y0}" width="${drawingWidth.toFixed(2)}" height="${drawingHeight.toFixed(2)}" fill="none" stroke="#111" stroke-width="4"/>${vertical}${horizontal}<text x="${x0}" y="${(y0 + drawingHeight + 28).toFixed(2)}" font-family="Roboto" font-size="16">Габарит ${xmlText(design.overallWidthMm)}×${xmlText(design.overallHeightMm)} мм; шаг ${xmlText(design.barSpacingMm)} мм</text></svg>`
      return [
        { text: 'Геометрия листа построена только по подтверждённым параметрам изделия.', fontSize: 9, margin: [0, 0, 0, 8] },
        { svg, fit: [760, 320], margin: [0, 0, 0, 8] },
        basicTable(
          ['Параметр', 'Значение'],
          [
            ['Количество', `${design.quantity.toFixed(3)} шт.`],
            ['Рама / стержни', `${design.frameProfile} / ${design.barProfile}`],
            ['Материал / покрытие', `${design.material} / ${design.coating}`],
            ['Крепление', design.fixing],
            ['Источник', design.source],
          ],
          [160, '*'],
        ),
      ]
    }
    return [
      { text: 'Реестр карточек пересечений и готовность исходных данных', fontSize: 10, bold: true, margin: [0, 0, 0, 10] },
      basicTable(
        ['Источник', 'Состав', 'Наличие', 'Проверка'],
        sheet.sources.map((source) => [source.label, source.detail ?? '—', source.available ? 'есть' : 'нет', source.verified ? 'проверено' : 'не проверено']),
        [180, '*', 80, 100],
      ),
    ]
  }
  if (sheet.kind === 'specification') {
    const componentTotals = new Map<string, { name: string; unit: string; code: string; quantity: number }>()
    for (const construction of input.manholeConstructions) {
      for (const component of construction.components) {
        const key = `${component.catalogCode ?? ''}\u0000${component.name}\u0000${component.unit}`
        const current = componentTotals.get(key)
        componentTotals.set(key, {
          name: component.name,
          unit: component.unit,
          code: component.catalogCode ?? '—',
          quantity: (current?.quantity ?? 0) + component.quantity,
        })
      }
    }
    const rows = [
      ...input.schedule.pipes.map((row) => [row.designation, row.agskCode || '—', 'м', row.lengthM.toFixed(2)]),
      ...[...componentTotals.values()].map((row) => [row.name, row.code, row.unit, row.quantity.toFixed(3)]),
    ]
    const range = sheet.dataRange ?? { start: 0, end: rows.length, total: rows.length }
    if (range.total !== rows.length) {
      throw new Error(`Лист ${sheet.sheetNumber}: реестр спецификации устарел (${range.total} строк, модель ${rows.length}).`)
    }
    const selectedRows = rows.slice(range.start, range.end)
    return [
      { text: 'Спецификация пересчитана из текущей инженерной модели и активных каталогов.', fontSize: 9, margin: [0, 0, 0, 10] },
      basicTable(
        ['Поз.', 'Наименование', 'Код', 'Ед.', 'Количество'],
        selectedRows.map((row, index) => [range.start + index + 1, ...row]),
        [45, '*', 100, 55, 90],
      ),
    ]
  }
  throw new Error(`Тип листа ${sheet.kind} ещё не поддерживается экспортом.`)
}

function drawingRegisterColumns(sheets: WorkingDrawingSheet[]): PdfNode {
  const rows = sheets.map((sheet) => [
    `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}`,
    sheet.title,
    sheet.status,
  ])
  const chunks = Array.from({ length: Math.max(1, Math.ceil(rows.length / 18)) }, (_, index) =>
    rows.slice(index * 18, (index + 1) * 18))
  return {
    columns: chunks.map((chunk) => ({
      width: '*',
      stack: [basicTable(['Лист', 'Наименование', 'Статус'], chunk, [72, '*', 75])],
    })),
    columnGap: 12,
    margin: [0, 12, 0, 4],
  }
}

export function buildProjectSheetDoc(input: ProjectAlbumInput, sheetId: string): PdfNode {
  const sheet = input.drawingSet.sheets.find((item) => item.id === sheetId)
  if (!sheet) throw new Error('Лист не найден в текущем реестре.')
  if (sheet.status !== 'VERIFIED') throw new Error(
    `Лист ${sheet.sheetNumber} нельзя выпустить как отдельный финальный документ со статусом ${sheet.status}.`,
  )
  const page = manifestPageForSheet(input, sheet)
  return {
    pageSize: pdfPageSize(page.pageFormat),
    pageOrientation: pdfPageOrientation(page.pageFormat),
    pageMargins: PAGE_MARGINS,
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#111' },
    content: [{
      stack: [
        {
          table: {
            widths: ['*', 90],
            body: [[
              { text: sheet.title, bold: true, fontSize: 12 },
              { text: `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}`, alignment: 'right', fontSize: 9 },
            ]],
          },
          layout: 'noBorders',
          margin: [0, 0, 0, 8],
        },
        ...drawingSheetBody(input, sheet, page.pageFormat),
      ],
    }],
    background: engineeringFrame,
    footer: engineeringStamp(
      input,
      `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}`,
      1,
      1,
    ),
    info: { title: `${input.projectCode} — ${sheet.title}`, subject: 'Отдельный рабочий лист', creator: 'AquaScheme' },
  }
}

/**
 * Кто просит альбом.
 *
 * `release` — экранный выпуск. Шлюз прежний и не ослаблен ни на йоту: пока хоть
 * один лист не `VERIFIED`, альбома не будет.
 *
 * `benchmark` — измерение сходства с эталоном. Пока альбом не собирается,
 * показателя не существует вовсе, и инструмент не мерит прогресс, а лишь
 * подтверждает финиш. Ровно та же болезнь уже лечилась в самом
 * `visual-benchmark.mjs`, где несовпадение числа страниц прекращало работу до
 * всякого измерения.
 *
 * Водяного знака в этом режиме НЕТ намеренно: он отравил бы попиксельное
 * сравнение, ради которого альбом и собирается. Отличимость обеспечивается
 * иначе — статусом каждого листа в метаданных PDF.
 */
export type AlbumBuildMode = 'release' | 'benchmark'

/**
 * Собирает альбом. Режим `benchmark` доступен только через
 * `shared/benchmarkAlbum.ts`; из экранов приложения он недостижим, и это
 * закреплено проверкой.
 */
export function buildAlbumDocument(input: ProjectAlbumInput, mode: AlbumBuildMode): PdfNode {
  if (mode === 'release' && !input.drawingSet.summary.finalExportAllowed) {
    throw new Error(`Финальный выпуск запрещён: заблокировано ${input.drawingSet.summary.blocked}, устарело ${input.drawingSet.summary.stale}.`)
  }
  const totalSheets = input.drawingSet.manifest.pdfPageCount
  const serviceManifestPages = input.drawingSet.manifest.pages.filter((page) => !page.sheetId)
  if (serviceManifestPages.length !== 3) throw new Error('Манифест альбома должен содержать три служебных страницы.')
  const serviceContent: PdfNode[] = [
    {
      stack: [
        { text: 'РАБОЧАЯ ДОКУМЕНТАЦИЯ', alignment: 'center', bold: true, fontSize: 21, margin: [0, 100, 0, 25] },
        { text: input.projectName, alignment: 'center', fontSize: 18, margin: [70, 0, 70, 30] },
        { text: `НАРУЖНЫЕ СЕТИ КАНАЛИЗАЦИИ · ${input.system === 'storm' ? 'К2' : 'К1'}`, alignment: 'center', bold: true, fontSize: 15 },
        { text: input.projectCode, alignment: 'center', fontSize: 28, bold: true, color: '#173f9f', margin: [0, 42, 0, 0] },
        { text: `Хэш исходных данных: ${input.drawingSet.inputHash}`, alignment: 'center', fontSize: 9, color: '#666', margin: [0, 18, 0, 0] },
      ],
    },
    {
      pageBreak: 'before',
      stack: [
        { text: 'Ведомость рабочих чертежей', bold: true, fontSize: 14, margin: [0, 0, 0, 12] },
        basicTable(['Листы', 'Раздел', 'Количество'], [
          ['PDF 1', 'Титульный лист рабочего комплекта', 1],
          ['MAIN/1–2', 'Ведомость рабочих чертежей и общие данные', 2],
          [rangeFor(input.drawingSet.sheets, 'plan'), 'Планы трассы по фактической оси DWG', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'plan').length],
          [rangeFor(input.drawingSet.sheets, 'network_plan'), 'Сводный план всей подтверждённой топологии сети', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'network_plan').length],
          [rangeFor(input.drawingSet.sheets, 'profile'), 'Продольные профили по расчётным отметкам', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'profile').length],
          [rangeFor(input.drawingSet.sheets, 'material_table'), 'Ведомости колодцев и материалов', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'material_table').length],
          [rangeFor(input.drawingSet.sheets, 'detail'), 'Пересечения и конструктивные решения', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'detail').length],
          [rangeFor(input.drawingSet.sheets, 'specification'), 'Спецификации оборудования и материалов', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'specification').length],
        ], [80, '*', 75]),
        drawingRegisterColumns(input.drawingSet.sheets),
        { text: `\nВсего: ${totalSheets} листов. Расчётный расход на выпуске: ${input.outletFlowLps.toFixed(2)} л/с. Протяжённость: ${input.schedule.totalPipeLengthM.toLocaleString('ru-RU')} м.`, fontSize: 10 },
        { text: `\nИсточник плановой геометрии: ${input.network.pipes.length} участков сети, ${input.drawingSet.mainPath.length} вершин оси. Источник рельефа: ${input.surveyPoints.length} точек. Значения эталонного проекта в расчёты не подставлялись.`, fontSize: 9 },
      ],
    },
    generalDataPage(input),
  ]

  const content: PdfNode[] = serviceContent.map((section, index) => servicePage(serviceManifestPages[index], section))

  for (const sheet of input.drawingSet.sheets) {
    const page = manifestPageForSheet(input, sheet)
    content.push(sheetPage(sheet, drawingSheetBody(input, sheet, page.pageFormat), page.pageFormat))
  }

  return {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: PAGE_MARGINS,
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#111' },
    content,
    background: engineeringFrame,
    footer: (currentPage: number) => {
      if (currentPage === 1) return { text: '' }
      const page = input.drawingSet.manifest.pages[currentPage - 1]
      const designation = page?.documentSetCode && page.sheetNumber !== null
        ? `${page.documentSetCode}/${page.sheetNumber}`
        : `PDF ${currentPage}`
      return engineeringStamp(input, designation, currentPage, totalSheets)
    },
    info: {
      title: `${input.projectCode} — ${input.projectName}`,
      subject: mode === 'benchmark'
        ? `Сборка для измерения сходства, НЕ ВЫПУСК, ${totalSheets} листов`
        : `Расчётный комплект рабочих чертежей, ${totalSheets} листов`,
      creator: 'AquaScheme',
      // Статус каждого листа — в метаданных. Ни один лист сборки для измерения
      // не выдаётся за выпущенный: посмотревший файл видит, что перед ним.
      ...(mode === 'benchmark'
        ? {
          keywords: [
            'benchmark',
            `finalExportAllowed=${input.drawingSet.summary.finalExportAllowed}`,
            ...input.drawingSet.sheets.map((sheet) =>
              `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}=${sheet.status}`),
          ].join('; '),
        }
        : {}),
    },
  }
}

/**
 * Экранный выпуск. Поведение не менялось: без `finalExportAllowed` — исключение.
 */
export function buildProjectAlbumDoc(input: ProjectAlbumInput): PdfNode {
  return buildAlbumDocument(input, 'release')
}
