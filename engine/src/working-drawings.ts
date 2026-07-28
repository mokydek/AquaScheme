import type { SurveyPoint } from './types'
import type { GravityProfile, SewerSchedule } from './norms/gravity'
import { planWindows, profileSheetSpecs, type PlanWindow, type SheetInterval } from './norms/sheetset'
import type { TracedNetwork } from './trace'
import type { SelectedManholeConstruction } from './manhole-catalog'

export type WorkingDrawingStatus = 'BLOCKED' | 'PRELIMINARY' | 'CALCULATED' | 'VERIFIED' | 'STALE'

export type WorkingDrawingKind =
  | 'plan'
  | 'network_plan'
  | 'profile'
  | 'material_table'
  | 'detail'
  | 'specification'

export type WorkingDrawingDocumentSet = 'working_drawings' | 'specification'

export type WorkingDrawingVariant =
  | 'route_plan'
  | 'network_plan'
  | 'main_profile'
  | 'material_schedule'
  | 'crossing_detail'
  | 'protective_grid'
  | 'specification'

export type WorkingDrawingRequirement =
  | 'route'
  | 'georeference'
  | 'topography'
  | 'dwg_classification'
  | 'hydraulics'
  | 'storm_runoff'
  | 'catalog'
  | 'geology'
  | 'freezing_depth'
  | 'crossings'
  | 'manhole_catalog'
  | 'deliverables'
  | 'protective_grid'
  | 'norms'

export interface WorkingDrawingDeliverableRequirements {
  /** Separate crossing-card/detail sheets are issued only when the approved brief asks for them. */
  crossingDetailSheets: boolean
  /** A dedicated protective-grid construction sheet is issued only when explicitly required. */
  protectiveGridDetail: boolean
  source: string
  verified: boolean
}

/** Confirmed product geometry. Nothing here may be inferred from a reference drawing. */
export interface ProtectiveGridDesign {
  quantity: number
  overallWidthMm: number
  overallHeightMm: number
  barSpacingMm: number
  frameProfile: string
  barProfile: string
  material: string
  coating: string
  fixing: string
  source: string
  verified: boolean
}

export interface WorkingDrawingIssue {
  code: string
  message: string
  requirement: WorkingDrawingRequirement
  stationM?: number
  elementId?: string
}

export interface WorkingDrawingSource {
  requirement: WorkingDrawingRequirement
  label: string
  available: boolean
  verified: boolean
  source?: string
  detail?: string
}

export type FreezingDepthVerificationStatus = 'missing' | 'unverified' | 'verified'

/** Source status for the value used to constrain gravity-profile burial. */
export interface WorkingDrawingFreezingDepthInput {
  valueM: number | null
  status: FreezingDepthVerificationStatus
  source?: string
}

export interface CrossingRecord {
  id: string
  stationM: number
  kind: string
  owner?: string
  size?: string
  source?: string
  existingElevationM?: number
  designInvertElevationM?: number
  clearanceM?: number
  requiredClearanceM?: number
  method?: string
  casingLengthM?: number
  casingMaterial?: string
  approved?: boolean
}

export interface WorkingDrawingSheet {
  id: string
  /** Global order within the generated album, independent of per-set numbering. */
  sequence: number
  documentSet: WorkingDrawingDocumentSet
  sheetNumber: number
  title: string
  kind: WorkingDrawingKind
  variant: WorkingDrawingVariant
  status: WorkingDrawingStatus
  blockers: WorkingDrawingIssue[]
  warnings: WorkingDrawingIssue[]
  requirements: WorkingDrawingRequirement[]
  sources: WorkingDrawingSource[]
  inputHash: string
  interval?: SheetInterval
  window?: PlanWindow
  /** Half-open source row interval [start, end) owned by this sheet. */
  dataRange?: { start: number; end: number; total: number }
}

export interface WorkingDrawingNetworkPath {
  pipeId: string
  points: Array<{ x: number; y: number }>
  source?: string
}

export interface WorkingDrawingSet {
  sheets: WorkingDrawingSheet[]
  mainPath: Array<{ x: number; y: number; chainageM: number }>
  networkPaths: WorkingDrawingNetworkPath[]
  missingAlignmentPipeIds: string[]
  missingNetworkAlignmentPipeIds: string[]
  protectiveGridDesign: ProtectiveGridDesign | null
  inputHash: string
  layoutPolicy: {
    planLengthM: number
    profileLengthM: number
    planMarginM: number
    materialRowsPerSheet: number
    specificationRowsPerSheet: number
  }
  summary: {
    total: number
    blocked: number
    preliminary: number
    calculated: number
    verified: number
    stale: number
    /** Every sheet can be rendered for engineering review, but may still need verification. */
    draftExportAllowed: boolean
    /** Final issue is deliberately stricter: every generated sheet must be VERIFIED. */
    finalExportAllowed: boolean
  }
}

