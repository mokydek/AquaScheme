import DxfParser from 'dxf-parser'
import type { ImportPoint, ImportSegment } from './importnet'
import type { ParseIssue, TopoParseResult } from './topography'
import type { SurveyPoint } from './types'

/**
 * Reads an AutoCAD DXF drawing into network import geometry (requirements
 * update 1): straight polylines and deterministically tessellated ARC,
 * CIRCLE, ELLIPSE and SPLINE entities become segments; POINT and INSERT
 * references become markers. INSERT metadata is retained, and block geometry
 * is expanded only when dxf-parser supplied its real definition; missing or
 * recursive definitions remain explicit diagnostics. Entities are grouped by layer so
 * the import dialog can let the user pick which layers carry the network.
 * Heavy dependency (dxf-parser), therefore exported as the subpath
 * @aquascheme/engine/dxfread.
 */

export interface DxfLayerInfo {
  name: string
  segments: number
  points: number
  closedSegments?: number
  entityTypes?: Record<string, number>
  zMin?: number
  zMax?: number
  textSamples?: string[]
  colorNumbers?: number[]
  lineTypes?: string[]
}

export interface DxfNetworkData {
  segments: ImportSegment[]
  points: Array<ImportPoint & { z?: number; layer?: string }>
  /** CAD POINT entities, including points expanded from real block definitions.
   * Kept separate from `points` so symbolic points inside a block cannot be
   * mistaken for surveyed elevations. */
  pointEntities?: DxfPointEntity[]
  textEntities?: DxfTextEntity[]
  blockEntities?: DxfBlockEntity[]
  diagnostics?: DxfParseDiagnostic[]
  layers: DxfLayerInfo[]
  ok: boolean
  metadata?: {
    insertionUnitsCode?: number
    insertionUnits?: string
    coordinateSystem?: string
  }
}

export interface DxfParseDiagnostic {
  code: 'BLOCK_DEFINITION_MISSING' | 'BLOCK_RECURSION_SKIPPED' | 'BLOCK_GEOMETRY_EMPTY' | 'ENTITY_VERTEX_INVALID'
  message: string
  blockName?: string
  sourceHandle?: string
  layer?: string
  entityType?: string
  invalidVertexCount?: number
}

export interface DxfTextEntity extends ImportPoint {
  text: string
  layer?: string
  sourceType?: 'TEXT' | 'MTEXT' | 'DIMENSION' | 'ATTDEF' | 'ATTRIB'
  sourceHandle?: string
  sourceBlock?: string
  sourceInsertHandle?: string
  height?: number
  rotationDeg?: number
  colorNumber?: number
  attributeTag?: string
  attributePrompt?: string
  attributeInvisible?: boolean
  attributeConstant?: boolean
  attributeVerificationRequired?: boolean
  attributePreset?: boolean
  /** Parser-supplied definition/alignment points, transformed with the block.
   * No dimension or annotation geometry is inferred when DXF omitted it. */
  geometryPoints?: ImportPoint[]
}

export interface DxfPointEntity extends ImportPoint {
  layer?: string
  sourceType: 'POINT'
  sourceHandle?: string
  sourceBlock?: string
  sourceInsertHandle?: string
  colorNumber?: number
}

export interface DxfBlockEntity extends ImportPoint {
  name: string
  layer?: string
  sourceHandle?: string
  /** Immediate parent block and outer INSERT for a nested reference. */
  parentBlock?: string
  rootInsertHandle?: string
  rotationDeg?: number
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  elevation?: number
  columnCount?: number
  rowCount?: number
  columnSpacing?: number
  rowSpacing?: number
  definitionAvailable?: boolean
  expandedSegmentCount?: number
  expansionDiagnostic?: DxfParseDiagnostic['code']
  colorNumber?: number
}

export type DxfLayerRole =
  | 'corridor'
  | 'guideAxis'
  | 'redLine'
  | 'utility'
  | 'road'
  | 'railway'
  | 'hydrography'
  | 'terrain'
  | 'terrainBreakline'
  | 'candidateRoute'
  | 'building'
  | 'structure'
  | 'protectionZone'
  | 'forbiddenZone'
  | 'approvedCrossing'
  | 'parcel'
  | 'ignore'
  | 'unknown'

export interface DxfConstraintData {
  /** Closed boundaries in which a designed route is allowed to run. */
  corridorRings: ImportPoint[][]
  /** Open linework from the corridor layer, retained for diagnostics only. */
  corridorLinework: ImportSegment[]
  guideAxis: ImportSegment[]
  redLines: ImportSegment[]
  utilityLines: ImportSegment[]
  roadLines: ImportSegment[]
  railwayLines: ImportSegment[]
  hydrography: ImportSegment[]
  terrainLines: ImportSegment[]
  /** All source LINE/POLYLINE entities, retained for a faithful vector underlay. */
  contextLines: ImportSegment[]
  pointEntities: DxfPointEntity[]
  textEntities: DxfTextEntity[]
  blockEntities: DxfBlockEntity[]
  candidateRoute: ImportSegment[]
  buildingFootprints: ImportPoint[][]
  protectionZoneRings: ImportPoint[][]
  forbiddenZoneRings: ImportPoint[][]
  approvedCrossingRings: ImportPoint[][]
  parcelRings: ImportPoint[][]
  roles: Record<string, DxfLayerRole>
  surveyPoints: SurveyPoint[]
  rejectedSurveyPoints: number
  /**
   * Where `surveyPoints` came from. `geometry` — Z of POINT entities, the
   * reliable case. `elevation_labels` — parsed from spot-height TEXT on terrain
   * layers because the drawing carries no Z at all; the surface is only as good
   * as the label placement, so a consumer must surface this to the engineer.
   */
  surveyPointSource: 'geometry' | 'elevation_labels' | 'none'
}

const normalizedLayer = (name: string): string => name.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')

/**
 * A spot height printed on a topographic plan: «686.86», «102,5». The decimal
 * part is required so that point numbers and other bare integers on the same
 * layer are not mistaken for elevations.
 */
const ELEVATION_LABEL = /^\d{2,4}[.,]\d{1,3}$/

function pointSegmentDistance(point: ImportPoint, a: ImportPoint, b: ImportPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2))
  return Math.hypot(point.x - (a.x + ratio * dx), point.y - (a.y + ratio * dy))
}

/** Douglas-Peucker removes millimetric CAD vertices and narrow backtracking
 * spikes that make an otherwise valid right-of-way polygon self-intersect. */
function simplifyPolyline(points: ImportPoint[], toleranceM: number): ImportPoint[] {
  if (points.length <= 2) return points
  let farthestIndex = -1
  let farthestDistance = 0
  for (let index = 1; index < points.length - 1; index++) {
    const distance = pointSegmentDistance(points[index], points[0], points[points.length - 1])
    if (distance > farthestDistance) {
      farthestDistance = distance
      farthestIndex = index
    }
  }
  if (farthestDistance <= toleranceM || farthestIndex < 0) return [points[0], points[points.length - 1]]
  const left = simplifyPolyline(points.slice(0, farthestIndex + 1), toleranceM)
  const right = simplifyPolyline(points.slice(farthestIndex), toleranceM)
  return [...left.slice(0, -1), ...right]
}

const COORDINATE_KEY_DECIMALS = 6

