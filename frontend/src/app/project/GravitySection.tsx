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
  NORMATIVE_DEFAULTS,
  ringFromGeoJsonGeometry,
  manholeSpacingM,
  maxFilling,
  plannedSurfaceAlong,
  selectManholeConstructions,
  solveGravityNetwork,
  assessExistingInvertTie,
  assessGravityFeasibility,
  auditProjectProvenance,
  summarizeRouteCoverage,
  planDropWells,
  planBasinPressureLinks,
  applyGravityBasinLifts,
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
import { readTechnicalConditions } from '../../shared/technicalConditions'
import type { NodeRow, PipeRow } from '../../shared/network'
import { loadActiveCatalogNominalDiameters, resolveGravityCatalog } from '../../shared/catalog'
import { ReconstructionProfileNotes } from './ReconstructionProfileNotes'
import { readRouteConstraints } from '../../shared/dxfContext'
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
  generatePlanSheetSetDxf,
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
import { SituationSchemeView } from './SituationSchemeView'
import { StormInletsView } from './StormInletsView'
import { ReadinessView } from './ReadinessView'
import { ProvenanceAuditView } from './ProvenanceAuditView'
import { GeologySectionView } from './GeologySectionView'
import { QuantityBillView } from './QuantityBillView'
import { MasterPlanView } from './MasterPlanView'
import type { MasterPlanContent } from './MasterPlanView'
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
  verticalPlanDataset,
  gravityBasinsDataset,
  pumpCatalogDataset,
  conditionsDataset,
  constraintsDataset,
  routeAuditDataset,
  manholeCatalogDataset,
  titleBlockDataset,
  masterPlanDataset,
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
  /** Проектные отметки вертикальной планировки. */
  verticalPlanDataset?: DatasetRow
  /** Подтверждённая инженером разбивка на самотёчные бассейны. */
  gravityBasinsDataset?: DatasetRow
  /** Каталог насосов, категория надёжности и характер стоков. */
  pumpCatalogDataset?: DatasetRow
  /** Контрактные величины проекта, в том числе подтверждённые из задания. */
  conditionsDataset?: DatasetRow
  constraintsDataset?: DatasetRow
  routeAuditDataset?: DatasetRow
  manholeCatalogDataset?: DatasetRow
  titleBlockDataset?: DatasetRow
  masterPlanDataset?: DatasetRow
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
  const [basinSource, setBasinSource] = useState('')
  const [basinSaving, setBasinSaving] = useState(false)
  /**
   * Решение, только что сохранённое на этом экране.
   *
   * Родитель эту секцию по сохранению набора не перезагружает — так же ведёт
   * себя и соседнее сохранение ширины проезжей части. Без локального
   * состояния подтверждение вступало бы в силу лишь после перезагрузки
   * страницы, и инженер решил бы, что кнопка не работает.
   */
  const [savedDecision, setSavedDecision] = useState<
    { confirmed: true; liftCount: number; source: string; boundaryChainagesM: number[] } | null | undefined
  >(undefined)
  const [exporting, setExporting] = useState(false)
  const [albumExporting, setAlbumExporting] = useState(false)
  const [albumError, setAlbumError] = useState<string | null>(null)
  const [bundleError, setBundleError] = useState<string | null>(null)
  // Design criterion: minBurial is what professional flat-terrain trunks use
  // (registry sewer.design.minBurial); minDiameter is the economical default.
  const [strategy, setStrategy] = useState<'minDiameter' | 'minBurial'>('minBurial')
  const [corridorCheck, setCorridorCheck] = useState<CorridorCheck | null>(null)
  const [saving, setSaving] = useState(false)
  const [runPersisted, setRunPersisted] = useState(false)
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
  // Диаметры генплана: держатся в состоянии, чтобы ввод не ждал ответа базы.
  const savedMasterPlan = (masterPlanDataset?.content ?? {}) as MasterPlanContent
  const [masterPlan, setMasterPlan] = useState<MasterPlanContent>(savedMasterPlan)
  const [masterPlanError, setMasterPlanError] = useState<string | null>(null)
  useEffect(() => { setMasterPlan(savedMasterPlan) }, [masterPlanDataset])

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
  /**
   * Контрактные величины проекта.
   *
   * Читаются ДО разрешения ряда диаметров: подтверждённый ряд по ТУ участвует
   * в нём наравне с каталогом. Раньше набор читался ниже по файлу, ряд шёл
   * только из каталога, и подтверждённый Д=450 в расчёт не попадал вовсе.
   */
  const projectConditions = useMemo(
    () => readTechnicalConditions(conditionsDataset),
    [conditionsDataset],
  )
  const catalogResolution = useMemo(
    () => resolveGravityCatalog(
      activeCatalogId, currentCatalogDiameters, currentCatalogError, projectConditions,
    ),
    [activeCatalogId, currentCatalogDiameters, currentCatalogError, projectConditions],
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
    /*
      БЕЗ ГЛУБИНЫ ПРОМЕРЗАНИЯ ПРОФИЛЬ НЕ СЧИТАЕТСЯ.
      Здесь стояла подстановка глубины по умолчанию — 2,00 м, числа, которого нет
      ни в одном документе объекта: по отчёту Станкевича наибольший кандидат
      1,03 м, по отчёту Талдыколя наименьший 1,71 м. Промерзание задаёт
      наименьшее заглубление, то есть весь профиль, и «предварительный расчёт»
      по числу из воздуха давал глубины, к объекту отношения не имеющие.
      Показать их — хуже, чем не показать: инженер видит правдоподобные метры.
      Отсутствие выражается ОТКАЗОМ СЧИТАТЬ, а раздел ниже называет причину и
      ведёт к выбору кандидата из отчёта.
    */
    if (freezingDepth.valueM === null) return null
    const freezingDepthM = freezingDepth.valueM
    return solveGravityNetwork({
      network,
      buildingFlowLps,
      system: systemType,
      freezingDepthM,
      strategy,
      stormRainPeriodYears,
      outletNodeId: network.nodes.find((node) => node.kind === 'lns_inlet' || node.kind === 'pumping_station')?.id,
      allowedDiametersMm: catalogResolution.allowedDiametersMm,
      diametersFromConditions: catalogResolution.fromConditions === true,
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
        /*
          «Рассчитан» и «можно выпускать» — РАЗНЫЕ УТВЕРЖДЕНИЯ. Шапка проекта
          говорила «Проект рассчитан. Можно экспортировать документацию», а на
          той же странице ниже стояло «к выпуску 0 (0%), заблокировано 5».
          Инженер читал верхнюю строку и шёл выпускать то, чего нельзя.
          Состояние выпуска известно здесь — оно и уходит вместе с итогом.
        */
        setRunPersisted(true)
      })
      .catch((error) => {
        const detail = formatAppError(error)
        setSaveError(detail)
        onRunComplete?.('error', detail)
      })
      .finally(() => setSaving(false))
  }, [catalogResolution.blocker, onRunComplete, pipes.length, projectId, result, routeStatus, runRequest])

  /*
    Что известно и без промерзания: состав сети и её длина.

    Длина суммируется ТОЛЬКО по участкам, где она есть, а число таких участков
    называется отдельно. Иначе участок без длины тихо вошёл бы в сумму нулём —
    и «длина сети» оказалась бы меньше настоящей без всякого признака.
  */
  const networkLength = useMemo(() => {
    const measured = network.pipes.filter((pipe) => Number.isFinite(pipe.lengthM))
    return {
      measured: measured.length,
      totalM: measured.reduce((sum, pipe) => sum + pipe.lengthM, 0),
    }
  }, [network])

  const rows = useMemo(() => {
    if (!result) return []
    return [...result.pipes].sort((a, b) => b.flowLps - a.flowLps)
  }, [result])

  // Профили ветвей — та же глубина промерзания и то же правило: без выбранной
  // величины их не считают, а не считают по умолчанию.
  const branchProfileResolution = useMemo(
    () => (freezingDepth.valueM === null
      ? { branchProfiles: [], blockers: [] }
      : resolveGravityBranchProfilesForDrawings({
        network,
        result,
        freezingDepthM: freezingDepth.valueM,
      })),
    [freezingDepth.valueM, network, result],
  )

  const schedule = useMemo(() => (result
    ? buildSewerSchedule(result, {
        branchProfiles: branchProfileResolution.branchProfiles.map((branch) => branch.profile),
      })
    : null), [branchProfileResolution.branchProfiles, result])
  /**
   * Проект собран на учебных данных.
   *
   * Признак ставит демо-посев: геология учебного набора помечена как
   * синтетическая. Он НЕ блокирует расчёт — листы доходят до CALCULATED,
   * альбом собирается со знаком «ДЕМО», — а к выпуску набор не допускает,
   * потому что VERIFIED синтетика не получает.
   */
  const syntheticData = ((geologyDataset?.content ?? {}) as { synthetic?: boolean }).synthetic === true

  const manholeCatalog = useMemo(
    () => ((manholeCatalogDataset?.content ?? {}) as { entries?: ManholeCatalogEntry[] }).entries ?? [],
    [manholeCatalogDataset],
  )
  const manholeSelection = useMemo(
    () => schedule ? selectManholeConstructions(schedule.manholes, manholeCatalog) : { selected: [], unmatched: [] },
    [schedule, manholeCatalog],
  )
  // Единственная граница чтения набора ограничений: и предпросмотр, и альбом
  // берут содержимое только отсюда. Здесь же линиям наборов, сохранённых до
  // того, как роль поехала вместе с линией, проставляется 'unknown' —
  // см. `readRouteConstraints`.
  const constraints = useMemo(
    () => readRouteConstraints((constraintsDataset?.content ?? null) as (RouteConstraintInput & {
      crossings?: CrossingRecord[]
      deliverableRequirements?: WorkingDrawingDeliverableRequirements
      protectiveGridDesign?: ProtectiveGridDesign
    }) | null),
    [constraintsDataset],
  )
  const surveyPoints = useMemo<SurveyPoint[]>(() => {
    const topography = (topographyDataset?.content ?? null) as { points?: SurveyPoint[] } | null
    return constraints?.surveyPoints?.length ? constraints.surveyPoints : topography?.points ?? []
  }, [constraints, topographyDataset])
  /**
   * Проектная поверхность вдоль трассы.
   *
   * Городской объект проектируется от планируемой поверхности, а не от
   * существующего рельефа: глубина заложения считается от неё. Модуль
   * совмещения двух поверхностей в движке был, а показать его результат было
   * негде — профиль строился по одной съёмке.
   *
   * Пусто, пока вертикальная планировка не загружена: подставлять сюда съёмку
   * значило бы выдать измеренное за проектное.
   */
  /**
   * Подтверждённое решение о разбивке.
   *
   * Хранится отдельным набором данных, потому что это решение инженера, а не
   * производная расчёта: программа предлагает разбивку, а где ставить
   * перекачку — вопрос компоновки площадки и согласований.
   */
  const basinDecision = useMemo(() => {
    if (savedDecision !== undefined) return savedDecision
    const stored = (gravityBasinsDataset?.content ?? null) as
      { confirmed?: boolean; liftCount?: number; source?: string; boundaryChainagesM?: number[] } | null
    if (!stored?.confirmed || !(stored.liftCount ?? 0) || !(stored.source ?? '').trim()) return null
    return {
      confirmed: true as const,
      liftCount: stored.liftCount!,
      source: stored.source!.trim(),
      boundaryChainagesM: stored.boundaryChainagesM ?? [],
    }
  }, [gravityBasinsDataset, savedDecision])

  const plannedSurface = useMemo(() => {
    const design = ((verticalPlanDataset?.content ?? null) as { points?: SurveyPoint[] } | null)?.points ?? []
    if (design.length === 0 || !result?.profile) return null
    /*
      Станция без узла — не точка в начале координат.

      Здесь стояла подстановка нулём по координате: пропавший узел клал станцию
      в начало координат, и поверхность считалась вдоль пути, уходящего к нулю. На экране
      это отметки, а не ошибка: правдоподобные метры не про этот объект.
      Пути нет — нет и поверхности, а причина видна тем, что её не показали.
    */
    const path: Array<{ x: number; y: number }> = []
    for (const station of result.profile.stations) {
      const node = network.nodes.find((item) => item.id === station.nodeId)
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null
      path.push({ x: node.x, y: node.y })
    }
    const along = plannedSurfaceAlong(path, design, surveyPoints)
    return new Map(result.profile.stations.map((station, index) => [station.nodeId, along[index]?.elevation ?? null]))
  }, [verticalPlanDataset, result, network, surveyPoints])

  const gravityPlan = useMemo(() => {
    const profile = result?.profile
    if (!profile || profile.stations.length < 2) return null
    /*
      Глубина промерзания здесь ЕСТЬ — и это доказано, а не предполагается.

      Ниже стояла подстановка нулём — та, про которую можно было рассуждать,
      что она недостижима: без выбранной величины `result` равен null, а
      значит и `profile`. Рассуждение — не проверка. Явное
      сужение делает недостижимость свойством типа: ноль в разбивку бассейнов
      попасть больше не может, а если однажды сможет — расчёта просто не
      будет, и это увидит человек.
    */
    if (freezingDepth.valueM === null) return null
    const design = new Map((result?.pipes ?? []).map((pipe) => [
      pipe.id,
      { diameterMm: pipe.diameterMm, slope: pipe.slope },
    ]))
    // Вывод об осуществимости самотёка невозможен, пока диаметры приняты без
    // расчётного расхода: потребный уклон вычислен для непобранного диаметра.
    const adoptedWithoutFlow = (result?.pipes ?? [])
      .some((pipe) => pipe.issues.some((issue) => issue.code === 'noDesignFlow'))
    const feasibility = assessGravityFeasibility(profile, design, {
      diameterAdoptedWithoutFlow: adoptedWithoutFlow,
    })
    /**
     * Стыковка с существующими колодцами на реконструкции.
     *
     * Найдено сравнением с рабочим проектом того же объекта: наш профиль
     * выходит на 1,95 м, а уложенная труба лежит на 2,01…5,63 м. Уклоны по
     * норме исправны — неверна постановка: реконструкция обязана состыковаться
     * с измеренными лотками, а не проектироваться от промерзания вниз.
     */
    const existingInvertByNodeId = new Map(
      network.nodes.flatMap((node) => (typeof node.invertElevationM === 'number'
        ? [[node.id, node.invertElevationM] as const]
        : [])),
    )
    const invertTie = assessExistingInvertTie({
      stations: profile.stations.map((station) => ({
        nodeId: station.nodeId, invertElevationM: station.invertElevationM,
      })),
      existingInvertByNodeId,
    })
    const catalogMaxDepthM = manholeCatalog.reduce((deepest, entry) => Math.max(deepest, entry.maxDepthM), 0)
    // Разбивка считается вместе с пересчётом профиля: одни только места
    // перекачек ничего не меняли, и инженер не видел, на какую глубину труба
    // выходит ПОСЛЕ подтверждения разбивки.
    const outcome = catalogMaxDepthM > 0 && !feasibility.feasible
      ? applyGravityBasinLifts(profile, design, {
        maxDepthM: catalogMaxDepthM,
        freezingDepthM: freezingDepth.valueM,
      })
      : null
    const basins = outcome?.plan ?? null
    const basinDepthLine = outcome && outcome.plan.lifts.length > 0
      ? `${outcome.profile.maxDepthM} м / ${catalogMaxDepthM} м`
      : null
    return { feasibility, invertTie, basins, catalogMaxDepthM, basinDepthLine }
  }, [result, manholeCatalog, freezingDepth, network])
  /**
   * Напорные перемычки между бассейнами.
   *
   * Разбивка ставит перекачки, а сами напорные участки до сих пор не
   * считались: у перекачки не было ни требуемого напора, ни агрегата, ни
   * строки в спецификации. Подъём берётся из разбивки, остальное — из
   * каталога насосов и полей напорного участка; чего нет, о том сказано.
   */
  const pressureLinks = useMemo(() => {
    const lifts = gravityPlan?.basins?.lifts ?? []
    if (lifts.length === 0) return null
    const catalog = (pumpCatalogDataset?.content ?? {}) as {
      entries?: Parameters<typeof planBasinPressureLinks>[0]['catalogue']
      category?: Parameters<typeof planBasinPressureLinks>[0]['category']
      effluent?: Parameters<typeof planBasinPressureLinks>[0]['effluent']
    }
    const drainage = (drainageDataset?.content ?? {}) as {
      basinLinkLengthM?: number
      basinLinkDiameterMm?: number
    }
    return planBasinPressureLinks({
      lifts,
      designFlowLps: result?.outletFlowLps ?? null,
      // Длина выводится из геометрии: расстояние по оси до головы следующего
      // бассейна. Заданная вручную её переопределяет — трасса перемычки может
      // отличаться от оси самотёчной трассы.
      basinBoundariesM: lifts.map((item) => item.chainageM),
      routeEndM: result?.profile?.totalLengthM ?? null,
      availableDiametersMm: catalogResolution.allowedDiametersMm ?? [],
      pressureLengthM: drainage.basinLinkLengthM ?? null,
      pressureDiameterMm: drainage.basinLinkDiameterMm ?? null,
      catalogue: catalog.entries,
      // Подтверждённое из задания имеет приоритет над карточкой каталога:
      // категорию называет задание, а каталог — перечень агрегатов.
      category: projectConditions.reliabilityCategory?.value ?? catalog.category,
      effluent: projectConditions.effluentKind?.value ?? catalog.effluent,
    })
  }, [gravityPlan, pumpCatalogDataset, drainageDataset, result, catalogResolution, projectConditions])

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
    // Нормативные пределы, которые расчёт действительно применил. Аудит о них
    // не знал: в сводке были состояния исходных данных, а величин, которыми
    // ограничен сам расчёт, — ни одной.
    normativeValues: [
      { label: 'Предельное наполнение', value: maxFilling(systemType) },
      ...(schedule?.pipes[0]?.diameterMm
        ? [{ label: 'Наибольший шаг колодцев', value: manholeSpacingM(schedule.pipes[0].diameterMm) }]
        : []),
    ],
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
      syntheticData,
      catalogReady: Boolean(activeCatalogId) && catalogResolution.ready,
      catalogFingerprint: { activeCatalogId, catalogDiameters: currentCatalogDiameters },
      hydraulicsReady: Boolean(result?.profile) && (result?.pipes.every((pipe) => pipe.issues.length === 0) ?? false),
      stormRunoff: stormRunoffStatus,
      gravityFeasibility: gravityPlan?.feasibility ?? null,
      gravityBasinDecision: basinDecision,
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
  /**
   * «Рассчитан» и «можно выпускать» — РАЗНЫЕ УТВЕРЖДЕНИЯ.
   *
   * Шапка проекта говорила «Проект рассчитан. Можно экспортировать
   * документацию», а на той же странице ниже стояло «к выпуску 0 (0%),
   * заблокировано 5». Инженер читал верхнюю строку и шёл выпускать то, чего
   * нельзя. Теперь итог расчёта несёт состояние выпуска — оно известно ровно
   * здесь, после сборки комплекта, и потому отчёт отделён от сохранения.
   */
  useEffect(() => {
    if (!runPersisted) return
    setRunPersisted(false)
    const sheets = workingDrawingSet.sheets
    const verified = sheets.filter((sheet) => sheet.status === 'VERIFIED').length
    onRunComplete?.('done', t(
      verified === 0
        ? 'project.pipeline.releaseBlocked'
        : verified === sheets.length
          ? 'project.pipeline.releaseReady'
          : 'project.pipeline.releasePartial',
      { total: sheets.length, verified },
    ))
  }, [onRunComplete, runPersisted, t, workingDrawingSet])

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
      // Учебный набор: водяной знак на каждом листе и запрет выпуска.
      syntheticData,
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

  /**
   * Листы плана по пикетам, М1:500.
   *
   * Сводный план на весь объект годится для обзора, но строителю выдаётся не
   * он: лист режется по пикетажу, и разрез допускается только на колодце. Такой
   * набор движок собирал давно, а пути к нему с экрана не было — функция
   * числилась в долге достижимости.
   *
   * Границы листов берутся из пикетажа профиля, а не назначаются равными
   * кусками: `stationChainagesM` — это станции колодцев, и резать между ними
   * нельзя.
   */
  const planSheetSet = async () => {
    if (!result?.profile) return []
    return generatePlanSheetSetDxf({
      projectName,
      network,
      pipeDiameterMm: new Map(result.pipes.map((pipe) => [pipe.id, pipe.diameterMm])),
      mainPath: workingDrawingSet.mainPath,
      buildingLabels: new Map(buildings.map((building) => [building.id, building.label ?? ''])),
      constraints,
      surveyPoints,
      system: systemType,
      stationChainagesM: result.profile.stations.map((station) => station.chainageM),
    })
  }

  const exportPlanSheets = async () => {
    if (!result?.profile) return
    setExporting(true)
    setBundleError(null)
    try {
      const sheets = await planSheetSet()
      if (sheets.length === 0) {
        setBundleError(t('project.gravity.planSheetsEmpty'))
        return
      }
      const files: Record<string, string> = {}
      sheets.forEach((sheet, index) => {
        const safe = sheet.title.replace(/\.\s*М1:500$/, '').replace(/[\s.()]+/g, '_')
        files[`${slug}_план_${String(index + 1).padStart(2, '0')}_${safe}.dxf`] = sheet.dxf
      })
      const zip = await zipBundle(files)
      const url = URL.createObjectURL(zip)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_листы_плана_${systemType === 'storm' ? 'К2' : 'К1'}.zip`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setBundleError(formatAppError(error))
    } finally {
      setExporting(false)
    }
  }

  /**
   * Подтвердить предложенную разбивку.
   *
   * Умолчания нет: без основания и без перекачек решение не сохраняется, а
   * стоп-фактор остаётся. Отменить подтверждение можно тем же способом —
   * пустым решением, чтобы вернуться к сплошному самотёку.
   */
  const confirmBasins = async () => {
    const proposal = gravityPlan?.basins
    if (!proposal || proposal.lifts.length === 0 || basinSource.trim() === '') return
    setBasinSaving(true)
    try {
      await saveDataset(projectId, 'gravity_basins', {
        confirmed: true,
        liftCount: proposal.lifts.length,
        source: basinSource.trim(),
        // Пикеты перекачек: по ним лист профиля режется так, чтобы не
        // пересекать перекачку — за ней начинается другой бассейн со своим
        // условным горизонтом.
        boundaryChainagesM: proposal.lifts.map((lift) => lift.chainageM),
        basins: proposal.basins,
        lifts: proposal.lifts,
      }, { liftCount: proposal.lifts.length }, null)
      setSavedDecision({
        confirmed: true,
        liftCount: proposal.lifts.length,
        source: basinSource.trim(),
        boundaryChainagesM: proposal.lifts.map((lift) => lift.chainageM),
      })
    } finally {
      setBasinSaving(false)
    }
  }

  const revokeBasins = async () => {
    setBasinSaving(true)
    try {
      await saveDataset(projectId, 'gravity_basins', { confirmed: false }, {}, null)
      setSavedDecision(null)
    } finally {
      setBasinSaving(false)
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
      const [general, situation, plan, profile, planSheets, xlsx, manholeSheets, specSheet, specXlsx, drawingFiles] = await Promise.all([
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
        planSheetSet(),
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
      // Полистовой план по пикетам рядом со сводным: сводный годится для
      // обзора, а строителю выдаётся лист, разрезанный по колодцам.
      planSheets.forEach((sheet, index) => {
        files[`${slug}_03a_${String(index + 1).padStart(2, '0')}_${fileSafe(sheet.title)}.dxf`] = sheet.dxf
      })
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
    <Panel anchor="gravity" title={t('project.gravity.title')} status={result ? 'filled' : 'empty'}>
      <p className="hint">{t('project.gravity.hint')}</p>

      {/*
        Готовность проекта первым делом: до этого состояние выпуска было
        видно только внутри альбома, а одна причина держит десяток листов.
      */}
      <h4>{t('project.readiness.title')}</h4>
      <ReadinessView drawingSet={workingDrawingSet} />

      <div className="drawing-audit" style={{ marginBottom: 12 }}>
        <div>
          <h5>{t('project.gravity.freezingTitle')}</h5>
          <p className={`stat-line${freezingDepth.verified ? ' ok' : ' warn'}`}>
            {freezingDepth.verified
              ? `Подтверждено: ${freezingDepth.detail}.`
              : freezingDepth.valueM === null
                ? t('project.gravity.freezingNotChosen')
                : `Черновой режим: ${freezingDepth.detail}; для предварительного расчёта используется ${
                  freezingDepth.valueM.toFixed(2)
                } м.`}
          </p>
          {!freezingDepth.verified && freezingDepth.blockers.map((message) => (
            <p className="stat-line warn" key={message}>{message}</p>
          ))}
        </div>
      </div>
      <div className="drawing-audit" style={{ marginBottom: 12 }}>
        <ProvenanceAuditView provenance={provenance} />
      </div>

      {routeCoverage && (
        <div className="drawing-audit" style={{ marginBottom: 12 }}>
          <div>
            <h5>{t('project.gravity.geologyCoverageTitle')}</h5>
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
            <h5>{t('project.gravity.feasibilityTitle')}</h5>
            {/* Стыковка с существующими колодцами: на реконструкции она
                главнее вывода об осуществимости — труба, пришедшая выше
                существующего лотка, не ляжет вовсе. */}
            {gravityPlan.invertTie.comparedNodes > 0 && (
              <p
                className={`stat-line${gravityPlan.invertTie.tied ? ' ok' : ' warn'}`}
                data-invert-tie="true"
              >
                {gravityPlan.invertTie.reason}
              </p>
            )}
            {/*
              Итог перезакладки профиля от измеренных лотков. Движок считал его
              и раньше — конфликты уклона, мелкие узлы, опорные связи, — но ни
              один вид его не читал: на объекте Станкевича четыре участка из
              тринадцати текут против уклона, и инженер об этом не знал.
            */}
            <ReconstructionProfileNotes reconstruction={result?.profile?.reconstruction} />
            <p className={`stat-line${gravityPlan.feasibility.feasible ? ' ok' : ' warn'}`}>
              {gravityPlan.feasibility.reason}
            </p>
            {!gravityPlan.feasibility.feasible && gravityPlan.basins && (
              <>
                <p className="stat-line">{gravityPlan.basins.reason}</p>
                {gravityPlan.basinDepthLine && (
                  <p className="stat-line">{gravityPlan.basinDepthLine}</p>
                )}
                <p className="hint">
                  Предел глубины {gravityPlan.catalogMaxDepthM} м взят из каталога конструкций
                  колодцев проекта: глубже самой глубокой позиции колодец не из чего собрать.
                  Гидравлика напорных участков здесь не считается.
                </p>
                <div className="table-wrap" style={{ maxHeight: 260 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('project.gravity.thBasin')}</th>
                        <th scope="col" className="num">{t('project.gravity.thFrom')}</th>
                        <th scope="col" className="num">{t('project.gravity.thTo')}</th>
                        <th scope="col" className="num">{t('project.gravity.thLength')}</th>
                        <th scope="col" className="num">{t('project.gravity.thBasinDepth')}</th>
                        <th scope="col">{t('project.gravity.thEnd')}</th>
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

                {/*
                  Напорные перемычки: у каждой перекачки должен быть требуемый
                  напор и агрегат, иначе в проекте есть насосная станция, о
                  которой не сказано ничего.
                */}
                {pressureLinks && (
                  <>
                    <h5>{t('project.gravity.linksTitle')}</h5>
                    <p className={`stat-line${pressureLinks.missing.length === 0 ? ' ok' : ' warn'}`}>
                      {pressureLinks.reason}
                    </p>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">{t('project.gravity.thLift')}</th>
                            <th scope="col" className="num">{t('project.gravity.thLiftHeight')}</th>
                            <th scope="col" className="num">{t('project.gravity.thLinkLength')}</th>
                            <th scope="col" className="num">{t('project.gravity.thLinkDiameter')}</th>
                            <th scope="col" className="num">{t('project.gravity.thHeadloss')}</th>
                            <th scope="col" className="num">{t('project.gravity.thRequiredHead')}</th>
                            <th scope="col">{t('project.gravity.thPump')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pressureLinks.links.map((link) => (
                            <tr key={link.liftNodeId}>
                              <td>{link.liftNodeId}</td>
                              <td className="num mono">{link.geometricLiftM.toFixed(2)}</td>
                              <td className="num mono">
                                {link.lengthM === null ? '—' : link.lengthM.toFixed(0)}
                                {link.lengthOrigin === 'derived' && ` ${t('project.gravity.derivedMark')}`}
                              </td>
                              <td className="num mono">{link.suggestedDiameterMm ?? '—'}</td>
                              <td className="num mono">{link.headlossM?.toFixed(2) ?? '—'}</td>
                              <td className="num mono">{link.requiredHeadM?.toFixed(2) ?? '—'}</td>
                              <td>
                                {link.pumps?.pump
                                  ? t('project.gravity.pumpPicked', {
                                    designation: link.pumps.pump.designation,
                                    standby: link.pumps.standbyCount,
                                  })
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/*
                  Подтверждение разбивки. Программа предлагает, решает инженер:
                  где ставить перекачку — вопрос компоновки площадки, стоимости
                  эксплуатации и согласований. Пока решение не подтверждено,
                  неосуществимый самотёк остаётся стоп-фактором выпуска.
                */}
                {basinDecision ? (
                  <>
                    <p className="stat-line ok">
                      {t('project.gravity.basinsConfirmed', {
                        count: basinDecision.liftCount,
                        source: basinDecision.source,
                      })}
                    </p>
                    <div className="section-actions">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={basinSaving} onClick={() => void revokeBasins()}>
                        {t('project.gravity.basinsRevoke')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="form-grid">
                      <label className="field" htmlFor={`basins-source-${projectId}`}>
                        <span className="field-label">{t('project.gravity.basinsSource')}</span>
                        <input
                          id={`basins-source-${projectId}`}
                          name={`basins-source-${projectId}`}
                          className="input"
                          type="text"
                          value={basinSource}
                          disabled={basinSaving}
                          placeholder={t('project.gravity.basinsSourceHint')}
                          onChange={(event) => setBasinSource(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="section-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={basinSaving || basinSource.trim() === '' || (gravityPlan.basins?.lifts.length ?? 0) === 0}
                        onClick={() => void confirmBasins()}
                      >
                        {t('project.gravity.basinsConfirm', { count: gravityPlan.basins?.lifts.length ?? 0 })}
                      </button>
                    </div>
                    <p className="hint">{t('project.gravity.basinsPending')}</p>
                  </>
                )}
              </>
            )}
            {!gravityPlan.feasibility.feasible && !gravityPlan.basins && (
              <p className="stat-line warn">
                {t('project.gravity.noBasins')}
              </p>
            )}
          </div>
        </div>
      )}
      {systemType === 'storm' && stormRunoffStatus && (
        <div className="drawing-audit" style={{ marginBottom: 12 }}>
          <div>
            <h5>{t('project.gravity.stormTitle')}</h5>
            <p className={`stat-line${stormRunoffStatus.verified ? ' ok' : ' warn'}`}>
              {stormRunoffStatus.detail}. Подтверждённый расчёт имеет приоритет над ручным расходом.
            </p>
            {!stormRunoffStatus.verified && (
              <p className="notice error">
                {t('project.gravity.manualFlowsNote')}
              </p>
            )}
            {stormRunoffStatus.blockers?.map((message) => <p className="stat-line warn" key={message}>{message}</p>)}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>{t('project.gravity.thCatchment')}</th><th className="num">{t('project.gravity.thArea')}</th><th className="num">z mid</th><th className="num">{t('project.gravity.thTravelTime')}</th><th className="num">{t('project.gravity.thFlowCal')}</th><th>{t('project.gravity.thStatus')}</th></tr></thead>
              <tbody>
                {stormRunoffResults.length === 0 ? (
                  <tr><td colSpan={6}>{t('project.gravity.noCatchments')}</td></tr>
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
          {/*
            ВСЕ ПРИЧИНЫ СРАЗУ, А НЕ ПЕРВАЯ ПО СПИСКУ.

            Здесь стояла цепочка `? :`: срабатывала одна ветка, остальные
            молчали. Владелец открыл проект, где не хватает и сети, и ряда
            диаметров, и промерзания, — и увидел одну строку. Про добавленный
            разбор «что известно без промерзания» он написал, что его нет: он и
            не мог его увидеть, потому что раньше срабатывала ветка сети.

            Инженеру нужно расстояние до результата целиком, а не первый шаг.
            Причины независимы, значит и показываются независимо.
          */}
          {pipes.length === 0 && (
            <p className="stat-line warn" data-gravity-needs-network="true">{t('project.gravity.needNetwork')}</p>
          )}
          {(routeStatus === 'stale' || routeStatus === 'blocked') && (
            <p className="notice error" data-gravity-route-status={routeStatus}>
              Гидравлический расчёт остановлен: инженерная трасса имеет статус «{routeStatus}». Завершите загрузку исходных данных и пересчитайте трассу.
            </p>
          )}
          {catalogResolution.blocker && (
            <p className="notice error" data-gravity-needs-catalog="true">{catalogResolution.blocker}</p>
          )}
          {freezingDepth.valueM === null && (
            <div className="notice warn" data-gravity-needs-freezing="true">
              <p className="stat-line warn">{t('project.gravity.freezingNotChosen')}</p>
              {/*
                Состав сети называется, только когда сеть есть: «участков 0,
                длина 0,0 м» — не сведение, а шум поверх строки о том, что сети
                нет.
              */}
              {network.pipes.length > 0 && (
                <p className="stat-line">
                  {t('project.gravity.knownWithoutFreezing', {
                    pipes: network.pipes.length,
                    measured: networkLength.measured,
                    length: networkLength.totalM.toFixed(1),
                  })}
                </p>
              )}
              <p className="hint">
                <a href="#geology">{t('project.gravity.chooseFreezingLink')}</a>
              </p>
            </div>
          )}
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
            {/* Полистовой план по пикетам: сводный лист выдают для обзора, а
                строителю — разрезанный по колодцам набор М1:500. */}
            <button
              type="button"
              className="btn btn-sm"
              disabled={exporting || !result.profile || !finalOutputAllowed}
              onClick={() => void exportPlanSheets()}
            >
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportPlanSheets')}
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
              <h4>{t('project.gravity.dropWellsTitle')}</h4>
              <p className={dropWells.structureCount > 0 ? 'notice' : 'stat-line'}>{dropWells.reason}</p>
              {dropWells.wells.length > 0 && (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('project.gravity.thDropNode')}</th><th className="num">{t('project.gravity.thDropChainage')}</th><th className="num">{t('project.gravity.thDrop')}</th>
                        <th className="num">{t('project.gravity.thDropDiameter')}</th><th>{t('project.gravity.thDropDecision')}</th><th>{t('project.gravity.thDropBasis')}</th>
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

          {/*
            Сверка со схемой генплана. Расчёт честно подбирает диаметр по
            расходу, и там, где он расходится со схемой, расхождение до сих пор
            всплывало только на экспертизе: сравнить два десятка участков с
            бумажной схемой инженер может, но именно этого и не делает.
          */}
          <MasterPlanView
            pipes={result.pipes.map((pipe) => ({
              id: pipe.id,
              diameterMm: pipe.diameterMm,
              flowLps: pipe.flowLps,
              diameterAdoptedWithoutFlow: pipe.issues.some((issue) => issue.code === 'noDesignFlow'),
            }))}
            content={masterPlan}
            fieldPrefix={`master-plan-${projectId}`}
            error={masterPlanError}
            onChange={(next) => {
              setMasterPlan(next)
              setMasterPlanError(null)
              // Без разбора ошибки введённый диаметр молча пропал бы при
              // следующей загрузке: на базе без миграции 0018 ограничение kind
              // отклоняет запись, а этого обещания никто не ждёт.
              void saveDataset(projectId, 'master_plan', next, {
                segments: (next.segments ?? []).length,
              }).catch((cause: unknown) => {
                setMasterPlanError(cause instanceof Error ? cause.message : String(cause))
              })
            }}
          />

          {systemType === 'storm' && result.profile && (
            <StormInletsView
              profile={result.profile}
              streetWidthM={streetWidthM}
              onStreetWidthChange={(value) => void saveStreetWidth(value)}
              fieldId={`storm-street-width-${projectId}`}
            />
          )}

          {/*
            Ситуационная схема строится по ЗАГРУЖЕННОЙ топооснове тем же
            отрисовщиком, что и плановые листы. Прежде её рисовал самодельный
            вид: белый лист, синяя ломаная и «подоснова» из координат зданий —
            ноль из тринадцати тысяч линий чертежа.
          */}
          <SituationSchemeView
            scheme={{
              title: `${systemType === 'storm' ? 'К2' : 'К1'}. ${projectName}`,
              network,
              constraints: constraints ?? undefined,
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
                      {plannedSurface && <th className="num">{t('project.gravity.thPlanned')}</th>}
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
                        {plannedSurface && (
                          <td className="num mono">
                            {plannedSurface.get(s.nodeId)?.z.toFixed(2) ?? '—'}
                          </td>
                        )}
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
