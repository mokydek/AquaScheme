import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { buildRecommendations, ISSUE_BASIS, ISSUE_REFS } from '@aquascheme/engine'
import type { SizedPipe, SizingResult } from '@aquascheme/engine/sizing'
import type { BuildingRow } from '../../shared/datasets'
import type { NodeRow } from '../../shared/network'
import { NormBadge } from './NormBadge'
import { Panel } from './Panel'

const KIND_ORDER: Record<string, number> = { supply: 0, ring: 1, main: 1, cross: 2, service: 3 }

export function ResultsSection({
  lastRun,
  nodes,
  buildings,
}: {
  lastRun: SizingResult | null
  nodes: NodeRow[]
  buildings: BuildingRow[]
}) {
  const { t } = useTranslation()

  // Resolve an engine node id to a human label (building label when possible).
  const labelOfNode = useMemo(() => {
    const buildingLabelById = new Map(buildings.map((b) => [b.id, b.label ?? '']))
    const engineToBuilding = new Map(
      nodes.filter((n) => n.building_id).map((n) => [n.label ?? n.id, n.building_id as string]),
    )
    return (engineId: string): string => {
      const buildingId = engineToBuilding.get(engineId)
      if (buildingId) return buildingLabelById.get(buildingId) || engineId
      return engineId
    }
  }, [nodes, buildings])

  const pipeLabel = (p: SizedPipe) => `${labelOfNode(p.fromNode)}–${labelOfNode(p.toNode)}`

  const sortedPipes = useMemo(() => {
    if (!lastRun) return []
    return [...lastRun.pipes].sort((a, b) => {
      const ka = KIND_ORDER[a.kind] ?? 9
      const kb = KIND_ORDER[b.kind] ?? 9
      if (ka !== kb) return ka - kb
      return (
        Number(a.id.replace(/\D/g, '') || 0) - Number(b.id.replace(/\D/g, '') || 0)
      )
    })
  }, [lastRun])

  const recommendations = useMemo(
    () => (lastRun ? buildRecommendations(lastRun) : []),
    [lastRun],
  )

  const resolveTarget = (id: string): string => {
    if (!lastRun) return id
    const pipe = lastRun.pipes.find((p) => p.id === id)
    if (pipe) return pipeLabel(pipe)
    return labelOfNode(id)
  }

  if (!lastRun) {
    return (
      <Panel title={t('project.results.title')} status="empty">
        <p className="stat-line">{t('project.results.empty')}</p>
      </Panel>
    )
  }

  return (
    <Panel title={t('project.results.title')} status="filled">
      <p className={`stat-line${lastRun.converged ? ' ok' : ' warn'}`}>
        {t(`project.results.${lastRun.converged ? 'converged' : 'notConverged'}`)}
      </p>

      {recommendations.length > 0 && (
        <div className="problem-list">
          {recommendations.map((rec) => (
            <div className="problem" key={rec.kind}>
              <div className="problem-head">
                <span className={`badge problem-badge-${rec.severity}`}>
                  {t(`project.results.severity.${rec.severity}`)}
                </span>
                <span className="problem-title">{t(`project.results.issue.${rec.kind}`)}</span>
              </div>
              <p className="problem-targets">
                {rec.targets.slice(0, 12).map(resolveTarget).join(', ')}
                {rec.targets.length > 12
                  ? ` ${t('project.results.andMore', { count: rec.targets.length - 12 })}`
                  : ''}
              </p>
              <ul className="problem-actions">
                {rec.actions.map((action) => (
                  <li key={action}>{t(`project.results.action.${action}`)}</li>
                ))}
              </ul>
              <div style={{ marginTop: 8 }}>
                <NormBadge refs={ISSUE_REFS[rec.kind]} basis={ISSUE_BASIS[rec.kind]} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('project.results.th.segment')}</th>
              <th>{t('project.results.th.kind')}</th>
              <th className="num">{t('project.results.th.d')}</th>
              <th className="num">{t('project.results.th.l')}</th>
              <th className="num">{t('project.results.th.q')}</th>
              <th className="num">{t('project.results.th.v')}</th>
              <th className="num">{t('project.results.th.i')}</th>
              <th className="num">{t('project.results.th.h')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedPipes.map((p) => {
              const overV = p.velocityMs > 2.5
              return (
                <tr key={p.id} className={overV ? 'row-warn' : undefined}>
                  <td>{pipeLabel(p)}</td>
                  <td>{t(`project.results.pipeKind.${p.kind}`)}</td>
                  <td className="num">{p.nominalMm}</td>
                  <td className="num">{p.lengthM.toFixed(1)}</td>
                  <td className="num">{Math.abs(p.flowLps).toFixed(2)}</td>
                  <td className="num">{p.velocityMs.toFixed(2)}</td>
                  <td className="num">{p.unitHeadlossMPerKm.toFixed(1)}</td>
                  <td className="num">{p.headlossM.toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="norm-basis-list">
        <NormBadge refs={['velocity.economic', 'velocity.max']} />
        <NormBadge refs={['freeHead.base', 'freeHead.perFloor', 'freeHead.max']} />
        <NormBadge refs={['main.looped']} />
      </div>
    </Panel>
  )
}
