import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NORMATIVE_DEFAULTS } from '@aquascheme/engine'
import type { NetworkNodeKind, NetworkPipeKind, NormativeParams, TracedNetwork } from '@aquascheme/engine'
import type { SizingResult } from '@aquascheme/engine/sizing'
import type { HydraulicsWorkerResponse } from '../../workers/hydraulics.worker'
import { supabase } from '../../shared/supabase'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import type { NodeRow, PipeRow } from '../../shared/network'
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
  const workerRef = useRef<Worker | null>(null)

  const canRun = pipes.length > 0 && buildings.length > 0 && source !== null

  const persist = async (result: SizingResult, norms: NormativeParams, availableHeadM: number) => {
    const pipeByEngineId = new Map(pipes.map((p) => [p.meta?.engineId ?? '', p]))
    const pipeUpdates = result.pipes.flatMap((rp) => {
      const row = pipeByEngineId.get(rp.id)
      if (!row) return []
      return [
        {
          id: row.id,
          project_id: projectId,
          from_node: row.from_node,
          to_node: row.to_node,
          length_m: row.length_m,
          diameter_mm: rp.nominalMm,
          material: 'ПЭ100 SDR17',
          meta: {
            ...row.meta,
            kind: rp.kind,
            engineId: rp.id,
            flowLps: rp.flowLps,
            velocityMs: rp.velocityMs,
            headlossM: rp.headlossM,
            internalMm: rp.internalMm,
          },
        },
      ]
    })
    const pipesUpsert = await supabase.from('pipes').upsert(pipeUpdates)
    if (pipesUpsert.error) throw pipesUpsert.error

    const nodeByLabel = new Map(nodes.map((n) => [n.label ?? '', n]))
    const nodeUpdates = result.nodes.flatMap((rn) => {
      const row = nodeByLabel.get(rn.id)
      if (!row) return []
      return [
        {
          id: row.id,
          project_id: projectId,
          kind: row.kind,
          label: row.label,
          x: row.x,
          y: row.y,
          ground_elevation: row.ground_elevation,
          building_id: row.building_id,
          meta: {
            ...row.meta,
            pressureM: rn.pressureM,
            headM: rn.headM,
            requiredPressureM: rn.requiredPressureM ?? null,
            ok: rn.ok,
          },
        },
      ]
    })
    const nodesUpsert = await supabase.from('nodes').upsert(nodeUpdates)
    if (nodesUpsert.error) throw nodesUpsert.error

    const runInsert = await supabase.from('calc_runs').insert({
      project_id: projectId,
      status: 'done',
      params: { ...norms, availableHeadM },
      summary: result as unknown as Record<string, unknown>,
      finished_at: new Date().toISOString(),
    })
    if (runInsert.error) throw runInsert.error
  }

  const run = () => {
    if (!canRun || busy || !source) return
    setBusy(true)
    setNotice(null)

    const labelById = new Map(nodes.map((n) => [n.id, n.label ?? n.id]))
    const network: TracedNetwork = {
      nodes: nodes.map((n) => ({
        id: n.label ?? n.id,
        kind: (n.meta?.engineKind ?? (n.kind === 'source' ? 'source' : 'ring')) as NetworkNodeKind,
        x: n.x,
        y: n.y,
        groundElevation: n.ground_elevation ?? 0,
        buildingId: n.building_id ?? undefined,
      })),
      pipes: pipes.map((p) => ({
        id: p.meta?.engineId ?? p.id,
        kind: (p.meta?.kind ?? 'ring') as NetworkPipeKind,
        fromNode: labelById.get(p.from_node) ?? p.from_node,
        toNode: labelById.get(p.to_node) ?? p.to_node,
        lengthM: p.length_m ?? 0,
      })),
      totalLengthM: pipes.reduce((sum, p) => sum + (p.length_m ?? 0), 0),
    }

    const norms: NormativeParams = {
      ...NORMATIVE_DEFAULTS,
      ...((normsDataset?.content ?? {}) as Partial<NormativeParams>),
    }
    const availableHeadM = source.availableHead ?? 45

    workerRef.current?.terminate()
    const worker = new Worker(new URL('../../workers/hydraulics.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<HydraulicsWorkerResponse>) => {
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
      const response = event.data
      if (!response.ok) {
        setNotice('error')
        setBusy(false)
        return
      }
      persist(response.result, norms, availableHeadM)
        .then(async () => {
          setNotice('done')
          await onChanged()
        })
        .catch(() => setNotice('error'))
        .finally(() => setBusy(false))
    }
    worker.onerror = () => {
      worker.terminate()
      setNotice('error')
      setBusy(false)
    }
    worker.postMessage({
      network,
      buildings: buildings.map((b) => ({
        id: b.id,
        floors: b.floors,
        residents: b.residents ?? 0,
      })),
      availableHeadM,
      norms,
    })
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
          onClick={run}
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
