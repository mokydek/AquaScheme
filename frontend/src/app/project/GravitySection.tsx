import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  assessLiftStationNeed,
  buildWorkingDrawingSet,
  buildSewerSchedule,
  buildSewerSpecification,
  calculateStormRunoff,
  checkRouteInCorridor,
  computeNetworkDemand,
  DEFAULT_FREEZING_DEPTH_M,
  NORMATIVE_DEFAULTS,
  ringFromGeoJsonGeometry,
  selectManholeConstructions,
  solveGravityNetwork,
  assessGravityFeasibility,
  auditProjectProvenance,
  provenanceLabel,
  summarizeRouteCoverage,
  planDropWells,
  planGravityBasins,
  unverifiedClauses,
  workingDrawingSpecificationItemCount,
} from '@aquascheme/engine'
import type {
  Borehole,
  CorridorCheck,
  CrossingRecord,
  ManholeCatalogEntry,
  ProtectiveGridDesign,
  RouteConstraintInput,
  SurveyPoint,
  StormRunoffInput,
  WorkingDrawingDeliverableRequirements,
} from '@aquascheme/engine'
import type { ParcelRow } from '../../shared/parcels'
import type { NormativeParams, NormClauseConfirmation } from '@aquascheme/engine'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import { loadActiveCatalogNominalDiameters, resolveGravityCatalog } from '../../shared/catalog'
import { saveDataset } from '../../shared/datasets'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import { formatAppError } from '../../shared/errorFormatting'
import {
  generateSewerGeneralDataDxf,
  generateProjectAlbumPdf,
  generateProjectSheetPdf,
  generateWorkingDrawingSheetDxf,
  generateWorkingDrawingSetDxfs,
  generateSewerNotePdf,
  generateSewerPlanDxf,
  generateSewerProfileDxf,
  generateManholeSheetsDxf,
  generateSewerSpecSheetDxf,
  generateSewerSpecXlsx,
  generateQuantityBillXlsx,
  generateSewerScheduleXlsx,
  generateSituationDxf,
  zipBundle,
} from '../../shared/exporters'
import { fetchLastGravityRun, persistGravity } from '../../shared/gravity'
import { resolveGravityBranchProfilesForDrawings } from '../../shared/gravityBranches'
import { NormBadge } from './NormBadge'
import { Panel } from './Panel'
import { AlbumSheetSet } from './AlbumSheetSet'
import { SchemeBuilder } from './SchemeBuilder'
import { StormInletsView } from './StormInletsView'
import { ReadinessView } from './ReadinessView'
import { GeologySectionView } from './GeologySectionView'
import { QuantityBillView } from './QuantityBillView'
import type { QuantityBillSettings } from './QuantityBillView'
import type { TitleBlockSignatory } from '../../shared/titleBlock'
import { freezingDepthStatus } from '../../shared/geologyStatus'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface PlanPoint {
  x: number
  y: number
}

interface ProfileGeologyCoverage {
  maxOffsetM?: number
  status: 'missing' | 'unverified' | 'verified'
  source?: string
}

function isFinitePlanPoint(point: { x?: number; y?: number } | null | undefined): point is PlanPoint {
  return point != null && Number.isFinite(point.x) && Number.isFinite(point.y)
}

function pointToSegmentDistance(point: PlanPoint, start: PlanPoint, end: PlanPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const ratio = Math.max(0, Math.min(1, projection))
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio))
}

function distanceToActualAlignment(point: PlanPoint, alignment: Array<{ x: number; y: number }>): number | null {
  let minimum = Number.POSITIVE_INFINITY
  for (let index = 1; index < alignment.length; index++) {
    const start = alignment[index - 1]
    const end = alignment[index]
    if (!isFinitePlanPoint(start) || !isFinitePlanPoint(end)) continue
    minimum = Math.min(minimum, pointToSegmentDistance(point, start, end))
  }
  return Number.isFinite(minimum) ? minimum : null
}

function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Gravity (free-surface) calculation for sewer (К1) and storm (К2), NB4. Runs
 * the Chezy-Manning design over the traced/imported network with the drainage
 * flow accumulated per pipe; every column cites its verified СН РК 4.01-03-2013*
 * clause. The table always reflects the current geometry; "Сохранить расчёт"
 * writes the result to calc_runs (kind: gravity) for the project history.
 */