function coordinateKey(value: number): string {
  if (!Number.isFinite(value)) return `non-finite:${String(value)}`
  const rounded = Number(value.toFixed(COORDINATE_KEY_DECIMALS))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function canonicalOpenPath(pointKeys: string[]): string {
  const forward = JSON.stringify(pointKeys)
  const reverse = JSON.stringify([...pointKeys].reverse())
  return compareStrings(forward, reverse) <= 0 ? forward : reverse
}

/** Поэлементное сравнение двух путей одинаковой длины. */
function comparePaths(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

/**
 * Наименьший поворот кольца.
 *
 * Раньше канонический вид искался перебором: строились все 2n повёрнутых копий,
 * каждая через JSON.stringify, и сортировались. Это O(n²) по времени и памяти на
 * кольцо. Топооснова же полна окружностей, которые CAD разворачивает в кольца из
 * полутора сотен вершин: на съёмке Станкевича их 158, на Талдыколе 1863, и
 * классификация чертежа занимала 3,3 с из 3,8 с всей сборки проекта.
 *
 * Кандидатами могут быть только повороты, начинающиеся с наименьшей вершины, —
 * их обычно ровно один. Вырожденное кольцо из одинаковых вершин даст прежнюю
 * квадратичную оценку, но такое кольцо — точка.
 */
function smallestRotation(values: string[]): string[] {
  const n = values.length
  let smallest = values[0]
  for (const value of values) if (value < smallest) smallest = value
  let best = 0
  for (let start = 1; start < n; start++) {
    if (values[start] !== smallest) continue
    for (let k = 0; k < n; k++) {
      const a = values[(best + k) % n]
      const b = values[(start + k) % n]
      if (a === b) continue
      if (b < a) best = start
      break
    }
  }
  return best === 0 ? values : [...values.slice(best), ...values.slice(0, best)]
}

function canonicalClosedPath(pointKeys: string[]): string {
  const ring = [...pointKeys]
  if (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop()
  if (ring.length === 0) return '[]'
  const forward = smallestRotation(ring)
  const backward = smallestRotation([...ring].reverse())
  // Каждый ключ вершины — JSON-массив в скобках, поэтому склейка без
  // разделителя остаётся однозначной.
  return (comparePaths(forward, backward) <= 0 ? forward : backward).join('')
}

/**
 * Removes CAD entities that describe the same visible line twice. Handles
 * reversed open polylines and rotated/reversed closed rings. Layer and visual
 * style are part of the key, so coincident utilities on different layers are
 * not accidentally collapsed into one object.
 */
export function deduplicateImportSegments(segments: ImportSegment[]): ImportSegment[] {
  const seen = new Set<string>()
  return segments.filter((segment) => {
    const pointKeys = segment.points.map((point) =>
      JSON.stringify([
        coordinateKey(point.x),
        coordinateKey(point.y),
        point.z == null ? null : coordinateKey(point.z),
      ]))
    const closed = segment.closed === true
    const geometry = closed ? canonicalClosedPath(pointKeys) : canonicalOpenPath(pointKeys)
    const key = JSON.stringify({
      layer: segment.layer ?? '',
      closed,
      colorNumber: segment.colorNumber ?? null,
      lineType: segment.lineType ?? '',
      geometry,
    })
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Classifies a complete topographic/master-plan DXF. This is deliberately
 * separate from parseDxfNetwork: a red line, contour or cable must never be
 * imported as a sewer pipe merely because it is a polyline.
 */
export function classifyDxfConstraints(
  data: DxfNetworkData,
  roleOverrides: Partial<Record<string, DxfLayerRole>> = {},
): DxfConstraintData {
  const roles: Record<string, DxfLayerRole> = {}
  const roleOf = (layer: string): DxfLayerRole => {
    const name = normalizedLayer(layer)
    if (roleOverrides[layer]) return roleOverrides[layer] as DxfLayerRole
    if (/ось.*коридор|направляющ.*ос|guide.*axis|corridor.*axis/.test(name)) return 'guideAxis'
    if (/коридор.*инженер|инженер.*коридор/.test(name)) return 'corridor'
    if (/красн.*лин|крассн.*лин/.test(name)) return 'redLine'
    if (/железн.*дорог|ж\/д|rail/.test(name)) return 'railway'
    if (/проезж|тротуар|дорог|улиц|road/.test(name)) return 'road'
    // «Канал» alone is ambiguous: a master-plan DXF spells cable, gas and heat
    // ducts as «кабельные каналы», «каналы газоснабжения». Routing them as
    // hydrography would demand an approved water crossing over a power duct and
    // drop them from the utility clearance checks, so utility qualifiers win.
    if (/гидрогр|водоем|водоём|река|канал|озер|озёр/.test(name)
      && !/канализ|кабел|газоснаб|теплосет|электро|связи/.test(name)) return 'hydrography'
    if (/брейк|структур.*лин|breakline/.test(name)) return 'terrainBreakline'
    if (/рельеф|горизонтал|отметк|grade|elevation|survey|точк.*высот/.test(name)) return 'terrain'
    if (/охран.*зон|санитар.*зон|защит.*зон|protection/.test(name)) return 'protectionZone'
    if (/разреш.*пересеч|окн.*пересеч|approved.*cross|crossing.*window/.test(name)) return 'approvedCrossing'
    if (/павильон|камер|эстакад|опор|structure/.test(name)) return 'structure'
    if (/здани|сооруж|строени|контур.*объект|building/.test(name)) return 'building'
    if (/запрет|недопуст|forbidden/.test(name)) return 'forbiddenZone'
    if (/участ|землеотвод|границ.*зем|parcel/.test(name)) return 'parcel'
    // Roots are deliberately short: municipal topographic bases still carry the
    // 10-character layer names of older CAD systems, where «водопровод»
    // arrives as «SIT_LВОДОПРО» and «линии связи» as «SIT_LЛИН_СВЯ». Matching
    // the full word would leave every crossing utility unclassified.
    if (/трубопровод|водопро|канализ|ливнев|дренаж|кабел|газоснаб|газопро|теплосет|теплотр|электро|связи|лин_свя|лэп/
      .test(name)) return 'utility'
    if (/проект.*(трас|осев|коллектор)|(^|[_ -])к2([_ -]|$)/.test(name)) return 'candidateRoute'
    // Раньше здесь стоял отлов: «в слое есть точки с конечным Z — значит
    // рельеф». В топосъёмке этому условию отвечает почти всё. На реальном
    // чертеже Талдыколя он относил к рельефу 6 453 линии из 6 490 — слой `0`
    // (362 тыс. вершин), «растительность», «Кустарники_заросли» и коды
    // условных знаков, — и лист плана рисовал кусты цветом горизонталей.
    // Настоящие слои рельефа на обоих объектах опознаются по имени. Ничего не
    // теряется: вся эта геометрия остаётся в contextLines и выводится как
    // ситуационная подложка.
    return 'unknown'
  }

  for (const layer of data.layers) roles[layer.name] = roleOf(layer.name)
  const byRole = (role: DxfLayerRole) => data.segments.filter((segment) => roles[segment.layer ?? '0'] === role)
  const closedRings = (role: DxfLayerRole) => byRole(role)
    .filter((segment) => segment.closed && segment.points.length >= 4)
    .map((segment) => {
      const points = [...segment.points]
      const first = points[0]
      const last = points[points.length - 1]
      if (first.x === last.x && first.y === last.y) points.pop()
      return simplifyPolyline(points, 0.25)
    })
  const corridor = byRole('corridor')
  const rawCorridorRings = corridor
    .filter((segment) => segment.closed && segment.points.length >= 4)
    .map((segment) => {
      const points = [...segment.points]
      const first = points[0]
      const last = points[points.length - 1]
      if (first.x === last.x && first.y === last.y) points.pop()
      // 5 m is below normal corridor width but removes doubled CAD strokes.
      return simplifyPolyline(points, 5)
    })
    // The source drawing contains small closed symbols on the same layer.
    // Keep only spatially meaningful right-of-way polygons.
    .filter((ring) => {
      const xs = ring.map((point) => point.x)
      const ys = ring.map((point) => point.y)
      return Math.max(...xs) - Math.min(...xs) >= 30 && Math.max(...ys) - Math.min(...ys) >= 30
    })
  const ringArea = (ring: ImportPoint[]) => Math.abs(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2)
  const fingerprints = new Set<string>()
  const corridorRings = rawCorridorRings
    .sort((a, b) => ringArea(b) - ringArea(a))
    .filter((ring) => {
      const fingerprint = ring.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(';')
      if (fingerprints.has(fingerprint)) return false
      fingerprints.add(fingerprint)
      return true
    })

  const geometrySurveyPoints = data.points
    .filter((point) => typeof point.z === 'number' && Number.isFinite(point.z) && point.z !== 0)
    .map((point) => ({ x: point.x, y: point.y, z: point.z as number }))

  // Municipal surveys often annotate spot heights as TEXT and leave every
  // entity flat at Z=0. Only terrain layers qualify: a height printed on a heat
  // or water layer belongs to that utility, not to the ground surface, and
  // mixing them would bend the profile towards buried pipes.
  const labelSurveyPoints = geometrySurveyPoints.length > 0 ? [] : (data.textEntities ?? [])
    .filter((entity) => roles[entity.layer ?? ''] === 'terrain'
      && ELEVATION_LABEL.test(String(entity.text ?? '').trim())
      && Number.isFinite(entity.x) && Number.isFinite(entity.y))
    .map((entity) => ({
      x: entity.x,
      y: entity.y,
      z: Number(String(entity.text).trim().replace(',', '.')),
    }))
    .filter((point) => Number.isFinite(point.z) && point.z !== 0)

  const rawSurveyPoints = geometrySurveyPoints.length > 0 ? geometrySurveyPoints : labelSurveyPoints
  const sortedElevations = rawSurveyPoints.map((point) => point.z).sort((a, b) => a - b)
  const median = sortedElevations[Math.floor(sortedElevations.length / 2)] ?? 0
  const deviations = sortedElevations.map((z) => Math.abs(z - median)).sort((a, b) => a - b)
  const medianDeviation = deviations[Math.floor(deviations.length / 2)] ?? 0
  const elevationLimit = Math.max(50, medianDeviation * 8)
  const surveyPoints = rawSurveyPoints.filter((point) => Math.abs(point.z - median) <= elevationLimit)

  return {
    corridorRings,
    corridorLinework: corridor.filter((segment) => !segment.closed),
    guideAxis: byRole('guideAxis'),
    redLines: byRole('redLine'),
    utilityLines: byRole('utility'),
    roadLines: byRole('road'),
    railwayLines: byRole('railway'),
    hydrography: byRole('hydrography'),
    terrainLines: deduplicateImportSegments([...byRole('terrain'), ...byRole('terrainBreakline')]),
    contextLines: deduplicateImportSegments(data.segments),
    pointEntities: data.pointEntities ?? [],
    textEntities: data.textEntities ?? [],
    blockEntities: data.blockEntities ?? [],
    candidateRoute: byRole('candidateRoute'),
    buildingFootprints: [...closedRings('building'), ...closedRings('structure')],
    protectionZoneRings: closedRings('protectionZone'),
    forbiddenZoneRings: closedRings('forbiddenZone'),
    approvedCrossingRings: closedRings('approvedCrossing'),
    parcelRings: closedRings('parcel'),
    roles,
    surveyPoints,
    rejectedSurveyPoints: rawSurveyPoints.length - surveyPoints.length,
    surveyPointSource: surveyPoints.length === 0
      ? 'none'
      : geometrySurveyPoints.length > 0 ? 'geometry' : 'elevation_labels',
  }
}

interface DxfVertex {
  x?: number
  y?: number
  z?: number
  /** tan(included arc angle / 4), attached to the edge starting here. */
  bulge?: number
}

interface DxfBlockDefinition {
  name?: string
  position?: DxfVertex
  entities?: DxfEntity[]
}

interface DxfEntity {
  type?: string
  layer?: string
  shape?: boolean
  closed?: boolean
  vertices?: DxfVertex[]
  position?: DxfVertex
  startPoint?: DxfVertex
  center?: DxfVertex
  radius?: number
  startAngle?: number
  endAngle?: number
  angleLength?: number
  majorAxisEndPoint?: DxfVertex
  axisRatio?: number
  controlPoints?: DxfVertex[]
  fitPoints?: DxfVertex[]
  knotValues?: number[]
  degreeOfSplineCurve?: number
  boundaryPaths?: Array<{ vertices?: DxfVertex[] }>
  anchorPoint?: DxfVertex
  middleOfText?: DxfVertex
  insertionPoint?: DxfVertex
  endPoint?: DxfVertex
  linearOrAngularPoint1?: DxfVertex
  linearOrAngularPoint2?: DxfVertex
  diameterOrRadiusPoint?: DxfVertex
  arcPoint?: DxfVertex
  actualMeasurement?: number
  dimensionType?: number
  angle?: number
  block?: string
  text?: string
  tag?: string
  prompt?: string
  invisible?: boolean
  constant?: boolean
  verificationRequired?: boolean
  preset?: boolean
  name?: string
  handle?: string
  colorNumber?: number
  color?: number
  lineType?: string
  textHeight?: number
  height?: number
  rotation?: number
  xScale?: number
  yScale?: number
  zScale?: number
  columnCount?: number
  rowCount?: number
  columnSpacing?: number
  rowSpacing?: number
  colorIndex?: number
}

const DXF_UNITS: Record<number, string> = {
  0: 'unitless', 1: 'inch', 2: 'foot', 3: 'mile', 4: 'millimetre', 5: 'centimetre',
  6: 'metre', 7: 'kilometre', 8: 'microinch', 9: 'mil', 10: 'yard', 11: 'angstrom',
  12: 'nanometre', 13: 'micrometre', 14: 'decimetre', 15: 'decametre', 16: 'hectometre',
  17: 'gigametre', 18: 'astronomical_unit', 19: 'light_year', 20: 'parsec',
}

const FULL_TURN = Math.PI * 2
const MAX_CURVE_ANGLE_RAD = Math.PI / 90 // two degrees
const MAX_CURVE_STEPS = 720

function validPoint(point: DxfVertex | undefined): point is Required<Pick<DxfVertex, 'x' | 'y'>> & DxfVertex {
  return point != null && typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y)
}

function invalidPolylineVertexCount(vertices: DxfVertex[] | undefined): number {
  return (vertices ?? []).reduce((count, vertex) => count + (validPoint(vertex) ? 0 : 1), 0)
}

function invalidEntityVertexCount(entity: DxfEntity): number {
  if (entity.type === 'LINE' || entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
    return invalidPolylineVertexCount(entity.vertices)
  }
  if (entity.type === 'HATCH') {
    return (entity.boundaryPaths ?? []).reduce(
      (count, boundary) => count + invalidPolylineVertexCount(boundary.vertices),
      0,
    )
  }
  return 0
}

function invalidVertexDiagnostic(
  entity: DxfEntity,
  layer: string,
  invalidVertexCount: number,
  blockName?: string,
): DxfParseDiagnostic {
  const entityType = entity.type ?? 'UNKNOWN'
  return {
    code: 'ENTITY_VERTEX_INVALID',
    message: `${entityType} ${entity.handle ?? '(without handle)'} was skipped because ${invalidVertexCount} source vertex/vertices have non-finite or missing XY; no chord was created across the gap.`,
    blockName,
    sourceHandle: entity.handle,
    layer,
    entityType,
    invalidVertexCount,
  }
}

function normalizedSweep(start: number, end: number, fullWhenEqual = false): number {
  let sweep = end - start
  while (sweep < 0) sweep += FULL_TURN
  while (sweep > FULL_TURN) sweep -= FULL_TURN
  if (fullWhenEqual && Math.abs(sweep) < 1e-12) return FULL_TURN
  return sweep
}

function curveSteps(sweep: number, minimum = 1): number {
  return Math.max(minimum, Math.min(MAX_CURVE_STEPS, Math.ceil(Math.abs(sweep) / MAX_CURVE_ANGLE_RAD)))
}

function importPoint(vertex: DxfVertex): ImportPoint {
  const point: ImportPoint = { x: vertex.x as number, y: vertex.y as number }
  if (typeof vertex.z === 'number' && Number.isFinite(vertex.z)) point.z = vertex.z
  return point
}

function interpolatedZ(start: DxfVertex, end: DxfVertex, ratio: number): number | undefined {
  const startZ = typeof start.z === 'number' && Number.isFinite(start.z) ? start.z : undefined
  const endZ = typeof end.z === 'number' && Number.isFinite(end.z) ? end.z : undefined
  if (startZ != null && endZ != null) return startZ + (endZ - startZ) * ratio
  return startZ ?? endZ
}

/** Tessellates the DXF bulge attached to `start`; returned points exclude
 * start and include the exact end vertex. Positive and negative bulges keep
 * their source orientation, and Z is interpolated independently of XY. */
function tessellateBulgeEdge(start: DxfVertex, end: DxfVertex): ImportPoint[] {
  if (!validPoint(start) || !validPoint(end)) return []
  const bulge = typeof start.bulge === 'number' && Number.isFinite(start.bulge) ? start.bulge : 0
  const chordX = end.x - start.x
  const chordY = end.y - start.y
  const chord = Math.hypot(chordX, chordY)
  if (Math.abs(bulge) < 1e-12 || chord < 1e-12) return [importPoint(end)]

  const sweep = 4 * Math.atan(bulge)
  const midpointX = (start.x + end.x) / 2
  const midpointY = (start.y + end.y) / 2
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge)
  const centerX = midpointX - chordY / chord * centerOffset
  const centerY = midpointY + chordX / chord * centerOffset
  const radius = Math.hypot(start.x - centerX, start.y - centerY)
  const startAngle = Math.atan2(start.y - centerY, start.x - centerX)
  const steps = curveSteps(sweep)
  const points: ImportPoint[] = []
  for (let index = 1; index < steps; index++) {
    const ratio = index / steps
    const angle = startAngle + sweep * ratio
    const point: ImportPoint = {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    }
    const z = interpolatedZ(start, end, ratio)
    if (z != null) point.z = z
    points.push(point)
  }
  points.push(importPoint(end))
  return points
}

function tessellatePolyline(vertices: DxfVertex[] | undefined, closed: boolean): ImportPoint[] {
  const rawVertices = vertices ?? []
  // Filtering an invalid middle vertex would connect its neighbours with a
  // synthetic chord. For engineering geometry the safe behaviour is to fail
  // this source entity closed; callers record an explicit diagnostic.
  if (rawVertices.some((vertex) => !validPoint(vertex))) return []
  const sourceVertices = rawVertices.filter(validPoint)
  if (sourceVertices.length < 2) return sourceVertices.map(importPoint)
  const points: ImportPoint[] = [importPoint(sourceVertices[0])]
  for (let index = 0; index < sourceVertices.length - 1; index++) {
    points.push(...tessellateBulgeEdge(sourceVertices[index], sourceVertices[index + 1]))
  }
  const first = sourceVertices[0]
  const last = sourceVertices[sourceVertices.length - 1]
  if (closed && Math.hypot(first.x - last.x, first.y - last.y) > 1e-9) {
    points.push(...tessellateBulgeEdge(last, first))
  }
  return points
}

function approximateArc(entity: DxfEntity, fullCircle: boolean): ImportPoint[] {
  if (!validPoint(entity.center) || typeof entity.radius !== 'number' || !Number.isFinite(entity.radius) || entity.radius <= 0) return []
  const start = fullCircle ? 0 : (entity.startAngle ?? 0)
  const end = fullCircle ? FULL_TURN : (entity.endAngle ?? start)
  const sweep = fullCircle ? FULL_TURN : normalizedSweep(start, end)
  if (!fullCircle && sweep <= 1e-12) return []
  const steps = curveSteps(sweep, fullCircle ? 12 : 1)
  return Array.from({ length: steps + 1 }, (_value, index) => {
    const angle = start + sweep * index / steps
    return {
      x: (entity.center as Required<Pick<DxfVertex, 'x' | 'y'>>).x + (entity.radius as number) * Math.cos(angle),
      y: (entity.center as Required<Pick<DxfVertex, 'x' | 'y'>>).y + (entity.radius as number) * Math.sin(angle),
    }
  })
}

function approximateEllipse(entity: DxfEntity): { points: ImportPoint[]; closed: boolean } {
  if (!validPoint(entity.center) || !validPoint(entity.majorAxisEndPoint)
    || typeof entity.axisRatio !== 'number' || !Number.isFinite(entity.axisRatio) || entity.axisRatio <= 0) {
    return { points: [], closed: false }
  }
  const majorX = entity.majorAxisEndPoint.x
  const majorY = entity.majorAxisEndPoint.y
  const majorRadius = Math.hypot(majorX, majorY)
  if (majorRadius <= 0) return { points: [], closed: false }
  const start = entity.startAngle ?? 0
  const end = entity.endAngle ?? FULL_TURN
  const sweep = normalizedSweep(start, end, true)
  const closed = Math.abs(sweep - FULL_TURN) < 1e-9
  const steps = curveSteps(sweep, closed ? 12 : 1)
  const points = Array.from({ length: steps + 1 }, (_value, index) => {
    const angle = start + sweep * index / steps
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    return {
      x: entity.center!.x! + majorX * cosine - majorY * entity.axisRatio! * sine,
      y: entity.center!.y! + majorY * cosine + majorX * entity.axisRatio! * sine,
    }
  })
  return { points, closed }
}

function clampedUniformKnots(controlPointCount: number, degree: number): number[] {
  const knotCount = controlPointCount + degree + 1
  const interiorCount = knotCount - 2 * (degree + 1)
  const knots = Array.from({ length: degree + 1 }, () => 0)
  for (let index = 1; index <= interiorCount; index++) knots.push(index / (interiorCount + 1))
  knots.push(...Array.from({ length: degree + 1 }, () => 1))
  return knots
}

function deBoorPoint(controlPoints: ImportPoint[], degree: number, knots: number[], parameter: number): ImportPoint {
  const lastControlIndex = controlPoints.length - 1
  const domainEnd = knots[lastControlIndex + 1]
  let span = degree
  if (parameter >= domainEnd) span = lastControlIndex
  else {
    for (let index = degree; index <= lastControlIndex; index++) {
      if (parameter >= knots[index] && parameter < knots[index + 1]) {
        span = index
        break
      }
    }
  }
  const work = Array.from({ length: degree + 1 }, (_value, index) => ({ ...controlPoints[span - degree + index] }))
  for (let level = 1; level <= degree; level++) {
    for (let index = degree; index >= level; index--) {
      const knotIndex = span - degree + index
      const denominator = knots[knotIndex + degree - level + 1] - knots[knotIndex]
      const alpha = Math.abs(denominator) < 1e-12 ? 0 : (parameter - knots[knotIndex]) / denominator
      work[index] = {
        x: (1 - alpha) * work[index - 1].x + alpha * work[index].x,
        y: (1 - alpha) * work[index - 1].y + alpha * work[index].y,
      }
    }
  }
  return work[degree]
}

function approximateControlPointSpline(entity: DxfEntity, controlPoints: ImportPoint[]): ImportPoint[] {
  const degree = Math.max(1, Math.min(entity.degreeOfSplineCurve ?? 3, controlPoints.length - 1))
  const suppliedKnots = (entity.knotValues ?? []).filter((value) => Number.isFinite(value))
  const expectedKnotCount = controlPoints.length + degree + 1
  const monotonic = suppliedKnots.every((value, index) => index === 0 || value >= suppliedKnots[index - 1])
  const knots = suppliedKnots.length === expectedKnotCount && monotonic
    ? suppliedKnots
    : clampedUniformKnots(controlPoints.length, degree)
  const start = knots[degree]
  const end = knots[controlPoints.length]
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return controlPoints
  const steps = Math.max(12, Math.min(MAX_CURVE_STEPS, (controlPoints.length - 1) * 12))
  return Array.from({ length: steps + 1 }, (_value, index) =>
    deBoorPoint(controlPoints, degree, knots, start + (end - start) * index / steps))
}

function catmullRomPoint(points: ImportPoint[], segment: number, t: number): ImportPoint {
  const p0 = points[Math.max(0, segment - 1)]
  const p1 = points[segment]
  const p2 = points[Math.min(points.length - 1, segment + 1)]
  const p3 = points[Math.min(points.length - 1, segment + 2)]
  const t2 = t * t
  const t3 = t2 * t
  const coordinate = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return { x: coordinate(p0.x, p1.x, p2.x, p3.x), y: coordinate(p0.y, p1.y, p2.y, p3.y) }
}

function approximateSpline(entity: DxfEntity): { points: ImportPoint[]; closed: boolean } {
  const fitPoints = (entity.fitPoints ?? []).filter(validPoint).map((point) => ({ x: point.x, y: point.y }))
  if (fitPoints.length >= 2) {
    const samplesPerSpan = 12
    const points: ImportPoint[] = []
    for (let segment = 0; segment < fitPoints.length - 1; segment++) {
      for (let sample = 0; sample < samplesPerSpan; sample++) {
        points.push(catmullRomPoint(fitPoints, segment, sample / samplesPerSpan))
      }
    }
    points.push({ ...fitPoints[fitPoints.length - 1] })
    if (entity.closed && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) > 1e-9) {
      points.push({ ...points[0] })
    }
    return { points, closed: entity.closed === true }
  }
  const controlPoints = (entity.controlPoints ?? []).filter(validPoint).map((point) => ({ x: point.x, y: point.y }))
  if (controlPoints.length < 2) return { points: [], closed: false }
  const points = approximateControlPointSpline(entity, controlPoints)
  if (entity.closed && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) > 1e-9) {
    points.push({ ...points[0] })
  }
  return { points, closed: entity.closed === true }
}

function dimensionText(entity: DxfEntity): string {
  const explicit = typeof entity.text === 'string' ? entity.text.trim() : ''
  const measurement = typeof entity.actualMeasurement === 'number' && Number.isFinite(entity.actualMeasurement)
    ? String(Number(entity.actualMeasurement.toFixed(6)))
    : ''
  if (explicit && explicit !== '<>') return explicit.replace('<>', measurement)
  return measurement
}

function entityColorNumber(entity: DxfEntity): number | undefined {
  return typeof entity.colorNumber === 'number'
    ? entity.colorNumber
    : typeof entity.colorIndex === 'number' ? entity.colorIndex : entity.color
}

function geometrySegments(entity: DxfEntity, inheritedLayer?: string): ImportSegment[] {
  const layer = typeof entity.layer === 'string' && entity.layer !== '' && entity.layer !== '0'
    ? entity.layer
    : (inheritedLayer ?? entity.layer ?? '0')
  const source = {
    layer,
    sourceType: entity.type ?? 'UNKNOWN',
    sourceHandle: entity.handle,
    colorNumber: entityColorNumber(entity),
    lineType: entity.lineType,
  }
  if (entity.type === 'LINE') {
    const points = tessellatePolyline(entity.vertices?.slice(0, 2), false)
    return points.length >= 2 ? [{ points, ...source }] : []
  }
  if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
    const closed = entity.shape === true
    const points = tessellatePolyline(entity.vertices, closed)
    return points.length >= 2 ? [{ points, closed, ...source }] : []
  }
  if (entity.type === 'ARC' || entity.type === 'CIRCLE') {
    const closed = entity.type === 'CIRCLE'
    const points = approximateArc(entity, closed)
    return points.length >= 2 ? [{ points, closed, ...source }] : []
  }
  if (entity.type === 'ELLIPSE') {
    const ellipse = approximateEllipse(entity)
    return ellipse.points.length >= 2 ? [{ points: ellipse.points, closed: ellipse.closed, ...source }] : []
  }
  if (entity.type === 'SPLINE') {
    const spline = approximateSpline(entity)
    return spline.points.length >= 2 ? [{ points: spline.points, closed: spline.closed, ...source }] : []
  }
  if (entity.type === 'HATCH') {
    // Only parser-supplied polyline boundaries are safe to expand.
    return (entity.boundaryPaths ?? []).flatMap((boundary): ImportSegment[] => {
      const points = tessellatePolyline(boundary.vertices, true)
      return points.length >= 4 ? [{ points, closed: true, ...source }] : []
    })
  }
  return []
}

interface DxfTransform {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
  sz: number
  tz: number
  zDefined: boolean
}

const IDENTITY_TRANSFORM: DxfTransform = {
  a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0, sz: 1, tz: 0, zDefined: false,
}

function composeTransform(parent: DxfTransform, child: DxfTransform): DxfTransform {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    tx: parent.a * child.tx + parent.c * child.ty + parent.tx,
    ty: parent.b * child.tx + parent.d * child.ty + parent.ty,
    sz: parent.sz * child.sz,
    tz: parent.sz * child.tz + parent.tz,
    zDefined: parent.zDefined || child.zDefined,
  }
}

