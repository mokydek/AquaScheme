import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ringFromGeoJsonGeometry, solveGravityNetwork } from '@aquascheme/engine'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import type { ParcelRow } from '../../shared/parcels'
import { SchemeBuilder } from './SchemeBuilder'
import { Panel } from './Panel'

/**
 * Standalone «Ситуационная схема» category: the scheme is built here on its own
 * so the user has a dedicated place to watch it draw itself and read the data
 * behind each layer, separate from the calculation table. It re-derives the
 * gravity result from the same project inputs (cheap, memoised) and hands the
 * scheme + step plan to the SchemeBuilder player.
 */
export function SituationSchemeSection({
  systemType,
  buildings,
  nodes,
  pipes,
  geologyDataset,
  parcels,
}: {
  systemType: 'sewer' | 'storm'
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  geologyDataset?: DatasetRow
  parcels?: ParcelRow[]
}) {
  const { t } = useTranslation()

  const model = useMemo(() => {
    if (pipes.length === 0) return null
    const network = networkFromRows(nodes, pipes)
    const flows = new Map<string, number>()
    if (systemType === 'storm') {
      for (const b of buildings) flows.set(b.id, b.residents ?? 0)
    } else {
      for (const b of buildings) flows.set(b.id, b.residents ?? 0)
    }
    const freezingDepthM = ((geologyDataset?.content ?? {}) as { freezingDepthM?: number }).freezingDepthM ?? 1.5
    const result = solveGravityNetwork({
      network,
      buildingFlowLps: flows,
      system: systemType,
      freezingDepthM,
      strategy: 'minBurial',
    })
    return {
      network,
      pipeDiameterMm: new Map(result.pipes.map((p) => [p.id, p.diameterMm])),
      outletFlowLps: result.outletFlowLps,
    }
  }, [systemType, buildings, nodes, pipes, geologyDataset])

  const corridorRings = useMemo(
    () =>
      (parcels ?? [])
        .filter((p) => p.kind === 'right_of_way')
        .map((p) => ringFromGeoJsonGeometry(p.geometry))
        .filter((r): r is NonNullable<typeof r> => !!r),
    [parcels],
  )

  return (
    <Panel title={t('project.scheme.title')} status={model ? 'filled' : 'empty'}>
      <p className="hint">{t('project.scheme.hint')}</p>
      {!model ? (
        <p className="stat-line warn">{t('project.scheme.needNetwork')}</p>
      ) : (
        <SchemeBuilder
          scheme={{
            title: t('project.gravity.schemeTitle'),
            network: model.network,
            buildings: buildings.map((b) => ({ x: b.x, y: b.y, label: b.label })),
            pipeDiameterMm: model.pipeDiameterMm,
            outletFlowLps: model.outletFlowLps,
            corridorRings,
          }}
          steps={{
            network: model.network,
            pipeDiameterMm: model.pipeDiameterMm,
            buildingsCount: buildings.length,
            corridorRings: corridorRings.length,
            outletFlowLps: model.outletFlowLps,
          }}
        />
      )}
    </Panel>
  )
}
