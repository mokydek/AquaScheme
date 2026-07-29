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

export type WorkingDrawingDocumentSetCode = 'MAIN' | 'SPEC'

export type WorkingDrawingVariant =
  | 'route_plan'
  | 'network_plan'
  | 'main_profile'
  | 'branch_profile'
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
  /** Profile alignment that owns this crossing. Untagged legacy records belong to the main profile only. */
  profileId?: string
  /** Pipe that owns this crossing. Used to isolate annotations in branched gravity networks. */
  pipeId?: string
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
  /** Profile owned by this sheet. Main-profile sheets use the project profile; branch sheets carry their own data. */
  profileData?: GravityProfile
  profileId?: string
  /** Auditable source path used by a detailed plan sheet. */
  planPathId?: string
}

export type WorkingDrawingAlbumPageKind = 'cover' | 'drawing_register' | 'general_data' | WorkingDrawingKind

/** One physical page in the exported PDF. This is deliberately separate from the generated drawing registry. */
export interface WorkingDrawingAlbumPage {
  id: string
  pdfPageNumber: number
  documentSet: WorkingDrawingDocumentSet | null
  documentSetCode: WorkingDrawingDocumentSetCode | null
  sheetNumber: number | null
  title: string
  kind: WorkingDrawingAlbumPageKind
  sheetId?: string
  pageFormat: {
    format: 'A3' | 'custom'
    widthMm: number
    heightMm: number
    orientation: 'landscape'
    rotationDeg: 0 | 270
    /** The exporter may replace this default only from an explicit layout policy, never from reference geometry. */
    source: 'generated_layout_policy' | 'explicit_layout_policy'
  }
}

export interface WorkingDrawingDocumentSetManifest {
  documentSet: WorkingDrawingDocumentSet
  code: WorkingDrawingDocumentSetCode
  title: string
  sheetCount: number
  generatedSheetCount: number
  firstPdfPage: number | null
  lastPdfPage: number | null
}

export interface WorkingDrawingAlbumManifest {
  pages: WorkingDrawingAlbumPage[]
  /** Physical pages in the combined PDF, including the cover and service sheets. */
  pdfPageCount: number
  /** Data-generated plan/profile/table/detail/specification sheets. */
  generatedSheetCount: number
  servicePageCount: number
  documentSets: Record<WorkingDrawingDocumentSet, WorkingDrawingDocumentSetManifest>
}

export interface WorkingDrawingBranchProfileInput {
  id: string
  title?: string
  source?: string
  verified: boolean
  profile: GravityProfile
}

export interface WorkingDrawingNetworkPath {
  pipeId: string
  points: Array<{ x: number; y: number }>
  source?: string
}

/** One continuous, source-backed alignment group used to paginate detailed plans. */
export interface WorkingDrawingPlanPath {
  id: string
  title: string
  pipeIds: string[]
  points: Array<{ x: number; y: number; chainageM: number }>
  stationChainagesM: number[]
  source?: string
}

/**
 * Exact coverage audit for the manhole/material schedule.  Counts alone are
 * insufficient on a branched network: a schedule with the same number of
 * duplicated junction rows can still omit an entire branch.
 */
export interface WorkingDrawingScheduleCoverage {
  expectedNodeIds: string[]
  scheduledNodeIds: string[]
  missingNodeIds: string[]
  unexpectedNodeIds: string[]
  duplicateNodeIds: string[]
  anonymousRowCount: number
  expectedPipeIds: string[]
  profiledPipeIds: string[]
  unprofiledPipeIds: string[]
  complete: boolean
}