function insertTransform(
  insert: DxfEntity,
  blockBase: DxfVertex | undefined,
  columnOffset = 0,
  rowOffset = 0,
): DxfTransform | null {
  if (!validPoint(insert.position)) return null
  const base = validPoint(blockBase) ? blockBase : { x: 0, y: 0, z: 0 }
  const scaleX = typeof insert.xScale === 'number' && Number.isFinite(insert.xScale) ? insert.xScale : 1
  const scaleY = typeof insert.yScale === 'number' && Number.isFinite(insert.yScale) ? insert.yScale : 1
  const scaleZ = typeof insert.zScale === 'number' && Number.isFinite(insert.zScale) ? insert.zScale : 1
  const angle = (typeof insert.rotation === 'number' && Number.isFinite(insert.rotation) ? insert.rotation : 0) * Math.PI / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const a = cosine * scaleX
  const b = sine * scaleX
  const c = -sine * scaleY
  const d = cosine * scaleY
  const rotatedOffsetX = cosine * columnOffset - sine * rowOffset
  const rotatedOffsetY = sine * columnOffset + cosine * rowOffset
  const insertZ = typeof insert.position.z === 'number' && Number.isFinite(insert.position.z) ? insert.position.z : 0
  const baseZ = typeof base.z === 'number' && Number.isFinite(base.z) ? base.z : 0
  return {
    a, b, c, d,
    tx: insert.position.x + rotatedOffsetX - a * base.x - c * base.y,
    ty: insert.position.y + rotatedOffsetY - b * base.x - d * base.y,
    sz: scaleZ,
    tz: insertZ - scaleZ * baseZ,
    zDefined: insert.position.z != null || blockBase?.z != null || insert.zScale != null,
  }
}

