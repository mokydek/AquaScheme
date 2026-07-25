import { useEffect, useMemo, useRef, useState } from 'react'
import {
  assessRouteSurveyCoverage,
  compareRouteToReference,
  ringFromGeoJsonGeometry,
  ROUTE_ALGORITHM_VERSION,
  solveGravityNetwork,
  solvePressureMain,
} from '@aquascheme/engine'
import type { RouteConstraintInput } from '@aquascheme/engine'
import { loadActiveCatalogNominalDiameters } from '../../shared/catalog'
import { networkFromRows, replaceNetwork, routeInputHash } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import type { BuildingRow, DatasetRow, SourceData } from '../../shared/datasets'
import type { ParcelRow } from '../../shared/parcels'
import { Panel } from './Panel'
import { PipeCalculationsView } from './PipeCalculationsView'
import { LiveSituationMap } from './LiveSituationMap'
import { runEngineeringRouteInWorker } from '../../shared/routeWorker'

type View = 'inputs' | 'constraints' | 'route' | 'profile' | 'calculations' | 'crossings' | 'blockers' | 'comparison'

interface RouteState {
  status: 'stale' | 'blocked' | 'preliminary' | 'calculated'
  algorithmVersion: string | null
  inputHash: string | null
  calculatedAt: string | null
  blockers: Array<{ code?: string; message?: string; scope?: string }>
  warnings: string[]
  revision: number
  report?: {
    gravity?: { redLineCrossings?: number; utilityCrossings?: number; roadCrossings?: number; waterCrossings?: number; outsideCorridorSegments?: number }
    pressure?: { redLineCrossings?: number; utilityCrossings?: number; roadCrossings?: number; waterCrossings?: number; outsideCorridorSegments?: number }
    quality?: { totalLengthM?: number; routedTerminals?: number; outsideCorridorSegments?: number }
  }
}

interface PersistedConstraints extends RouteConstraintInput {
  lns?: { x: number; y: number; designFlowLps?: number; label?: string; pumpHeadM?: number }
  completeness?: string
}

const TABS: Array<{ id: View; label: string }> = [
  { id: 'inputs', label: 'Исходные точки' },
  { id: 'constraints', label: 'Ограничения DWG' },
  { id: 'route', label: 'Трасса на карте' },
  { id: 'profile', label: 'Продольный профиль' },
  { id: 'calculations', label: 'Трубы и диаметры' },
  { id: 'crossings', label: 'Пересечения' },
  { id: 'blockers', label: 'Блокеры' },
  { id: 'comparison', label: 'Сравнение' },
]

