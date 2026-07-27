import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  assessLiftStationNeed,
  buildWorkingDrawingSet,
  buildSewerSchedule,
  buildSewerSpecification,
  checkRouteInCorridor,
  computeNetworkDemand,
  NORMATIVE_DEFAULTS,
  ringFromGeoJsonGeometry,
  selectManholeConstructions,
  solveGravityNetwork,
  unverifiedClauses,
} from '@aquascheme/engine'
import type { Borehole, CorridorCheck, CrossingRecord, ManholeCatalogEntry, RouteConstraintInput, SurveyPoint } from '@aquascheme/engine'
import type { ParcelRow } from '../../shared/parcels'
import type { NormativeParams } from '@aquascheme/engine'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import { loadActiveCatalogNominalDiameters } from '../../shared/catalog'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import {
  generateSewerGeneralDataDxf,
  generateProjectAlbumPdf,
  generateProjectSheetPdf,
  generateWorkingDrawingSheetDxf,
  generateWorkingDrawingSetDxfs,
  generateSewerNotePdf,
  generateSewerPlanDxf,
  generateSewerProfileDxf,
  generateSewerSpecSheetDxf,
  generateSewerSpecXlsx,
  generateSewerScheduleXlsx,
  generateSituationDxf,
  zipBundle,
} from '../../shared/exporters'
import { fetchLastGravityRun, persistGravity } from '../../shared/gravity'
import { NormBadge } from './NormBadge'
import { Panel } from './Panel'
import { AlbumSheetSet } from './AlbumSheetSet'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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
  topographyDataset,
  constraintsDataset,
  routeAuditDataset,
  manholeCatalogDataset,
  boreholes,
  parcels,
  activeCatalogId,
  routeStatus = 'stale',
  routeBlockers = [],
  routeRevision = 0,
  onChanged,
}: {
  projectId: string
  systemType: 'sewer' | 'storm'
  projectName: string
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  normsDataset?: DatasetRow
  geologyDataset?: DatasetRow
  topographyDataset?: DatasetRow
  constraintsDataset?: DatasetRow
  routeAuditDataset?: DatasetRow
  manholeCatalogDataset?: DatasetRow
  boreholes?: Borehole[]
  /** Project parcels; kind 'right_of_way' rings form the corridor to check. */
  parcels?: ParcelRow[]
  activeCatalogId?: string | null
  routeStatus?: 'stale' | 'blocked' | 'preliminary' | 'calculated'
  routeBlockers?: Array<{ code?: string; message?: string } | string>
  routeRevision?: number
  /** Reload the project data after the demo seeding. */
  onChanged?: () => Promise<void>
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
  const [catalogDiameters, setCatalogDiameters] = useState<readonly number[] | undefined>(undefined)

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
    if (!activeCatalogId) {
      setCatalogDiameters(undefined)
      return () => { active = false }
    }
    loadActiveCatalogNominalDiameters(activeCatalogId)
      .then((diameters) => { if (active) setCatalogDiameters(diameters ?? []) })
      .catch(() => { if (active) setCatalogDiameters([]) })
    return () => { active = false }
  }, [activeCatalogId])

  const labelOfNode = useMemo(() => {
    const buildingLabelById = new Map(buildings.map((b) => [b.id, b.label ?? '']))
    const engineToBuilding = new Map(
      nodes.filter((n) => n.building_id).map((n) => [n.label ?? n.id, n.building_id as string]),
    )
    return (engineId: string): string =>
      buildingLabelById.get(engineToBuilding.get(engineId) ?? '') || engineId
  }, [nodes, buildings])

  const network = useMemo(() => networkFromRows(nodes, pipes), [nodes, pipes])

  const result = useMemo(() => {
    if (pipes.length === 0) return null
    const norms: NormativeParams = {
      ...NORMATIVE_DEFAULTS,
      ...((normsDataset?.content ?? {}) as Partial<NormativeParams>),
    }
    const buildingFlowLps = new Map<string, number>()
    if (systemType === 'storm') {
      // Storm inflows are catchment/treatment-plant flows entered directly,
      // not domestic demand: the residents field holds the inflow in L/s.
      for (const b of buildings) buildingFlowLps.set(b.id, b.design_flow_lps ?? b.specific_demand_lpd ?? b.residents ?? 0)
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
    const freezingDepthM =
      ((geologyDataset?.content ?? {}) as { freezingDepthM?: number }).freezingDepthM ?? 1.5
    return solveGravityNetwork({
      network,
      buildingFlowLps,
      system: systemType,
      freezingDepthM,
      strategy,
      outletNodeId: network.nodes.find((node) => node.kind === 'lns_inlet' || node.kind === 'pumping_station')?.id,
      allowedDiametersMm: activeCatalogId ? catalogDiameters ?? [] : undefined,
    })
  }, [buildings, network, normsDataset, geologyDataset, systemType, strategy, activeCatalogId, catalogDiameters])

  const rows = useMemo(() => {
    if (!result) return []
    return [...result.pipes].sort((a, b) => b.flowLps - a.flowLps)
  }, [result])

  const schedule = useMemo(() => (result ? buildSewerSchedule(result) : null), [result])
  const manholeCatalog = useMemo(
    () => ((manholeCatalogDataset?.content ?? {}) as { entries?: ManholeCatalogEntry[] }).entries ?? [],
    [manholeCatalogDataset],
  )
  const manholeSelection = useMemo(
    () => schedule ? selectManholeConstructions(schedule.manholes, manholeCatalog) : { selected: [], unmatched: [] },
    [schedule, manholeCatalog],
  )
  const constraints = useMemo(
    () => (constraintsDataset?.content ?? null) as (RouteConstraintInput & { crossings?: CrossingRecord[] }) | null,
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
  const workingDrawingSet = useMemo(() => {
    const applicableUnverifiedClauses = unverifiedClauses()
      .filter((clause) => clause.appliesSystem.includes(systemType))
    return buildWorkingDrawingSet({
      system: systemType,
      network,
      profile: result?.profile ?? null,
      schedule,
      routeStatus,
      routeBlockers,
      georeference: constraints?.georeference ?? null,
      surveyPoints,
      unresolvedLayerCount,
      catalogReady: Boolean(activeCatalogId) && (catalogDiameters?.length ?? 0) > 0,
      catalogFingerprint: { activeCatalogId, catalogDiameters },
      hydraulicsReady: Boolean(result?.profile) && (result?.pipes.every((pipe) => pipe.issues.length === 0) ?? false),
      utilityFeatureCount: constraints?.utilityLines?.length ?? 0,
      crossings: constraints?.crossings,
      spatialBoreholeCount: (boreholes ?? []).filter((borehole) =>
        Number.isFinite(borehole.x) && Number.isFinite(borehole.y) && borehole.layers.length > 0,
      ).length,
      geologyFingerprint: { dataset: geologyDataset?.content, boreholes },
      manholeCatalogReady: schedule
        ? schedule.manholes.length > 0
          && manholeSelection.selected.length === schedule.manholes.length
          && manholeSelection.unmatched.length === 0
        : false,
      manholeCatalogMissingLabels: manholeSelection.unmatched,
      manholeCatalogFingerprint: { entries: manholeCatalog, selection: manholeSelection },
      normsVerified: applicableUnverifiedClauses.length === 0,
      normsFingerprint: {
        dataset: normsDataset?.content,
        unresolvedApplicableClauseIds: applicableUnverifiedClauses.map((clause) => clause.id),
      },
      revision: routeRevision,
    })
  }, [
    activeCatalogId,
    boreholes,
    catalogDiameters,
    constraints,
    geologyDataset,
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
    systemType,
    unresolvedLayerCount,
  ])
  const finalOutputAllowed = workingDrawingSet.summary.finalExportAllowed

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
      constraints,
      manholeConstructions: manholeSelection.selected,
      pipeDiameterMm: new Map(result.pipes.map((pipe) => [pipe.id, pipe.diameterMm])),
      buildingLabels: new Map(buildings.map((building) => [building.id, building.label ?? building.id])),
      outletFlowLps: result.outletFlowLps,
    }
  }

  // The full К1 sheet set, mirroring the professional НК album: общие данные,
  // ситуационная схема, план, продольный профиль, ведомость колодцев и труб.
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
      const [general, situation, plan, profile, xlsx, specSheet, specXlsx, drawingFiles] = await Promise.all([
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
        [`${slug}_06_спецификация_НК.dxf`]: specSheet,
        [`${slug}_06_спецификация_НК.xlsx`]: specXlsx,
      }
      const fileSafe = (title: string) => title.replace(/\.\s*М1:500$/, '').replace(/[\s.()]+/g, '_')
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

  // Seed a wholly synthetic project for UI demonstration. It is deliberately
  // unsuitable for acceptance against the confidential control project.
  const [seeding, setSeeding] = useState(false)
  const [seedNotice, setSeedNotice] = useState<string | null>(null)
  const seedDemo = async () => {
    setSeeding(true)
    setSeedNotice(null)
    try {
      const { seedStormProject } = await import('../../shared/stormDemo')
      const { seededSections, failures } = await seedStormProject(projectId)
      setSeedNotice(
        failures.length === 0
          ? t('project.gravity.demoSeedDone', { count: seededSections })
          : t('project.gravity.demoSeedPartial', { count: seededSections, failed: failures.join(', ') }),
      )
      await onChanged?.()
    } finally {
      setSeeding(false)
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
    try {
      await persistGravity(projectId, result)
      setSavedAt(new Date().toISOString())
    } catch {
      // Best effort: a missing migration or offline state must not break the UI.
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
      {!finalOutputAllowed && result && (
        <p className="notice error">Расчёт доступен для проверки, но финальный выпуск заблокирован: {workingDrawingSet.summary.blocked} листов со стоп-факторами, {workingDrawingSet.summary.stale} устаревших. Причины перечислены в реестре ниже.</p>
      )}
      {!result && (
        <>
          <p className="stat-line warn">{t('project.gravity.needNetwork')}</p>
          {systemType === 'storm' && (
            <div className="section-actions">
              <button type="button" className="btn btn-sm" disabled={seeding} onClick={() => void seedDemo()}>
                {seeding ? t('project.gravity.demoSeeding') : t('project.gravity.demoSeed')}
              </button>
              <span className="stat-line" style={{ marginTop: 0 }}>{t('project.gravity.demoSeedHint')}</span>
            </div>
          )}
          {seedNotice && <p className="stat-line ok">{seedNotice}</p>}
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
            <label className="field" style={{ maxWidth: 320 }}>
              <span className="field-label">{t('project.gravity.strategy')}</span>
              <select
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

          {result.profile && schedule && (
            <AlbumSheetSet
              drawingSet={workingDrawingSet}
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