function transformPoint(point: ImportPoint, transform: DxfTransform): ImportPoint {
  const transformed: ImportPoint = {
    x: transform.a * point.x + transform.c * point.y + transform.tx,
    y: transform.b * point.x + transform.d * point.y + transform.ty,
  }
  if (point.z != null || transform.zDefined) transformed.z = transform.sz * (point.z ?? 0) + transform.tz
  return transformed
}

function transformedRotationDeg(rotationDeg: number | undefined, transform: DxfTransform): number | undefined {
  if (rotationDeg == null || !Number.isFinite(rotationDeg)) return undefined
  const angle = rotationDeg * Math.PI / 180
  const x = transform.a * Math.cos(angle) + transform.c * Math.sin(angle)
  const y = transform.b * Math.cos(angle) + transform.d * Math.sin(angle)
  if (Math.hypot(x, y) < 1e-12) return undefined
  return Math.atan2(y, x) * 180 / Math.PI
}

function transformedTextHeight(
  height: number | undefined,
  rotationDeg: number | undefined,
  transform: DxfTransform,
): number | undefined {
  if (height == null || !Number.isFinite(height)) return undefined
  const normalAngle = ((rotationDeg ?? 0) + 90) * Math.PI / 180
  const x = transform.a * Math.cos(normalAngle) + transform.c * Math.sin(normalAngle)
  const y = transform.b * Math.cos(normalAngle) + transform.d * Math.sin(normalAngle)
  const scale = Math.hypot(x, y)
  return Number.isFinite(scale) ? Math.abs(height) * scale : undefined
}

