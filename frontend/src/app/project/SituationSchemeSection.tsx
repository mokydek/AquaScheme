import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ringFromGeoJsonGeometry, solveGravityNetwork } from '@aquascheme/engine'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import type { ParcelRow } from '../../shared/parcels'
import { Panel } from './Panel'
import { PipeCalculationsView } from './PipeCalculationsView'
import { LiveSituationMap } from './LiveSituationMap'

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
  basisDataset,
  parcels,
}: {
  systemType: 'sewer' | 'storm'
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  geologyDataset?: DatasetRow
  basisDataset?: DatasetRow
  parcels?: ParcelRow[]
}) {
  const { t } = useTranslation()
  const basisContent = (basisDataset?.content ?? {}) as { mode?: string; project?: { code?: string } }
  const hasReferenceSheet = basisContent.mode === 'demo-derived' || basisContent.project?.code === '2024-51-НК'
  const [view, setView] = useState<'calculated' | 'calculations'>('calculated')

  const model = useMemo(() => {
    if (pipes.length === 0) return null
    const network = networkFromRows(nodes, pipes)
    const flows = new Map<string, number>()
    if (systemType === 'storm') {
      for (const b of buildings) flows.set(b.id, b.specific_demand_lpd ?? b.residents ?? 0)
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
      calculatedPipes: result.pipes,
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

  const nodeLabel = useMemo(() => {
    const buildingById = new Map(buildings.map((building) => [building.id, building.label ?? building.id]))
    const labels = new Map(nodes.map((node, index) => [
      node.label ?? node.id,
      node.building_id ? buildingById.get(node.building_id) ?? `ОС-${index + 1}` : node.kind === 'source' ? 'Оголовок' : `К-${index + 1}`,
    ]))
    return (nodeId: string) => labels.get(nodeId) ?? nodeId
  }, [buildings, nodes])

  return (
    <Panel title={t('project.scheme.title')} status={model ? 'filled' : 'empty'}>
      <p className="hint">{t('project.scheme.hint')}</p>
      {!model ? (
        <p className="stat-line warn">{t('project.scheme.needNetwork')}</p>
      ) : (
        <>
          <div className="scheme-view-tabs" role="tablist" aria-label="Вид ситуационной схемы">
              <button type="button" className={view === 'calculated' ? 'active' : ''} onClick={() => setView('calculated')}>
                Рассчитанная трасса на карте
              </button>
              <button type="button" className={view === 'calculations' ? 'active' : ''} onClick={() => setView('calculations')}>
                Расчёты труб и диаметры
              </button>
          </div>
          {view === 'calculations' ? (
            <PipeCalculationsView pipes={model.calculatedPipes} nodeLabel={nodeLabel} />
          ) : (
            <LiveSituationMap
              network={model.network}
              buildings={buildings.map((building) => ({ x: building.x, y: building.y, label: building.label }))}
              pipeDiameterMm={model.pipeDiameterMm}
              corridorRings={corridorRings}
              outletFlowLps={model.outletFlowLps}
            />
          )}
          {hasReferenceSheet && (
            <p className="reference-source-note">
              Ось на карте рассчитана заново из инженерного коридора и исходных точек. Изображение итогового проекта в построении не участвует.
              Генплан задаёт допустимую геометрию, топосъёмка — высоты, а вкладка расчётов проверяет расходы, диаметры, уклоны и глубины.
            </p>
          )}
        </>
      )}
    </Panel>
  )
}
