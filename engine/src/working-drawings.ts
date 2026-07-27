import type { SurveyPoint } from './types'
import type { GravityProfile, SewerSchedule } from './norms/gravity'
import { planWindows, profileSheetSpecs, type PlanWindow, type SheetInterval } from './norms/sheetset'
import type { TracedNetwork } from './trace'

export type WorkingDrawingStatus = 'BLOCKED' | 'PRELIMINARY' | 'CALCULATED' | 'VERIFIED' | 'STALE'

export type WorkingDrawingKind =
  | 'plan'
  | 'profile'
  | 'material_table'
  | 'detail'
  | 'specification'

export type WorkingDrawingRequirement =
  | 'route'
  | 'georeference'
  | 'topography'
  | 'dwg_classification'
  | 'hydraulics'
  | 'catalog'
  | 'geology'
  | 'crossings'
  | 'manhole_catalog'
  | 'norms'

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
  sheetNumber: number
  title: string
  kind: WorkingDrawingKind
  status: WorkingDrawingStatus
  blockers: WorkingDrawingIssue[]
  warnings: WorkingDrawingIssue[]
  requirements: WorkingDrawingRequirement[]
  sources: WorkingDrawingSource[]
  inputHash: string
  interval?: SheetInterval
  window?: PlanWindow
  /** Comparable page group in the approved album; not an input to engineering calculations. */
  referenceGroup: 'pages-4-32' | 'pages-33-52' | 'pages-53-57' | 'page-58' | 'pages-59-61'
}

