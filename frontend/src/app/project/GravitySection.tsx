import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  assessLiftStationNeed,
  buildSewerSchedule,
  buildSewerSpecification,
  checkRouteInCorridor,
  computeNetworkDemand,
  NORMATIVE_DEFAULTS,
  ringFromGeoJsonGeometry,
  solveGravityNetwork,
} from '@aquascheme/engine'
import type { CorridorCheck } from '@aquascheme/engine'
import type { ParcelRow } from '../../shared/parcels'
import type { NormativeParams } from '@aquascheme/engine'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import { seedStormProject } from '../../shared/stormDemo'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import {
  generateSewerGeneralDataDxf,
  generateManholeSheetsDxf,
  generatePlanSheetSetDxf,
  generateProjectAlbumPdf,
  generateProfileSheetSetDxf,
  generateSewerNotePdf,
  generateSewerPlanDxf,
  generateSewerProfileDxf,
  generateReferencePipeScheduleXlsx,
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
  basisDataset,
  parcels,
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
  basisDataset?: DatasetRow
  /** Project parcels; kind 'right_of_way' rings form the corridor to check. */
  parcels?: ParcelRow[]
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

  const labelOfNode = useMemo(() => {
    const buildingLabelById = new Map(buildings.map((b) => [b.id, b.label ?? '']))
    const engineToBuilding = new Map(
      nodes.filter((n) => n.building_id).map((n) => [n.label ?? n.id, n.building_id as string]),
    )
    return (engineId: string): string =>
      buildingLabelById.get(engineToBuilding.get(engineId) ?? '') || engineId
  }, [nodes, buildings])

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
      for (const b of buildings) buildingFlowLps.set(b.id, b.specific_demand_lpd ?? b.residents ?? 0)
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
    const network = networkFromRows(nodes, pipes)
    const freezingDepthM =
      ((geologyDataset?.content ?? {}) as { freezingDepthM?: number }).freezingDepthM ?? 1.5
    return solveGravityNetwork({ network, buildingFlowLps, system: systemType, freezingDepthM, strategy })
  }, [buildings, nodes, pipes, normsDataset, geologyDataset, systemType, strategy])

  const rows = useMemo(() => {
    if (!result) return []
    return [...result.pipes].sort((a, b) => b.flowLps - a.flowLps)
  }, [result])

  const schedule = useMemo(() => (result ? buildSewerSchedule(result) : null), [result])
  const referenceSchedule = useMemo(() => {
    const content = basisDataset?.content as { designSchedule?: Array<{ system: string; designation: string; standard: string; diameterMm: number; lengthM: number }> } | null
    return content?.designSchedule ?? []
  }, [basisDataset])
  const referenceProject = useMemo(() => {
    const content = basisDataset?.content as { project?: { code?: string } } | null
    return content?.project
  }, [basisDataset])

  // The full К1 sheet set, mirroring the professional НК album: общие данные,
  // ситуационная схема, план, продольный профиль, ведомость колодцев и труб.
  const exportBundle = async () => {
    if (!result?.profile || !schedule) return
    setExporting(true)
    setBundleError(null)
    try {
      const network = networkFromRows(nodes, pipes)
      const pipeDiameterMm = new Map(result.pipes.map((p) => [p.id, p.diameterMm]))
      const buildingLabels = new Map(buildings.map((b) => [b.id, b.label ?? '']))
      // The main collector path in station order, for the per-picket windows.
      const nodeById = new Map(network.nodes.map((n) => [n.id, n]))
      const mainPath = result.profile.stations
        .map((s) => nodeById.get(s.nodeId))
        .filter((n): n is NonNullable<typeof n> => !!n)
        .map((n) => ({ x: n.x, y: n.y }))
      const sheetSystem = systemType === 'storm' ? ('storm' as const) : ('sewer' as const)
      // Specification НК.С: lift station from the profile depths (ТЗ rule),
      // the waterproofing set when the water table sits above the deepest
      // excavation (dataset geology, groundwaterDepthM).
      const groundwaterDepthM = (geologyDataset?.content as { groundwaterDepthM?: number } | null)?.groundwaterDepthM
      const specItems = buildSewerSpecification({
        schedule,
        liftStation: assessLiftStationNeed(result.profile.stations.map((s) => s.depthM)).needed.value,
        highGroundwater: groundwaterDepthM !== undefined && groundwaterDepthM < result.profile.maxDepthM,
      })
      const [general, situation, plan, profile, xlsx, referenceXlsx, specSheet, specXlsx, planSheets, profileSheets, manholeSheets] = await Promise.all([
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
        generateSewerProfileDxf({ projectName, profile: result.profile }),
        generateSewerScheduleXlsx(schedule),
        referenceSchedule.length > 0 ? generateReferencePipeScheduleXlsx(referenceSchedule) : Promise.resolve(null),
        generateSewerSpecSheetDxf(projectName, specItems),
        generateSewerSpecXlsx(specItems),
        mainPath.length >= 2
          ? generatePlanSheetSetDxf({ projectName, network, pipeDiameterMm, mainPath, buildingLabels, system: sheetSystem })
          : Promise.resolve([]),
        generateProfileSheetSetDxf(projectName, result.profile, sheetSystem),
        generateManholeSheetsDxf(projectName, schedule),
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
      if (referenceXlsx) files[`${slug}_05А_проектная_спецификация_2024-51-НК.С.xlsx`] = referenceXlsx
      // Per-picket sheets follow the summary sheets, numbered like the album.
      let sheetNo = 7
      const fileSafe = (title: string) => title.replace(/\.\s*М1:500$/, '').replace(/[\s.()]+/g, '_')
      for (const sheet of [...planSheets, ...profileSheets, ...manholeSheets.tables]) {
        files[`${slug}_${String(sheetNo).padStart(2, '0')}_${fileSafe(sheet.title)}.dxf`] = sheet.dxf
        sheetNo++
      }
      files[`${slug}_${String(sheetNo).padStart(2, '0')}_защитная_сетка_для_колодцев.dxf`] = manholeSheets.grille
      const zip = await zipBundle(files)
      const url = URL.createObjectURL(zip)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_комплект_К1.zip`
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

  // Seed a WHOLE ready demo project (benchmark-shaped): inflow sources, the
  // ~15.8 km trunk, geology with boreholes, seismicity, norms, the corridor
  // and the permitting-documents checklist — all panels at once.
  const [seeding, setSeeding] = useState(false)
  const [seedNotice, setSeedNotice] = useState<string | null>(null)
  const seedDemo = async () => {
    setSeeding(true)
    setSeedNotice(null)
    try {
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
    const network = networkFromRows(nodes, pipes)
    const nodeById = new Map(network.nodes.map((n) => [n.id, n]))
    const mainPath = result.profile.stations
      .map((s) => nodeById.get(s.nodeId))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map((n) => ({ x: n.x, y: n.y }))
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
      const bytes = await generateSewerScheduleXlsx(schedule)
      const blob = new Blob([bytes], { type: XLSX_TYPE })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_ведомость_К1.xlsx`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setExporting(false)
    }
  }

  const exportReferenceSchedule = async () => {
    if (referenceSchedule.length === 0) return
    setExporting(true)
    try {
      const bytes = await generateReferencePipeScheduleXlsx(referenceSchedule)
      const blob = new Blob([bytes], { type: XLSX_TYPE })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_проектная_спецификация_2024-51-НК.С.xlsx`
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
      const dxf = await generateSewerProfileDxf({ projectName, profile: result.profile })
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
    setAlbumExporting(true)
    setAlbumError(null)
    try {
      // Allow the busy indicator to paint before pdfmake starts its CPU-heavy layout pass.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const network = networkFromRows(nodes, pipes)
      const pipeDiameterMm = new Map(result.pipes.map((pipe) => [pipe.id, pipe.diameterMm]))
      const blob = await generateProjectAlbumPdf({
        projectName,
        projectCode: referenceProject?.code ?? 'НК',
        system: systemType,
        network,
        profile: result.profile,
        schedule,
        pipeDiameterMm,
        buildingLabels: new Map(buildings.map((building) => [building.id, building.label ?? building.id])),
        outletFlowLps: result.outletFlowLps,
        designSchedule: referenceSchedule,
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${slug}_${referenceProject?.code ?? 'НК'}_альбом_61_лист.pdf`
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

  return (
    <Panel title={t('project.gravity.title')} status={result ? 'filled' : 'empty'}>
      <p className="hint">{t('project.gravity.hint')}</p>
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
            <button type="button" className="btn btn-sm" disabled={exporting} onClick={() => void exportPlan()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportPlan')}
            </button>
            <button type="button" className="btn btn-sm" disabled={exporting} onClick={() => void exportSituation()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportSituation')}
            </button>
            <button type="button" className="btn btn-sm" disabled={!result.profile} onClick={runCorridorCheck}>
              {t('project.gravity.corridorRun')}
            </button>
            <button type="button" className="btn btn-sm" disabled={exporting || !result.profile} onClick={() => void exportNote()}>
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
            <button type="button" className="btn btn-sm" disabled={exporting || !result.profile} onClick={() => void exportBundle()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportBundle')}
            </button>
          </div>

          {result.profile && schedule && (
            <AlbumSheetSet
              pdfBusy={albumExporting}
              zipBusy={exporting}
              onPdf={() => void exportAlbum()}
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
                <button type="button" className="btn btn-sm" disabled={exporting} onClick={() => void exportProfile()}>
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
              {referenceSchedule.length > 0 && (
                <>
                  <h4 className="subhead" style={{ marginTop: 16 }}>Проектная спецификация 2024-51-НК.С</h4>
                  <p className="hint">Контрольные количества из листов 1–3 итогового альбома; они не заменяются результатом автоматического подбора.</p>
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table className="data-table">
                      <thead><tr><th>Система</th><th>Наименование</th><th>Стандарт</th><th className="num">Ø, мм</th><th className="num">Длина, м</th></tr></thead>
                      <tbody>
                        {referenceSchedule.map((item, index) => (
                          <tr key={`${item.designation}-${index}`}><td>{item.system}</td><td>{item.designation}</td><td>{item.standard}</td><td className="num">{item.diameterMm}</td><td className="num">{item.lengthM}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="stat-line">Итого по проектной спецификации: {referenceSchedule.reduce((sum, item) => sum + item.lengthM, 0).toLocaleString('ru-RU')} м</p>
                  <div className="section-actions"><button type="button" className="btn btn-sm" disabled={exporting} onClick={() => void exportReferenceSchedule()}>Скачать проектную спецификацию XLSX</button></div>
                </>
              )}
              <div className="section-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-sm" disabled={exporting} onClick={() => void exportSchedule()}>
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
