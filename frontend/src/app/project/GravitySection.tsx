import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildSewerSchedule, computeNetworkDemand, NORMATIVE_DEFAULTS, solveGravityNetwork } from '@aquascheme/engine'
import type { NormativeParams } from '@aquascheme/engine'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import {
  generateSewerGeneralDataDxf,
  generateSewerPlanDxf,
  generateSewerProfileDxf,
  generateSewerScheduleXlsx,
  generateSituationDxf,
  zipBundle,
} from '../../shared/exporters'
import { fetchLastGravityRun, persistGravity } from '../../shared/gravity'
import { NormBadge } from './NormBadge'
import { Panel } from './Panel'

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
}: {
  projectId: string
  systemType: 'sewer' | 'storm'
  projectName: string
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  normsDataset?: DatasetRow
  geologyDataset?: DatasetRow
}) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
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
    const demand = computeNetworkDemand(
      buildings.map((b) => ({
        id: b.id,
        residents: b.residents ?? 0,
        specificDemandLpd: b.specific_demand_lpd ?? undefined,
      })),
      norms,
    )
    const buildingFlowLps = new Map<string, number>()
    for (const b of demand.buildings) if (b.id) buildingFlowLps.set(b.id, b.designFlowLps)
    const network = networkFromRows(nodes, pipes)
    const freezingDepthM =
      ((geologyDataset?.content ?? {}) as { freezingDepthM?: number }).freezingDepthM ?? 1.5
    return solveGravityNetwork({ network, buildingFlowLps, system: systemType, freezingDepthM })
  }, [buildings, nodes, pipes, normsDataset, geologyDataset, systemType])

  const rows = useMemo(() => {
    if (!result) return []
    return [...result.pipes].sort((a, b) => b.flowLps - a.flowLps)
  }, [result])

  const schedule = useMemo(() => (result ? buildSewerSchedule(result) : null), [result])

  // The full К1 sheet set, mirroring the professional НК album: общие данные,
  // ситуационная схема, план, продольный профиль, ведомость колодцев и труб.
  const exportBundle = async () => {
    if (!result?.profile || !schedule) return
    setExporting(true)
    try {
      const network = networkFromRows(nodes, pipes)
      const pipeDiameterMm = new Map(result.pipes.map((p) => [p.id, p.diameterMm]))
      const buildingLabels = new Map(buildings.map((b) => [b.id, b.label ?? '']))
      const [general, situation, plan, profile, xlsx] = await Promise.all([
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
      ])
      const zip = await zipBundle({
        [`${slug}_01_общие_данные.dxf`]: general,
        [`${slug}_02_ситуационная_схема.dxf`]: situation,
        [`${slug}_03_план_К1.dxf`]: plan,
        [`${slug}_04_профиль_К1.dxf`]: profile,
        [`${slug}_05_ведомость_К1.xlsx`]: xlsx,
      })
      const url = URL.createObjectURL(zip)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}_комплект_К1.zip`
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

  return (
    <Panel title={t('project.gravity.title')} status={result ? 'filled' : 'empty'}>
      <p className="hint">{t('project.gravity.hint')}</p>
      {!result && <p className="stat-line warn">{t('project.gravity.needNetwork')}</p>}
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
            <button type="button" className="btn btn-sm" disabled={exporting} onClick={() => void exportPlan()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportPlan')}
            </button>
            <button type="button" className="btn btn-sm" disabled={exporting} onClick={() => void exportSituation()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportSituation')}
            </button>
            <button type="button" className="btn btn-sm" disabled={exporting || !result.profile} onClick={() => void exportBundle()}>
              {exporting ? t('project.gravity.exporting') : t('project.gravity.exportBundle')}
            </button>
          </div>

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