export function SituationSchemeSection({
  projectId,
  systemType,
  buildings,
  nodes,
  pipes,
  geologyDataset,
  basisDataset,
  topographyDataset,
  constraintsDataset,
  routeAuditDataset,
  sourceDataset,
  parcels,
  activeCatalogId,
  routeState,
  onChanged,
}: {
  projectId: string
  systemType: 'sewer' | 'storm'
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  geologyDataset?: DatasetRow
  basisDataset?: DatasetRow
  topographyDataset?: DatasetRow
  constraintsDataset?: DatasetRow
  routeAuditDataset?: DatasetRow
  sourceDataset?: DatasetRow
  parcels?: ParcelRow[]
  activeCatalogId: string | null
  routeState: RouteState
  onChanged: () => Promise<void>
}) {
  const [view, setView] = useState<View>('route')
  const [catalogDiameters, setCatalogDiameters] = useState<readonly number[] | undefined>(undefined)
  const [recalculating, setRecalculating] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [recalcError, setRecalcError] = useState<string | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const constraints = (constraintsDataset?.content ?? null) as PersistedConstraints | null
  const source = (sourceDataset?.content ?? null) as SourceData | null

  useEffect(() => {
    if (!recalculating) {
      setElapsedSeconds(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [recalculating])

  useEffect(() => {
    let active = true
    if (!activeCatalogId) {
      setCatalogDiameters(undefined)
      return () => { active = false }
    }
    loadActiveCatalogNominalDiameters(activeCatalogId)
      .then((diameters) => { if (active) setCatalogDiameters(diameters ?? []) })
      .catch(() => { if (active) setCatalogDiameters([]) })
    return () => { active = false }
  }, [activeCatalogId])

  const model = useMemo(() => {
    if (routeState.status === 'blocked' || routeState.status === 'stale' || pipes.length === 0) return null
    const network = networkFromRows(nodes, pipes)
    const flows = new Map<string, number>()
    for (const building of buildings) {
      flows.set(building.id, systemType === 'storm'
        ? building.design_flow_lps ?? building.specific_demand_lpd ?? 0
        : building.design_flow_lps ?? building.residents ?? 0)
    }
    const freezingDepthM = ((geologyDataset?.content ?? {}) as { freezingDepthM?: number }).freezingDepthM ?? 1.5
    const lns = network.nodes.find((node) => node.kind === 'lns_inlet' || node.kind === 'pumping_station')
    const gravity = solveGravityNetwork({
      network,
      buildingFlowLps: flows,
      system: systemType,
      freezingDepthM,
      strategy: 'minBurial',
      outletNodeId: lns?.id,
      allowedDiametersMm: activeCatalogId ? catalogDiameters ?? [] : undefined,
    })
    const totalFlow = buildings.reduce((sum, building) => sum + (building.design_flow_lps ?? building.specific_demand_lpd ?? 0), 0)
    const pressureRows = network.pipes.filter((pipe) => pipe.systemType === 'pressure' || pipe.kind === 'pressure_main')
    const outlet = network.nodes.find((node) => node.kind === 'outlet' || node.kind === 'outfall')
    const pressure = solvePressureMain({
      pipes: pressureRows.map((pipe) => ({
        id: pipe.id,
        lengthM: pipe.lengthM,
        diameterMm: pipe.diameterMm ?? 0,
        flowLps: totalFlow,
        parallelCount: pipe.parallelCount,
      })),
      inletElevationM: lns?.groundElevation ?? 0,
      outletElevationM: outlet?.groundElevation ?? 0,
      availablePumpHeadM: constraints?.lns?.pumpHeadM ?? null,
    })
    return {
      network,
      gravity,
      pressure,
      pipeDiameterMm: new Map([
        ...gravity.pipes.map((pipe) => [pipe.id, pipe.diameterMm] as const),
        ...pressureRows.flatMap((pipe) => pipe.diameterMm ? [[pipe.id, pipe.diameterMm] as const] : []),
      ]),
      outletFlowLps: totalFlow,
    }
  }, [systemType, buildings, nodes, pipes, geologyDataset, activeCatalogId, catalogDiameters, constraints, routeState.status])

  const corridorRings = useMemo(() => {
    if (constraints?.corridorRings?.length) return constraints.corridorRings
    return (parcels ?? [])
      .filter((parcel) => parcel.kind === 'right_of_way')
      .map((parcel) => ringFromGeoJsonGeometry(parcel.geometry))
      .filter((ring): ring is NonNullable<typeof ring> => Boolean(ring))
  }, [constraints, parcels])

  const nodeLabel = useMemo(() => {
    const buildingById = new Map(buildings.map((building) => [building.id, building.label ?? building.id]))
    const labels = new Map(nodes.map((node, index) => [
      node.meta?.engineId ?? node.label ?? node.id,
      node.building_id ? buildingById.get(node.building_id) ?? `ОС-${index + 1}` : node.label ?? `К-${index + 1}`,
    ]))
    return (nodeId: string) => labels.get(nodeId) ?? nodeId
  }, [buildings, nodes])

  const recalculate = async () => {
    if (recalculating) return
    setRecalculating(true)
    setRecalcError(null)
    const paint = async (text: string) => {
      setStage(text)
      await new Promise<void>((resolve) => window.setTimeout(resolve, 30))
    }
    try {
      await paint('Проверка исходных точек, ЛНС и системы координат…')
      if (!constraints || !constraints.lns || !source) throw new Error('Нет ЛНС, выпуска или структурированных ограничений DWG.')
      const surveyPoints = constraints.surveyPoints?.length
        ? constraints.surveyPoints
        : ((topographyDataset?.content ?? {}) as { points?: Array<{ x: number; y: number; z: number }> }).points ?? []
      await paint('Построение маски запретных зон и инженерного коридора…')
      const running = runEngineeringRouteInWorker({
        facilities: buildings.map((building) => ({
          id: building.label ?? building.id,
          label: building.label ?? building.id,
          buildingId: building.id,
          x: building.x,
          y: building.y,
          designFlowLps: building.design_flow_lps ?? building.specific_demand_lpd ?? 0,
        })),
        lns: { id: 'LNS', label: constraints.lns.label ?? 'ЛНС', ...constraints.lns },
        outlet: { id: 'OUTLET', label: 'Оголовок / выпуск', x: source.x, y: source.y },
        constraints: { ...constraints, surveyPoints },
        options: { gridSizeM: 15 },
        sourceSurveyPointCount: (topographyDataset?.meta as { total?: number } | null)?.total,
        pumpHeadM: constraints.lns.pumpHeadM ?? null,
      }, setStage)
      cancelRef.current = running.cancel
      const route = await running.promise
      await paint('Проверка связности, пересечений и гидравлических систем…')
      const hash = await routeInputHash({ buildings, source, constraints: { ...constraints, surveyPoints } })
      await paint('Атомарное сохранение новой версии сети…')
      await replaceNetwork(projectId, route.network, {
        status: route.status,
        algorithmVersion: route.algorithmVersion,
        inputHash: hash,
        warnings: route.warnings,
        blockers: route.blockers,
        report: {
          ...route.reports,
          surveyCoverage: route.surveyCoverage,
          quality: {
            totalLengthM: route.network.totalLengthM,
            routedTerminals: route.reports.gravity.routedTerminals + route.reports.pressure.routedTerminals,
            outsideCorridorSegments: route.reports.gravity.outsideCorridorSegments + route.reports.pressure.outsideCorridorSegments,
          },
        },
      })
      await onChanged()
      if (route.status === 'blocked') {
        setRecalcError(route.blockers.map((blocker) => blocker.message).join(' '))
        setStage('Расчёт остановлен: проектная геометрия очищена.')
      } else {
        setStage('Пересчёт завершён.')
      }
    } catch (error) {
      setRecalcError(error instanceof Error ? error.message : 'Не удалось пересчитать трассу.')
    } finally {
      cancelRef.current = null
      setRecalculating(false)
      window.setTimeout(() => setStage(null), 1500)
    }
  }

  const constraintsAuditMeta = (constraintsDataset?.meta ?? {}) as {
    sourceLayers?: Array<{ name: string; segments: number; points: number; closedSegments?: number; entityTypes?: Record<string, number>; textSamples?: string[] }>
  }
  const persistedRouteAudit = (routeAuditDataset?.content ?? {}) as {
    layers?: Array<{ name: string; segments: number; points: number; closedSegments?: number; entityTypes?: Record<string, number>; textSamples?: string[] }>
    parsed?: { layers?: number; segments?: number; pointMarkers?: number }
    unresolved?: { layers?: number; reason?: string }
  }
  const sourceAudit = {
    sourceLayers: constraintsAuditMeta.sourceLayers ?? persistedRouteAudit.layers,
    sourceLayerCount: persistedRouteAudit.parsed?.layers,
    unresolvedLayers: persistedRouteAudit.unresolved?.layers,
    unresolvedReason: persistedRouteAudit.unresolved?.reason,
  }
  const crossings = {
    redLines: constraints?.redLines?.length ?? 0,
    utilities: constraints?.utilityLines?.length ?? 0,
    roads: constraints?.roadLines?.length ?? 0,
    water: constraints?.waterLines?.length ?? 0,
  }
  const allBlockers = [
    ...routeState.blockers.map((blocker) => blocker.message ?? blocker.code ?? 'Неизвестный блокер'),
    ...(!activeCatalogId ? ['Не выбран активный каталог материалов.'] : []),
    ...(activeCatalogId && catalogDiameters?.length === 0 ? ['В активном каталоге нет пригодных труб.'] : []),
    ...(model?.pressure.blockers ?? []),
  ]
  const benchmark = useMemo(() => {
    const accepted = (basisDataset?.content as { acceptedRoute?: Array<{ x: number; y: number }> } | null)?.acceptedRoute
    if (!accepted?.length || !model) return null
    const generated = model.network.pipes.flatMap((pipe) => pipe.alignment?.length ? [{ points: pipe.alignment }] : [])
    return compareRouteToReference(generated, accepted, 25, 10)
  }, [basisDataset, model])
  const surveyCoverage = useMemo(() => {
    if (!model) return null
    const survey = constraints?.surveyPoints ?? ((topographyDataset?.content ?? {}) as { points?: Array<{ x: number; y: number; z: number }> }).points ?? []
    const paths = model.network.pipes.flatMap((pipe) => pipe.alignment?.length ? [{ points: pipe.alignment }] : [])
    return assessRouteSurveyCoverage(paths, survey, 50, 75)
  }, [model, constraints, topographyDataset])

  return (
    <Panel title="Ситуационная схема и инженерная трасса" status={model ? 'filled' : 'empty'}>
      <p className="hint">
        Трасса рассчитывается из структурированных слоёв DWG. Картографическая подложка служит только для визуального контроля и не заменяет топосъёмку.
      </p>
      <div className={`notice ${routeState.status === 'calculated' ? 'info' : 'error'}`}>
        Статус трассы: <strong>{routeState.status}</strong> · алгоритм {routeState.algorithmVersion ?? 'не указан'} · ревизия {routeState.revision}.
        {' '}Хэш входов: <code>{routeState.inputHash?.slice(0, 16) ?? 'нет'}</code>{routeState.calculatedAt ? ` · расчёт ${new Date(routeState.calculatedAt).toLocaleString('ru-RU')}` : ''}.
        {routeState.algorithmVersion && routeState.algorithmVersion !== ROUTE_ALGORITHM_VERSION && ' Требуется пересчёт новой версией алгоритма.'}
      </div>
      {routeState.report?.quality ? (
        <p className="stat-line">Контроль качества: длина {routeState.report.quality.totalLengthM?.toFixed(1) ?? '—'} м · проложено ветвей {routeState.report.quality.routedTerminals ?? '—'} · участков вне коридора {routeState.report.quality.outsideCorridorSegments ?? '—'}.</p>
      ) : null}
      <div className="section-actions">
        <button type="button" className={`btn btn-sm${recalculating ? ' is-loading' : ''}`} disabled={recalculating} onClick={() => void recalculate()}>
          {recalculating && <span className="button-spinner" aria-hidden="true" />}
          {recalculating ? 'Пересчёт…' : 'Пересчитать трассу'}
        </button>
        {recalculating && <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancelRef.current?.()}>Отменить</button>}
      </div>
      {stage && <div className="export-progress" role="status"><span className="export-progress-spinner" /><div className="export-progress-copy"><strong>{stage}</strong><span>Прошло {elapsedSeconds} с. Старая сеть остаётся в базе до успешного атомарного сохранения.</span></div><span className="export-progress-bar"><i /></span></div>}
      {recalcError && <p className="notice error">{recalcError}</p>}

      <div className="scheme-view-tabs" role="tablist" aria-label="Инженерные представления">
        {TABS.map((tab) => <button key={tab.id} type="button" className={view === tab.id ? 'active' : ''} onClick={() => setView(tab.id)}>{tab.label}</button>)}
      </div>

      {view === 'inputs' && (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Точка</th><th className="num">X</th><th className="num">Y</th><th className="num">Расход, л/с</th></tr></thead><tbody>
          {buildings.map((building) => <tr key={building.id}><td>{building.label ?? building.id}</td><td className="num">{building.x}</td><td className="num">{building.y}</td><td className="num">{building.design_flow_lps ?? '—'}</td></tr>)}
          {constraints?.lns && <tr><td>{constraints.lns.label ?? 'ЛНС'}</td><td className="num">{constraints.lns.x}</td><td className="num">{constraints.lns.y}</td><td className="num">{constraints.lns.designFlowLps ?? '—'}</td></tr>}
          {source && <tr><td>Оголовок / выпуск</td><td className="num">{source.x}</td><td className="num">{source.y}</td><td className="num">—</td></tr>}
        </tbody></table></div>
      )}

      {view === 'constraints' && (
        <div>
          <p className="stat-line">Коридоры: {corridorRings.length} · красные линии: {crossings.redLines} · коммуникации: {crossings.utilities} · дороги: {crossings.roads} · гидрография: {crossings.water} · сооружения: {constraints?.hardObstacleRings?.length ?? 0} · земельные контуры: {constraints?.parcelRings?.length ?? 0}.</p>
          <p className="stat-line">Полнота: {constraints?.completeness ?? 'нет аудита'}; слоёв в DWG: {sourceAudit.sourceLayerCount ?? sourceAudit.sourceLayers?.length ?? 0}; нераспознано: {sourceAudit.unresolvedLayers ?? '—'}.</p>
          {sourceAudit.unresolvedReason ? <p className="notice error">{sourceAudit.unresolvedReason}</p> : null}
          <details><summary>Послойный аудит</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>Слой</th><th className="num">Линий</th><th className="num">Точек</th><th>Сущности</th><th>Тексты/блоки (выборка)</th></tr></thead><tbody>{(sourceAudit.sourceLayers ?? []).map((layer) => <tr key={layer.name}><td>{layer.name}</td><td className="num">{layer.segments}</td><td className="num">{layer.points}</td><td>{Object.entries(layer.entityTypes ?? {}).map(([kind, count]) => `${kind}: ${count}`).join(', ') || '—'}</td><td>{layer.textSamples?.slice(0, 4).join(' · ') || '—'}</td></tr>)}</tbody></table></div></details>
        </div>
      )}

      {view === 'route' && (routeState.status === 'blocked' || routeState.status === 'stale' ? (
        <p className="notice error">{routeState.status === 'stale' ? 'Трасса скрыта: после изменения исходных данных требуется повторный расчёт.' : 'Трасса не показана: исходные данные имеют блокирующие пробелы. Откройте вкладку «Блокеры» и устраните их.'}</p>
      ) : model ? (
        <LiveSituationMap
          network={model.network}
          buildings={buildings.map((building) => ({ x: building.x, y: building.y, label: building.label }))}
          pipeDiameterMm={model.pipeDiameterMm}
          corridorRings={corridorRings}
          constraints={constraints ?? undefined}
          outletFlowLps={model.outletFlowLps}
        />
      ) : <p className="notice error">Сеть не рассчитана.</p>)}

      {view === 'calculations' && model && <PipeCalculationsView pipes={model.gravity.pipes} nodeLabel={nodeLabel} />}
      {view === 'profile' && (
        model?.gravity.profile ? <div>{surveyCoverage && <p className={surveyCoverage.gapPoints > 0 ? 'notice error' : 'stat-line ok'}>Покрытие топосъёмкой: медиана {surveyCoverage.medianNearestM} м, P95 {surveyCoverage.p95NearestM} м, максимум {surveyCoverage.maximumNearestM} м; пробелов более {surveyCoverage.gapThresholdM} м — {surveyCoverage.gapPoints}.</p>}<div className="table-wrap"><table className="data-table"><thead><tr><th>Узел</th><th className="num">Пикетаж, м</th><th className="num">Земля, м</th><th className="num">Лоток, м</th><th className="num">Глубина, м</th></tr></thead><tbody>{model.gravity.profile.stations.map((station) => <tr key={station.nodeId}><td>{nodeLabel(station.nodeId)}</td><td className="num">{station.chainageM.toFixed(1)}</td><td className="num">{station.groundElevationM.toFixed(2)}</td><td className="num">{station.invertElevationM.toFixed(2)}</td><td className="num">{station.depthM.toFixed(2)}</td></tr>)}</tbody></table></div></div> : <p className="notice error">Профиль заблокирован: нет связной самотёчной ветви до ЛНС или отметок рельефа.</p>
      )}
      {view === 'crossings' && <div><p className="stat-line">Исходные объекты: красные линии — {crossings.redLines}; коммуникации — {crossings.utilities}; дороги — {crossings.roads}; водные объекты — {crossings.water}.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>Система</th><th className="num">Красные линии</th><th className="num">Коммуникации</th><th className="num">Дороги</th><th className="num">Вода</th><th className="num">Вне коридора</th></tr></thead><tbody>{(['gravity', 'pressure'] as const).map((kind) => { const report = routeState.report?.[kind]; return <tr key={kind}><td>{kind === 'gravity' ? 'Самотёк до ЛНС' : 'Напор от ЛНС'}</td><td className="num">{report?.redLineCrossings ?? '—'}</td><td className="num">{report?.utilityCrossings ?? '—'}</td><td className="num">{report?.roadCrossings ?? '—'}</td><td className="num">{report?.waterCrossings ?? '—'}</td><td className="num">{report?.outsideCorridorSegments ?? '—'}</td></tr> })}</tbody></table></div></div>}
      {view === 'blockers' && <div>{allBlockers.length ? [...new Set(allBlockers)].map((blocker) => <p className="notice error" key={blocker}>{blocker}</p>) : <p className="notice info">Стоп-факторов нет.</p>}{routeState.warnings.map((warning) => <p className="stat-line warn" key={warning}>{warning}</p>)}</div>}
      {view === 'comparison' && <div><p className="stat-line">Эталонная трасса не участвует в генерации и используется только после расчёта.</p>{benchmark ? <div className="table-wrap"><table className="data-table"><tbody><tr><th>Покрытие эталона в допуске 25 м</th><td className="num">{benchmark.referenceCoveragePct}%</td></tr><tr><th>Покрытие расчётной оси</th><td className="num">{benchmark.routeCoveragePct}%</td></tr><tr><th>Среднее отклонение</th><td className="num">{benchmark.meanDeviationM} м</td></tr><tr><th>Максимальное отклонение</th><td className="num">{benchmark.maximumDeviationM} м</td></tr><tr><th>Симметричное расстояние Хаусдорфа</th><td className="num">{benchmark.hausdorffDeviationM} м</td></tr></tbody></table>{benchmark.referenceCoveragePct < 99 && <p className="notice error">Цель 99% не достигнута. Результат нельзя выдавать как совпадающий с принятым проектом.</p>}</div> : <p className="hint">Независимая принятая ось в структурированном виде не загружена.</p>}</div>}
    </Panel>
  )
}
