import type {
  GravityProfile,
  Borehole,
  CrossingRecord,
  RouteConstraintInput,
  SelectedManholeConstruction,
  SewerSchedule,
  SurveyPoint,
  TracedNetwork,
  WorkingDrawingSet,
  WorkingDrawingSheet,
} from '@aquascheme/engine'

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
  outletFlowLps: number
  buildingLabels?: Map<string, string>
}

type PdfNode = Record<string, unknown>
type PathPoint = { x: number; y: number; chainageM: number }

function picket(chainageM: number): string {
  const pk = Math.floor(chainageM / 100)
  const rest = Math.round((chainageM - pk * 100) * 100) / 100
  return rest === 0 ? `ПК${pk}` : `ПК${pk}+${rest}`
}

function xmlText(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function pointAt(path: PathPoint[], chainageM: number): PathPoint {
  if (path.length === 0) return { x: 0, y: 0, chainageM }
  if (chainageM <= path[0].chainageM) return { ...path[0], chainageM }
  for (let index = 1; index < path.length; index++) {
    if (path[index].chainageM >= chainageM) {
      const a = path[index - 1]
      const b = path[index]
      const ratio = (chainageM - a.chainageM) / Math.max(b.chainageM - a.chainageM, 1e-9)
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, chainageM }
    }
  }
  return { ...path[path.length - 1], chainageM }
}

function pathSlice(path: PathPoint[], fromM: number, toM: number): PathPoint[] {
  return [
    pointAt(path, fromM),
    ...path.filter((point) => point.chainageM > fromM && point.chainageM < toM),
    pointAt(path, toM),
  ]
}