function annotationPosition(entity: DxfEntity): DxfVertex | undefined {
  if (entity.type === 'DIMENSION') {
    return entity.middleOfText ?? entity.anchorPoint ?? entity.insertionPoint
  }
  return entity.startPoint ?? entity.position
}

function annotationText(entity: DxfEntity): string {
  if (entity.type === 'DIMENSION') return dimensionText(entity)
  return typeof entity.text === 'string' ? entity.text.trim() : ''
}

function annotationGeometryPoints(entity: DxfEntity, transform: DxfTransform): ImportPoint[] | undefined {
  const source = entity.type === 'DIMENSION'
    ? [
        entity.anchorPoint,
        entity.middleOfText,
        entity.insertionPoint,
        entity.linearOrAngularPoint1,
        entity.linearOrAngularPoint2,
        entity.diameterOrRadiusPoint,
        entity.arcPoint,
      ]
    : [entity.endPoint]
  const points = source.filter(validPoint).map((point) => transformPoint(importPoint(point), transform))
  return points.length > 0 ? points : undefined
}

function expandedAnnotation(
  entity: DxfEntity,
  layer: string,
  transform: DxfTransform,
  sourceBlock: string | undefined,
  sourceInsertHandle: string | undefined,
): DxfTextEntity | null {
  if (!['TEXT', 'MTEXT', 'DIMENSION', 'ATTDEF', 'ATTRIB'].includes(entity.type ?? '')) return null
  const position = annotationPosition(entity)
  const text = annotationText(entity)
  if (!validPoint(position) || (!text && !entity.tag)) return null
  const transformed = transformPoint(importPoint(position), transform)
  const sourceRotation = entity.type === 'DIMENSION' ? (entity.angle ?? entity.rotation) : entity.rotation
  return {
    ...transformed,
    text,
    layer,
    sourceType: entity.type as DxfTextEntity['sourceType'],
    sourceHandle: entity.handle,
    sourceBlock,
    sourceInsertHandle,
    height: transformedTextHeight(entity.textHeight ?? entity.height, sourceRotation, transform),
    rotationDeg: transformedRotationDeg(sourceRotation, transform),
    colorNumber: entityColorNumber(entity),
    attributeTag: entity.tag,
    attributePrompt: entity.prompt,
    attributeInvisible: entity.invisible,
    attributeConstant: entity.constant,
    attributeVerificationRequired: entity.verificationRequired,
    attributePreset: entity.preset,
    geometryPoints: annotationGeometryPoints(entity, transform),
  }
}