export function GravitySection({
  projectId,
  systemType,
  projectName,
  buildings,
  nodes,
  pipes,
  normsDataset,
  geologyDataset,
  drainageDataset,
  topographyDataset,
  constraintsDataset,
  routeAuditDataset,
  manholeCatalogDataset,
  titleBlockDataset,
  boreholes,
  parcels,
  activeCatalogId,
  routeStatus = 'stale',
  routeBlockers = [],
  routeRevision = 0,
  runRequest = 0,
  onRunComplete,
}: {
  projectId: string
  systemType: 'sewer' | 'storm'
  projectName: string
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  normsDataset?: DatasetRow
  geologyDataset?: DatasetRow
  drainageDataset?: DatasetRow
  topographyDataset?: DatasetRow
  constraintsDataset?: DatasetRow
  routeAuditDataset?: DatasetRow
  manholeCatalogDataset?: DatasetRow
  titleBlockDataset?: DatasetRow
  boreholes?: Borehole[]
  /** Project parcels; kind 'right_of_way' rings form the corridor to check. */
  parcels?: ParcelRow[]
  activeCatalogId?: string | null
  routeStatus?: 'stale' | 'blocked' | 'preliminary' | 'calculated'
  routeBlockers?: Array<{ code?: string; message?: string } | string>
  routeRevision?: number
  /** Monotonic request from the shared project-level "Calculate all" CTA. */
  runRequest?: number
  onRunComplete?: (outcome: 'done' | 'needData' | 'error', detail?: string) => void
}) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [albumExporting, setAlbumExporting] = useState(false)
  const [albumError, setAlbumError] = useState<string | null>(null)
  const [bundleError, setBundleError] = useState<string | null>(null)
  // Design criterion: minBurial is what professional flat-terrain trunks use
  // (registry sewer.design.minBurial); minDiameter is the economical default.
  const [strategy, setStrategy] = useState<'minDiameter' | 'minBurial'>('minBurial')
  const [corridorCheck, setCorridorCheck] = useState<CorridorCheck | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const handledRunRequestRef = useRef(0)
  const [catalogDiameters, setCatalogDiameters] = useState<readonly number[] | undefined>(undefined)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoadedForId, setCatalogLoadedForId] = useState<string | null>(null)
  // Величины земляных работ: норматива на них в реестре нет, поэтому они
  // задаются инженером и хранятся с прочими исходными данными проекта.
  const savedQuantitySettings = ((drainageDataset?.content ?? {}) as { quantityBill?: QuantityBillSettings }).quantityBill ?? {}
  const [quantitySettings, setQuantitySettings] = useState<QuantityBillSettings>(savedQuantitySettings)
  const [quantityExporting, setQuantityExporting] = useState(false)
  useEffect(() => { setQuantitySettings(savedQuantitySettings) }, [drainageDataset])

  useEffect(() => {
    let active = true
    fetchLastGravityRun(projectId)
      .then((run) => {
        if (active) setSavedAt(run?.finishedAt ?? null)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [projectId])

  useEffect(() => {
    let active = true
    setCatalogDiameters(undefined)
    setCatalogError(null)
    setCatalogLoadedForId(activeCatalogId ?? null)
    if (!activeCatalogId) {
      return () => { active = false }
    }
    loadActiveCatalogNominalDiameters(activeCatalogId)
      .then((diameters) => { if (active) setCatalogDiameters(diameters ?? []) })
      .catch((error) => {
        if (active) setCatalogError(formatAppError(error))
      })
    return () => { active = false }
  }, [activeCatalogId])

  // Effects run after render. Keying the async payload prevents one render
  // from sizing the new catalog with diameters left from the previous one.
  const currentCatalogDiameters = catalogLoadedForId === activeCatalogId ? catalogDiameters : undefined
  const currentCatalogError = catalogLoadedForId === activeCatalogId ? catalogError : null
  const catalogResolution = useMemo(
    () => resolveGravityCatalog(activeCatalogId, currentCatalogDiameters, currentCatalogError),
    [activeCatalogId, currentCatalogDiameters, currentCatalogError],
  )

  const labelOfNode = useMemo(() => {
    const buildingLabelById = new Map(buildings.map((b) => [b.id, b.label ?? '']))
    const engineToBuilding = new Map(
      nodes.filter((n) => n.building_id).map((n) => [n.label ?? n.id, n.building_id as string]),
    )
    return (engineId: string): string =>
      buildingLabelById.get(engineToBuilding.get(engineId) ?? '') || engineId
  }, [nodes, buildings])

  const network = useMemo(() => networkFromRows(nodes, pipes), [nodes, pipes])
  const freezingDepth = useMemo(() => freezingDepthStatus(geologyDataset), [geologyDataset])
  const geologyCoverage = useMemo<ProfileGeologyCoverage>(() => {
    const content = (geologyDataset?.content ?? {}) as {
      profileGeologyMaxOffsetM?: number
      profileGeologySource?: string
      profileGeologyVerified?: boolean
    }
    const maxOffsetM = Number.isFinite(content.profileGeologyMaxOffsetM)
      && (content.profileGeologyMaxOffsetM ?? 0) > 0
      ? content.profileGeologyMaxOffsetM
      : undefined
    const source = typeof content.profileGeologySource === 'string'
      ? content.profileGeologySource.trim()
      : ''
    const status = maxOffsetM == null
      ? 'missing'
      : content.profileGeologyVerified === true && source
        ? 'verified'
        : 'unverified'
    return { maxOffsetM, status, source: source || undefined }
  }, [geologyDataset])
  const spatialBoreholeCount = useMemo(() => {
    if (geologyCoverage.maxOffsetM == null) return 0
    const alignments = network.pipes
      .map((pipe) => pipe.alignment)
      .filter((alignment): alignment is Array<{ x: number; y: number }> => Array.isArray(alignment) && alignment.length >= 2)
    if (alignments.length === 0) return 0
    return (boreholes ?? []).filter((borehole) => {
      if (!isFinitePlanPoint(borehole) || !Array.isArray(borehole.layers) || borehole.layers.length === 0) return false
      return alignments.some((alignment) => {
        const distance = distanceToActualAlignment(borehole, alignment)
        return distance != null && distance <= geologyCoverage.maxOffsetM!
      })
    }).length
  }, [boreholes, geologyCoverage.maxOffsetM, network.pipes])

  // Ширина улицы хранится в наборе дождевой канализации: это исходное данное
  // проекта, а не состояние экрана. Локальное состояние нужно только для
  // немедленного отклика — на перезагрузке значение приходит из набора.
  const savedStreetWidthM = ((drainageDataset?.content ?? {}) as { streetWidthM?: number }).streetWidthM ?? null
  const [streetWidthM, setStreetWidthM] = useState<number | null>(savedStreetWidthM)
  useEffect(() => { setStreetWidthM(savedStreetWidthM) }, [savedStreetWidthM])
  const saveStreetWidth = async (value: number | null) => {
    setStreetWidthM(value)
    const content = (drainageDataset?.content ?? {}) as Record<string, unknown>
    // Набор перезаписывается целиком, поэтому остальные ключи переносятся явно:
    // иначе выбор источника водоснабжения и водосборы были бы стёрты.
    await saveDataset(projectId, 'drainage', { ...content, streetWidthM: value })
  }

  const stormCatchments = useMemo(
    () => (((drainageDataset?.content ?? {}) as {
      stormCatchments?: Array<StormRunoffInput & { inflowId: string }>
    }).stormCatchments ?? []),
    [drainageDataset],
  )
  const stormRunoffResults = useMemo(
    () => stormCatchments.map((catchment) => ({
      inflowId: catchment.inflowId,
      result: calculateStormRunoff(catchment),
    })),
    [stormCatchments],
  )
  const stormRainPeriodYears = useMemo(() => {
    if (stormCatchments.length === 0 || stormCatchments.some((item) => !item.rain.verified || !item.rain.source.trim())) {
      return undefined
    }
    const periods = [...new Set(stormCatchments.map((item) => item.rain.designPeriodYears))]
    return periods.length === 1 && Number.isFinite(periods[0]) && periods[0] > 0 ? periods[0] : undefined
  }, [stormCatchments])
  const stormRunoffByInflow = useMemo(
    () => new Map(stormRunoffResults.map((item) => [item.inflowId, item.result])),
    [stormRunoffResults],
  )
  const stormRunoffStatus = useMemo(() => {
    if (systemType !== 'storm') return undefined
    const matched = buildings.map((building) => ({ building, result: stormRunoffByInflow.get(building.id) }))
    const verifiedCount = matched.filter((item) => item.result?.verified && item.result.calculatedFlowLps !== null).length
    const missing = matched.filter((item) => !item.result).map((item) => item.building.label ?? item.building.id)
    const blockers = [
      ...stormRunoffResults.flatMap((item) => item.result.blockers.map((message) => `${item.result.catchmentId}: ${message}`)),
      ...(missing.length > 0 ? [`Нет структурированного водосбора для: ${missing.join(', ')}.`] : []),
    ]
    return {
      available: stormCatchments.length > 0,
      verified: matched.length > 0 && verifiedCount === matched.length && blockers.length === 0,
      source: drainageDataset?.file_name ?? 'dataset:drainage',
      detail: `${verifiedCount} из ${matched.length} водосборов подтверждены`,
      blockers,
    }
  }, [buildings, drainageDataset?.file_name, stormCatchments.length, stormRunoffByInflow, stormRunoffResults, systemType])

  const result = useMemo(() => {
    if (pipes.length === 0 || routeStatus === 'stale' || routeStatus === 'blocked' || !catalogResolution.ready) return null
    const norms: NormativeParams = {
      ...NORMATIVE_DEFAULTS,
      ...((normsDataset?.content ?? {}) as Partial<NormativeParams>),
    }
    const buildingFlowLps = new Map<string, number>()
    if (systemType === 'storm') {
      // A verified N05 catchment calculation is authoritative. An explicit
      // manual inflow remains usable for a draft calculation, but the drawing
      // register blocks final issue until every catchment is verified.
      for (const b of buildings) {
        const runoff = stormRunoffByInflow.get(b.id)
        buildingFlowLps.set(
          b.id,
          runoff?.verified && runoff.calculatedFlowLps !== null
            ? runoff.calculatedFlowLps
            : b.design_flow_lps ?? b.specific_demand_lpd ?? b.residents ?? 0,
        )
      }
    } else {
      const demand = computeNetworkDemand(
        buildings.map((b) => ({
          id: b.id,
          residents: b.residents ?? 0,
          specificDemandLpd: b.specific_demand_lpd ?? undefined,
        })),
        norms,
      )
      for (const b of demand.buildings) if (b.id) buildingFlowLps.set(b.id, b.designFlowLps)
    }
    // Keep draft calculations inspectable, but never present this fallback as
    // verified project geology. The drawing register blocks final issue.
    const freezingDepthM = freezingDepth.valueM ?? DEFAULT_FREEZING_DEPTH_M
    return solveGravityNetwork({
      network,
      buildingFlowLps,
      system: systemType,
      freezingDepthM,
      strategy,
      stormRainPeriodYears,
      outletNodeId: network.nodes.find((node) => node.kind === 'lns_inlet' || node.kind === 'pumping_station')?.id,
      allowedDiametersMm: catalogResolution.allowedDiametersMm,
    })
  }, [buildings, network, normsDataset, freezingDepth, systemType, strategy, catalogResolution, routeStatus, stormRainPeriodYears, stormRunoffByInflow])

  useEffect(() => {
    if (runRequest <= 0 || handledRunRequestRef.current >= runRequest) return
    handledRunRequestRef.current = runRequest
    if (!result) {
      const detail = pipes.length === 0
        ? 'Сначала загрузите или постройте инженерную сеть.'
        : routeStatus === 'stale' || routeStatus === 'blocked'
          ? `Трасса имеет статус «${routeStatus}»; сначала пересчитайте трассу.`
          : catalogResolution.blocker ?? 'Расчётные исходные данные ещё не готовы.'
      onRunComplete?.('needData', detail)
      return
    }

    setSaving(true)
    setSaveError(null)
    void persistGravity(projectId, result)
      .then(() => {
        setSavedAt(new Date().toISOString())
        onRunComplete?.('done')
      })
      .catch((error) => {
        const detail = formatAppError(error)
        setSaveError(detail)
        onRunComplete?.('error', detail)
      })
      .finally(() => setSaving(false))
  }, [catalogResolution.blocker, onRunComplete, pipes.length, projectId, result, routeStatus, runRequest])

  const rows = useMemo(() => {
    if (!result) return []
    return [...result.pipes].sort((a, b) => b.flowLps - a.flowLps)
  }, [result])

  const branchProfileResolution = useMemo(
    () => resolveGravityBranchProfilesForDrawings({
      network,
      result,
      freezingDepthM: freezingDepth.valueM ?? DEFAULT_FREEZING_DEPTH_M,
    }),
    [freezingDepth.valueM, network, result],
  )

  const schedule = useMemo(() => (result
    ? buildSewerSchedule(result, {
        branchProfiles: branchProfileResolution.branchProfiles.map((branch) => branch.profile),
      })
    : null), [branchProfileResolution.branchProfiles, result])
  const manholeCatalog = useMemo(
    () => ((manholeCatalogDataset?.content ?? {}) as { entries?: ManholeCatalogEntry[] }).entries ?? [],
    [manholeCatalogDataset],
  )
  const manholeSelection = useMemo(
    () => schedule ? selectManholeConstructions(schedule.manholes, manholeCatalog) : { selected: [], unmatched: [] },
    [schedule, manholeCatalog],
  )
  const constraints = useMemo(
    () => (constraintsDataset?.content ?? null) as (RouteConstraintInput & {
      crossings?: CrossingRecord[]
      deliverableRequirements?: WorkingDrawingDeliverableRequirements
      protectiveGridDesign?: ProtectiveGridDesign
    }) | null,
    [constraintsDataset],
  )
  const surveyPoints = useMemo<SurveyPoint[]>(() => {
    const topography = (topographyDataset?.content ?? null) as { points?: SurveyPoint[] } | null
    return constraints?.surveyPoints?.length ? constraints.surveyPoints : topography?.points ?? []
  }, [constraints, topographyDataset])
  const unresolvedLayerCount = useMemo(() => {
    const audit = (routeAuditDataset?.content ?? null) as { unresolved?: { layers?: number } } | null
    return audit?.unresolved?.layers ?? constraints?.unresolvedLayers?.length ?? 0
  }, [constraints, routeAuditDataset])
  /**
   * Обеспечен ли самотёк по трассе и как она делится на бассейны.
   *
   * По отдельности каждый участок норме отвечает, поэтому без этой проверки
   * профиль выпускался при любой глубине. Предел глубины берётся из каталога
   * конструкций колодцев проекта: глубже самой глубокой позиции колодец не из
   * чего собрать. Без каталога разбивка не считается — своего предела мы не
   * вводим.
   */
  const gravityPlan = useMemo(() => {
    const profile = result?.profile
    if (!profile || profile.stations.length < 2) return null
    const design = new Map((result?.pipes ?? []).map((pipe) => [
      pipe.id,
      { diameterMm: pipe.diameterMm, slope: pipe.slope },
    ]))
    const feasibility = assessGravityFeasibility(profile, design)
    const catalogMaxDepthM = manholeCatalog.reduce((deepest, entry) => Math.max(deepest, entry.maxDepthM), 0)
    const basins = catalogMaxDepthM > 0 && !feasibility.feasible
      ? planGravityBasins(profile, design, {
        maxDepthM: catalogMaxDepthM,
        freezingDepthM: freezingDepth.valueM ?? 0,
      })
      : null
    return { feasibility, basins, catalogMaxDepthM }
  }, [result, manholeCatalog, freezingDepth])

  /**
   * Насколько геология описывает саму трассу.
   *
   * Шлюз выпуска проверяет лишь то, что у скважин есть координаты. Скважины
   * могут при этом стоять в стороне, и профиль опирался бы на значения,
   * продолженные за пределы изысканий. Сводка считает это по станциям профиля
   * и называет те, что вне допуска или за контуром выработок.
   */
  const routeCoverage = useMemo(() => {
    const profile = result?.profile
    const maxOffsetM = geologyCoverage.maxOffsetM
    if (!profile || profile.stations.length === 0 || !maxOffsetM || (boreholes ?? []).length === 0) {
      return null
    }
    const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
    const path = profile.stations
      .map((station) => nodeById.get(station.nodeId))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map((node) => ({ x: node.x, y: node.y }))
    if (path.length === 0) return null
    return summarizeRouteCoverage(boreholes ?? [], path, maxOffsetM)
  }, [result, boreholes, geologyCoverage.maxOffsetM, network.nodes])

  // Сверки, выполненные инженером по бумажному документу, — такое же
  // подтверждение, как транскрипция из PDF, и снимают пункт для этого проекта.
  const applicableUnverifiedClauses = useMemo(() => {
    const clauseConfirmations = ((normsDataset?.content ?? {}) as {
      clauseConfirmations?: NormClauseConfirmation[]
    }).clauseConfirmations ?? []
    return unverifiedClauses(clauseConfirmations)
      .filter((clause) => clause.appliesSystem.includes(systemType))
  }, [normsDataset, systemType])

  /**
   * Происхождение ключевых величин проекта.
   *
   * Читает те же состояния, что и шлюзы набора чертежей, поэтому разойтись с
   * ними не может. Ценность в другом разрезе: шлюз говорит «нельзя выпустить»,
   * а эта сводка — что именно измерено, что взято из задания, а что принято по
   * умолчанию и потому выпуску мешает.
   */
  const provenance = useMemo(() => auditProjectProvenance({
    surveyPointCount: surveyPoints.length,
    surveyPointSource: surveyPoints.length > 0 ? 'geometry' : 'none',
    georeference: constraints?.georeference ?? null,
    freezingDepth: {
      valueM: freezingDepth.valueM,
      status: freezingDepth.verified ? 'verified' : freezingDepth.available ? 'unverified' : 'missing',
      source: freezingDepth.source,
    },
    geologyCoverage,
    spatialBoreholeCount,
    designDiameterMm: schedule?.pipes[0]?.diameterMm ?? null,
    requiredClearanceM: constraints?.crossings?.[0]?.requiredClearanceM ?? null,
    deliverables: constraints?.deliverableRequirements ?? null,
    catalogReady: Boolean(activeCatalogId) && catalogResolution.ready,
    manholeCatalogReady: schedule
      ? schedule.manholes.length > 0
        && manholeSelection.selected.length === schedule.manholes.length
        && manholeSelection.unmatched.length === 0
      : false,
    normsVerified: applicableUnverifiedClauses.length === 0,
    ...(systemType === 'storm' ? { stormRunoff: stormRunoffStatus } : {}),
  }), [
    surveyPoints, constraints, freezingDepth, geologyCoverage, spatialBoreholeCount,
    schedule, activeCatalogId, catalogResolution.ready, manholeSelection,
    applicableUnverifiedClauses, systemType, stormRunoffStatus,
  ])

  const workingDrawingSet = useMemo(() => {
    return buildWorkingDrawingSet({
      system: systemType,
      network,
      profile: result?.profile ?? null,
      branchProfiles: branchProfileResolution.branchProfiles,
      schedule,
      routeStatus,
      routeBlockers: [...routeBlockers, ...branchProfileResolution.blockers],
      georeference: constraints?.georeference ?? null,
      surveyPoints,
      planContextFeatureCount: [
        constraints?.cadContextLines,
        constraints?.terrainLines,
        constraints?.cadTextEntities,
        constraints?.cadBlockEntities,
        constraints?.hardObstacleRings,
        constraints?.buildingPolygons,
        constraints?.parcelRings,
        constraints?.forbiddenRings,
        constraints?.protectionZoneRings,
        constraints?.protectionZones,
        constraints?.approvedCrossingRings,
        constraints?.approvedCrossingZones,
        constraints?.waterRings,
        constraints?.roadLines,
        constraints?.waterLines,
        constraints?.utilityLines,
        constraints?.redLines,
        constraints?.guideLines,
        constraints?.hardObstacles,
      ].reduce((total, collection) => total + (collection?.length ?? 0), 0),
      unresolvedLayerCount,
      catalogReady: Boolean(activeCatalogId) && catalogResolution.ready,
      catalogFingerprint: { activeCatalogId, catalogDiameters: currentCatalogDiameters },
      hydraulicsReady: Boolean(result?.profile) && (result?.pipes.every((pipe) => pipe.issues.length === 0) ?? false),
      stormRunoff: stormRunoffStatus,
      gravityFeasibility: gravityPlan?.feasibility ?? null,
      freezingDepth: {
        valueM: freezingDepth.valueM,
        status: freezingDepth.verified ? 'verified' : freezingDepth.available ? 'unverified' : 'missing',
        source: freezingDepth.source,
      },
      utilityFeatureCount: constraints?.utilityLines?.length ?? 0,
      crossings: constraints?.crossings,
      constraintsFingerprint: constraints,
      deliverableRequirements: constraints?.deliverableRequirements,
      protectiveGridDesign: constraints?.protectiveGridDesign,
      spatialBoreholeCount,
      geologyCoverage,
      geologyFingerprint: {
        dataset: geologyDataset?.content,
        boreholes,
        coverage: geologyCoverage,
        spatialBoreholeCount,
      },
      manholeCatalogReady: schedule
        ? schedule.manholes.length > 0
          && manholeSelection.selected.length === schedule.manholes.length
          && manholeSelection.unmatched.length === 0
        : false,
      manholeCatalogMissingLabels: manholeSelection.unmatched,
      manholeCatalogFingerprint: { entries: manholeCatalog, selection: manholeSelection },
      specificationItemCount: workingDrawingSpecificationItemCount(schedule, manholeSelection.selected),
      normsVerified: applicableUnverifiedClauses.length === 0,
      normsFingerprint: {
        dataset: normsDataset?.content,
        unresolvedApplicableClauseIds: applicableUnverifiedClauses.map((clause) => clause.id),
      },
      revision: routeRevision,
    })
  }, [
    activeCatalogId,
    branchProfileResolution,
    boreholes,
    currentCatalogDiameters,
    catalogResolution.ready,
    constraints,
    freezingDepth,
    applicableUnverifiedClauses,
    geologyCoverage,
    geologyDataset,
    gravityPlan,
    manholeCatalog,
    manholeSelection,
    network,
    normsDataset,
    result,
    routeBlockers,
    routeRevision,
    routeStatus,
    schedule,
    surveyPoints,
    stormRunoffStatus,
    spatialBoreholeCount,
    systemType,
    unresolvedLayerCount,
  ])
  const finalOutputAllowed = workingDrawingSet.summary.finalExportAllowed

  // Перепады читаются из уже решённого профиля: решатель прижимает лоток к
  // минимальному заглублению, и там, где земля падает быстрее трубы, остаётся
  // ступень. Раньше её никто не называл перепадом — в ведомость она не
  // попадала, конструкцию под неё не подбирали.
  const dropWells = useMemo(
    () => (result?.profile
      ? planDropWells(result.profile,
        new Map(result.pipes.map((pipe) => [pipe.id, { diameterMm: pipe.diameterMm, slope: pipe.slope }])))
      : null),
    [result],
  )

  const projectAlbumInput = () => {
    if (!result?.profile || !schedule) throw new Error('Не рассчитаны профиль и ведомость.')
    return {
      projectName,
      projectCode: systemType === 'storm' ? 'К2' : 'К1',
      system: systemType,
      network,
      profile: result.profile,
      schedule,
      drawingSet: workingDrawingSet,
      surveyPoints,
      boreholes,
      geologyMaxOffsetM: geologyCoverage.maxOffsetM,
      constraints,
      manholeConstructions: manholeSelection.selected,
      // Графы 9–13 основной надписи. Пока карточки не было, они печатались
      // пустыми на каждом листе альбома.
      ...((titleBlockDataset?.content ?? {}) as { organisation?: string; signatories?: TitleBlockSignatory[] }),
      pipeDiameterMm: new Map(result.pipes.map((pipe) => [pipe.id, pipe.diameterMm])),
      pipeDesign: new Map(result.pipes.map((pipe) => [pipe.id, {
        diameterMm: pipe.diameterMm,
        slope: pipe.slope,
        lengthM: pipe.lengthM,
        flowLps: pipe.flowLps,
        velocityMs: pipe.velocityMs,
        fillRatio: pipe.fillRatio,
      }])),
      buildingLabels: new Map(buildings.map((building) => [building.id, building.label ?? building.id])),
      outletFlowLps: result.outletFlowLps,
    }
  }

  // The full К1 sheet set, mirroring the professional НК album: общие данные,
  // ситуационная схема, план, продольный профиль, ведомость колодцев и труб.
  const exportQuantityBill = async () => {
    if (!result?.profile || !schedule) return
    setQuantityExporting(true)
    try {
      const { buildQuantityBill } = await import('@aquascheme/engine')
      const bytes = await generateQuantityBillXlsx(buildQuantityBill({
        profile: result.profile,
        schedule,
        constructions: manholeSelection.selected,
        dropWells: dropWells?.wells ?? [],
        ...quantitySettings,
      }))
      const blob = new Blob([bytes], { type: XLSX_TYPE })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_ведомость_объёмов.xlsx`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setBundleError(formatAppError(error))
    } finally {
      setQuantityExporting(false)
    }
  }

  const exportBundle = async () => {
    if (!result?.profile || !schedule) return
    if (!finalOutputAllowed) {
      setBundleError('Финальный комплект заблокирован: устраните стоп-факторы в реестре рабочих листов.')
      return
    }
    setExporting(true)
    setBundleError(null)
    try {
      const pipeDiameterMm = new Map(result.pipes.map((p) => [p.id, p.diameterMm]))
      const buildingLabels = new Map(buildings.map((b) => [b.id, b.label ?? '']))
      // Specification НК.С: lift station from the profile depths (ТЗ rule),
      // the waterproofing set when the water table sits above the deepest
      // excavation (dataset geology, groundwaterDepthM).
      const groundwaterDepthM = (geologyDataset?.content as { groundwaterDepthM?: number } | null)?.groundwaterDepthM
      const specItems = buildSewerSpecification({
        schedule,
        liftStation: assessLiftStationNeed(result.profile.stations.map((s) => s.depthM)).needed.value,
        highGroundwater: groundwaterDepthM !== undefined && groundwaterDepthM < result.profile.maxDepthM,
      })
      const [general, situation, plan, profile, xlsx, manholeSheets, specSheet, specXlsx, drawingFiles] = await Promise.all([
        generateSewerGeneralDataDxf({
          projectName,
          schedule,
          outletFlowLps: result.outletFlowLps,
          maxDepthM: result.profile.maxDepthM,
        }),
        generateSituationDxf({
          projectName,
          systemType,
          network,
          buildings: buildings.map((b) => ({ x: b.x, y: b.y, label: b.label ?? undefined })),
          pipeDiameterMm,
        }),
        generateSewerPlanDxf({ projectName, network, pipeDiameterMm, buildingLabels }),
        generateSewerProfileDxf({ projectName, profile: result.profile, crossings: constraints?.crossings ?? [] }),
        generateSewerScheduleXlsx(schedule, manholeSelection.selected),
        generateManholeSheetsDxf(projectName, schedule, manholeSelection.selected),
        generateSewerSpecSheetDxf(projectName, specItems),
        generateSewerSpecXlsx(specItems),
        generateWorkingDrawingSetDxfs(projectAlbumInput()),
      ])
      const files: Record<string, string | Uint8Array> = {
        [`${slug}_01_общие_данные.dxf`]: general,
        [`${slug}_02_ситуационная_схема.dxf`]: situation,
        [`${slug}_03_план_${systemType === 'storm' ? 'К2' : 'К1'}_сводный.dxf`]: plan,
        [`${slug}_04_профиль_${systemType === 'storm' ? 'К2' : 'К1'}_сводный.dxf`]: profile,
        [`${slug}_05_ведомость.xlsx`]: xlsx,
        // Листы колодцев: параметрические решения и ведомость материалов по
        // каждому колодцу. Строились и проверялись, но в комплект не попадали —
        // собиравшая их функция не вызывалась ниоткуда.
        [`${slug}_05a_колодцы_решения.dxf`]: manholeSheets.detail,
        [`${slug}_06_спецификация_НК.dxf`]: specSheet,
        [`${slug}_06_спецификация_НК.xlsx`]: specXlsx,
      }
      const fileSafe = (title: string) => title.replace(/\.\s*М1:500$/, '').replace(/[\s.()]+/g, '_')
      manholeSheets.tables.forEach((sheet, index) => {
        files[`${slug}_05b_${String(index + 1).padStart(2, '0')}_${fileSafe(sheet.title)}.dxf`] = sheet.dxf
      })
      if (manholeSheets.grille) files[`${slug}_05c_защитная_сетка.dxf`] = manholeSheets.grille
      for (const sheet of drawingFiles) {
        files[`${slug}_${String(sheet.sheetNumber).padStart(2, '0')}_${fileSafe(sheet.title)}.dxf`] = sheet.dxf
      }
      const zip = await zipBundle(files)
      const url = URL.createObjectURL(zip)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_комплект_${systemType === 'storm' ? 'К2' : 'К1'}.zip`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setBundleError(error instanceof Error ? `Не удалось сформировать рабочий комплект: ${error.message}` : 'Не удалось сформировать рабочий комплект')
    } finally {
      setExporting(false)
    }
  }

  // Mandatory corridor check (ТЗ п.6.1): the main collector path against the
  // right-of-way rings loaded/drawn in the parcels section.
  const runCorridorCheck = () => {
    if (!result?.profile) return
    const mainPath = workingDrawingSet.mainPath.map(({ x, y }) => ({ x, y }))
    const rings = (parcels ?? [])
      .filter((p) => p.kind === 'right_of_way')
      .map((p) => ringFromGeoJsonGeometry(p.geometry))
      .filter((r): r is NonNullable<typeof r> => !!r)
    setCorridorCheck(checkRouteInCorridor(mainPath, rings))
  }

  const exportNote = async () => {
    if (!result || !schedule) return
    setExporting(true)
    try {
      const groundwaterDepthM = (geologyDataset?.content as { groundwaterDepthM?: number } | null)?.groundwaterDepthM
      const spec = buildSewerSpecification({
        schedule,
        liftStation: assessLiftStationNeed((result.profile?.stations ?? []).map((s) => s.depthM)).needed.value,
        highGroundwater:
          groundwaterDepthM !== undefined && result.profile !== null && groundwaterDepthM < result.profile.maxDepthM,
      })
      const blob = await generateSewerNotePdf({
        projectName,
        dateIso: new Date().toISOString(),
        system: systemType,
        result,
        spec,
        designStrategyNote:
          strategy === 'minBurial'
            ? 'Критерий подбора: минимизация заглубления коллектора на плоском рельефе (проектное решение, запись реестра sewer.design.minBurial).'
            : undefined,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_записка_${systemType === 'storm' ? 'К2' : 'К1'}.pdf`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setExporting(false)
    }
  }

  const exportSchedule = async () => {
    if (!schedule) return
    setExporting(true)
    try {
      const bytes = await generateSewerScheduleXlsx(schedule, manholeSelection.selected)
      const blob = new Blob([bytes], { type: XLSX_TYPE })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_ведомость_${systemType === 'storm' ? 'К2' : 'К1'}.xlsx`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setExporting(false)
    }
  }

  const slug = projectName.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '').slice(0, 40) || 'project'

  const saveRun = async () => {
    if (!result) return
    setSaving(true)
    setSaveError(null)
    try {
      await persistGravity(projectId, result)
      setSavedAt(new Date().toISOString())
    } catch (error) {
      setSaveError(formatAppError(error))
    } finally {
      setSaving(false)
    }
  }

  const exportProfile = async () => {
    if (!result?.profile) return
    setExporting(true)
    try {
      const dxf = await generateSewerProfileDxf({ projectName, profile: result.profile, crossings: constraints?.crossings ?? [] })
      downloadText(`${slug}_профиль_К1.dxf`, dxf, 'application/dxf')
    } finally {
      setExporting(false)
    }
  }

  const exportPlan = async () => {
    if (!result) return
    setExporting(true)
    try {
      const network = networkFromRows(nodes, pipes)
      const pipeDiameterMm = new Map(result.pipes.map((p) => [p.id, p.diameterMm]))
      const buildingLabels = new Map(buildings.map((b) => [b.id, b.label ?? '']))
      const dxf = await generateSewerPlanDxf({ projectName, network, pipeDiameterMm, buildingLabels })
      downloadText(`${slug}_план_К1.dxf`, dxf, 'application/dxf')
    } finally {
      setExporting(false)
    }
  }

  const exportSituation = async () => {
    if (!result) return
    setExporting(true)
    try {
      const network = networkFromRows(nodes, pipes)
      const pipeDiameterMm = new Map(result.pipes.map((p) => [p.id, p.diameterMm]))
      const dxf = await generateSituationDxf({
        projectName,
        systemType,
        network,
        buildings: buildings.map((b) => ({ x: b.x, y: b.y, label: b.label ?? undefined })),
        pipeDiameterMm,
      })
      downloadText(`${slug}_ситуационная_схема.dxf`, dxf, 'application/dxf')
    } finally {
      setExporting(false)
    }
  }

  const exportAlbum = async () => {
    if (!result?.profile || !schedule) return
    if (!finalOutputAllowed) {
      setAlbumError('Финальный PDF заблокирован: устраните стоп-факторы в реестре рабочих листов.')
      return
    }
    setAlbumExporting(true)
    setAlbumError(null)
    try {
      // Allow the busy indicator to paint before pdfmake starts its CPU-heavy layout pass.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const blob = await generateProjectAlbumPdf(projectAlbumInput())
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${slug}_рабочие_чертежи_${workingDrawingSet.summary.total}_листов.pdf`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setAlbumError(error instanceof Error ? `Не удалось сформировать альбом: ${error.message}` : 'Не удалось сформировать альбом')
    } finally {
      setAlbumExporting(false)
    }
  }

  const exportAlbumSheet = async (sheetId: string) => {
    setAlbumExporting(true)
    setAlbumError(null)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const sheet = workingDrawingSet.sheets.find((item) => item.id === sheetId)
      const blob = await generateProjectSheetPdf(projectAlbumInput(), sheetId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${slug}_лист_${sheet?.sheetNumber ?? sheetId}.pdf`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setAlbumError(error instanceof Error ? `Не удалось сформировать лист: ${error.message}` : 'Не удалось сформировать лист')
    } finally {
      setAlbumExporting(false)
    }
  }

  const exportAlbumSheetDxf = async (sheetId: string) => {
    setExporting(true)
    setAlbumError(null)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const sheet = workingDrawingSet.sheets.find((item) => item.id === sheetId)
      const dxf = await generateWorkingDrawingSheetDxf(projectAlbumInput(), sheetId)
      const safeTitle = (sheet?.title ?? sheetId).replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0, 80)
      downloadText(`${slug}_лист_${sheet?.sheetNumber ?? sheetId}_${safeTitle}.dxf`, dxf, 'application/dxf')
    } catch (error) {
      setAlbumError(error instanceof Error ? `Не удалось сформировать DXF листа: ${error.message}` : 'Не удалось сформировать DXF листа')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Panel title={t('project.gravity.title')} status={result ? 'filled' : 'empty'}>
      <p className="hint">{t('project.gravity.hint')}</p>

      {/*
        Готовность проекта первым делом: до этого состояние выпуска было
        видно только внутри альбома, а одна причина держит десяток листов.
      */}
      <h4>Готовность к выпуску</h4>
      <ReadinessView drawingSet={workingDrawingSet} />

      <div className="drawing-audit" style={{ marginBottom: 12 }}>
        <div>
          <h5>Глубина промерзания для профиля</h5>
          <p className={`stat-line${freezingDepth.verified ? ' ok' : ' warn'}`}>
            {freezingDepth.verified
              ? `Подтверждено: ${freezingDepth.detail}.`
              : `Черновой режим: ${freezingDepth.detail}; для предварительного расчёта используется ${
                (freezingDepth.valueM ?? DEFAULT_FREEZING_DEPTH_M).toFixed(2)
              } м.`}
          </p>
          {!freezingDepth.verified && freezingDepth.blockers.map((message) => (
            <p className="stat-line warn" key={message}>{message}</p>
          ))}
        </div>
      </div>
      <div className="drawing-audit" style={{ marginBottom: 12 }}>
        <div>
          <h5>Происхождение исходных величин</h5>
          <p className={`stat-line${provenance.blockers.length === 0 ? ' ok' : ' warn'}`}>
            Пригодно к выпуску {Math.round(provenance.verifiedShare * 100)}% величин
            ({provenance.total - provenance.blockers.length} из {provenance.total}).
          </p>
          <p className="hint">
            Шлюз выпуска говорит, что выпустить нельзя; эта сводка — чем именно подтверждена
            каждая величина. Величины из задания и ТУ идут отдельным разрядом: это авторитетный
            вход проекта, а не принятое по умолчанию.
          </p>
          <div className="table-wrap" style={{ maxHeight: 300 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Величина</th>
                  <th scope="col">Происхождение</th>
                  <th scope="col">Чем подтверждена</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(provenance.fields).map(([field, item]) => (
                  <tr key={field} className={item.provenance.verified ? undefined : 'row-warn'}>
                    <td>{field}</td>
                    <td>{provenanceLabel(item.provenance.kind)}</td>
                    <td>
                      {item.provenance.source}
                      {item.provenance.note ? ` — ${item.provenance.note}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {routeCoverage && (
        <div className="drawing-audit" style={{ marginBottom: 12 }}>
          <div>
            <h5>Покрытие трассы геологией</h5>
            <p className={`stat-line${routeCoverage.blockers.length === 0 ? ' ok' : ' warn'}`}>
              Описано изысканиями {(routeCoverage.covered * 100).toFixed(0)}% станций
              ({routeCoverage.measured} по замеру, {routeCoverage.interpolated} интерполяцией
              из {routeCoverage.stations})
              {routeCoverage.worstGapM === null
                ? ''
                : `; наибольшее удаление до скважины ${routeCoverage.worstGapM.toFixed(0)} м`}.
            </p>
            {routeCoverage.blockers.map((message) => (
              <p className="stat-line warn" key={message}>{message}</p>
            ))}
          </div>
        </div>
      )}
      {gravityPlan && (
        <div className="drawing-audit" style={{ marginBottom: 12 }}>
          <div>
            <h5>Самотёк по трассе</h5>
            <p className={`stat-line${gravityPlan.feasibility.feasible ? ' ok' : ' warn'}`}>
              {gravityPlan.feasibility.reason}
            </p>
            {!gravityPlan.feasibility.feasible && gravityPlan.basins && (
              <>
                <p className="stat-line">{gravityPlan.basins.reason}</p>
                <p className="hint">
                  Предел глубины {gravityPlan.catalogMaxDepthM} м взят из каталога конструкций
                  колодцев проекта: глубже самой глубокой позиции колодец не из чего собрать.
                  Гидравлика напорных участков здесь не считается.
                </p>
                <div className="table-wrap" style={{ maxHeight: 260 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Бассейн</th>
                        <th scope="col" className="num">От, м</th>
                        <th scope="col" className="num">До, м</th>
                        <th scope="col" className="num">Длина, м</th>
                        <th scope="col" className="num">Глубина, м</th>
                        <th scope="col">Конец</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gravityPlan.basins.basins.map((basin) => (
                        <tr key={basin.index}>
                          <td className="num">{basin.index}</td>
                          <td className="num">{basin.fromChainageM.toFixed(0)}</td>
                          <td className="num">{basin.toChainageM.toFixed(0)}</td>
                          <td className="num">{basin.lengthM.toFixed(0)}</td>
                          <td className="num">{basin.maxDepthM.toFixed(2)}</td>
                          <td>{basin.liftAtEnd ? 'перекачка' : 'выпуск'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {!gravityPlan.feasibility.feasible && !gravityPlan.basins && (
              <p className="stat-line warn">
                Разбивка на бассейны не рассчитана: не загружен каталог конструкций колодцев,
                а предел глубины из него и берётся.
              </p>
            )}
          </div>
        </div>
      )}
      {systemType === 'storm' && stormRunoffStatus && (
        <div className="drawing-audit" style={{ marginBottom: 12 }}>
          <div>
            <h5>Расчёт дождевого стока по N05, п. 5.4</h5>
            <p className={`stat-line${stormRunoffStatus.verified ? ' ok' : ' warn'}`}>
              {stormRunoffStatus.detail}. Подтверждённый расчёт имеет приоритет над ручным расходом.
            </p>
            {!stormRunoffStatus.verified && (
              <p className="notice error">
                Ручные расходы используются только для черновой гидравлики. Финальный выпуск заблокирован до загрузки
                `drainage.stormCatchments` с подтверждёнными q20, n, m_r, gamma, P, площадями/типами покрытий и временем добегания.
              </p>
            )}
            {stormRunoffStatus.blockers?.map((message) => <p className="stat-line warn" key={message}>{message}</p>)}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Водосбор</th><th className="num">F, га</th><th className="num">z mid</th><th className="num">t r, мин</th><th className="num">q cal, л/с</th><th>Статус</th></tr></thead>
              <tbody>
                {stormRunoffResults.length === 0 ? (
                  <tr><td colSpan={6}>Структурированные водосборы не загружены.</td></tr>
                ) : stormRunoffResults.map(({ inflowId, result: runoff }) => (
                  <tr key={`${inflowId}-${runoff.catchmentId}`} className={runoff.verified ? undefined : 'row-warn'}>
                    <td>{runoff.catchmentId} → {inflowId}</td>
                    <td className="num mono">{runoff.areaHa.toFixed(3)}</td>
                    <td className="num mono">{runoff.coefficientZMid?.toFixed(4) ?? '—'}</td>
                    <td className="num mono">{runoff.durationMin?.toFixed(3) ?? '—'}</td>
                    <td className="num mono">{runoff.calculatedFlowLps?.toFixed(3) ?? '—'}</td>
                    <td>{runoff.verified ? 'проверен' : 'заблокирован'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!finalOutputAllowed && result && (
        <p className="notice error">Расчёт доступен для проверки, но финальный выпуск заблокирован: {workingDrawingSet.summary.blocked} листов со стоп-факторами, {workingDrawingSet.summary.stale} устаревших. Причины перечислены в реестре ниже.</p>
      )}
      {!result && (
        <>
          {pipes.length === 0 ? (
            <p className="stat-line warn">{t('project.gravity.needNetwork')}</p>
          ) : routeStatus === 'stale' || routeStatus === 'blocked' ? (
            <p className="notice error">Гидравлический расчёт остановлен: инженерная трасса имеет статус «{routeStatus}». Завершите загрузку исходных данных и пересчитайте трассу.</p>
          ) : catalogResolution.blocker ? (
            <p className="notice error">{catalogResolution.blocker}</p>
          ) : null}
          {systemType === 'storm' && (
            <p className="stat-line">{t('project.gravity.demoSeedHint')} Используйте безопасную кнопку «Загрузить синтетическое демо» в заголовке проекта.</p>
          )}
        </>
      )}
      {result && (
        <>
          <p className="stat-line ok">
            {t('project.gravity.outletFlow', { value: result.outletFlowLps.toFixed(2) })}
          </p>

          <div className="section-actions" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={() => void saveRun()}>
              {saving ? t('project.gravity.saving') : t('project.gravity.save')}
            </button>
            {savedAt && (
              <span className="stat-line" style={{ marginTop: 0 }}>
                {t('project.gravity.savedAt', { value: savedAt.slice(0, 16).replace('T', ' ') })}
              </span>
            )}
          </div>
          {saveError && <p className="notice error" role="alert">Не удалось сохранить расчёт: {saveError}</p>}
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('project.gravity.thSegment')}</th>
                  <th className="num">{t('project.gravity.thFlow')}</th>
                  <th className="num">{t('project.gravity.thDiameter')}</th>
                  <th className="num">{t('project.gravity.thSlope')}</th>
                  <th className="num">{t('project.gravity.thFill')}</th>
                  <th className="num">{t('project.gravity.thVelocity')}</th>
                  <th>{t('project.gravity.thCheck')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={p.issues.length > 0 ? 'row-warn' : undefined}>
                    <td>{`${labelOfNode(p.fromNode)}–${labelOfNode(p.toNode)}`}</td>
                    <td className="num mono">{p.flowLps.toFixed(2)}</td>
                    <td className="num mono">{p.diameterMm}</td>
                    <td className="num mono">{(p.slope * 1000).toFixed(1)}</td>
                    <td className="num mono">{p.fillRatio.toFixed(2)}</td>
                    <td className="num mono">{p.velocityMs.toFixed(2)}</td>
                    <td>
                      {p.issues.length === 0
                        ? t('project.gravity.ok')
                        : p.issues.map((i) => i.message).join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8 }}>
            <NormBadge refs={['sewer.minDiameter', 'sewer.velocity.min', 'sewer.filling.max', 'sewer.slope.min']} />
          </div>
          <div className="section-actions" style={{ marginTop: 12 }}>
            <label className="field" htmlFor="gravity-sizing-strategy" style={{ maxWidth: 320 }}>
              <span className="field-label">{t('project.gravity.strategy')}</span>
              <select
                id="gravity-sizing-strategy"
                name="gravity-sizing-strategy"
                className="input"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as 'minDiameter' | 'minBurial')}
              >
                <option value="minBurial">{t('project.gravity.strategyMinBurial')}</option>
                <option value="minDiameter">{t('project.gravity.strategyMinDiameter')}</option>
              </select>
            </label>
            <button type="button" className="btn btn-sm" disabled={exporting || !finalOutputAllowed} onClick={() => void exportPlan()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportPlan')}
            </button>
            <button type="button" className="btn btn-sm" disabled={exporting || !finalOutputAllowed} onClick={() => void exportSituation()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportSituation')}
            </button>
            <button type="button" className="btn btn-sm" disabled={!result.profile} onClick={runCorridorCheck}>
              {t('project.gravity.corridorRun')}
            </button>
            <button type="button" className="btn btn-sm" disabled={exporting || !result.profile || !finalOutputAllowed} onClick={() => void exportNote()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportNote')}
            </button>
            {corridorCheck && (
              <span className={`stat-line${corridorCheck.inside.value ? ' ok' : ' warn'}`} style={{ marginTop: 0 }}>
                {corridorCheck.inside.value
                  ? t('project.gravity.corridorOk')
                  : corridorCheck.violations.length === 0
                    ? t('project.gravity.corridorNone')
                    : t('project.gravity.corridorViolations', { count: corridorCheck.violations.length })}
              </span>
            )}
            <button type="button" className="btn btn-sm" disabled={exporting || !result.profile || !finalOutputAllowed} onClick={() => void exportBundle()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportBundle')}
            </button>
          </div>

          {/*
            Геологический разрез: на профиле стояли колонки отдельных скважин,
            а между ними было пусто. Ось профиля берётся из того же набора
            рабочих чертежей, что и сами листы.
          */}
          {result.profile && workingDrawingSet.mainPath.length >= 2 && (
            <GeologySectionView
              boreholes={boreholes ?? []}
              path={workingDrawingSet.mainPath}
              maxOffsetM={geologyCoverage.maxOffsetM}
              routeLengthM={result.profile.totalLengthM}
            />
          )}

          {dropWells && (
            <div>
              <h4>Перепады на трассе (п. 7.5.1)</h4>
              <p className={dropWells.structureCount > 0 ? 'notice' : 'stat-line'}>{dropWells.reason}</p>
              {dropWells.wells.length > 0 && (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Узел</th><th className="num">Пикетаж, м</th><th className="num">Перепад, м</th>
                        <th className="num">Ø, мм</th><th>Решение</th><th>Обоснование</th>
                      </tr>
                    </thead>
                    <tbody>{dropWells.wells.map((well) => (
                      <tr key={well.nodeId} className={well.kind.value === 'перепадный колодец' ? 'row-warn' : undefined}>
                        <td>{well.nodeId}</td>
                        <td className="num">{well.chainageM.toFixed(1)}</td>
                        <td className="num">{well.dropM.toFixed(2)}</td>
                        <td className="num">{well.diameterMm || '—'}</td>
                        <td>{well.kind.value}</td>
                        <td>{well.kind.note}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {result.profile && schedule && (
            <QuantityBillView
              profile={result.profile}
              schedule={schedule}
              constructions={manholeSelection.selected}
              dropWells={dropWells?.wells ?? []}
              settings={quantitySettings}
              exporting={quantityExporting}
              fieldPrefix={`quantity-${projectId}`}
              onSettingsChange={(next) => {
                setQuantitySettings(next)
                const content = (drainageDataset?.content ?? {}) as Record<string, unknown>
                void saveDataset(projectId, 'drainage', { ...content, quantityBill: next })
              }}
              onExport={() => void exportQuantityBill()}
            />
          )}

          {systemType === 'storm' && result.profile && (
            <StormInletsView
              profile={result.profile}
              streetWidthM={streetWidthM}
              onStreetWidthChange={(value) => void saveStreetWidth(value)}
              fieldId={`storm-street-width-${projectId}`}
            />
          )}

          {/*
            Пошаговая сборка ситуационной схемы: каждый слой называет данные, из
            которых нарисован, а отсутствующие показывает прямо, а не пропускает.
            Компонент существовал со своим SchemeView и переводами на трёх
            языках, но не отрисовывался нигде — путь с экрана к нему отсутствовал.
          */}
          <SchemeBuilder
            scheme={{
              title: `${systemType === 'storm' ? 'К2' : 'К1'}. ${projectName}`,
              network,
              buildings: buildings.map((building) => ({ x: building.x, y: building.y, label: building.label })),
              pipeDiameterMm: new Map(result.pipes.map((pipe) => [pipe.id, pipe.diameterMm])),
              outletFlowLps: result.outletFlowLps,
              corridorRings: constraints?.corridorRings,
            }}
            steps={{
              network,
              pipeDiameterMm: new Map(result.pipes.map((pipe) => [pipe.id, pipe.diameterMm])),
              buildingsCount: buildings.length,
              corridorRings: constraints?.corridorRings?.length ?? 0,
              outletFlowLps: result.outletFlowLps,
            }}
          />

          {result.profile && schedule && (
            <AlbumSheetSet
              drawingSet={workingDrawingSet}
              network={network}
              pipeDiameterMm={new Map(result.pipes.map((pipe) => [pipe.id, pipe.diameterMm]))}
              pipeDesign={new Map(result.pipes.map((pipe) => [pipe.id, {
                diameterMm: pipe.diameterMm,
                slope: pipe.slope,
                lengthM: pipe.lengthM,
                flowLps: pipe.flowLps,
                velocityMs: pipe.velocityMs,
                fillRatio: pipe.fillRatio,
              }]))}
              buildingLabels={new Map(buildings.map((building) => [building.id, building.label ?? building.id]))}
              surveyPoints={surveyPoints}
              profile={result.profile}
              schedule={schedule}
              constraints={constraints}
              manholeConstructions={manholeSelection.selected}
              pdfBusy={albumExporting}
              zipBusy={exporting}
              onPdf={() => void exportAlbum()}
              onSheetPdf={(sheetId) => void exportAlbumSheet(sheetId)}
              onSheetDxf={(sheetId) => void exportAlbumSheetDxf(sheetId)}
              onZip={() => void exportBundle()}
              error={albumError ?? bundleError}
            />
          )}

          {result.profile && result.profile.stations.length > 0 && (
            <>
              <h4 className="subhead" style={{ marginTop: 20 }}>
                {t('project.gravity.profileTitle')}
              </h4>
              <p className="stat-line">
                {t('project.gravity.maxDepth', { value: result.profile.maxDepthM.toFixed(2) })}
              </p>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('project.gravity.thNode')}</th>
                      <th className="num">{t('project.gravity.thChainage')}</th>
                      <th className="num">{t('project.gravity.thGround')}</th>
                      <th className="num">{t('project.gravity.thInvert')}</th>
                      <th className="num">{t('project.gravity.thDepth')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.profile.stations.map((s) => (
                      <tr key={s.nodeId}>
                        <td>{labelOfNode(s.nodeId)}</td>
                        <td className="num mono">{s.chainageM.toFixed(0)}</td>
                        <td className="num mono">{s.groundElevationM.toFixed(2)}</td>
                        <td className="num mono">{s.invertElevationM.toFixed(2)}</td>
                        <td className="num mono">{s.depthM.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 8 }}>
                <NormBadge refs={['sewer.depth.min']} />
              </div>
              <div className="section-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-sm" disabled={exporting || !finalOutputAllowed} onClick={() => void exportProfile()}>
                  {exporting ? t('project.gravity.exporting') : t('project.gravity.exportProfile')}
                </button>
              </div>
            </>
          )}

          {schedule && schedule.manholes.length > 0 && (
            <>
              <h4 className="subhead" style={{ marginTop: 20 }}>
                {t('project.gravity.scheduleTitle')}
              </h4>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('project.gravity.thNode')}</th>
                      <th>{t('project.gravity.thPicket')}</th>
                      <th className="num">{t('project.gravity.thWellDepth')}</th>
                      <th className="num">{t('project.gravity.thWellDiameter')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.manholes.map((m) => (
                      <tr key={m.label}>
                        <td>{m.label}</td>
                        <td className="mono">{m.picket}</td>
                        <td className="num mono">{m.depthMm}</td>
                        <td className="num mono">{m.pipeDiameterMm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h4 className="subhead" style={{ marginTop: 16 }}>
                {t('project.gravity.pipeScheduleTitle')}
              </h4>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('project.gravity.thDesignation')}</th>
                      <th className="num">{t('project.gravity.thWellDiameter')}</th>
                      <th className="num">{t('project.gravity.thPipeLength')}</th>
                      <th>{t('project.gravity.thAgsk')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.pipes.map((p) => (
                      <tr key={p.diameterMm}>
                        <td>{p.designation}</td>
                        <td className="num mono">{p.diameterMm}</td>
                        <td className="num mono">{p.lengthM}</td>
                        <td className="mono">{p.agskCode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="stat-line">{t('project.gravity.pipeTotal', { value: schedule.totalPipeLengthM })}</p>
              <p className="hint">{t('project.gravity.agskNote')}</p>
              <p className="hint">{t('project.gravity.scheduleNote')}</p>
              <div className="section-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-sm" disabled={exporting || !finalOutputAllowed} onClick={() => void exportSchedule()}>
                  {exporting ? t('project.gravity.exporting') : t('project.gravity.exportSchedule')}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  )
}