function planSvg(input: ProjectAlbumInput, sheet: WorkingDrawingSheet): string {
  const window = sheet.window
  if (!window || input.drawingSet.mainPath.length < 2) {
    throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая геометрия плана.`)
  }
  const path = pathSlice(input.drawingSet.mainPath, window.fromM, window.toM)
  const width = Math.max(window.maxX - window.minX, 1)
  const height = Math.max(window.maxY - window.minY, 1)
  const scale = Math.min(900 / width, 410 / height)
  const x = (value: number) => 45 + (value - window.minX) * scale
  const y = (value: number) => 445 - (value - window.minY) * scale
  const route = path.map((point) => `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(' ')
  const linePoints = (points: Array<{ x: number; y: number }>) => points.map((point) => `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(' ')
  const constraints = [
    ...(input.constraints?.hardObstacleRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d7d7d7" stroke="#555"/>`),
    ...(input.constraints?.waterRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d8f1f8" stroke="#2685b5"/>`),
    ...(input.constraints?.corridorRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" stroke="#d33232" stroke-width="1.5" stroke-dasharray="8 5"/>`),
    ...(input.constraints?.roadLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#8b734f" stroke-width="3"/>`),
    ...(input.constraints?.waterLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#2685b5" stroke-width="2"/>`),
    ...(input.constraints?.utilityLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#9b2c8c" stroke-width="1.5" stroke-dasharray="6 4"/>`),
    ...(input.constraints?.redLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#d22" stroke-width="2"/>`),
  ].join('')
  const topo = input.surveyPoints.filter((point) =>
    point.x >= window.minX && point.x <= window.maxX && point.y >= window.minY && point.y <= window.maxY)
  const stride = Math.max(1, Math.ceil(topo.length / 360))
  const topoSvg = topo.filter((_, index) => index % stride === 0).map((point, index) => {
    const label = index % 14 === 0
      ? `<text x="${(x(point.x) + 3).toFixed(1)}" y="${(y(point.y) - 3).toFixed(1)}" font-size="7" fill="#666">${point.z.toFixed(2)}</text>`
      : ''
    return `<circle cx="${x(point.x).toFixed(1)}" cy="${y(point.y).toFixed(1)}" r="1" fill="#666"/>${label}`
  }).join('')
  const bounds = path.filter((_, index) => index === 0 || index === path.length - 1).map((point) =>
    `<circle cx="${x(point.x).toFixed(1)}" cy="${y(point.y).toFixed(1)}" r="4" fill="#fff" stroke="#1746b5" stroke-width="2"/><text x="${(x(point.x) + 7).toFixed(1)}" y="${(y(point.y) - 7).toFixed(1)}" font-size="10" font-weight="700">${picket(point.chainageM)}</text>`,
  ).join('')
  const overview = input.drawingSet.mainPath
  const minX = Math.min(...overview.map((point) => point.x))
  const maxX = Math.max(...overview.map((point) => point.x))
  const minY = Math.min(...overview.map((point) => point.y))
  const maxY = Math.max(...overview.map((point) => point.y))
  const overviewScale = Math.min(135 / Math.max(maxX - minX, 1), 78 / Math.max(maxY - minY, 1))
  const ox = (value: number) => 825 + (value - minX) * overviewScale
  const oy = (value: number) => 110 - (value - minY) * overviewScale
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><defs><clipPath id="work-${sheet.sheetNumber}"><rect x="35" y="15" width="930" height="445"/></clipPath></defs><rect width="1000" height="500" fill="#fff"/><rect x="35" y="15" width="930" height="445" fill="none" stroke="#111"/><g clip-path="url(#work-${sheet.sheetNumber})">${constraints}${topoSvg}<polyline points="${route}" fill="none" stroke="#1746b5" stroke-width="5" stroke-linejoin="round"/>${bounds}</g><g transform="translate(55 45)"><path d="M0 28 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/><text x="0" y="-5" text-anchor="middle" font-size="10">С</text></g><g transform="translate(0 -20)"><rect x="810" y="35" width="150" height="90" fill="#fff" stroke="#111"/><polyline points="${overview.map((point) => `${ox(point.x).toFixed(1)},${oy(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#999" stroke-width="1"/><polyline points="${path.map((point) => `${ox(point.x).toFixed(1)},${oy(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#1746b5" stroke-width="3"/><text x="817" y="120" font-size="7">Положение листа</text></g><text x="40" y="485" font-size="8">Основание: классифицированная ось DWG; рельеф: ${input.surveyPoints.length} точек топосъёмки. Вымышленные дороги и горизонтали не добавляются.</text></svg>`
}

function networkPlanSvg(input: ProjectAlbumInput, sheet: WorkingDrawingSheet): string {
  const networkPaths = input.drawingSet.networkPaths
  const routePoints = networkPaths.flatMap((path) => path.points)
  if (routePoints.length < 2) throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая геометрия сети.`)
  const contextPoints = [
    ...(input.constraints?.hardObstacleRings ?? []).flat(),
    ...(input.constraints?.waterRings ?? []).flat(),
    ...(input.constraints?.corridorRings ?? []).flat(),
    ...(input.constraints?.roadLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.waterLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.utilityLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.redLines ?? []).flatMap((line) => line.points),
  ]
  const allPoints = [...routePoints, ...contextPoints]
  const rawMinX = Math.min(...allPoints.map((point) => point.x))
  const rawMaxX = Math.max(...allPoints.map((point) => point.x))
  const rawMinY = Math.min(...allPoints.map((point) => point.y))
  const rawMaxY = Math.max(...allPoints.map((point) => point.y))
  const margin = Math.max(Math.max(rawMaxX - rawMinX, rawMaxY - rawMinY) * 0.04, 10)
  const minX = rawMinX - margin
  const maxX = rawMaxX + margin
  const minY = rawMinY - margin
  const maxY = rawMaxY + margin
  const scale = Math.min(900 / Math.max(maxX - minX, 1), 410 / Math.max(maxY - minY, 1))
  const x = (value: number) => 45 + (value - minX) * scale
  const y = (value: number) => 445 - (value - minY) * scale
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .map((point) => `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`)
    .join(' ')
  const constraints = [
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
  const networkSvg = networkPaths.map((path) => {
    const middle = path.points[Math.floor(path.points.length / 2)]
    const diameter = input.pipeDiameterMm.get(path.pipeId)
    return `<polyline points="${linePoints(path.points)}" fill="none" stroke="#1746b5" stroke-width="4" stroke-linejoin="round"/><text x="${(x(middle.x) + 5).toFixed(1)}" y="${(y(middle.y) - 5).toFixed(1)}" font-size="8" fill="#1746b5">${xmlText(path.pipeId)}${diameter ? ` · Ø${diameter}` : ''}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><defs><clipPath id="network-${sheet.sequence}"><rect x="35" y="15" width="930" height="445"/></clipPath></defs><rect width="1000" height="500" fill="#fff"/><rect x="35" y="15" width="930" height="445" fill="none" stroke="#111"/><g clip-path="url(#network-${sheet.sequence})">${constraints}${topoSvg}${networkSvg}</g><g transform="translate(55 45)"><path d="M0 28 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/><text x="0" y="-5" text-anchor="middle" font-size="10">С</text></g><text x="40" y="485" font-size="8">Сводный план построен по ${networkPaths.length} подтверждённым полилиниям сети; прямые хорды не используются в финальном выпуске.</text></svg>`
}

function profileStationAt(profile: GravityProfile, chainageM: number) {
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
): { chainageM: number; distanceM: number } | null {
  const maxOffsetM = input.geologyMaxOffsetM
  if (!Number.isFinite(maxOffsetM) || Number(maxOffsetM) <= 0) return null
  if (!Number.isFinite(borehole.x) || !Number.isFinite(borehole.y) || borehole.layers.length === 0) return null
  const projection = nearestPathProjection(input.drawingSet.mainPath, borehole.x!, borehole.y!)
  if (!projection || projection.distanceM > Number(maxOffsetM) + 1e-9) return null
  return projection
}

function profileSvg(input: ProjectAlbumInput, sheet: WorkingDrawingSheet): string {
  const fromM = sheet.interval?.fromM ?? 0
  const toM = sheet.interval?.toM ?? input.profile.totalLengthM
  const stations = [
    profileStationAt(input.profile, fromM),
    ...input.profile.stations.filter((station) => station.chainageM > fromM && station.chainageM < toM),
    profileStationAt(input.profile, toM),
  ]
  if (stations.length < 2) throw new Error(`Лист ${sheet.sheetNumber}: недостаточно станций профиля.`)
  const minElevation = Math.floor(Math.min(...stations.map((station) => station.invertElevationM)) - 1)
  const maxElevation = Math.ceil(Math.max(...stations.map((station) => station.groundElevationM)) + 1)
  const x = (chainageM: number) => 185 + ((chainageM - fromM) / Math.max(toM - fromM, 1)) * 765
  const y = (elevationM: number) => 330 - ((elevationM - minElevation) / Math.max(maxElevation - minElevation, 1)) * 245
  const ground = stations.map((station) => `${x(station.chainageM).toFixed(1)},${y(station.groundElevationM).toFixed(1)}`).join(' ')
  const invert = stations.map((station) => `${x(station.chainageM).toFixed(1)},${y(station.invertElevationM).toFixed(1)}`).join(' ')
  const manholeByPicket = new Map(input.schedule.manholes.map((manhole) => [manhole.picket, manhole.label]))
  const columns = stations.map((station) => {
    const stationPicket = picket(station.chainageM)
    const label = manholeByPicket.get(stationPicket) ?? station.nodeId
    return `<line x1="${x(station.chainageM)}" y1="${y(station.groundElevationM)}" x2="${x(station.chainageM)}" y2="${y(station.invertElevationM)}" stroke="#111"/><line x1="${x(station.chainageM)}" y1="350" x2="${x(station.chainageM)}" y2="500" stroke="#bbb"/><text x="${x(station.chainageM)}" y="367" text-anchor="middle" font-size="8">${station.invertElevationM.toFixed(2)}</text><text x="${x(station.chainageM)}" y="392" text-anchor="middle" font-size="8">${station.groundElevationM.toFixed(2)}</text><text x="${x(station.chainageM)}" y="417" text-anchor="middle" font-size="8">${station.diameterMm}</text><text x="${x(station.chainageM)}" y="484" text-anchor="middle" font-size="7">${xmlText(label)}</text><text x="${x(station.chainageM)}" y="496" text-anchor="middle" font-size="7">${stationPicket}</text>`
  }).join('')
  const segmentValues = stations.slice(1).map((station, index) => {
    const previous = stations[index]
    const lengthM = Math.max(station.chainageM - previous.chainageM, 0)
    const slopePermille = lengthM > 0 ? ((previous.invertElevationM - station.invertElevationM) / lengthM) * 1000 : 0
    const centerX = x((previous.chainageM + station.chainageM) / 2)
    return `<text x="${centerX}" y="442" text-anchor="middle" font-size="7">${slopePermille.toFixed(2)}‰ / ${lengthM.toFixed(2)} м</text><text x="${centerX}" y="467" text-anchor="middle" font-size="7">${lengthM.toFixed(2)}</text>`
  }).join('')
  const crossings = (input.constraints?.crossings ?? [])
    .filter((crossing) => crossing.stationM >= fromM && crossing.stationM <= toM)
    .map((crossing) => {
      const crossingX = x(crossing.stationM)
      const designY = Number.isFinite(crossing.designInvertElevationM) ? y(crossing.designInvertElevationM!) : 315
      const existingY = Number.isFinite(crossing.existingElevationM) ? y(crossing.existingElevationM!) : 65
      return `<line x1="${crossingX}" y1="45" x2="${crossingX}" y2="335" stroke="#9b2c8c" stroke-width="1.5" stroke-dasharray="5 4"/><circle cx="${crossingX}" cy="${designY}" r="4" fill="#fff" stroke="#9b2c8c"/><path d="M${crossingX - 5} ${existingY} L${crossingX + 5} ${existingY}" stroke="#9b2c8c" stroke-width="2"/><text x="${crossingX + 5}" y="55" font-size="7" fill="#7c226f">${xmlText(crossing.id)} · ${xmlText(crossing.kind)}</text><text x="${crossingX + 5}" y="66" font-size="7" fill="#7c226f">просвет ${Number.isFinite(crossing.clearanceM) ? crossing.clearanceM!.toFixed(2) + ' м' : 'нет данных'}</text>`
    }).join('')
  const geology = (input.boreholes ?? []).flatMap((borehole) => {
    if (!Number.isFinite(borehole.mouthElevationM)) return []
    const projection = boreholeProfileProjection(input, borehole)
    if (!projection || projection.chainageM < fromM || projection.chainageM > toM) return []
    const chainageM = projection.chainageM
    const boreholeX = x(chainageM)
    const mouthElevationM = borehole.mouthElevationM!
    const deepest = Math.max(...borehole.layers.map((layer) => layer.bottomDepthM))
    const layerLines = borehole.layers.map((layer) => {
      const boundaryY = y(mouthElevationM - layer.bottomDepthM)
      const middleY = y(mouthElevationM - (layer.topDepthM + layer.bottomDepthM) / 2)
      return `<line x1="${boreholeX - 5}" y1="${boundaryY}" x2="${boreholeX + 5}" y2="${boundaryY}" stroke="#7a5a32"/><text x="${boreholeX + 6}" y="${middleY}" font-size="6" fill="#6b4c2b">ИГЭ-${xmlText(layer.igeCode ?? '—')}</text>`
    }).join('')
    const water = Number.isFinite(borehole.water.depthM)
      ? `<line x1="${boreholeX - 7}" y1="${y(mouthElevationM - borehole.water.depthM!)}" x2="${boreholeX + 7}" y2="${y(mouthElevationM - borehole.water.depthM!)}" stroke="#2685b5" stroke-width="2"/><text x="${boreholeX - 9}" y="${y(mouthElevationM - borehole.water.depthM!) - 2}" text-anchor="end" font-size="6" fill="#2685b5">УГВ</text>`
      : ''
    return [`<line x1="${boreholeX}" y1="${y(mouthElevationM)}" x2="${boreholeX}" y2="${y(mouthElevationM - deepest)}" stroke="#7a5a32" stroke-width="2"/>${layerLines}${water}<text x="${boreholeX}" y="${y(mouthElevationM) - 5}" text-anchor="middle" font-size="7" fill="#6b4c2b">${xmlText(borehole.label)}</text>`]
  }).join('')
  const rows = ['Отметка лотка, м', 'Отметка земли, м', 'Диаметр, мм', 'Уклон / длина', 'Расстояние, м', 'Колодец / ПК']
  const table = rows.map((label, index) => `<rect x="35" y="${350 + index * 25}" width="930" height="25" fill="none" stroke="#111"/><line x1="160" y1="${350 + index * 25}" x2="160" y2="${375 + index * 25}" stroke="#111"/><text x="42" y="${367 + index * 25}" font-size="8">${label}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><defs><clipPath id="profile-${sheet.sheetNumber}"><rect x="160" y="35" width="805" height="300"/></clipPath></defs><rect width="1000" height="500" fill="#fff"/><text x="35" y="22" font-size="9">Условный горизонт ${minElevation.toFixed(2)} м · масштаб гор. 1:500, верт. 1:100</text><g clip-path="url(#profile-${sheet.sheetNumber})"><polyline points="${ground}" fill="none" stroke="#6c5134" stroke-width="2.5"/><polyline points="${invert}" fill="none" stroke="#1746b5" stroke-width="3.5"/>${geology}${crossings}</g>${columns}${table}${segmentValues}</svg>`
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
    boreholeProfileProjection(input, borehole) !== null)
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

function sheetPage(sheet: WorkingDrawingSheet, body: PdfNode[]): PdfNode {
  const header = {
    table: {
      widths: [920, 70],
      body: [[
        { text: sheet.title, bold: true, fontSize: 12 },
        { text: `Лист ${sheet.sheetNumber}`, alignment: 'right', fontSize: 9 },
      ]],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 8],
  }
  return {
    pageBreak: 'before',
    stack: [
      header,
      ...body,
    ],
  }
}

function rangeFor(sheets: WorkingDrawingSheet[], kind: WorkingDrawingSheet['kind']): string {
  const matches = sheets.filter((sheet) => sheet.kind === kind)
  if (matches.length === 0) return '—'
  return matches.length === 1 ? String(matches[0].sheetNumber) : `${matches[0].sheetNumber}–${matches[matches.length - 1].sheetNumber}`
}

function drawingSheetBody(input: ProjectAlbumInput, sheet: WorkingDrawingSheet): PdfNode[] {
  if (sheet.kind === 'plan') return [{ svg: planSvg(input, sheet), fit: [1080, 500] }]
  if (sheet.kind === 'network_plan') return [{ svg: networkPlanSvg(input, sheet), fit: [1080, 500] }]
  if (sheet.kind === 'profile') return [{ svg: profileSvg(input, sheet), fit: [1080, 500] }]
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
        throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая конструкция защитной сетки.`)
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

export function buildProjectSheetDoc(input: ProjectAlbumInput, sheetId: string): PdfNode {
  const sheet = input.drawingSet.sheets.find((item) => item.id === sheetId)
  if (!sheet) throw new Error('Лист не найден в текущем реестре.')
  if (sheet.status !== 'VERIFIED') throw new Error(
    `Лист ${sheet.sheetNumber} нельзя выпустить как отдельный финальный документ со статусом ${sheet.status}.`,
  )
  return {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [30, 28, 30, 52],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#111' },
    content: [{
      stack: [
        {
          table: {
            widths: [920, 70],
            body: [[
              { text: sheet.title, bold: true, fontSize: 12 },
              { text: `Лист ${sheet.sheetNumber}`, alignment: 'right', fontSize: 9 },
            ]],
          },
          layout: 'noBorders',
          margin: [0, 0, 0, 8],
        },
        ...drawingSheetBody(input, sheet),
      ],
    }],
    footer: { margin: [30, 0, 30, 10], text: `${input.projectCode} · лист ${sheet.sheetNumber} · ${sheet.inputHash}`, alignment: 'right', fontSize: 8 },
    info: { title: `${input.projectCode} — ${sheet.title}`, subject: 'Отдельный рабочий лист', creator: 'AquaScheme' },
  }
}

export function buildProjectAlbumDoc(input: ProjectAlbumInput): PdfNode {
  if (!input.drawingSet.summary.finalExportAllowed) {
    throw new Error(`Финальный выпуск запрещён: заблокировано ${input.drawingSet.summary.blocked}, устарело ${input.drawingSet.summary.stale}.`)
  }
  const totalSheets = input.drawingSet.sheets.length + 3
  const content: PdfNode[] = [
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
          ['1–3', 'Титульный лист, ведомость и общие данные', 3],
          [rangeFor(input.drawingSet.sheets, 'plan'), 'Планы трассы по фактической оси DWG', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'plan').length],
          [rangeFor(input.drawingSet.sheets, 'network_plan'), 'Сводный план всей подтверждённой топологии сети', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'network_plan').length],
          [rangeFor(input.drawingSet.sheets, 'profile'), 'Продольные профили по расчётным отметкам', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'profile').length],
          [rangeFor(input.drawingSet.sheets, 'material_table'), 'Ведомости колодцев и материалов', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'material_table').length],
          [rangeFor(input.drawingSet.sheets, 'detail'), 'Пересечения и конструктивные решения', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'detail').length],
          [rangeFor(input.drawingSet.sheets, 'specification'), 'Спецификации оборудования и материалов', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'specification').length],
        ], [80, '*', 75]),
        { text: `\nВсего: ${totalSheets} листов. Расчётный расход на выпуске: ${input.outletFlowLps.toFixed(2)} л/с. Протяжённость: ${input.schedule.totalPipeLengthM.toLocaleString('ru-RU')} м.`, fontSize: 10 },
        { text: `\nИсточник плановой геометрии: ${input.network.pipes.length} участков сети, ${input.drawingSet.mainPath.length} вершин оси. Источник рельефа: ${input.surveyPoints.length} точек. Значения эталонного проекта в расчёты не подставлялись.`, fontSize: 9 },
      ],
    },
    generalDataPage(input),
  ]

  for (const sheet of input.drawingSet.sheets) {
    content.push(sheetPage(sheet, drawingSheetBody(input, sheet)))
  }

  return {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [30, 28, 30, 52],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#111' },
    content,
    footer: (currentPage: number) => currentPage === 1 ? { text: '' } : ({
      margin: [30, 0, 30, 10],
      table: { widths: ['*', 150, 85], body: [[
        { text: input.projectName, fontSize: 7 },
        { text: input.projectCode, alignment: 'center', bold: true, fontSize: 9 },
        { text: `${currentPage} / ${totalSheets}`, alignment: 'center', fontSize: 8 },
      ]] },
      layout: 'lightHorizontalLines',
    }),
    info: {
      title: `${input.projectCode} — ${input.projectName}`,
      subject: `Расчётный комплект рабочих чертежей, ${totalSheets} листов`,
      creator: 'AquaScheme',
    },
  }
}