export interface WorkingDrawingInput {
  system: 'sewer' | 'storm'
  network: TracedNetwork
  profile: GravityProfile | null
  schedule: SewerSchedule | null
  routeStatus: 'stale' | 'blocked' | 'preliminary' | 'calculated'
  routeBlockers?: Array<{ code?: string; message?: string } | string>
  georeference?: { kind?: string; source?: string } | null
  surveyPoints?: SurveyPoint[]
  unresolvedLayerCount?: number
  catalogReady: boolean
  hydraulicsReady: boolean
  stormRunoff?: {
    available: boolean
    verified: boolean
    source?: string
    detail?: string
    blockers?: string[]
  }
  utilityFeatureCount?: number
  crossings?: CrossingRecord[]
  spatialBoreholeCount?: number
  /** Verified lateral-distance contract used to qualify boreholes for the route profile. */
  geologyCoverage?: {
    maxOffsetM?: number
    status: 'missing' | 'unverified' | 'verified'
    source?: string
  }
  /** Final profiles require a non-negative, source-backed and verified design value. */
  freezingDepth?: WorkingDrawingFreezingDepthInput
  /** Full source fingerprints are included so same-count edits still invalidate sheets. */
  geologyFingerprint?: unknown
  catalogFingerprint?: unknown
  manholeCatalogFingerprint?: unknown
  /** Number of distinct rows after aggregating the active specification sources. */
  specificationItemCount?: number
  /** Labels that could not be matched to a verified construction. */
  manholeCatalogMissingLabels?: string[]
  normsFingerprint?: unknown
  /** Full spatial-constraint fingerprint; same-count geometry edits must invalidate sheets. */
  constraintsFingerprint?: unknown
  deliverableRequirements?: WorkingDrawingDeliverableRequirements | null
  protectiveGridDesign?: ProtectiveGridDesign | null
  manholeCatalogReady?: boolean
  normsVerified?: boolean
  revision?: number | string
  options?: {
    planLengthM?: number
    profileLengthM?: number
    planMarginM?: number
    materialRowsPerSheet?: number
    specificationRowsPerSheet?: number
  }
}

type Point = { x: number; y: number }

const sourceLabel: Record<WorkingDrawingRequirement, string> = {
  route: 'Проектная ось и сеть',
  georeference: 'Система координат и геопривязка',
  topography: 'Топографическая поверхность',
  dwg_classification: 'Классификация слоёв DWG',
  hydraulics: 'Гидравлический расчёт и продольные отметки',
  storm_runoff: 'Нормативный расчёт дождевого стока',
  catalog: 'Активный каталог труб и материалов',
  geology: 'Пространственная инженерная геология',
  freezing_depth: 'Расчётная глубина промерзания',
  crossings: 'Карточки пересечений',
  manhole_catalog: 'Параметрические конструкции колодцев',
  deliverables: 'Утверждённый состав комплекта',
  protective_grid: 'Подтверждённая конструкция защитной сетки',
  norms: 'Подтверждённый реестр нормативных проверок',
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]))
  }
  return value
}

