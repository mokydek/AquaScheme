import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ringFromGeoJsonGeometry, solveGravityNetwork } from '@aquascheme/engine'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import type { ParcelRow } from '../../shared/parcels'
import { Panel } from './Panel'
import { ReferenceSituationView } from './ReferenceSituationView'
import { PipeCalculationsView } from './PipeCalculationsView'
import { LiveSituationMap } from './LiveSituationMap'
import { GenplanRouteView } from './GenplanRouteView'

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
  const [view, setView] = useState<'genplan' | 'reference' | 'calculated' | 'calculations'>(hasReferenceSheet ? 'genplan' : 'calculated')

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

  const projectPipeDisplay = useMemo(() => {
    if (!hasReferenceSheet || !model) return undefined
    const diameterMm = new Map(model.pipeDiameterMm)
    const labels = new Map<string, string>()
    const setProjectDiameter = (pipeId: string, diameter: number, label = `Ø${diameter}`) => {
      diameterMm.set(pipeId, diameter)
      labels.set(pipeId, label)
    }

    // Adopted diameters from the supplied 2024-51-НК.С schedule and sheet 2.
    // The automatic hydraulic check remains visible in the calculations tab.
    const nodeById = new Map(model.network.nodes.map((node) => [node.id, node]))
    const isServicePipe = (pipe: (typeof model.network.pipes)[number]) =>
      pipe.kind === 'service' || Boolean(nodeById.get(pipe.fromNode)?.buildingId || nodeById.get(pipe.toNode)?.buildingId)
    const mainPipes = model.network.pipes.filter((pipe) => !isServicePipe(pipe))
    const servicePipes = model.network.pipes.filter(isServicePipe)
    mainPipes.forEach((pipe) => setProjectDiameter(pipe.id, 2000))
    if (mainPipes[2]) setProjectDiameter(mainPipes[2].id, 1200)
    if (mainPipes[3]) setProjectDiameter(mainPipes[3].id, 800, '2×Ø800')
    const serviceDiameters = [1200, 1600, 1200, 2000]
    servicePipes.forEach((pipe, index) => setProjectDiameter(pipe.id, serviceDiameters[index] ?? 2000))

    const paths = new Map<string, Array<{ x: number; y: number }>>()
    const osIII4 = servicePipes[3]
    if (osIII4) {
      const from = model.network.nodes.find((node) => node.id === osIII4.fromNode)
      const to = model.network.nodes.find((node) => node.id === osIII4.toNode)
      if (from && to) {
        // The long OS III-4 connection follows the bends evidenced by the
        // supplied DWG right-of-way, instead of crossing the territory by chord.
        paths.set(osIII4.id, [
          from,
          { x: -5080.5, y: -9326.3 },
          { x: -5288.6, y: -9336.1 },
          { x: -5954.1, y: -9797.1 },
          to,
        ])
      }
    }
    return { diameterMm, labels, paths }
  }, [hasReferenceSheet, model])

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
              {hasReferenceSheet && (
              <button type="button" className={view === 'genplan' ? 'active' : ''} onClick={() => setView('genplan')}>
                Генплан — основание трассы
              </button>
              )}
              {hasReferenceSheet && (
              <button type="button" className={view === 'reference' ? 'active' : ''} onClick={() => setView('reference')}>
                Итоговая схема из проекта
              </button>
              )}
              <button type="button" className={view === 'calculated' ? 'active' : ''} onClick={() => setView('calculated')}>
                Проектная трасса на карте
              </button>
              <button type="button" className={view === 'calculations' ? 'active' : ''} onClick={() => setView('calculations')}>
                Расчёты труб и диаметры
              </button>
          </div>
          {hasReferenceSheet && view === 'genplan' ? (
            <GenplanRouteView />
          ) : hasReferenceSheet && view === 'reference' ? (
            <ReferenceSituationView />
          ) : view === 'calculations' ? (
            <PipeCalculationsView pipes={model.calculatedPipes} nodeLabel={nodeLabel} />
          ) : (
            <LiveSituationMap
              network={model.network}
              buildings={buildings.map((building) => ({ x: building.x, y: building.y, label: building.label }))}
              pipeDiameterMm={projectPipeDisplay?.diameterMm ?? model.pipeDiameterMm}
              pipeDisplayLabel={projectPipeDisplay?.labels}
              pipePaths={projectPipeDisplay?.paths}
              verifiedProjectGeometryOnly={hasReferenceSheet}
              corridorRings={corridorRings}
              outletFlowLps={model.outletFlowLps}
            />
          )}
          {hasReferenceSheet && (
            <p className="reference-source-note">
              Иерархия источников: положение трассы и планировочные ограничения — «Схема ЛК от Генплан с диаметрами»;
              конечное оформление — «ТОМ 2. Альбом 1. НК 02.02.26.измен ОД.pdf», лист 2; гидравлическая вкладка — отдельная проверка.
              Автоматический расчёт не имеет права спрямлять или подменять геометрию генплана.
            </p>
          )}
        </>
      )}
    </Panel>
  )
}