export interface WorkingDrawingSet {
  sheets: WorkingDrawingSheet[]
  mainPath: Array<{ x: number; y: number; chainageM: number }>
  missingAlignmentPipeIds: string[]
  inputHash: string
  summary: {
    total: number
    blocked: number
    preliminary: number
    calculated: number
    verified: number
    stale: number
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
  utilityFeatureCount?: number
  crossings?: CrossingRecord[]
  spatialBoreholeCount?: number
  /** Full source fingerprints are included so same-count edits still invalidate sheets. */
  geologyFingerprint?: unknown
  catalogFingerprint?: unknown
  manholeCatalogFingerprint?: unknown
  /** Labels that could not be matched to a verified construction. */
  manholeCatalogMissingLabels?: string[]
  normsFingerprint?: unknown
  manholeCatalogReady?: boolean
  normsVerified?: boolean
  revision?: number | string
  options?: {
    planLengthM?: number
    profileLengthM?: number
    planMarginM?: number
    materialRowsPerSheet?: number
  }
}

type Point = { x: number; y: number }

const sourceLabel: Record<WorkingDrawingRequirement, string> = {
  route: 'Проектная ось и сеть',
  georeference: 'Система координат и геопривязка',
  topography: 'Топографическая поверхность',
  dwg_classification: 'Классификация слоёв DWG',
  hydraulics: 'Гидравлический расчёт и продольные отметки',
  catalog: 'Активный каталог труб и материалов',
  geology: 'Пространственная инженерная геология',
  crossings: 'Карточки пересечений',
  manhole_catalog: 'Параметрические конструкции колодцев',
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

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function samePoint(a: Point, b: Point, toleranceM = 0.01): boolean {
  return pointDistance(a, b) <= toleranceM
}

function appendPath(target: Point[], points: Point[]): void {
  for (const point of points) {
    if (target.length === 0 || !samePoint(target[target.length - 1], point)) target.push(point)
  }
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

  const points: Point[] = []
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
    appendPath(points, segment)
  }

  let chainageM = 0
  return {
    points: points.map((point, index) => {
      if (index > 0) chainageM += pointDistance(points[index - 1], point)
      return { ...point, chainageM }
    }),
    missingAlignmentPipeIds,
  }
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
    return missing.length === 0 ? [] : [issue(
      'CROSSING_CARD_INCOMPLETE',
      `Пересечение ${crossing.id}: не заполнено — ${missing.join(', ')}.`,
      'crossings',
      { stationM: crossing.stationM, elementId: crossing.id },
    )]
  })
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
  const opts = {
    planLengthM: input.options?.planLengthM ?? 550,
    profileLengthM: input.options?.profileLengthM ?? 850,
    planMarginM: input.options?.planMarginM ?? 60,
    materialRowsPerSheet: input.options?.materialRowsPerSheet ?? 27,
  }
  const inputHash = workingDrawingInputHash({
    revision: input.revision,
    routeStatus: input.routeStatus,
    nodeCount: input.network.nodes.length,
    pipes: input.network.pipes.map((pipe) => ({ id: pipe.id, lengthM: pipe.lengthM, alignment: pipe.alignment, dataSource: pipe.dataSource })),
    profile: input.profile,
    surveyPoints: input.surveyPoints ?? [],
    georeference: input.georeference,
    routeBlockers: input.routeBlockers,
    unresolvedLayerCount: input.unresolvedLayerCount ?? 0,
    catalogReady: input.catalogReady,
    catalogFingerprint: input.catalogFingerprint,
    hydraulicsReady: input.hydraulicsReady,
    crossings: input.crossings,
    spatialBoreholeCount: input.spatialBoreholeCount ?? 0,
    geologyFingerprint: input.geologyFingerprint,
    manholeCatalogReady: input.manholeCatalogReady ?? false,
    manholeCatalogMissingLabels: input.manholeCatalogMissingLabels ?? [],
    manholeCatalogFingerprint: input.manholeCatalogFingerprint,
    normsVerified: input.normsVerified ?? false,
    normsFingerprint: input.normsFingerprint,
    opts,
  })

  const planChecks = sharedPlanChecks(input, path.missingAlignmentPipeIds)
  const planWindowsList = path.points.length >= 2
    ? planWindows(path.points, opts.planLengthM, opts.planMarginM)
    : []
  const planItems: Array<{ interval?: SheetInterval; window?: PlanWindow }> = planWindowsList.length > 0
    ? planWindowsList.map((window) => ({ interval: window, window }))
    : [{ interval: undefined, window: undefined }]

  const sheets: WorkingDrawingSheet[] = []
  let number = 3
  for (const item of planItems) {
    const blockers = [...planChecks.blockers]
    if (!item.interval) blockers.push(issue('PLAN_GEOMETRY_MISSING', 'Нет непрерывной проектной оси для формирования планового листа.', 'route'))
    const title = `План ${input.system === 'storm' ? 'К2' : 'К1'}${item.interval ? ` ${item.interval.label}` : ''}. М1:500`
    const sources = [...planChecks.sources]
    const warnings = [...planChecks.warnings]
    sheets.push({
      id: `plan-${number}`,
      sheetNumber: number,
      title,
      kind: 'plan',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['route', 'georeference', 'topography', 'dwg_classification'],
      sources,
      inputHash: sheetHash(inputHash, 'plan', number, item.interval),
      interval: item.interval,
      window: item.window,
      referenceGroup: 'pages-4-32',
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
    if (!input.hydraulicsReady) blockers.push(issue('HYDRAULICS_NOT_VERIFIED', 'Гидравлический расчёт содержит ошибки или не завершён.', 'hydraulics'))
    if (!input.catalogReady) blockers.push(issue('CATALOG_MISSING', 'Не подтверждён активный каталог труб и материалов.', 'catalog'))
    if ((input.spatialBoreholeCount ?? 0) === 0) blockers.push(issue(
      'SPATIAL_GEOLOGY_MISSING',
      'Нет скважин с координатами для построения геологии вдоль трассы.',
      'geology',
    ))
    blockers.push(...crossingIssues(input))
    if (!input.normsVerified) warnings.push(issue('NORMS_REQUIRE_REVIEW', 'Не все применённые нормативные правила подтверждены инженером.', 'norms'))
    const sources = [
      ...planChecks.sources,
      makeSource('hydraulics', !!input.profile && input.hydraulicsReady, input.hydraulicsReady, undefined, input.profile ? `${input.profile.stations.length} станций` : undefined),
      makeSource('catalog', input.catalogReady, input.catalogReady),
      makeSource('geology', (input.spatialBoreholeCount ?? 0) > 0, (input.spatialBoreholeCount ?? 0) > 0, undefined, `${input.spatialBoreholeCount ?? 0} скважин с координатами`),
      makeSource('crossings', (input.utilityFeatureCount ?? 0) === 0 || (input.crossings?.length ?? 0) > 0, crossingIssues(input).length === 0),
      makeSource('norms', true, input.normsVerified ?? false),
    ]
    sheets.push({
      id: `profile-${number}`,
      sheetNumber: number,
      title: item.title,
      kind: 'profile',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['route', 'topography', 'hydraulics', 'catalog', 'geology', 'crossings', 'norms'],
      sources,
      inputHash: sheetHash(inputHash, 'profile', number, item.interval),
      interval: item.interval,
      referenceGroup: 'pages-33-52',
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
      sheetNumber: number,
      title: `Таблица расхода материалов по сборным канализационным колодцам${materialSheetCount > 1 ? `, часть ${part + 1}` : ''}`,
      kind: 'material_table',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['manhole_catalog', 'catalog', 'norms'],
      sources,
      inputHash: sheetHash(inputHash, 'material_table', number),
      referenceGroup: 'pages-53-57',
    })
    number++
  }

  const crossingCount = Math.max(input.utilityFeatureCount ?? 0, input.crossings?.length ?? 0)
  if (crossingCount > 0) {
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
      const warnings = input.normsVerified ? [] : [issue(
        'NORMS_REQUIRE_REVIEW',
        'Нормативные просветы и конструктивные решения пересечений требуют подтверждения инженером.',
        'norms',
      )]
      const sources = [
        makeSource('crossings', selected.length > 0, blockers.length === 0, undefined, `${selected.length} карточек на листе`),
        makeSource('norms', true, input.normsVerified ?? false),
        makeSource('catalog', input.catalogReady, input.catalogReady),
      ]
      if (!input.catalogReady) blockers.push(issue('CATALOG_MISSING', 'Не подтверждены материалы футляров и узлов пересечений.', 'catalog'))
      sheets.push({
        id: `crossings-${number}`,
        sheetNumber: number,
        title: `Пересечения с существующими коммуникациями${detailSheetCount > 1 ? `, часть ${part + 1}` : ''}`,
        kind: 'detail',
        status: sheetStatus(input.routeStatus, blockers, warnings, sources),
        blockers,
        warnings,
        requirements: ['crossings', 'catalog', 'norms'],
        sources,
        inputHash: sheetHash(inputHash, 'detail', number),
        referenceGroup: 'page-58',
      })
      number++
    }
  }

  if (manholeCount > 0) {
    const blockers: WorkingDrawingIssue[] = []
    const warnings: WorkingDrawingIssue[] = []
    if (!input.manholeCatalogReady) blockers.push(issue(
      'MANHOLE_CONSTRUCTION_MISSING',
      input.manholeCatalogMissingLabels?.length
        ? `Не подобраны конструкции: ${input.manholeCatalogMissingLabels.join(', ')}.`
        : 'Не выбран подтверждённый параметрический каталог колодцев и камер.',
      'manhole_catalog',
    ))
    if (!input.normsVerified) warnings.push(issue('NORMS_REQUIRE_REVIEW', 'Конструктивные решения требуют подтверждения инженером.', 'norms'))
    const sources = [
      makeSource('manhole_catalog', !!input.manholeCatalogReady, !!input.manholeCatalogReady, undefined, `${manholeCount} сооружений`),
      makeSource('norms', true, input.normsVerified ?? false),
    ]
    sheets.push({
      id: `structures-${number}`,
      sheetNumber: number,
      title: 'Колодцы и камеры. Параметрические конструктивные решения',
      kind: 'detail',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['manhole_catalog', 'norms'],
      sources,
      inputHash: sheetHash(inputHash, 'detail', number),
      referenceGroup: 'pages-59-61',
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
    sheets.push({
      id: `specification-${number}`,
      sheetNumber: number,
      title: 'Спецификация оборудования, изделий и материалов',
      kind: 'specification',
      status: sheetStatus(input.routeStatus, blockers, warnings, sources),
      blockers,
      warnings,
      requirements: ['catalog', 'manhole_catalog', 'crossings', 'norms'],
      sources,
      inputHash: sheetHash(inputHash, 'specification', number),
      referenceGroup: 'pages-59-61',
    })
  }

  const statusCounts = (status: WorkingDrawingStatus) => sheets.filter((sheet) => sheet.status === status).length
  return {
    sheets,
    mainPath: path.points,
    missingAlignmentPipeIds: path.missingAlignmentPipeIds,
    inputHash,
    summary: {
      total: sheets.length,
      blocked: statusCounts('BLOCKED'),
      preliminary: statusCounts('PRELIMINARY'),
      calculated: statusCounts('CALCULATED'),
      verified: statusCounts('VERIFIED'),
      stale: statusCounts('STALE'),
      finalExportAllowed: sheets.length > 0 && sheets.every((sheet) => sheet.status === 'CALCULATED' || sheet.status === 'VERIFIED'),
    },
  }
}