export interface WorkingDrawingSet {
  sheets: WorkingDrawingSheet[]
  manifest: WorkingDrawingAlbumManifest
  mainPath: Array<{ x: number; y: number; chainageM: number }>
  /** Every confirmed pipe alignment is owned by exactly one detailed-plan path. */
  planPaths: WorkingDrawingPlanPath[]
  networkPaths: WorkingDrawingNetworkPath[]
  missingAlignmentPipeIds: string[]
  missingNetworkAlignmentPipeIds: string[]
  protectiveGridDesign: ProtectiveGridDesign | null
  scheduleCoverage: WorkingDrawingScheduleCoverage
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
    /** Physical PDF pages: cover + MAIN service sheets + generated MAIN/SPEC sheets. */
    pdfPages: number
    workingDrawingSheets: number
    specificationSheets: number
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
  /** Optional source-backed profiles for gravity branches outside the governing main profile. */
  branchProfiles?: WorkingDrawingBranchProfileInput[]
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

function confirmedPipeAlignment(
  pipe: TracedNetwork['pipes'][number] | undefined,
  from: Point,
  to: Point,
): Point[] | null {
  if (!pipe?.alignment || pipe.alignment.length < 2) return null
  let alignment = pipe.alignment
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map(({ x, y }) => ({ x, y }))
  if (alignment.length < 2) return null
  const forward = pointDistance(alignment[0], from) + pointDistance(alignment[alignment.length - 1], to)
  const reverse = pointDistance(alignment[0], to) + pointDistance(alignment[alignment.length - 1], from)
  if (reverse < forward) alignment = [...alignment].reverse()
  // A stored alignment must actually terminate at the network nodes. Adding a
  // chord here would manufacture plan geometry across unknown terrain.
  if (!samePoint(alignment[0], from) || !samePoint(alignment[alignment.length - 1], to)) return null
  alignment[0] = { x: from.x, y: from.y }
  alignment[alignment.length - 1] = { x: to.x, y: to.y }
  return alignment
}

/**
 * Rebuild the main collector polyline from the real per-pipe alignments in
 * profile order. Missing or detached alignments invalidate the continuous
 * path; endpoint chords are never manufactured.
 */
export function workingDrawingMainPath(
  network: TracedNetwork,
  profile: GravityProfile | null,
): { points: Array<Point & { chainageM: number }>; missingAlignmentPipeIds: string[] } {
  if (!profile || profile.stations.length < 2) return { points: [], missingAlignmentPipeIds: [] }
  const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
  const pipeById = new Map(network.pipes.map((pipe) => [pipe.id, pipe]))

  const points: Array<Point & { chainageM: number }> = []
  const missingAlignmentPipeIds: string[] = []
  const usedPipeIds = new Set<string>()
  for (let index = 1; index < profile.stations.length; index++) {
    const fromId = profile.stations[index - 1].nodeId
    const toId = profile.stations[index].nodeId
    const requestedPipeId = profile.pipeIds[index - 1]
    const from = nodeById.get(fromId)
    const to = nodeById.get(toId)
    if (!requestedPipeId || !from || !to) {
      missingAlignmentPipeIds.push(requestedPipeId ?? `${fromId}-${toId}`)
      continue
    }
    const pipe = pipeById.get(requestedPipeId)
    const pipeMatches = pipe
      && ((pipe.fromNode === fromId && pipe.toNode === toId)
        || (pipe.fromNode === toId && pipe.toNode === fromId))
    if (!pipeMatches || usedPipeIds.has(requestedPipeId)) {
      missingAlignmentPipeIds.push(requestedPipeId)
      continue
    }
    usedPipeIds.add(requestedPipeId)
    const segment = confirmedPipeAlignment(pipe, from, to)
    if (!segment) {
      missingAlignmentPipeIds.push(requestedPipeId)
      continue
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
  // Extra ids are just as unsafe as missing ids: their geometry is not owned
  // by any consecutive station pair and must not be silently ignored.
  for (const extraPipeId of profile.pipeIds.slice(Math.max(0, profile.stations.length - 1))) {
    missingAlignmentPipeIds.push(extraPipeId)
  }
  if (missingAlignmentPipeIds.length > 0) return { points: [], missingAlignmentPipeIds }
  return {
    points,
    missingAlignmentPipeIds,
  }
}

/**
 * Build continuous, auditable paths for detailed plans. Main and calculated
 * branch profiles own their pipes first; every remaining confirmed alignment
 * (for example a pressure main) receives its own path. Invalid/missing
 * alignments are reported and never replaced by endpoint chords.
 */
export function workingDrawingPlanPaths(
  network: TracedNetwork,
  profile: GravityProfile | null,
  branchProfiles: WorkingDrawingBranchProfileInput[] = [],
): { paths: WorkingDrawingPlanPath[]; missingAlignmentPipeIds: string[] } {
  const paths: WorkingDrawingPlanPath[] = []
  const missingAlignmentPipeIds = new Set<string>()
  const assignedPipeIds = new Set<string>()
  const networkPipeIds = new Set(network.pipes.map((pipe) => pipe.id))
  const profileInputs: Array<{
    id: string
    title: string
    source?: string
    profile: GravityProfile
  }> = [
    ...(profile ? [{ id: 'main', title: 'Магистраль', profile }] : []),
    ...branchProfiles.map((branch) => ({
      id: `branch:${branch.id}`,
      title: branch.title?.trim() || `Ветвь ${branch.id}`,
      source: branch.source,
      profile: branch.profile,
    })),
  ]

  for (const item of profileInputs) {
    const pipeIds = item.profile.pipeIds.filter((pipeId) => networkPipeIds.has(pipeId))
    if (pipeIds.length === 0 || pipeIds.some((pipeId) => assignedPipeIds.has(pipeId))) continue
    const built = workingDrawingMainPath(network, item.profile)
    built.missingAlignmentPipeIds.forEach((pipeId) => missingAlignmentPipeIds.add(pipeId))
    if (built.points.length < 2 || built.missingAlignmentPipeIds.length > 0) continue
    pipeIds.forEach((pipeId) => assignedPipeIds.add(pipeId))
    const sources = [...new Set(pipeIds
      .map((pipeId) => network.pipes.find((pipe) => pipe.id === pipeId)?.dataSource?.trim())
      .filter((source): source is string => Boolean(source)))]
    paths.push({
      id: item.id,
      title: item.title,
      pipeIds,
      points: built.points,
      stationChainagesM: item.profile.stations.map((station) => station.chainageM),
      source: item.source ?? (sources.length > 0 ? sources.join('; ') : undefined),
    })
  }

  const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
  for (const pipe of network.pipes) {
    if (assignedPipeIds.has(pipe.id)) continue
    const from = nodeById.get(pipe.fromNode)
    const to = nodeById.get(pipe.toNode)
    const alignment = from && to ? confirmedPipeAlignment(pipe, from, to) : null
    if (!alignment) {
      missingAlignmentPipeIds.add(pipe.id)
      continue
    }
    const distances = [0]
    for (let index = 1; index < alignment.length; index++) {
      distances.push(distances[index - 1] + pointDistance(alignment[index - 1], alignment[index]))
    }
    const geometryLengthM = distances.at(-1) ?? 0
    if (geometryLengthM <= 0 || !Number.isFinite(pipe.lengthM) || pipe.lengthM <= 0) {
      missingAlignmentPipeIds.add(pipe.id)
      continue
    }
    const points = alignment.map((point, index) => ({
      ...point,
      chainageM: Math.round((distances[index] / geometryLengthM) * pipe.lengthM * 100) / 100,
    }))
    paths.push({
      id: `pipe:${pipe.id}`,
      title: `Участок ${pipe.id}`,
      pipeIds: [pipe.id],
      points,
      stationChainagesM: [0, pipe.lengthM],
      source: pipe.dataSource,
    })
    assignedPipeIds.add(pipe.id)
  }

  return { paths, missingAlignmentPipeIds: [...missingAlignmentPipeIds].sort() }
}

/** Preserve every confirmed pipe alignment for the full-network plan without endpoint chords. */
export function workingDrawingNetworkPaths(network: TracedNetwork): {
  paths: WorkingDrawingNetworkPath[]
  missingAlignmentPipeIds: string[]
} {
  const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
  const paths: WorkingDrawingNetworkPath[] = []
  const missingAlignmentPipeIds: string[] = []
  for (const pipe of network.pipes) {
    const from = nodeById.get(pipe.fromNode)
    const to = nodeById.get(pipe.toNode)
    const points = from && to ? confirmedPipeAlignment(pipe, from, to) ?? [] : []
    if (points.length < 2) {
      missingAlignmentPipeIds.push(pipe.id)
    }
    if (points.length >= 2) paths.push({ pipeId: pipe.id, points, source: pipe.dataSource })
  }
  return { paths, missingAlignmentPipeIds }
}

/**
 * Proves that the schedule covers every node and pipe in the gravity network.
 * A row without nodeId cannot be matched audibly and therefore cannot qualify
 * a material/specification sheet for final issue.
 */
export function workingDrawingScheduleCoverage(
  network: TracedNetwork,
  schedule: SewerSchedule | null,
  profile: GravityProfile | null,
  branchProfiles: readonly WorkingDrawingBranchProfileInput[] = [],
): WorkingDrawingScheduleCoverage {
  const gravityPipes = network.pipes.filter((pipe) =>
    pipe.systemType !== 'pressure' && pipe.kind !== 'pressure_main' && pipe.kind !== 'discharge')
  const expectedPipeIds = [...new Set(gravityPipes.map((pipe) => pipe.id))].sort()
  const expectedNodeIds = [...new Set(gravityPipes.flatMap((pipe) => [pipe.fromNode, pipe.toNode]))].sort()
  const expectedNodeSet = new Set(expectedNodeIds)

  const rowCounts = new Map<string, number>()
  let anonymousRowCount = 0
  for (const row of schedule?.manholes ?? []) {
    const nodeId = row.nodeId?.trim()
    if (!nodeId) {
      anonymousRowCount++
      continue
    }
    rowCounts.set(nodeId, (rowCounts.get(nodeId) ?? 0) + 1)
  }
  const scheduledNodeIds = [...rowCounts.keys()].sort()
  const scheduledNodeSet = new Set(scheduledNodeIds)
  const missingNodeIds = expectedNodeIds.filter((nodeId) => !scheduledNodeSet.has(nodeId))
  const unexpectedNodeIds = scheduledNodeIds.filter((nodeId) => !expectedNodeSet.has(nodeId))
  const duplicateNodeIds = scheduledNodeIds.filter((nodeId) => (rowCounts.get(nodeId) ?? 0) > 1)

  const expectedPipeSet = new Set(expectedPipeIds)
  const profiledPipeIds = [...new Set([
    ...(profile?.pipeIds ?? []),
    ...branchProfiles.flatMap((branch) => branch.profile.pipeIds),
  ].filter((pipeId) => expectedPipeSet.has(pipeId)))].sort()
  const profiledPipeSet = new Set(profiledPipeIds)
  const unprofiledPipeIds = expectedPipeIds.filter((pipeId) => !profiledPipeSet.has(pipeId))
  const complete = schedule != null
    && expectedNodeIds.length > 0
    && anonymousRowCount === 0
    && missingNodeIds.length === 0
    && unexpectedNodeIds.length === 0
    && duplicateNodeIds.length === 0
    && unprofiledPipeIds.length === 0

  return {
    expectedNodeIds,
    scheduledNodeIds,
    missingNodeIds,
    unexpectedNodeIds,
    duplicateNodeIds,
    anonymousRowCount,
    expectedPipeIds,
    profiledPipeIds,
    unprofiledPipeIds,
    complete,
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

function buildAlbumManifest(sheets: WorkingDrawingSheet[]): WorkingDrawingAlbumManifest {
  const defaultPageFormat: WorkingDrawingAlbumPage['pageFormat'] = {
    format: 'A3',
    widthMm: 420,
    heightMm: 297,
    orientation: 'landscape',
    rotationDeg: 0,
    source: 'generated_layout_policy',
  }
  const generatedPageFormat = (sheet: WorkingDrawingSheet): WorkingDrawingAlbumPage['pageFormat'] => {
    if ((sheet.kind !== 'plan' && sheet.kind !== 'profile') || !sheet.interval) {
      return { ...defaultPageFormat }
    }

    // The roll-sheet width follows the generated interval and the drawing scale. These values are
    // a layout policy, not measurements copied from a reference album. Fixed allowances reserve
    // room for the left band, sheet marks, notes and the title block.
    const intervalLengthM = Math.max(0, sheet.interval.toM - sheet.interval.fromM)
    const scaleDenominator = 500
    // Generated allowances cover the page margins, plan/profile side bands,
    // annotations and the title block. They are layout policy values derived
    // from the renderer, not dimensions copied from a reference album.
    const fixedAllowanceMm = sheet.kind === 'plan' ? 220 : 300
    const rawWidthMm = fixedAllowanceMm + intervalLengthM * 1000 / scaleDenominator
    const widthMm = Math.min(5000, Math.max(420, Math.ceil(rawWidthMm / 10) * 10))
    return {
      format: widthMm > 420 ? 'custom' : 'A3',
      widthMm,
      heightMm: 297,
      orientation: 'landscape',
      rotationDeg: 0,
      source: 'generated_layout_policy',
    }
  }
  const serviceRollFormat = (columnCount: number, extraColumnWidthMm: number): WorkingDrawingAlbumPage['pageFormat'] => {
    const widthMm = Math.min(5000, Math.max(420, 420 + Math.max(0, columnCount - 1) * extraColumnWidthMm))
    return {
      format: widthMm > 420 ? 'custom' : 'A3',
      widthMm,
      heightMm: 297,
      orientation: 'landscape',
      rotationDeg: 0,
      source: 'generated_layout_policy',
    }
  }
  // Service sheets expand horizontally when their generated content no longer fits one
  // readable A3 column. Counts come from the current model, not from a reference PDF.
  const registerColumnCount = Math.max(1, Math.ceil(sheets.length / 18))
  const uniqueSourceCount = new Set(sheets.flatMap((sheet) => sheet.sources.map((source) => source.requirement))).size
  const generalDataUnits = uniqueSourceCount
    + new Set(sheets.map((sheet) => sheet.kind)).size
    + 13
    + Math.ceil(sheets.length / 10)
  const generalDataColumnCount = Math.max(1, Math.ceil(generalDataUnits / 34))
  const registerPageFormat = serviceRollFormat(registerColumnCount, 340)
  const generalDataPageFormat = serviceRollFormat(generalDataColumnCount, 260)
  const pages: WorkingDrawingAlbumPage[] = [
    {
      id: 'cover',
      pdfPageNumber: 1,
      documentSet: null,
      documentSetCode: null,
      sheetNumber: null,
      title: 'Титульный лист рабочего комплекта',
      kind: 'cover',
      pageFormat: { ...defaultPageFormat },
    },
    {
      id: 'main-1',
      pdfPageNumber: 2,
      documentSet: 'working_drawings',
      documentSetCode: 'MAIN',
      sheetNumber: 1,
      title: 'Ведомость рабочих чертежей и общие данные, часть 1',
      kind: 'drawing_register',
      pageFormat: registerPageFormat,
    },
    {
      id: 'main-2',
      pdfPageNumber: 3,
      documentSet: 'working_drawings',
      documentSetCode: 'MAIN',
      sheetNumber: 2,
      title: 'Общие данные, часть 2',
      kind: 'general_data',
      pageFormat: generalDataPageFormat,
    },
  ]

  for (const sheet of sheets) {
    pages.push({
      id: `page-${sheet.id}`,
      pdfPageNumber: pages.length + 1,
      documentSet: sheet.documentSet,
      documentSetCode: sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC',
      sheetNumber: sheet.sheetNumber,
      title: sheet.title,
      kind: sheet.kind,
      sheetId: sheet.id,
      pageFormat: generatedPageFormat(sheet),
    })
  }

  const workingDrawingPages = pages.filter((page) => page.documentSet === 'working_drawings')
  const specificationPages = pages.filter((page) => page.documentSet === 'specification')
  const generatedWorkingDrawings = sheets.filter((sheet) => sheet.documentSet === 'working_drawings').length
  const generatedSpecifications = sheets.filter((sheet) => sheet.documentSet === 'specification').length
  const pageRange = (items: WorkingDrawingAlbumPage[]) => ({
    firstPdfPage: items[0]?.pdfPageNumber ?? null,
    lastPdfPage: items.at(-1)?.pdfPageNumber ?? null,
  })

  return {
    pages,
    pdfPageCount: pages.length,
    generatedSheetCount: sheets.length,
    servicePageCount: 3,
    documentSets: {
      working_drawings: {
        documentSet: 'working_drawings',
        code: 'MAIN',
        title: 'Основной комплект рабочих чертежей',
        sheetCount: workingDrawingPages.length,
        generatedSheetCount: generatedWorkingDrawings,
        ...pageRange(workingDrawingPages),
      },
      specification: {
        documentSet: 'specification',
        code: 'SPEC',
        title: 'Спецификация оборудования, изделий и материалов',
        sheetCount: specificationPages.length,
        generatedSheetCount: generatedSpecifications,
        ...pageRange(specificationPages),
      },
    },
  }
}

/** Build the auditable, data-driven drawing register. No reference-project values enter the calculation. */
export function buildWorkingDrawingSet(input: WorkingDrawingInput): WorkingDrawingSet {
  const path = workingDrawingMainPath(input.network, input.profile)
  const detailedPlanPaths = workingDrawingPlanPaths(input.network, input.profile, input.branchProfiles)
  const networkPaths = workingDrawingNetworkPaths(input.network)
  const scheduleCoverage = workingDrawingScheduleCoverage(
    input.network,
    input.schedule,
    input.profile,
    input.branchProfiles,
  )
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
    branchProfiles: input.branchProfiles,
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

  const planChecks = sharedPlanChecks(input, [])
  const planItems: Array<{
    planPath?: WorkingDrawingPlanPath
    interval?: SheetInterval
    window?: PlanWindow
  }> = detailedPlanPaths.paths.flatMap((planPath) => planWindows(
    planPath.points,
    opts.planLengthM,
    opts.planMarginM,
    planPath.stationChainagesM,
  ).map((window) => ({ planPath, interval: window, window })))
  if (planItems.length === 0) planItems.push({ interval: undefined, window: undefined })

  const sheets: WorkingDrawingSheet[] = []
  // PDF page 1 is an unnumbered cover. MAIN/1 and MAIN/2 are the two service
  // pages, therefore the first generated working drawing is MAIN/3 (PDF page 4).
  let number = 3
  for (const item of planItems) {
    const blockers = [...planChecks.blockers]
    if (!item.interval) blockers.push(issue('PLAN_GEOMETRY_MISSING', 'Нет непрерывной проектной оси для формирования планового листа.', 'route'))
    const groupTitle = item.planPath && item.planPath.id !== 'main' ? ` · ${item.planPath.title}` : ''
    const title = `План ${input.system === 'storm' ? 'К2' : 'К1'}${groupTitle}${item.interval ? ` ${item.interval.label}` : ''}. М1:500`
    const sources = planChecks.sources.map((source) => source.requirement === 'route' && item.planPath
      ? {
        ...source,
        source: item.planPath.source ?? source.source,
        detail: `${item.planPath.pipeIds.length} участков: ${item.planPath.pipeIds.join(', ')}`,
      }
      : { ...source })
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
      planPathId: item.planPath?.id,
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
    if (input.profile && (path.points.length < 2 || path.missingAlignmentPipeIds.length > 0)) {
      const pipeIds = path.missingAlignmentPipeIds.length > 0
        ? path.missingAlignmentPipeIds
        : input.profile.pipeIds
      blockers.push(issue(
        'PROFILE_ALIGNMENT_MISSING',
        `Продольный профиль не имеет непрерывной фактической оси для участков: ${pipeIds.join(', ') || 'не определены'}. Соединение узлов прямыми не допускается.`,
        'route',
      ))
    }
    const gravityPipeIds = input.network.pipes
      .filter((pipe) => pipe.systemType !== 'pressure' && pipe.kind !== 'pressure_main' && pipe.kind !== 'discharge')
      .map((pipe) => pipe.id)
    const profiledPipeIds = new Set([
      ...(input.profile?.pipeIds ?? []),
      ...(input.branchProfiles ?? []).flatMap((branch) => branch.profile.pipeIds),
    ])
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

  // A branch profile is a separate deliverable only when the caller provides
  // actual profile stations for that branch. Missing branches remain an
  // explicit blocker on the main profile; placeholder geometry is never made.
  const mainProfileTemplate = sheets.find((sheet) => sheet.variant === 'main_profile')
  for (const branch of input.branchProfiles ?? []) {
    if (branch.profile.stations.length < 2) continue
    const branchPath = workingDrawingMainPath(input.network, branch.profile)
    const branchSpecs = profileSheetSpecs(branch.profile, input.system, opts.profileLengthM)
    for (const item of branchSpecs) {
      const blockers = (mainProfileTemplate?.blockers ?? [])
        .filter((item) => item.code !== 'PROFILE_DATA_MISSING'
          && item.code !== 'PROFILE_BRANCHES_MISSING'
          && item.code !== 'PROFILE_ALIGNMENT_MISSING')
      if (branchPath.points.length < 2 || branchPath.missingAlignmentPipeIds.length > 0) {
        const pipeIds = branchPath.missingAlignmentPipeIds.length > 0
          ? branchPath.missingAlignmentPipeIds
          : branch.profile.pipeIds
        blockers.push(issue(
          'PROFILE_ALIGNMENT_MISSING',
          `Продольный профиль ветви ${branch.id} не имеет непрерывной фактической оси для участков: ${pipeIds.join(', ') || 'не определены'}. Соединение узлов прямыми не допускается.`,
          'route',
        ))
      }
      if (!branch.verified) blockers.push(issue(
        'BRANCH_PROFILE_UNVERIFIED',
        `Продольный профиль ветви ${branch.id} не подтверждён источником инженерной модели.`,
        'hydraulics',
      ))
      const warnings = [...(mainProfileTemplate?.warnings ?? [])]
      const sources = (mainProfileTemplate?.sources ?? []).map((source) => source.requirement === 'hydraulics'
        ? makeSource(
          'hydraulics',
          true,
          input.hydraulicsReady && branch.verified,
          branch.source,
          `${branch.profile.stations.length} станций ветви ${branch.id}`,
        )
        : { ...source })
      const baseTitle = branch.title?.trim() || `Профиль ветви ${branch.id}`
      sheets.push({
        id: `branch-profile-${branch.id}-${number}`,
        sequence: sheets.length + 1,
        documentSet: 'working_drawings',
        sheetNumber: number,
        title: `${baseTitle} ${item.interval.label}`,
        kind: 'profile',
        variant: 'branch_profile',
        status: sheetStatus(input.routeStatus, blockers, warnings, sources),
        blockers,
        warnings,
        requirements: mainProfileTemplate?.requirements ?? [
          'route', 'topography', 'hydraulics', 'catalog', 'geology', 'freezing_depth', 'crossings', 'norms',
        ],
        sources,
        inputHash: sheetHash(inputHash, 'profile', number, item.interval),
        interval: item.interval,
        profileData: branch.profile,
        profileId: branch.id,
      })
      number++
    }
  }

  const manholeCount = input.schedule?.manholes.length ?? 0
  const scheduleCoverageMessage = () => {
    const details: string[] = []
    if (scheduleCoverage.anonymousRowCount > 0) details.push(`строк без nodeId: ${scheduleCoverage.anonymousRowCount}`)
    if (scheduleCoverage.missingNodeIds.length > 0) details.push(`нет узлов: ${scheduleCoverage.missingNodeIds.join(', ')}`)
    if (scheduleCoverage.unexpectedNodeIds.length > 0) details.push(`лишние узлы: ${scheduleCoverage.unexpectedNodeIds.join(', ')}`)
    if (scheduleCoverage.duplicateNodeIds.length > 0) details.push(`дубли узлов: ${scheduleCoverage.duplicateNodeIds.join(', ')}`)
    if (scheduleCoverage.unprofiledPipeIds.length > 0) details.push(`нет профилей участков: ${scheduleCoverage.unprofiledPipeIds.join(', ')}`)
    return `Ведомость сооружений не покрывает всю самотечную сеть${details.length > 0 ? ` (${details.join('; ')})` : ''}.`
  }
  const materialSheetCount = Math.max(1, Math.ceil(manholeCount / opts.materialRowsPerSheet))
  for (let part = 0; part < materialSheetCount; part++) {
    const blockers: WorkingDrawingIssue[] = []
    const warnings: WorkingDrawingIssue[] = []
    if (!input.schedule || manholeCount === 0) blockers.push(issue('MANHOLE_SCHEDULE_MISSING', 'Не рассчитана ведомость колодцев.', 'manhole_catalog'))
    if (input.schedule && !scheduleCoverage.complete) blockers.push(issue(
      'MANHOLE_SCHEDULE_INCOMPLETE',
      scheduleCoverageMessage(),
      'manhole_catalog',
    ))
    if (!input.manholeCatalogReady) blockers.push(issue(
      'MANHOLE_CONSTRUCTION_MISSING',
      input.manholeCatalogMissingLabels?.length
        ? `Не подобрана подтверждённая конструкция для: ${input.manholeCatalogMissingLabels.join(', ')}. Расход сборных элементов считать нельзя.`
        : 'Не выбран подтверждённый параметрический каталог конструкций колодцев; расход сборных элементов считать нельзя.',
      'manhole_catalog',
    ))
    if (!input.catalogReady) blockers.push(issue('CATALOG_MISSING', 'Не подтверждён активный каталог материалов.', 'catalog'))
    const sources = [
      makeSource(
        'manhole_catalog',
        !!input.schedule && manholeCount > 0 && !!input.manholeCatalogReady,
        !!input.manholeCatalogReady && scheduleCoverage.complete,
        undefined,
        `${manholeCount} колодцев; покрытие ${scheduleCoverage.scheduledNodeIds.length}/${scheduleCoverage.expectedNodeIds.length} узлов`,
      ),
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
    if (input.schedule && !scheduleCoverage.complete) blockers.push(issue(
      'MANHOLE_SCHEDULE_INCOMPLETE',
      scheduleCoverageMessage(),
      'manhole_catalog',
    ))
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
      makeSource(
        'manhole_catalog',
        manholeCount > 0 && !!input.manholeCatalogReady,
        manholeCount > 0 && !!input.manholeCatalogReady && scheduleCoverage.complete,
        undefined,
        `покрытие ${scheduleCoverage.scheduledNodeIds.length}/${scheduleCoverage.expectedNodeIds.length} узлов`,
      ),
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
  const manifest = buildAlbumManifest(sheets)
  return {
    sheets,
    manifest,
    mainPath: path.points,
    planPaths: detailedPlanPaths.paths,
    networkPaths: networkPaths.paths,
    missingAlignmentPipeIds: detailedPlanPaths.missingAlignmentPipeIds,
    missingNetworkAlignmentPipeIds: networkPaths.missingAlignmentPipeIds,
    protectiveGridDesign: input.protectiveGridDesign ?? null,
    scheduleCoverage,
    inputHash,
    layoutPolicy: opts,
    summary: {
      total: sheets.length,
      pdfPages: manifest.pdfPageCount,
      workingDrawingSheets: manifest.documentSets.working_drawings.sheetCount,
      specificationSheets: manifest.documentSets.specification.sheetCount,
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