/** Deterministic, synchronous fingerprint for stale-sheet detection in the browser. */
export function workingDrawingInputHash(value: unknown): string {
  const text = JSON.stringify(stable(value))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Count the exact rows produced by the current pipe schedule and aggregated construction components. */
export function workingDrawingSpecificationItemCount(
  schedule: SewerSchedule | null,
  constructions: SelectedManholeConstruction[],
): number {
  if (!schedule) return 0
  const componentKeys = new Set<string>()
  for (const construction of constructions) {
    for (const component of construction.components) {
      componentKeys.add(`${component.catalogCode ?? ''}\u0000${component.name}\u0000${component.unit}`)
    }
  }
  return schedule.pipes.length + componentKeys.size
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function samePoint(a: Point, b: Point, toleranceM = 0.01): boolean {
  return pointDistance(a, b) <= toleranceM
}

/**
 * Rebuild the main collector polyline from the real per-pipe alignments in
 * profile order. Endpoint chords are retained only as a diagnostic fallback;
 * their pipe ids are returned and block final plan sheets.
 */
export function workingDrawingMainPath(
  network: TracedNetwork,
  profile: GravityProfile | null,
): { points: Array<Point & { chainageM: number }>; missingAlignmentPipeIds: string[] } {
  if (!profile || profile.stations.length < 2) return { points: [], missingAlignmentPipeIds: [] }
  const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
  const pipesByPair = new Map<string, TracedNetwork['pipes'][number]>()
  for (const pipe of network.pipes) {
    pipesByPair.set(`${pipe.fromNode}\u0000${pipe.toNode}`, pipe)
    pipesByPair.set(`${pipe.toNode}\u0000${pipe.fromNode}`, pipe)
  }

  const points: Array<Point & { chainageM: number }> = []
  const missingAlignmentPipeIds: string[] = []
  for (let index = 1; index < profile.stations.length; index++) {
    const fromId = profile.stations[index - 1].nodeId
    const toId = profile.stations[index].nodeId
    const from = nodeById.get(fromId)
    const to = nodeById.get(toId)
    if (!from || !to) continue
    const pipe = pipesByPair.get(`${fromId}\u0000${toId}`)
    let segment: Point[]
    if (pipe?.alignment && pipe.alignment.length >= 2) {
      segment = pipe.alignment.map(({ x, y }) => ({ x, y }))
      const forward = pointDistance(segment[0], from) + pointDistance(segment[segment.length - 1], to)
      const reverse = pointDistance(segment[0], to) + pointDistance(segment[segment.length - 1], from)
      if (reverse < forward) segment.reverse()
      if (!samePoint(segment[0], from, 1)) segment.unshift({ x: from.x, y: from.y })
      if (!samePoint(segment[segment.length - 1], to, 1)) segment.push({ x: to.x, y: to.y })
    } else {
      segment = [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]
      missingAlignmentPipeIds.push(pipe?.id ?? `${fromId}-${toId}`)
    }
    const segmentDistances = [0]
    for (let segmentIndex = 1; segmentIndex < segment.length; segmentIndex++) {
      segmentDistances.push(
        segmentDistances[segmentIndex - 1] + pointDistance(segment[segmentIndex - 1], segment[segmentIndex]),
      )
    }
    const geometryLength = segmentDistances[segmentDistances.length - 1]
    const fromChainageM = profile.stations[index - 1].chainageM
    const toChainageM = profile.stations[index].chainageM
    const profileLength = toChainageM - fromChainageM
    for (let segmentIndex = 0; segmentIndex < segment.length; segmentIndex++) {
      const ratio = geometryLength > 1e-9 ? segmentDistances[segmentIndex] / geometryLength : 0
      const chainageM = profileLength > 0
        ? fromChainageM + ratio * profileLength
        : fromChainageM + segmentDistances[segmentIndex]
      const point = { ...segment[segmentIndex], chainageM }
      const previous = points[points.length - 1]
      if (previous && samePoint(previous, point)) previous.chainageM = Math.max(previous.chainageM, point.chainageM)
      else points.push(point)
    }
  }
  return {
    points,
    missingAlignmentPipeIds,
  }
}

/** Preserve every pipe alignment for the full-network plan; endpoint chords are diagnostic only. */
export function workingDrawingNetworkPaths(network: TracedNetwork): {
  paths: WorkingDrawingNetworkPath[]
  missingAlignmentPipeIds: string[]
} {
  const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
  const paths: WorkingDrawingNetworkPath[] = []
  const missingAlignmentPipeIds: string[] = []
  for (const pipe of network.pipes) {
    let points = pipe.alignment?.map(({ x, y }) => ({ x, y })) ?? []
    if (points.length < 2) {
      const from = nodeById.get(pipe.fromNode)
      const to = nodeById.get(pipe.toNode)
      if (from && to) points = [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]
      missingAlignmentPipeIds.push(pipe.id)
    }
    if (points.length >= 2) paths.push({ pipeId: pipe.id, points, source: pipe.dataSource })
  }
  return { paths, missingAlignmentPipeIds }
}

function issue(
  code: string,
  message: string,
  requirement: WorkingDrawingRequirement,
  extra: Partial<Pick<WorkingDrawingIssue, 'stationM' | 'elementId'>> = {},
): WorkingDrawingIssue {
  return { code, message, requirement, ...extra }
}

function makeSource(
  requirement: WorkingDrawingRequirement,
  available: boolean,
  verified: boolean,
  source?: string,
  detail?: string,
): WorkingDrawingSource {
  return { requirement, label: sourceLabel[requirement], available, verified, source, detail }
}

function sheetStatus(
  routeStatus: WorkingDrawingInput['routeStatus'],
  blockers: WorkingDrawingIssue[],
  warnings: WorkingDrawingIssue[],
  sources: WorkingDrawingSource[],
): WorkingDrawingStatus {
  if (routeStatus === 'stale') return 'STALE'
  if (blockers.length > 0 || routeStatus === 'blocked') return 'BLOCKED'
  if (warnings.length > 0 || routeStatus === 'preliminary') return 'PRELIMINARY'
  return sources.every((source) => source.verified) ? 'VERIFIED' : 'CALCULATED'
}

function crossingIssues(input: WorkingDrawingInput): WorkingDrawingIssue[] {
  if ((input.utilityFeatureCount ?? 0) === 0) return []
  if (!input.crossings || input.crossings.length === 0) {
    return [issue(
      'CROSSING_CARDS_MISSING',
      'В DWG есть инженерные коммуникации, но карточки фактических пересечений не сформированы.',
      'crossings',
    )]
  }
  return input.crossings.flatMap((crossing) => {
    const missing: string[] = []
    if (!crossing.owner) missing.push('владелец')
    if (!crossing.size) missing.push('диаметр/размер')
    if (!crossing.source) missing.push('источник данных')
    if (!Number.isFinite(crossing.existingElevationM)) missing.push('отметка существующей сети')
    if (!Number.isFinite(crossing.designInvertElevationM)) missing.push('отметка проектной трубы')
    if (!Number.isFinite(crossing.clearanceM)) missing.push('вертикальный просвет')
    if (!Number.isFinite(crossing.requiredClearanceM)) missing.push('нормативный просвет')
    if (!crossing.method) missing.push('способ производства работ')
    if (crossing.approved !== true) missing.push('согласование')
    if (missing.length > 0) return [issue(
      'CROSSING_CARD_INCOMPLETE',
      `Пересечение ${crossing.id}: не заполнено — ${missing.join(', ')}.`,
      'crossings',
      { stationM: crossing.stationM, elementId: crossing.id },
    )]
    if ((crossing.clearanceM as number) < (crossing.requiredClearanceM as number)) return [issue(
      'CROSSING_CLEARANCE_INSUFFICIENT',
      `Пересечение ${crossing.id}: фактический просвет ${(crossing.clearanceM as number).toFixed(3)} м меньше требуемого ${(crossing.requiredClearanceM as number).toFixed(3)} м.`,
      'crossings',
      { stationM: crossing.stationM, elementId: crossing.id },
    )]
    return []
  })
}

function deliverableRequirementIssues(input: WorkingDrawingInput): WorkingDrawingIssue[] {
  const requirements = input.deliverableRequirements
  if (!requirements) return [issue(
    'DELIVERABLE_REQUIREMENTS_MISSING',
    'Не загружен и не подтверждён утверждённый состав проектного комплекта; окончательный выпуск запрещён.',
    'deliverables',
  )]
  const issues: WorkingDrawingIssue[] = []
  if (!requirements.source.trim()) issues.push(issue(
    'DELIVERABLE_SOURCE_MISSING',
    'Не указан источник утверждённого состава комплекта.',
    'deliverables',
  ))
  if (!requirements.verified) issues.push(issue(
    'DELIVERABLE_REQUIREMENTS_UNVERIFIED',
    'Состав комплекта не подтверждён ответственным специалистом.',
    'deliverables',
  ))
  return issues
}

function protectiveGridIssues(design: ProtectiveGridDesign | null | undefined): WorkingDrawingIssue[] {
  if (!design) return [issue(
    'PROTECTIVE_GRID_DESIGN_MISSING',
    'Требуется лист защитной сетки, но отсутствуют подтверждённые размеры и конструктивные параметры изделия.',
    'protective_grid',
  )]
  const missing: string[] = []
  if (!(design.quantity > 0)) missing.push('количество')
  if (!(design.overallWidthMm > 0)) missing.push('общая ширина')
  if (!(design.overallHeightMm > 0)) missing.push('общая высота')
  if (!(design.barSpacingMm > 0)) missing.push('шаг стержней')
  if (!design.frameProfile.trim()) missing.push('профиль рамы')
  if (!design.barProfile.trim()) missing.push('профиль стержней')
  if (!design.material.trim()) missing.push('материал')
  if (!design.coating.trim()) missing.push('покрытие')
  if (!design.fixing.trim()) missing.push('крепление')
  if (!design.source.trim()) missing.push('источник')
  const issues = missing.length > 0 ? [issue(
    'PROTECTIVE_GRID_DESIGN_INCOMPLETE',
    `Не заполнены параметры защитной сетки: ${missing.join(', ')}.`,
    'protective_grid',
  )] : []
  if (!design.verified) issues.push(issue(
    'PROTECTIVE_GRID_DESIGN_UNVERIFIED',
    'Конструкция защитной сетки не подтверждена ответственным специалистом.',
    'protective_grid',
  ))
  return issues
}

function sharedPlanChecks(
  input: WorkingDrawingInput,
  missingAlignmentPipeIds: string[],
): { blockers: WorkingDrawingIssue[]; warnings: WorkingDrawingIssue[]; sources: WorkingDrawingSource[] } {
  const blockers: WorkingDrawingIssue[] = []
  const warnings: WorkingDrawingIssue[] = []
  const surveyCount = input.surveyPoints?.length ?? 0
  const georeferenced = !!input.georeference && input.georeference.kind !== 'unreferenced'
  if (input.routeStatus === 'blocked') blockers.push(issue('ROUTE_BLOCKED', 'Проектная трасса имеет неустранённые стоп-факторы.', 'route'))
  if (input.routeStatus === 'stale') blockers.push(issue('ROUTE_STALE', 'Исходные данные изменены; трассу необходимо пересчитать.', 'route'))
  if (missingAlignmentPipeIds.length > 0) blockers.push(issue(
    'PIPE_ALIGNMENT_MISSING',
    `У ${missingAlignmentPipeIds.length} участков отсутствует фактическая полилиния оси; соединение конечных точек не допускается.`,
    'route',
  ))
  if (!georeferenced) blockers.push(issue('GEOREFERENCE_MISSING', 'Не подтверждена система координат или геопривязка проекта.', 'georeference'))
  if (surveyCount < 2) blockers.push(issue('TOPOGRAPHY_MISSING', 'Недостаточно точек топографической съёмки для планов и профилей.', 'topography'))
  if ((input.unresolvedLayerCount ?? 0) > 0) blockers.push(issue(
    'DWG_LAYERS_UNRESOLVED',
    `Не классифицировано слоёв DWG: ${input.unresolvedLayerCount}.`,
    'dwg_classification',
  ))
  for (const blocker of input.routeBlockers ?? []) {
    const message = typeof blocker === 'string' ? blocker : blocker.message
    if (message) blockers.push(issue(typeof blocker === 'string' ? 'ROUTE_INPUT_BLOCKER' : blocker.code ?? 'ROUTE_INPUT_BLOCKER', message, 'route'))
  }
  blockers.push(...deliverableRequirementIssues(input))
  if (input.routeStatus === 'preliminary') warnings.push(issue('ROUTE_PRELIMINARY', 'Трасса имеет предварительный статус.', 'route'))
  const sources = [
    makeSource('route', input.network.pipes.length > 0 && missingAlignmentPipeIds.length === 0, input.routeStatus === 'calculated', undefined, `${input.network.pipes.length} участков`),
    makeSource('georeference', georeferenced, georeferenced, input.georeference?.source),
    makeSource('topography', surveyCount >= 2, surveyCount >= 2, undefined, `${surveyCount} точек`),
    makeSource('dwg_classification', (input.unresolvedLayerCount ?? 0) === 0, (input.unresolvedLayerCount ?? 0) === 0),
  ]
  return { blockers, warnings, sources }
}

function sheetHash(inputHash: string, kind: WorkingDrawingKind, number: number, interval?: SheetInterval): string {
  return workingDrawingInputHash({ inputHash, kind, number, interval })
}

/** Build the auditable, data-driven drawing register. No reference-project values enter the calculation. */
export function buildWorkingDrawingSet(input: WorkingDrawingInput): WorkingDrawingSet {
  const path = workingDrawingMainPath(input.network, input.profile)
  const networkPaths = workingDrawingNetworkPaths(input.network)
  const opts = {
    planLengthM: input.options?.planLengthM ?? 550,
    profileLengthM: input.options?.profileLengthM ?? 850,
    planMarginM: input.options?.planMarginM ?? 60,
    materialRowsPerSheet: input.options?.materialRowsPerSheet ?? 27,
    specificationRowsPerSheet: input.options?.specificationRowsPerSheet ?? 20,
  }
  const inputHash = workingDrawingInputHash({
    revision: input.revision,
    system: input.system,
    routeStatus: input.routeStatus,
    nodes: input.network.nodes,
    pipes: input.network.pipes.map((pipe) => ({ id: pipe.id, lengthM: pipe.lengthM, alignment: pipe.alignment, dataSource: pipe.dataSource })),
    profile: input.profile,
    schedule: input.schedule,
    surveyPoints: input.surveyPoints ?? [],
    georeference: input.georeference,
    routeBlockers: input.routeBlockers,
    unresolvedLayerCount: input.unresolvedLayerCount ?? 0,
    catalogReady: input.catalogReady,
    catalogFingerprint: input.catalogFingerprint,
    hydraulicsReady: input.hydraulicsReady,
    stormRunoff: input.stormRunoff,
    crossings: input.crossings,
    utilityFeatureCount: input.utilityFeatureCount ?? 0,
    constraintsFingerprint: input.constraintsFingerprint,
    deliverableRequirements: input.deliverableRequirements,
    protectiveGridDesign: input.protectiveGridDesign,
    spatialBoreholeCount: input.spatialBoreholeCount ?? 0,
    geologyCoverage: input.geologyCoverage,
    freezingDepth: input.freezingDepth,
    geologyFingerprint: input.geologyFingerprint,
    manholeCatalogReady: input.manholeCatalogReady ?? false,
    manholeCatalogMissingLabels: input.manholeCatalogMissingLabels ?? [],
    manholeCatalogFingerprint: input.manholeCatalogFingerprint,
    specificationItemCount: input.specificationItemCount,
    normsVerified: input.normsVerified ?? false,
    normsFingerprint: input.normsFingerprint,
    opts,
  })

  const planChecks = sharedPlanChecks(input, path.missingAlignmentPipeIds)
  const planWindowsList = path.points.length >= 2
    ? planWindows(
      path.points,
      opts.planLengthM,
      opts.planMarginM,
      input.profile?.stations.map((station) => station.chainageM),
    )
    : []
  const planItems: Array<{ interval?: SheetInterval; window?: PlanWindow }> = planWindowsList.length > 0
    ? planWindowsList.map((window) => ({ interval: window, window }))
    : [{ interval: undefined, window: undefined }]

  const sheets: WorkingDrawingSheet[] = []
  let number = 4
  for (const item of planItems) {
    const blockers = [...planChecks.blockers]
    if (!item.interval) blockers.push(issue('PLAN_GEOMETRY_MISSING', 'Нет непрерывной проектной оси для формирования планового листа.', 'route'))
    const title = `План ${input.system === 'storm' ? 'К2' : 'К1'}${item.interval ? ` ${item.interval.label}` : ''}. М1:500`
    const sources = [...planChecks.sources]
    const warnings = [...planChecks.warnings]
    sheets.push({
      id: `plan-${number}`,
      sequence: sheets.length + 1,
      documentSet: 'working_drawings',
      sheetNumber: number,
      title,
      kind: 'plan',
      variant: 'route_plan',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['route', 'georeference', 'topography', 'dwg_classification'],
      sources,
      inputHash: sheetHash(inputHash, 'plan', number, item.interval),
      interval: item.interval,
      window: item.window,
    })
    number++
  }

  {
    const blockers = [...planChecks.blockers]
    const warnings = [...planChecks.warnings]
    if (networkPaths.paths.length === 0) blockers.push(issue(
      'NETWORK_GEOMETRY_MISSING',
      'Нет геометрии сети для формирования сводного плана.',
      'route',
    ))
    if (networkPaths.missingAlignmentPipeIds.length > 0) blockers.push(issue(
      'NETWORK_ALIGNMENT_MISSING',
      `У ${networkPaths.missingAlignmentPipeIds.length} участков сводного плана отсутствуют фактические полилинии.`,
      'route',
    ))
    const sources = [...planChecks.sources]
    sheets.push({
      id: `network-plan-${number}`,
      sequence: sheets.length + 1,
      documentSet: 'working_drawings',
      sheetNumber: number,
      title: `Сводный план сетей ${input.system === 'storm' ? 'К2' : 'К1'}. М1:500`,
      kind: 'network_plan',
      variant: 'network_plan',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['route', 'georeference', 'topography', 'dwg_classification'],
      sources,
      inputHash: sheetHash(inputHash, 'network_plan', number),
    })
    number++
  }

  const profileSpecs = input.profile
    ? profileSheetSpecs(input.profile, input.system, opts.profileLengthM)
    : []
  const profileItems = profileSpecs.length > 0 ? profileSpecs : [{ title: `Профиль ${input.system === 'storm' ? 'К2' : 'К1'}`, interval: undefined }]
  for (const item of profileItems) {
    const blockers = [...planChecks.blockers]
    const warnings = [...planChecks.warnings]
    if (!input.profile || input.profile.stations.length < 2) blockers.push(issue('PROFILE_DATA_MISSING', 'Не рассчитаны отметки продольного профиля.', 'hydraulics'))
    const gravityPipeIds = input.network.pipes
      .filter((pipe) => pipe.systemType !== 'pressure' && pipe.kind !== 'pressure_main' && pipe.kind !== 'discharge')
      .map((pipe) => pipe.id)
    const profiledPipeIds = new Set(input.profile?.pipeIds ?? [])
    const unprofiledPipeIds = gravityPipeIds.filter((pipeId) => !profiledPipeIds.has(pipeId))
    if (input.profile && unprofiledPipeIds.length > 0) blockers.push(issue(
      'PROFILE_BRANCHES_MISSING',
      `Продольный профиль не покрывает ${unprofiledPipeIds.length} участков разветвлённой сети; требуются отдельные профили ветвей.`,
      'hydraulics',
    ))
    if (!input.hydraulicsReady) blockers.push(issue('HYDRAULICS_NOT_VERIFIED', 'Гидравлический расчёт содержит ошибки или не завершён.', 'hydraulics'))
    if (input.system === 'storm' && input.stormRunoff?.verified !== true) blockers.push(issue(
      'STORM_RUNOFF_NOT_VERIFIED',
      input.stormRunoff?.blockers?.length
        ? `Расчёт дождевого стока не подтверждён: ${input.stormRunoff.blockers.join('; ')}`
        : 'Для К2 отсутствует подтверждённый расчёт дождевого стока по параметрам водосборов и дождя.',
      'storm_runoff',
    ))
    if (!input.catalogReady) blockers.push(issue('CATALOG_MISSING', 'Не подтверждён активный каталог труб и материалов.', 'catalog'))
    const spatialBoreholeCount = input.spatialBoreholeCount ?? 0
    const geologyCoverageAvailable = input.geologyCoverage?.maxOffsetM != null
      && Number.isFinite(input.geologyCoverage.maxOffsetM)
      && input.geologyCoverage.maxOffsetM > 0
    const geologyCoverageVerified = geologyCoverageAvailable
      && input.geologyCoverage?.status === 'verified'
      && Boolean(input.geologyCoverage.source?.trim())
    if (spatialBoreholeCount === 0) blockers.push(issue(
      'SPATIAL_GEOLOGY_MISSING',
      'Нет скважин с координатами для построения геологии вдоль трассы.',
      'geology',
    ))
    if (!geologyCoverageVerified) blockers.push(issue(
      'GEOLOGY_COVERAGE_UNVERIFIED',
      'Не подтверждены допустимое удаление скважин от трассы и источник правила пространственного покрытия геологией.',
      'geology',
    ))
    const freezingDepthAvailable = input.freezingDepth?.valueM != null
      && Number.isFinite(input.freezingDepth.valueM)
      && input.freezingDepth.valueM >= 0
    const freezingDepthVerified = freezingDepthAvailable
      && input.freezingDepth?.status === 'verified'
      && Boolean(input.freezingDepth.source?.trim())
    if (!freezingDepthVerified) blockers.push(issue(
      'FREEZING_DEPTH_UNVERIFIED',
      'Расчётная глубина промерзания отсутствует либо не подтверждена источником; окончательный продольный профиль выпускать нельзя.',
      'freezing_depth',
    ))
    blockers.push(...crossingIssues(input))
    if (!input.normsVerified) warnings.push(issue('NORMS_REQUIRE_REVIEW', 'Не все применённые нормативные правила подтверждены инженером.', 'norms'))
    const sources = [
      ...planChecks.sources,
      makeSource('hydraulics', !!input.profile && input.hydraulicsReady, input.hydraulicsReady, undefined, input.profile ? `${input.profile.stations.length} станций` : undefined),
      ...(input.system === 'storm' ? [makeSource(
        'storm_runoff',
        input.stormRunoff?.available === true,
        input.stormRunoff?.verified === true,
        input.stormRunoff?.source,
        input.stormRunoff?.detail,
      )] : []),
      makeSource('catalog', input.catalogReady, input.catalogReady),
      makeSource(
        'geology',
        spatialBoreholeCount > 0 && geologyCoverageAvailable,
        spatialBoreholeCount > 0 && geologyCoverageVerified,
        input.geologyCoverage?.source,
        `${spatialBoreholeCount} скважин в допуске; максимальное удаление ${
          geologyCoverageAvailable ? `${input.geologyCoverage!.maxOffsetM!.toFixed(2)} м` : 'не задано'
        }`,
      ),
      makeSource(
        'freezing_depth',
        freezingDepthAvailable,
        freezingDepthVerified,
        input.freezingDepth?.source,
        freezingDepthAvailable ? `${input.freezingDepth?.valueM?.toFixed(2)} м` : undefined,
      ),
      makeSource('crossings', (input.utilityFeatureCount ?? 0) === 0 || (input.crossings?.length ?? 0) > 0, crossingIssues(input).length === 0),
      makeSource('norms', true, input.normsVerified ?? false),
    ]
    sheets.push({
      id: `profile-${number}`,
      sequence: sheets.length + 1,
      documentSet: 'working_drawings',
      sheetNumber: number,
      title: item.title,
      kind: 'profile',
      variant: 'main_profile',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: [
        'route', 'topography', 'hydraulics',
        ...(input.system === 'storm' ? ['storm_runoff' as const] : []),
        'catalog', 'geology', 'freezing_depth', 'crossings', 'norms',
      ],
      sources,
      inputHash: sheetHash(inputHash, 'profile', number, item.interval),
      interval: item.interval,
    })
    number++
  }

  const manholeCount = input.schedule?.manholes.length ?? 0
  const materialSheetCount = Math.max(1, Math.ceil(manholeCount / opts.materialRowsPerSheet))
  for (let part = 0; part < materialSheetCount; part++) {
    const blockers: WorkingDrawingIssue[] = []
    const warnings: WorkingDrawingIssue[] = []
    if (!input.schedule || manholeCount === 0) blockers.push(issue('MANHOLE_SCHEDULE_MISSING', 'Не рассчитана ведомость колодцев.', 'manhole_catalog'))
    if (!input.manholeCatalogReady) blockers.push(issue(
      'MANHOLE_CONSTRUCTION_MISSING',
      input.manholeCatalogMissingLabels?.length
        ? `Не подобрана подтверждённая конструкция для: ${input.manholeCatalogMissingLabels.join(', ')}. Расход сборных элементов считать нельзя.`
        : 'Не выбран подтверждённый параметрический каталог конструкций колодцев; расход сборных элементов считать нельзя.',
      'manhole_catalog',
    ))
    if (!input.catalogReady) blockers.push(issue('CATALOG_MISSING', 'Не подтверждён активный каталог материалов.', 'catalog'))
    const sources = [
      makeSource('manhole_catalog', !!input.schedule && manholeCount > 0 && !!input.manholeCatalogReady, !!input.manholeCatalogReady, undefined, `${manholeCount} колодцев`),
      makeSource('catalog', input.catalogReady, input.catalogReady),
      makeSource('norms', true, input.normsVerified ?? false),
    ]
    if (!input.normsVerified) warnings.push(issue('NORMS_REQUIRE_REVIEW', 'Типовые решения и нормативные ссылки требуют подтверждения инженером.', 'norms'))
    sheets.push({
      id: `materials-${number}`,
      sequence: sheets.length + 1,
      documentSet: 'working_drawings',
      sheetNumber: number,
      title: `Таблица расхода материалов по сборным канализационным колодцам${materialSheetCount > 1 ? `, часть ${part + 1}` : ''}`,
      kind: 'material_table',
      variant: 'material_schedule',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['manhole_catalog', 'catalog', 'norms'],
      sources,
      inputHash: sheetHash(inputHash, 'material_table', number),
      dataRange: {
        start: part * opts.materialRowsPerSheet,
        end: Math.min((part + 1) * opts.materialRowsPerSheet, manholeCount),
        total: manholeCount,
      },
    })
    number++
  }

  const crossingCount = Math.max(input.utilityFeatureCount ?? 0, input.crossings?.length ?? 0)
  if (input.deliverableRequirements?.crossingDetailSheets) {
    const crossingsPerSheet = 8
    const detailSheetCount = Math.max(1, Math.ceil(crossingCount / crossingsPerSheet))
    for (let part = 0; part < detailSheetCount; part++) {
      const start = part * crossingsPerSheet
      const end = start + crossingsPerSheet
      const selected = input.crossings?.slice(start, end) ?? []
      const blockers = crossingIssues({
        ...input,
        utilityFeatureCount: Math.min(crossingsPerSheet, Math.max(crossingCount - start, 0)),
        crossings: selected,
      })
      blockers.push(...deliverableRequirementIssues(input))
      if (crossingCount === 0) blockers.push(issue(
        'CROSSING_DETAIL_SOURCE_MISSING',
        'Состав комплекта требует листы пересечений, но подтверждённые карточки пересечений отсутствуют.',
        'crossings',
      ))
      const warnings = input.normsVerified ? [] : [issue(
        'NORMS_REQUIRE_REVIEW',
        'Нормативные просветы и конструктивные решения пересечений требуют подтверждения инженером.',
        'norms',
      )]
      const sources = [
        makeSource(
          'deliverables',
          Boolean(input.deliverableRequirements?.source),
          input.deliverableRequirements?.verified === true,
          input.deliverableRequirements?.source,
        ),
        makeSource('crossings', selected.length > 0, blockers.length === 0, undefined, `${selected.length} карточек на листе`),
        makeSource('norms', true, input.normsVerified ?? false),
        makeSource('catalog', input.catalogReady, input.catalogReady),
      ]
      if (!input.catalogReady) blockers.push(issue('CATALOG_MISSING', 'Не подтверждены материалы футляров и узлов пересечений.', 'catalog'))
      sheets.push({
        id: `crossings-${number}`,
        sequence: sheets.length + 1,
        documentSet: 'working_drawings',
        sheetNumber: number,
        title: `Пересечения с существующими коммуникациями${detailSheetCount > 1 ? `, часть ${part + 1}` : ''}`,
        kind: 'detail',
        variant: 'crossing_detail',
        status: sheetStatus(input.routeStatus, blockers, warnings, sources),
        blockers,
        warnings,
        requirements: ['crossings', 'catalog', 'norms'],
        sources,
        inputHash: sheetHash(inputHash, 'detail', number),
        dataRange: { start, end: Math.min(end, crossingCount), total: crossingCount },
      })
      number++
    }
  }

  if (input.deliverableRequirements?.protectiveGridDetail) {
    const blockers: WorkingDrawingIssue[] = [
      ...deliverableRequirementIssues(input),
      ...protectiveGridIssues(input.protectiveGridDesign),
    ]
    const warnings: WorkingDrawingIssue[] = []
    if (!input.normsVerified) warnings.push(issue('NORMS_REQUIRE_REVIEW', 'Конструктивные решения требуют подтверждения инженером.', 'norms'))
    const sources = [
      makeSource(
        'deliverables',
        Boolean(input.deliverableRequirements.source),
        input.deliverableRequirements.verified,
        input.deliverableRequirements.source,
      ),
      makeSource(
        'protective_grid',
        Boolean(input.protectiveGridDesign),
        input.protectiveGridDesign?.verified === true && protectiveGridIssues(input.protectiveGridDesign).length === 0,
        input.protectiveGridDesign?.source,
        input.protectiveGridDesign ? `${input.protectiveGridDesign.quantity} шт.` : undefined,
      ),
      makeSource('norms', true, input.normsVerified ?? false),
    ]
    sheets.push({
      id: `protective-grid-${number}`,
      sequence: sheets.length + 1,
      documentSet: 'working_drawings',
      sheetNumber: number,
      title: 'Защитная сетка для смотровых колодцев',
      kind: 'detail',
      variant: 'protective_grid',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['deliverables', 'protective_grid', 'norms'],
      sources,
      inputHash: sheetHash(inputHash, 'detail', number),
    })
    number++
  }

  {
    const blockers: WorkingDrawingIssue[] = []
    const warnings: WorkingDrawingIssue[] = []
    if (!input.schedule) blockers.push(issue('SPECIFICATION_SOURCE_MISSING', 'Нет расчётной ведомости труб и сооружений.', 'catalog'))
    if (!input.catalogReady) blockers.push(issue('CATALOG_MISSING', 'Не подтверждён активный каталог материалов.', 'catalog'))
    if (manholeCount > 0 && !input.manholeCatalogReady) blockers.push(issue(
      'MANHOLE_CONSTRUCTION_MISSING',
      'Поэлементная спецификация колодцев невозможна без параметрического каталога конструкций.',
      'manhole_catalog',
    ))
    blockers.push(...crossingIssues(input))
    if (!input.normsVerified) warnings.push(issue('NORMS_REQUIRE_REVIEW', 'Обозначения и нормативные ссылки спецификации требуют подтверждения.', 'norms'))
    const sources = [
      makeSource('catalog', input.catalogReady, input.catalogReady, undefined, `${input.schedule?.pipes.length ?? 0} групп труб`),
      makeSource('manhole_catalog', manholeCount === 0 || !!input.manholeCatalogReady, manholeCount === 0 || !!input.manholeCatalogReady),
      makeSource('crossings', crossingCount === 0 || (input.crossings?.length ?? 0) > 0, crossingIssues(input).length === 0),
      makeSource('norms', true, input.normsVerified ?? false),
    ]
    const specificationItemCount = input.specificationItemCount ?? input.schedule?.pipes.length ?? 0
    const specificationSheetCount = Math.max(1, Math.ceil(specificationItemCount / opts.specificationRowsPerSheet))
    for (let part = 0; part < specificationSheetCount; part++) {
      const specificationNumber = part + 1
      const start = part * opts.specificationRowsPerSheet
      const end = Math.min((part + 1) * opts.specificationRowsPerSheet, specificationItemCount)
      sheets.push({
        id: `specification-${specificationNumber}`,
        sequence: sheets.length + 1,
        documentSet: 'specification',
        sheetNumber: specificationNumber,
        title: `Спецификация оборудования, изделий и материалов${specificationSheetCount > 1 ? `, часть ${specificationNumber}` : ''}`,
        kind: 'specification',
        variant: 'specification',
        status: sheetStatus(input.routeStatus, blockers, warnings, sources),
        blockers: [...blockers],
        warnings: [...warnings],
        requirements: ['catalog', 'manhole_catalog', 'crossings', 'norms'],
        sources: [...sources],
        inputHash: sheetHash(inputHash, 'specification', specificationNumber),
        dataRange: { start, end, total: specificationItemCount },
      })
    }
  }

  const statusCounts = (status: WorkingDrawingStatus) => sheets.filter((sheet) => sheet.status === status).length
  return {
    sheets,
    mainPath: path.points,
    networkPaths: networkPaths.paths,
    missingAlignmentPipeIds: path.missingAlignmentPipeIds,
    missingNetworkAlignmentPipeIds: networkPaths.missingAlignmentPipeIds,
    protectiveGridDesign: input.protectiveGridDesign ?? null,
    inputHash,
    layoutPolicy: opts,
    summary: {
      total: sheets.length,
      blocked: statusCounts('BLOCKED'),
      preliminary: statusCounts('PRELIMINARY'),
      calculated: statusCounts('CALCULATED'),
      verified: statusCounts('VERIFIED'),
      stale: statusCounts('STALE'),
      draftExportAllowed: sheets.length > 0 && sheets.every((sheet) => sheet.status === 'CALCULATED' || sheet.status === 'VERIFIED'),
      finalExportAllowed: sheets.length > 0 && sheets.every((sheet) => sheet.status === 'VERIFIED'),
    },
  }
}
