import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { computeNetworkDemand, NORMATIVE_DEFAULTS, solveGravityNetwork } from '@aquascheme/engine'
import type { NormativeParams } from '@aquascheme/engine'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import { NormBadge } from './NormBadge'
import { Panel } from './Panel'

/**
 * Gravity (free-surface) calculation for sewer (К1) and storm (К2), NB4. Runs
 * the Chezy-Manning design over the traced/imported network with the drainage
 * flow accumulated per pipe; every column cites its verified СН РК 4.01-03-2013*
 * clause. Computed on the client from the current network — an honest
 * calculator, not persisted, so it always reflects the latest geometry.
 */
export function GravitySection({
  systemType,
  buildings,
  nodes,
  pipes,
  normsDataset,
  geologyDataset,
}: {
  systemType: 'sewer' | 'storm'
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  normsDataset?: DatasetRow
  geologyDataset?: DatasetRow
}) {
  const { t } = useTranslation()

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

  return (
    <Panel title={t('project.gravity.title')} status={result ? 'filled' : 'empty'}>
      <p className="hint">{t('project.gravity.hint')}</p>
      {!result && <p className="stat-line warn">{t('project.gravity.needNetwork')}</p>}
      {result && (
        <>
          <p className="stat-line ok">
            {t('project.gravity.outletFlow', { value: result.outletFlowLps.toFixed(2) })}
          </p>
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
                    <td className="num mono">{p.slope.toFixed(4)}</td>
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
            </>
          )}
        </>
      )}
    </Panel>
  )
}