function expandedPointEntity(
  entity: DxfEntity,
  layer: string,
  transform: DxfTransform,
  sourceBlock: string | undefined,
  sourceInsertHandle: string | undefined,
): DxfPointEntity | null {
  if (entity.type !== 'POINT' || !validPoint(entity.position)) return null
  return {
    ...transformPoint(importPoint(entity.position), transform),
    layer,
    sourceType: 'POINT',
    sourceHandle: entity.handle,
    sourceBlock,
    sourceInsertHandle,
    colorNumber: entityColorNumber(entity),
  }
}

interface ExpandedInsertResult {
  segments: ImportSegment[]
  pointEntities: DxfPointEntity[]
  textEntities: DxfTextEntity[]
  blockEntities: DxfBlockEntity[]
  diagnostics: DxfParseDiagnostic[]
}

const MAX_BLOCK_RECURSION = 16

function expandInsertGeometry(
  insert: DxfEntity,
  blockDefinitions: Map<string, DxfBlockDefinition>,
  inheritedLayer: string,
  parentTransform: DxfTransform = IDENTITY_TRANSFORM,
  stack: string[] = [],
  rootInsertHandle = insert.handle,
): ExpandedInsertResult {
  const blockName = typeof insert.name === 'string' ? insert.name.trim() : ''
  const blockKey = blockName.toLocaleLowerCase('en-US')
  const definition = blockDefinitions.get(blockKey)
  if (!blockName || !definition?.entities) {
    return {
      segments: [],
      pointEntities: [],
      textEntities: [],
      blockEntities: [],
      diagnostics: [{
        code: 'BLOCK_DEFINITION_MISSING',
        message: `INSERT ${blockName || '(unnamed)'} was retained as a marker; no block definition was provided by the DXF parser.`,
        blockName: blockName || undefined,
        sourceHandle: insert.handle,
        layer: inheritedLayer,
      }],
    }
  }
  if (stack.includes(blockKey) || stack.length >= MAX_BLOCK_RECURSION) {
    return {
      segments: [],
      pointEntities: [],
      textEntities: [],
      blockEntities: [],
      diagnostics: [{
        code: 'BLOCK_RECURSION_SKIPPED',
        message: `Recursive INSERT ${blockName} was retained without expanding another block level.`,
        blockName,
        sourceHandle: insert.handle,
        layer: inheritedLayer,
      }],
    }
  }

  const columnCount = Math.max(1, Math.trunc(insert.columnCount ?? 1))
  const rowCount = Math.max(1, Math.trunc(insert.rowCount ?? 1))
  const columnSpacing = Number.isFinite(insert.columnSpacing) ? (insert.columnSpacing as number) : 0
  const rowSpacing = Number.isFinite(insert.rowSpacing) ? (insert.rowSpacing as number) : 0
  const segments: ImportSegment[] = []
  const pointEntities: DxfPointEntity[] = []
  const textEntities: DxfTextEntity[] = []
  const blockEntities: DxfBlockEntity[] = []
  const diagnostics: DxfParseDiagnostic[] = []
  for (let column = 0; column < columnCount; column++) {
    for (let row = 0; row < rowCount; row++) {
      const local = insertTransform(insert, definition.position, column * columnSpacing, row * rowSpacing)
      if (!local) continue
      const transform = composeTransform(parentTransform, local)
      for (const child of definition.entities) {
        const childLayer = typeof child.layer === 'string' && child.layer !== '' && child.layer !== '0'
          ? child.layer
          : inheritedLayer
        if (child.type === 'INSERT') {
          const nested = expandInsertGeometry(
            child,
            blockDefinitions,
            childLayer,
            transform,
            [...stack, blockKey],
            rootInsertHandle,
          )
          segments.push(...nested.segments)
          pointEntities.push(...nested.pointEntities)
          textEntities.push(...nested.textEntities)
          blockEntities.push(...nested.blockEntities)
          diagnostics.push(...nested.diagnostics)
          if (validPoint(child.position) && typeof child.name === 'string' && child.name.trim()) {
            const marker = transformPoint(importPoint(child.position), transform)
            blockEntities.push({
              ...marker,
              name: child.name.trim(),
              layer: childLayer,
              sourceHandle: child.handle,
              parentBlock: blockName,
              rootInsertHandle,
              rotationDeg: transformedRotationDeg(child.rotation, transform),
              scaleX: child.xScale,
              scaleY: child.yScale,
              scaleZ: child.zScale,
              elevation: marker.z,
              columnCount: child.columnCount,
              rowCount: child.rowCount,
              columnSpacing: child.columnSpacing,
              rowSpacing: child.rowSpacing,
              definitionAvailable: blockDefinitions.has(child.name.trim().toLocaleLowerCase('en-US')),
              expandedSegmentCount: nested.segments.length,
              expansionDiagnostic: nested.diagnostics[0]?.code,
              colorNumber: entityColorNumber(child),
            })
          }
          continue
        }
        const invalidVertexCount = invalidEntityVertexCount(child)
        if (invalidVertexCount > 0) {
          diagnostics.push(invalidVertexDiagnostic(child, childLayer, invalidVertexCount, blockName))
          continue
        }
        for (const segment of geometrySegments(child, childLayer)) {
          segments.push({
            ...segment,
            points: segment.points.map((point) => transformPoint(point, transform)),
            sourceBlock: blockName,
            sourceInsertHandle: rootInsertHandle,
          })
        }
        const annotation = expandedAnnotation(child, childLayer, transform, blockName, rootInsertHandle)
        if (annotation) textEntities.push(annotation)
        const point = expandedPointEntity(child, childLayer, transform, blockName, rootInsertHandle)
        if (point) pointEntities.push(point)
      }
    }
  }
  if (segments.length === 0 && pointEntities.length === 0 && textEntities.length === 0
    && blockEntities.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      code: 'BLOCK_GEOMETRY_EMPTY',
      message: `Block ${blockName} exists but contains no supported source geometry; its INSERT marker was retained.`,
      blockName,
      sourceHandle: insert.handle,
      layer: inheritedLayer,
    })
  }
  return { segments, pointEntities, textEntities, blockEntities, diagnostics }
}

interface RawDxfGroup {
  code: number
  value: string
}

function rawDxfEntityChunks(text: string): Array<{ type: string; groups: RawDxfGroup[]; section?: string }> {
  const lines = text.split(/\r?\n/)
  const groups: RawDxfGroup[] = []
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index].trim(), 10)
    if (Number.isFinite(code)) groups.push({ code, value: lines[index + 1].trim() })
  }
  const chunks: Array<{ type: string; groups: RawDxfGroup[]; section?: string }> = []
  let section: string | undefined
  let current: { type: string; groups: RawDxfGroup[]; section?: string } | undefined
  const finish = () => {
    if (!current) return
    if (current.type === 'SECTION') {
      section = current.groups.find((group) => group.code === 2)?.value.toUpperCase()
      current.section = section
    } else if (current.type === 'ENDSEC') {
      current.section = section
      section = undefined
    } else {
      current.section = section
    }
    chunks.push(current)
  }
  for (const group of groups) {
    if (group.code === 0) {
      finish()
      current = { type: group.value.toUpperCase(), groups: [] }
    } else if (current) {
      current.groups.push(group)
    }
  }
  finish()
  return chunks
}

