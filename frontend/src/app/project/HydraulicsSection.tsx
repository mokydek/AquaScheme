import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NORMATIVE_DEFAULTS } from '@aquascheme/engine'
import type { NormativeParams } from '@aquascheme/engine'
import { assessSourceHead, auditProjectProvenance } from '@aquascheme/engine'
import { ProvenanceAuditView } from './ProvenanceAuditView'
import { isSizingResultAcceptable } from '@aquascheme/engine/sizing'
import type { SizingResult } from '@aquascheme/engine/sizing'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import { persistSizing, runSizingInWorker } from '../../shared/pipeline'
import { loadActiveCatalogSizes } from '../../shared/catalog'
import type { SourceData } from '../../shared/datasets'
import { Panel } from './Panel'

const ISSUE_LIMIT = 6

export function HydraulicsSection({
  projectId,
  buildings,
  source,
  normsDataset,
  nodes,
  pipes,
  lastSummary,
  activeCatalogId,
  surveyPoints,
  onChanged,
}: {
  projectId: string
  buildings: BuildingRow[]
  source: SourceData | null
  normsDataset: DatasetRow | undefined
  nodes: NodeRow[]
  pipes: PipeRow[]
  lastSummary: SizingResult | null
  activeCatalogId: string | null
  /** Отметки съёмки: без них аудит не может судить об их наличии. */
  surveyPoints: Array<{ x: number; y: number; z: number }>
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'done' | 'blocked' | 'error' | null>(null)

  // Напор на источнике — исходное данное проекта, а не умолчание расчёта.
  // Прежде подставлялось 45 м, и весь подбор диаметров В1 стоял на выдуманной
  // величине, о которой пользователь не знал.
  const declaredHeadM = source?.availableHead
  const headDeclared = declaredHeadM != null && Number.isFinite(declaredHeadM) && declaredHeadM > 0
  const canRun = pipes.length > 0 && buildings.length > 0 && source !== null && headDeclared

  const run = async () => {
    if (!canRun || busy || !source) return
    setBusy(true)
    setNotice(null)
    const norms: NormativeParams = {
      ...NORMATIVE_DEFAULTS,
      ...((normsDataset?.content ?? {}) as Partial<NormativeParams>),
    }
    const availableHeadM = declaredHeadM as number
    try {
      const catalog = await loadActiveCatalogSizes(activeCatalogId)
      const result: SizingResult = await runSizingInWorker({
        network: networkFromRows(nodes, pipes),
        buildings: buildings.map((b) => ({
          id: b.id,
          floors: b.floors,
          residents: b.residents ?? 0,
          specificDemandLpd: b.specific_demand_lpd ?? undefined,
        })),
        availableHeadM,
        norms,
        ...(catalog ? { sizes: catalog.sizes, roughnessMm: catalog.roughnessMm } : {}),
      })
      await persistSizing(projectId, result, nodes, pipes, norms, availableHeadM, new Date().toISOString())
      setNotice(isSizingResultAcceptable(result) ? 'done' : 'blocked')
      await onChanged()
    } catch {
      setNotice('error')
    } finally {
      setBusy(false)
    }
  }

  const summary = lastSummary
  const mains = summary?.pipes.filter((p) => p.kind !== 'service') ?? []
  const buildingNodes = summary?.nodes.filter((n) => n.buildingId) ?? []
  const vValues = mains.map((p) => p.velocityMs)
  const pValues = buildingNodes.map((n) => n.pressureM)
  // Расчёт отвечал «сошлось» или «не сошлось», но не говорил, сколько напора
  // нужно: без этого не подобрать насос водозабора и не назначить высоту
  // водонапорной башни.
  const headAssessment = summary ? assessSourceHead(summary) : null
  // Аудит происхождения системе не специфичен, но жил только в самотёчной
  // секции — В1 его не видел вовсе. Величины, которых у водопровода нет
  // (каталог конструкций колодцев, проектный диаметр из ТУ, дождевой сток), не
  // передаются: показать их отсутствующими значило бы выставить стоп-фактор за
  // то, чего у системы по определению нет.
  const provenance = auditProjectProvenance({
    surveyPointCount: surveyPoints.length,
    surveyPointSource: surveyPoints.length > 0 ? 'geometry' : 'none',
    catalogReady: Boolean(activeCatalogId),
  })

  return (
    <Panel
      title={t('project.hydraulics.title')}
      status={summary ? 'filled' : 'empty'}
    >
      <p className="hint">{t('project.hydraulics.hint')}</p>
      {!headDeclared && (
        <p className="notice error">
          Не задан свободный напор на источнике. Расчёт не выполняется: прежде здесь подставлялось 45 м,
          и весь подбор диаметров стоял на выдуманной величине. Задайте напор в разделе «Источник».
        </p>
      )}
      <ProvenanceAuditView provenance={provenance} />

      {headAssessment && (
        <div>
          <p className={headAssessment.deficitM > 0 ? 'notice error' : 'stat-line ok'}>{headAssessment.reason}</p>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                <tr><th>{t('project.hydraulics.sourceLevel')}</th><td className="num">{headAssessment.sourceHeadM} м</td></tr>
                <tr><th>{t('project.hydraulics.requiredLevel')}</th><td className="num">{headAssessment.requiredSourceHeadM} м</td></tr>
                <tr className={headAssessment.reserveM < 0 ? 'row-warn' : undefined}>
                  <th>{t('project.hydraulics.minReserve')}</th>
                  <td className="num">{headAssessment.reserveM} м</td>
                </tr>
                <tr><th>{t('project.hydraulics.governingNode')}</th><td>{headAssessment.governingNodeId ?? '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="section-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canRun || busy}
          onClick={() => void run()}
        >
          {t('project.hydraulics.run')}
        </button>
        {busy && <span className="stat-line warn" style={{ marginTop: 0 }}>{t('project.hydraulics.running')}</span>}
        {!canRun && !busy && (
          <span className="stat-line warn" style={{ marginTop: 0 }}>
            {t('project.hydraulics.needData')}
          </span>
        )}
        {notice === 'done' && !busy && (
          <span className="stat-line ok">{t('project.hydraulics.done')}</span>
        )}
        {notice === 'blocked' && !busy && (
          <span className="stat-line warn">{t('project.hydraulics.blocked')}</span>
        )}
      </div>
      {notice === 'error' && <p className="notice error">{t('project.hydraulics.error')}</p>}
      {summary && (
        <>
          <p className={`stat-line${summary.converged ? ' ok' : ' warn'}`} style={{ marginTop: 16 }}>
            {t(`project.hydraulics.${summary.converged ? 'converged' : 'notConverged'}`)}
          </p>
          <div className="kv-list">
            <div className="kv">
              <span className="kv-label">{t('project.hydraulics.demandTotal')}</span>
              <span className="kv-value">{summary.totalDemandLps.toFixed(2)}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.hydraulics.iterations')}</span>
              <span className="kv-value">{summary.iterations} ({summary.solves})</span>
            </div>
            {vValues.length > 0 && (
              <div className="kv">
                <span className="kv-label">{t('project.hydraulics.vRange')}</span>
                <span className="kv-value">
                  {Math.min(...vValues).toFixed(2)} … {Math.max(...vValues).toFixed(2)}
                </span>
              </div>
            )}
            {pValues.length > 0 && (
              <div className="kv">
                <span className="kv-label">{t('project.hydraulics.pRange')}</span>
                <span className="kv-value">
                  {Math.min(...pValues).toFixed(2)} … {Math.max(...pValues).toFixed(2)}
                </span>
              </div>
            )}
          </div>
          {summary.issues.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p className="stat-line warn">{t('project.hydraulics.issuesTitle')}</p>
              {summary.issues.slice(0, ISSUE_LIMIT).map((issue, index) => (
                <p className="stat-line warn" key={`${issue.kind}-${issue.targetId}-${index}`}>
                  {t(`project.hydraulics.issue.${issue.kind}`, {
                    id: issue.targetId,
                    value: issue.value.toFixed(2),
                    limit: issue.limit.toFixed(issue.kind === 'lowVelocity' ? 1 : 0),
                  })}
                </p>
              ))}
              {summary.issues.length > ISSUE_LIMIT && (
                <p className="stat-line warn">
                  {t('project.hydraulics.issueMore', {
                    count: summary.issues.length - ISSUE_LIMIT,
                  })}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  )
}
