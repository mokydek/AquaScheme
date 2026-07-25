import { traceConstrainedNetwork } from './constrained-route'
import type {
  ConstrainedRouteOptions,
  ConstrainedRouteReport,
  RouteConstraintInput,
  RoutePoint,
  RouteTerminal,
} from './constrained-route'
import type { NetworkNode, NetworkPipe, TracedNetwork } from './trace'

export const ROUTE_ALGORITHM_VERSION = '2.1.0-lns-constraints-profile'

export type EngineeringRouteStatus = 'blocked' | 'preliminary' | 'calculated'

export interface EngineeringFacility extends RouteTerminal {
  label: string
  designFlowLps: number
}

export interface EngineeringRouteBlocker {
  code: string
  message: string
  scope: 'input' | 'topology' | 'hydraulics' | 'approval'
}

export interface EngineeringRouteResult {
  network: TracedNetwork
  status: EngineeringRouteStatus
  algorithmVersion: string
  gravityOutletNodeId: string | null
  pressureInletNodeId: string | null
  reports: { gravity: ConstrainedRouteReport; pressure: ConstrainedRouteReport }
  paths: { gravity: Array<{ terminalId: string; points: RoutePoint[] }>; pressure: Array<{ terminalId: string; points: RoutePoint[] }> }
  blockers: EngineeringRouteBlocker[]
  warnings: string[]
  surveyCoverage: SurveyCoverageReport
}

export interface SurveyCoverageReport {
  sampledRoutePoints: number
  medianNearestM: number
  p95NearestM: number
  maximumNearestM: number
  gapPoints: number
  gapThresholdM: number
}

/** Density check along the designed axis; map tiles are never used as elevations. */
export function assessRouteSurveyCoverage(
  paths: Array<{ points: RoutePoint[] }>,
  surveyPoints: Array<RoutePoint>,
  sampleStepM = 50,
  gapThresholdM = 75,
): SurveyCoverageReport {
  const samples: RoutePoint[] = []
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index++) {
      const a = path.points[index - 1]
      const b = path.points[index]
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / sampleStepM))
      for (let step = 0; step < count; step++) {
        const ratio = step / count
        samples.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio })
      }
    }
  }
  const distances = samples.map((sample) => surveyPoints.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.min(...surveyPoints.map((point) => Math.hypot(point.x - sample.x, point.y - sample.y))))
    .sort((a, b) => a - b)
  const quantile = (ratio: number) => distances.length
    ? distances[Math.min(distances.length - 1, Math.floor((distances.length - 1) * ratio))]
    : Number.POSITIVE_INFINITY
  return {
    sampledRoutePoints: samples.length,
    medianNearestM: Math.round(quantile(0.5) * 10) / 10,
    p95NearestM: Math.round(quantile(0.95) * 10) / 10,
    maximumNearestM: Math.round(quantile(1) * 10) / 10,
    gapPoints: distances.filter((distanceM) => distanceM > gapThresholdM).length,
    gapThresholdM,
  }
}

const emptyReport = (terminals: EngineeringFacility[], warning: string): ConstrainedRouteReport => ({
  ok: false,
  gridSizeM: 0,
  evaluatedCells: 0,
  routedTerminals: 0,
  unroutedTerminals: terminals.map((terminal) => terminal.id),
  redLineCrossings: 0,
  utilityCrossings: 0,
  roadCrossings: 0,
  waterCrossings: 0,
  outsideCorridorSegments: 0,
  warnings: [warning],
})

const renameNode = (node: NetworkNode, id: string): NetworkNode => ({ ...node, id })

function remapPipe(pipe: NetworkPipe, prefix: string, nodeIds: Map<string, string>, kind: NetworkPipe['kind']): NetworkPipe {
  return {
    ...pipe,
    id: `${prefix}${pipe.id}`,
    fromNode: nodeIds.get(pipe.fromNode) ?? `${prefix}${pipe.fromNode}`,
    toNode: nodeIds.get(pipe.toNode) ?? `${prefix}${pipe.toNode}`,
    kind,
    systemType: kind === 'pressure_main' || kind === 'discharge' ? 'pressure' : 'gravity',
    flowDirection: 'from_to',
    calculationStatus: 'unverified',
    dataSource: 'derived:constrained-route',
    alignment: pipe.alignment?.map((point) => ({ ...point })),
  }
}

/**
 * Builds a physically explicit sewer/storm topology:
 * facility inflows -> gravity collectors -> LNS -> pressure main -> outlet.
 * A missing LNS or missing full constraint model is reported as a blocker;
 * the function never disguises a straight point-to-point sketch as a final design.
 */
