import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NORMATIVE_DEFAULTS } from '@aquascheme/engine'
import type { NormativeParams } from '@aquascheme/engine'
import type { SizingResult } from '@aquascheme/engine/sizing'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import { persistSizing, runSizingInWorker } from '../../shared/pipeline'
import type { SourceData } from './ProjectMap'
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
  onChanged,
}: {
  projectId: string
  buildings: BuildingRow[]
  source: SourceData | null
  normsDataset: DatasetRow | undefined
  nodes: NodeRow[]
  pipes: PipeRow[]
  lastSummary: SizingResult | null
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'done' | 'error' | null>(null)

  const canRun = pipes.length > 0 && buildings.length > 0 && source !== null

  const run = async () => {
    if (!canRun || busy || !source) return
    setBusy(true)
    setNotice(null)
    const norms: NormativeParams = {
      ...NORMATIVE_DEFAULTS,
      ...((normsDataset?.content ?? {}) as Partial<NormativeParams>),
    }
    const availableHeadM = source.availableHead ?? 45
    try {
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
      })
      await persistSizing(projectId, result, nodes, pipes, norms, availableHeadM, new Date().toISOString())
      setNotice('done')
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

  return (
    <Panel
      title={t('project.hydraulics.title')}
      status={summary ? 'filled' : 'empty'}
    >
      <p className="hint">{t('project.hydraulics.hint')}</p>
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