function rawValue(groups: RawDxfGroup[], code: number): string | undefined {
  return groups.find((group) => group.code === code)?.value
}

function rawNumber(groups: RawDxfGroup[], code: number): number | undefined {
  const value = Number(rawValue(groups, code))
  return Number.isFinite(value) ? value : undefined
}

function rawPoint(groups: RawDxfGroup[], xCode: number): ImportPoint | undefined {
  const x = rawNumber(groups, xCode)
  const y = rawNumber(groups, xCode + 10)
  if (x == null || y == null) return undefined
  const point: ImportPoint = { x, y }
  const z = rawNumber(groups, xCode + 20)
  if (z != null) point.z = z
  return point
}

/** dxf-parser 1.x has no ATTRIB handler. Preserve the real entity values
 * directly from the DXF pairs instead of dropping them or substituting the
 * ATTDEF default. Coordinates remain exactly as stored by DXF; no block
 * transform is guessed for attribute instances. */
function parseRawAttribEntities(text: string): DxfTextEntity[] {
  const attributes: DxfTextEntity[] = []
  let activeInsert: { handle?: string; name?: string; layer?: string } | undefined
  for (const chunk of rawDxfEntityChunks(text)) {
    if (chunk.section !== 'ENTITIES') continue
    if (chunk.type === 'INSERT') {
      activeInsert = rawNumber(chunk.groups, 66) === 1
        ? {
            handle: rawValue(chunk.groups, 5),
            name: rawValue(chunk.groups, 2),
            layer: rawValue(chunk.groups, 8),
          }
        : undefined
      continue
    }
    if (chunk.type === 'SEQEND') {
      activeInsert = undefined
      continue
    }
    if (chunk.type !== 'ATTRIB') {
      // An ATTRIB sequence is contiguous and terminated by SEQEND. A broken
      // sequence must not make us associate a later unrelated attribute with
      // the preceding INSERT.
      activeInsert = undefined
      continue
    }
    const position = rawPoint(chunk.groups, 10)
    const text = rawValue(chunk.groups, 1)?.trim() ?? ''
    const tag = rawValue(chunk.groups, 2)?.trim()
    if (!position || (!text && !tag)) continue
    const flags = rawNumber(chunk.groups, 70) ?? 0
    const alignment = rawPoint(chunk.groups, 11)
    attributes.push({
      ...position,
      text,
      layer: rawValue(chunk.groups, 8) || activeInsert?.layer || '0',
      sourceType: 'ATTRIB',
      sourceHandle: rawValue(chunk.groups, 5),
      sourceBlock: activeInsert?.name,
      sourceInsertHandle: activeInsert?.handle,
      height: rawNumber(chunk.groups, 40),
      rotationDeg: rawNumber(chunk.groups, 50),
      colorNumber: rawNumber(chunk.groups, 62),
      attributeTag: tag,
      attributeInvisible: (flags & 0x01) !== 0,
      attributeConstant: (flags & 0x02) !== 0,
      attributeVerificationRequired: (flags & 0x04) !== 0,
      attributePreset: (flags & 0x08) !== 0,
      geometryPoints: alignment ? [alignment] : undefined,
    })
  }
  return attributes
}