export function buildEngineeringRoute(input: {
  facilities: EngineeringFacility[]
  lns: RoutePoint & { id?: string; label?: string; designFlowLps?: number }
  outlet: RoutePoint & { id?: string; label?: string }
  constraints: RouteConstraintInput
  options?: ConstrainedRouteOptions
  sourceSurveyPointCount?: number
  pumpHeadM?: number | null
}): EngineeringRouteResult {
  const blockers: EngineeringRouteBlocker[] = []
  const warnings: string[] = []
  if (input.facilities.length === 0) blockers.push({ code: 'NO_FACILITIES', message: 'Не заданы точки притока очистных сооружений.', scope: 'input' })
  for (const facility of input.facilities) {
    if (!(facility.designFlowLps > 0)) {
      blockers.push({ code: 'NO_FACILITY_FLOW', message: `Для ${facility.label} не задан положительный расчётный расход, л/с.`, scope: 'input' })
    }
  }
  if (input.constraints.corridorRings.length === 0) blockers.push({ code: 'NO_CORRIDOR', message: 'Не загружен замкнутый инженерный коридор генплана.', scope: 'input' })
  if ((input.constraints.surveyPoints?.length ?? 0) === 0) blockers.push({ code: 'NO_TERRAIN', message: 'Нет высотных отметок топосъёмки для профиля.', scope: 'input' })
  if (!input.constraints.georeference || input.constraints.georeference.kind === 'unreferenced') {
    blockers.push({
      code: 'NO_GEOREFERENCE',
      message: 'Не подтверждена геопривязка DWG: наложение проектной оси на реальную карту заблокировано до задания CRS или контрольных точек.',
      scope: 'input',
    })
  }
  const constraintGroups = [
    input.constraints.redLines,
    input.constraints.utilityLines,
    input.constraints.roadLines,
    input.constraints.waterLines,
    [...(input.constraints.hardObstacleRings ?? []), ...(input.constraints.buildingPolygons ?? [])],
  ]
  if (constraintGroups.every((group) => !group?.length)) {
    blockers.push({
      code: 'PARTIAL_DWG_MODEL',
      message: 'DWG содержит только коридор либо загружен частично: красные линии, коммуникации, дороги, гидрография и сооружения не классифицированы.',
      scope: 'input',
    })
  }
  if (!(input.constraints.hardObstacleRings?.length || input.constraints.buildingPolygons?.length)) {
    blockers.push({
      code: 'NO_HARD_OBSTACLE_MODEL',
      message: 'Не распознаны замкнутые контуры зданий и сооружений; обход застройки не подтверждён.',
      scope: 'input',
    })
  }
  const bundledSurvey = input.constraints.surveyPoints?.length ?? 0
  if (input.sourceSurveyPointCount && bundledSurvey < input.sourceSurveyPointCount) {
    warnings.push(`Для расчёта доступно ${bundledSurvey} из ${input.sourceSurveyPointCount} точек топосъёмки; профиль предварительный.`)
  }

  const gravity = blockers.some((blocker) => blocker.code === 'NO_CORRIDOR')
    ? { network: { nodes: [], pipes: [], totalLengthM: 0 }, paths: [], report: emptyReport(input.facilities, 'Нет инженерного коридора.') }
    : traceConstrainedNetwork(input.facilities, input.lns, input.constraints, input.options)
  const pressureTerminals: EngineeringFacility[] = [{
    id: input.lns.id ?? 'LNS',
    label: input.lns.label ?? 'ЛНС',
    x: input.lns.x,
    y: input.lns.y,
    designFlowLps: input.lns.designFlowLps ?? 0,
  }]
  const pressure = blockers.some((blocker) => blocker.code === 'NO_CORRIDOR')
    ? { network: { nodes: [], pipes: [], totalLengthM: 0 }, paths: [], report: emptyReport(pressureTerminals, 'Нет инженерного коридора.') }
    : traceConstrainedNetwork(pressureTerminals, input.outlet, input.constraints, input.options)

  const surveyCoverage = assessRouteSurveyCoverage(
    [...gravity.paths, ...pressure.paths],
    input.constraints.surveyPoints ?? [],
  )
  if (surveyCoverage.gapPoints > 0) {
    blockers.push({
      code: 'SURVEY_COVERAGE_GAPS',
      message: `На оси найдено ${surveyCoverage.gapPoints} интервалов дальше ${surveyCoverage.gapThresholdM} м от высотной точки; профиль предварительный.`,
      scope: 'input',
    })
  }

  if (!gravity.report.ok) blockers.push({ code: 'GRAVITY_ROUTE_FAILED', message: gravity.report.warnings.join(' ') || 'Не построены все самотёчные ветви до ЛНС.', scope: 'topology' })
  if (!pressure.report.ok) blockers.push({ code: 'PRESSURE_ROUTE_FAILED', message: pressure.report.warnings.join(' ') || 'Не построен напорный участок от ЛНС до выпуска.', scope: 'topology' })
  const waterCrossings = gravity.report.waterCrossings + pressure.report.waterCrossings
  if (waterCrossings > 0 && !(input.constraints.approvedCrossingRings?.length)) {
    blockers.push({ code: 'UNAPPROVED_WATER_CROSSING', message: `Найдено пересечений водных объектов: ${waterCrossings}; нет утверждённых окон перехода.`, scope: 'approval' })
  }
  const utilityCrossings = gravity.report.utilityCrossings + pressure.report.utilityCrossings
  if (utilityCrossings > 0) {
    blockers.push({ code: 'UTILITY_LEVEL_CHECK_REQUIRED', message: `Пересечения коммуникаций: ${utilityCrossings}; отсутствует подтверждённая высотная увязка.`, scope: 'approval' })
  }
  if (input.pumpHeadM == null) blockers.push({ code: 'NO_PUMP_DUTY', message: 'Нет характеристики насосов ЛНС; напорная гидравлика не может быть окончательной.', scope: 'hydraulics' })

  const totalInflow = input.facilities.reduce((sum, facility) => sum + facility.designFlowLps, 0)
  if (input.lns.designFlowLps != null && Math.abs(totalInflow - input.lns.designFlowLps) > Math.max(1, totalInflow * 0.01)) {
    blockers.push({
      code: 'FLOW_BALANCE_MISMATCH',
      message: `Сумма притоков ${totalInflow.toFixed(1)} л/с не равна расчётному расходу ЛНС ${input.lns.designFlowLps.toFixed(1)} л/с; требуется подтверждение состава потоков.`,
      scope: 'topology',
    })
  }

  const nodes: NetworkNode[] = []
  const pipes: NetworkPipe[] = []
  const gravityIds = new Map<string, string>()
  for (const node of gravity.network.nodes) {
    const isLns = node.kind === 'source'
    const facility = input.facilities.find((item) => item.id === node.buildingId)
    const id = isLns ? 'LNS' : `G-${node.id}`
    gravityIds.set(node.id, id)
    nodes.push({
      ...renameNode(node, id),
      kind: isLns ? 'pumping_station' : facility ? 'treatment_facility' : 'junction',
      label: isLns ? (input.lns.label ?? 'ЛНС') : facility?.label,
      designFlowLps: isLns ? input.lns.designFlowLps : facility?.designFlowLps,
      systemType: 'gravity',
      dataSource: isLns ? 'input:lns' : facility ? 'input:facility' : 'derived:constrained-route',
    })
  }
  for (const pipe of gravity.network.pipes) {
    pipes.push(remapPipe(pipe, 'G-', gravityIds, pipe.kind === 'service' ? 'facility_connection' : 'gravity_main'))
  }

  const pressureIds = new Map<string, string>()
  for (const node of pressure.network.nodes) {
    const isOutlet = node.kind === 'source'
    const isLns = node.kind === 'building' || node.buildingId === (input.lns.id ?? 'LNS')
    const id = isOutlet ? 'OUTLET' : isLns ? 'LNS' : `P-${node.id}`
    pressureIds.set(node.id, id)
    if (id === 'LNS') continue
    nodes.push({
      ...renameNode(node, id),
      kind: isOutlet ? 'outfall' : 'junction',
      label: isOutlet ? (input.outlet.label ?? 'Оголовок / выпуск') : undefined,
      designFlowLps: isOutlet ? totalInflow : undefined,
      systemType: 'pressure',
      dataSource: isOutlet ? 'input:outfall' : 'derived:constrained-route',
    })
  }
  for (const pipe of pressure.network.pipes) pipes.push(remapPipe(pipe, 'P-', pressureIds, 'pressure_main'))

  warnings.push(...gravity.report.warnings, ...pressure.report.warnings)
  const uniqueWarnings = [...new Set(warnings.filter(Boolean))]
  const fatalCodes = new Set(['NO_FACILITIES', 'NO_FACILITY_FLOW', 'NO_CORRIDOR', 'NO_TERRAIN', 'GRAVITY_ROUTE_FAILED', 'PRESSURE_ROUTE_FAILED'])
  const status: EngineeringRouteStatus = blockers.some((blocker) => fatalCodes.has(blocker.code))
    ? 'blocked'
    : blockers.length > 0
      ? 'preliminary'
      : 'calculated'
  return {
    network: { nodes, pipes, totalLengthM: pipes.reduce((sum, pipe) => sum + pipe.lengthM, 0) },
    status,
    algorithmVersion: ROUTE_ALGORITHM_VERSION,
    gravityOutletNodeId: nodes.some((node) => node.id === 'LNS') ? 'LNS' : null,
    pressureInletNodeId: nodes.some((node) => node.id === 'LNS') ? 'LNS' : null,
    reports: { gravity: gravity.report, pressure: pressure.report },
    paths: { gravity: gravity.paths, pressure: pressure.paths },
    blockers,
    warnings: uniqueWarnings,
    surveyCoverage,
  }
}