export function parseDxfNetwork(text: string): DxfNetworkData {
  const empty: DxfNetworkData = { segments: [], points: [], layers: [], ok: false }
  let entities: DxfEntity[]
  let blockDefinitions = new Map<string, DxfBlockDefinition>()
  let metadata: DxfNetworkData['metadata']
  try {
    const parsed = new DxfParser().parseSync(text) as {
      entities?: DxfEntity[]
      header?: Record<string, unknown>
      blocks?: Record<string, DxfBlockDefinition>
    } | null
    if (!parsed?.entities) return empty
    entities = parsed.entities
    for (const [key, definition] of Object.entries(parsed.blocks ?? {})) {
      blockDefinitions.set(key.toLocaleLowerCase('en-US'), definition)
      if (definition.name) blockDefinitions.set(definition.name.toLocaleLowerCase('en-US'), definition)
    }
    const rawUnits = parsed.header?.$INSUNITS
    const insertionUnitsCode = typeof rawUnits === 'number' ? rawUnits : undefined
    const coordinateSystem = [parsed.header?.$PROJECTNAME, parsed.header?.$CANNOSCALE]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    metadata = {
      insertionUnitsCode,
      insertionUnits: insertionUnitsCode == null ? undefined : (DXF_UNITS[insertionUnitsCode] ?? `code_${insertionUnitsCode}`),
      coordinateSystem,
    }
  } catch {
    return empty
  }

  const segments: ImportSegment[] = []
  const points: Array<ImportPoint & { z?: number; layer?: string }> = []
  const pointEntities: DxfPointEntity[] = []
  const textEntities: DxfTextEntity[] = []
  const blockEntities: DxfBlockEntity[] = []
  const diagnostics: DxfParseDiagnostic[] = []
  const stats = new Map<string, {
    segments: number
    points: number
    closedSegments: number
    entityTypes: Record<string, number>
    zMin?: number
    zMax?: number
    textSamples: string[]
    colorNumbers: number[]
    lineTypes: string[]
  }>()
  const bump = (layer: string, kind: 'segments' | 'points') => {
    const entry = stats.get(layer) ?? { segments: 0, points: 0, closedSegments: 0, entityTypes: {}, textSamples: [], colorNumbers: [], lineTypes: [] }
    entry[kind]++
    stats.set(layer, entry)
  }
  const toPoints = (vertices: DxfVertex[] | undefined): ImportPoint[] =>
    (vertices ?? [])
      .filter(validPoint)
      .map(importPoint)

  for (const entity of entities) {
    const layer = typeof entity.layer === 'string' && entity.layer !== '' ? entity.layer : '0'
    const entry = stats.get(layer) ?? { segments: 0, points: 0, closedSegments: 0, entityTypes: {}, textSamples: [], colorNumbers: [], lineTypes: [] }
    const entityType = entity.type ?? 'UNKNOWN'
    entry.entityTypes[entityType] = (entry.entityTypes[entityType] ?? 0) + 1
    const text = typeof entity.text === 'string' ? entity.text.trim() : ''
    const blockName = entity.type === 'INSERT' && typeof entity.name === 'string' ? `[BLOCK] ${entity.name}` : ''
    const dimensionSample = entity.type === 'DIMENSION' ? dimensionText(entity) : ''
    const sample = dimensionSample || text || blockName
    if (sample && entry.textSamples.length < 20 && !entry.textSamples.includes(sample)) entry.textSamples.push(sample)
    const colorNumber = typeof entity.colorNumber === 'number'
      ? entity.colorNumber
      : typeof entity.colorIndex === 'number' ? entity.colorIndex : entity.color
    if (typeof colorNumber === 'number' && !entry.colorNumbers.includes(colorNumber)) entry.colorNumbers.push(colorNumber)
    if (typeof entity.lineType === 'string' && entity.lineType && !entry.lineTypes.includes(entity.lineType)) entry.lineTypes.push(entity.lineType)
    stats.set(layer, entry)
    const source = {
      layer,
      sourceType: entityType,
      sourceHandle: entity.handle,
      colorNumber: typeof colorNumber === 'number' ? colorNumber : undefined,
      lineType: entity.lineType,
    }
    const invalidVertexCount = invalidEntityVertexCount(entity)
    if (invalidVertexCount > 0) {
      diagnostics.push(invalidVertexDiagnostic(entity, layer, invalidVertexCount))
      continue
    }
    if (entity.type === 'LINE') {
      const pts = toPoints(entity.vertices)
      if (pts.length >= 2) {
        segments.push({ points: pts.slice(0, 2), ...source })
        bump(layer, 'segments')
      }
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      const closed = entity.shape === true
      const pts = tessellatePolyline(entity.vertices, closed)
      if (pts.length >= 2) {
        segments.push({ points: pts, closed, ...source })
        bump(layer, 'segments')
        if (closed) (stats.get(layer) as NonNullable<ReturnType<typeof stats.get>>).closedSegments++
      }
    } else if (entity.type === 'ARC' || entity.type === 'CIRCLE') {
      const closed = entity.type === 'CIRCLE'
      const pts = approximateArc(entity, closed)
      if (pts.length >= 2) {
        segments.push({ points: pts, closed, ...source })
        bump(layer, 'segments')
        if (closed) (stats.get(layer) as NonNullable<ReturnType<typeof stats.get>>).closedSegments++
      }
    } else if (entity.type === 'ELLIPSE') {
      const ellipse = approximateEllipse(entity)
      if (ellipse.points.length >= 2) {
        segments.push({ points: ellipse.points, closed: ellipse.closed, ...source })
        bump(layer, 'segments')
        if (ellipse.closed) (stats.get(layer) as NonNullable<ReturnType<typeof stats.get>>).closedSegments++
      }
    } else if (entity.type === 'SPLINE') {
      const spline = approximateSpline(entity)
      if (spline.points.length >= 2) {
        segments.push({ points: spline.points, closed: spline.closed, ...source })
        bump(layer, 'segments')
        if (spline.closed) (stats.get(layer) as NonNullable<ReturnType<typeof stats.get>>).closedSegments++
      }
    } else if (entity.type === 'HATCH') {
      // dxf-parser 1.x does not expose HATCH today. If a future registered
      // handler supplies real boundary paths, retain only those vertices;
      // never manufacture a polygon from pattern, seed or extents metadata.
      for (const boundary of entity.boundaryPaths ?? []) {
        const boundaryPoints = tessellatePolyline(boundary.vertices, true)
        if (boundaryPoints.length < 3) continue
        segments.push({ points: boundaryPoints, closed: true, ...source })
        bump(layer, 'segments')
        ;(stats.get(layer) as NonNullable<ReturnType<typeof stats.get>>).closedSegments++
      }
    } else if (entity.type === 'POINT' || entity.type === 'INSERT') {
      const position = entity.position
      if (validPoint(position)) {
        const marker: ImportPoint & { z?: number; layer?: string } = { x: position.x, y: position.y, layer }
        if (typeof position.z === 'number' && Number.isFinite(position.z)) marker.z = position.z
        points.push(marker)
        bump(layer, 'points')
        if (entity.type === 'POINT') {
          const pointEntity = expandedPointEntity(entity, layer, IDENTITY_TRANSFORM, undefined, undefined)
          if (pointEntity) pointEntities.push(pointEntity)
        }
        if (entity.type === 'INSERT' && typeof entity.name === 'string' && entity.name.trim()) {
          const definitionAvailable = blockDefinitions.has(entity.name.trim().toLocaleLowerCase('en-US'))
          const expanded = expandInsertGeometry(entity, blockDefinitions, layer)
          segments.push(...expanded.segments)
          pointEntities.push(...expanded.pointEntities)
          textEntities.push(...expanded.textEntities)
          blockEntities.push(...expanded.blockEntities)
          diagnostics.push(...expanded.diagnostics)
          for (const segment of expanded.segments) {
            const expandedLayer = segment.layer ?? layer
            bump(expandedLayer, 'segments')
            if (segment.closed) (stats.get(expandedLayer) as NonNullable<ReturnType<typeof stats.get>>).closedSegments++
          }
          for (const expandedPoint of expanded.pointEntities) bump(expandedPoint.layer ?? layer, 'points')
          for (const expandedText of expanded.textEntities) bump(expandedText.layer ?? layer, 'points')
          for (const expandedBlock of expanded.blockEntities) bump(expandedBlock.layer ?? layer, 'points')
          blockEntities.push({
            x: position.x,
            y: position.y,
            name: entity.name.trim(),
            layer,
            sourceHandle: entity.handle,
            rotationDeg: entity.rotation,
            scaleX: entity.xScale,
            scaleY: entity.yScale,
            scaleZ: entity.zScale,
            elevation: marker.z,
            columnCount: entity.columnCount,
            rowCount: entity.rowCount,
            columnSpacing: entity.columnSpacing,
            rowSpacing: entity.rowSpacing,
            definitionAvailable,
            expandedSegmentCount: expanded.segments.length,
            expansionDiagnostic: expanded.diagnostics[0]?.code,
            colorNumber: typeof colorNumber === 'number' ? colorNumber : undefined,
          })
        }
        if (marker.z != null) {
          const layerStats = stats.get(layer) as NonNullable<ReturnType<typeof stats.get>>
          layerStats.zMin = Math.min(layerStats.zMin ?? marker.z, marker.z)
          layerStats.zMax = Math.max(layerStats.zMax ?? marker.z, marker.z)
        }
      }
    } else if (entity.type === 'DIMENSION' || entity.type === 'TEXT' || entity.type === 'MTEXT'
      || entity.type === 'ATTDEF' || entity.type === 'ATTRIB') {
      const annotation = expandedAnnotation(entity, layer, IDENTITY_TRANSFORM, undefined, undefined)
      if (annotation) {
        textEntities.push(annotation)
        bump(layer, 'points')
      }
    }
  }

  for (const attribute of parseRawAttribEntities(text)) {
    const duplicate = textEntities.some((entity) => entity.sourceType === 'ATTRIB'
      && ((attribute.sourceHandle && entity.sourceHandle === attribute.sourceHandle)
        || (!attribute.sourceHandle && !entity.sourceHandle
          && entity.x === attribute.x && entity.y === attribute.y && entity.text === attribute.text
          && entity.attributeTag === attribute.attributeTag)))
    if (duplicate) continue
    textEntities.push(attribute)
    const attributeLayer = attribute.layer ?? '0'
    bump(attributeLayer, 'points')
    const attributeStats = stats.get(attributeLayer) as NonNullable<ReturnType<typeof stats.get>>
    attributeStats.entityTypes.ATTRIB = (attributeStats.entityTypes.ATTRIB ?? 0) + 1
    if (attribute.text && attributeStats.textSamples.length < 20
      && !attributeStats.textSamples.includes(attribute.text)) attributeStats.textSamples.push(attribute.text)
  }

  const layers: DxfLayerInfo[] = [...stats.entries()]
    .map(([name, s]) => ({
      name,
      segments: s.segments,
      points: s.points,
      closedSegments: s.closedSegments,
      entityTypes: s.entityTypes,
      zMin: s.zMin,
      zMax: s.zMax,
      textSamples: s.textSamples,
      colorNumbers: s.colorNumbers,
      lineTypes: s.lineTypes,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    segments,
    points,
    pointEntities,
    textEntities,
    blockEntities,
    diagnostics,
    layers,
    metadata,
    ok: segments.length > 0 || points.length > 0 || textEntities.length > 0 || blockEntities.length > 0,
  }
}

/**
 * Survey points from a DXF/DWG topographic base (requirements update 3,
 * change 2: drawing sources are accepted in both DWG and DXF). POINT and
 * INSERT entities carry x, y and the elevation in z (group code 30). A DXF
 * point without an explicit elevation reads as z = 0, so a file where every
 * point sits at zero is treated as having no elevations at all and reported
 * honestly instead of producing a silently flat terrain.
 */
export function parseTopographyDxf(text: string): TopoParseResult {
  const data = parseDxfNetwork(text)
  if (!data.ok || data.points.length === 0) {
    return { points: [], issues: [{ row: 0, kind: 'invalidFormat' }], total: 0 }
  }
  const hasElevations = data.points.some((p) => typeof p.z === 'number' && p.z !== 0)
  const issues: ParseIssue[] = []
  if (!hasElevations) {
    data.points.forEach((_point, index) => issues.push({ row: index + 1, kind: 'missingZ' }))
    return { points: [], issues, total: data.points.length }
  }
  const classified = classifyDxfConstraints(data)
  data.points.forEach((point, index) => {
    if (typeof point.z !== 'number' || point.z === 0) issues.push({ row: index + 1, kind: 'missingZ' })
  })
  for (let index = 0; index < classified.rejectedSurveyPoints; index++) {
    issues.push({ row: data.points.length + index + 1, kind: 'badNumber' })
  }
  return { points: classified.surveyPoints, issues, total: data.points.length }
}
