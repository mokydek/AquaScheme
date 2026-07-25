import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { importNetwork, lonLatToLocal, parseGeoJsonNetwork, similarityTransform, traceConstrainedNetwork } from '@aquascheme/engine'
import type { ConstrainedRouteReport, ImportReport, ImportSegment, SurveyPoint } from '@aquascheme/engine'
import type { DxfConstraintData, DxfLayerRole, DxfNetworkData } from '@aquascheme/engine/dxfread'
import { replaceNetwork, routeInputHash } from '../../shared/network'
import { replaceRightOfWay } from '../../shared/parcels'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import { saveDataset } from '../../shared/datasets'
import { supabase } from '../../shared/supabase'
import type { BuildingRow } from '../../shared/datasets'
import type { PipeRow } from '../../shared/network'
import type { SourceData } from '../../shared/datasets'
import { Panel } from './Panel'
import { runEngineeringRouteInWorker } from '../../shared/routeWorker'

type Parsed =
  | { kind: 'dxf'; data: DxfNetworkData; constraints: DxfConstraintData }
  | { kind: 'geojson'; segments: ImportSegment[]; treatedAsLonLat: boolean }

type GeorefMode = 'none' | 'points' | 'proj4'
type SourceConfirmationKey = 'buildings' | 'utilities' | 'roads' | 'hydrography' | 'parcels' | 'protectionZones'

const ROLE_OPTIONS: Array<{ value: DxfLayerRole; label: string }> = [
  { value: 'corridor', label: 'Коридор' },
  { value: 'guideAxis', label: 'Направляющая ось' },
  { value: 'redLine', label: 'Красная линия' },
  { value: 'utility', label: 'Существующая коммуникация' },
  { value: 'road', label: 'Автомобильная дорога' },
  { value: 'railway', label: 'Железная дорога' },
  { value: 'hydrography', label: 'Гидрография' },
  { value: 'terrain', label: 'Высоты/рельеф' },
  { value: 'terrainBreakline', label: 'Структурная линия рельефа' },
  { value: 'building', label: 'Здание' },
  { value: 'structure', label: 'Сооружение' },
  { value: 'parcel', label: 'Земельный участок' },
  { value: 'protectionZone', label: 'Охранная зона' },
  { value: 'forbiddenZone', label: 'Запрещённая зона' },
  { value: 'approvedCrossing', label: 'Согласованное окно пересечения' },
  { value: 'candidateRoute', label: 'Готовая ось (только импорт)' },
  { value: 'ignore', label: 'Проверено: не инженерный слой' },
  { value: 'unknown', label: 'Не классифицировано' },
]

const CP_KEYS = ['ax', 'ay', 'AX', 'AY', 'bx', 'by', 'BX', 'BY'] as const
type CpKey = (typeof CP_KEYS)[number]

export function ImportSection({
  projectId,
  buildings,
  source,
  points,
  existingNodes,
  existingPipes,
  systemType = 'water',
  onChanged,
}: {
  projectId: string
  buildings: BuildingRow[]
  source: SourceData | null
  points: SurveyPoint[]
  existingNodes: number
  existingPipes: PipeRow[]
  systemType?: 'water' | 'sewer' | 'storm'
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [selectedLayers, setSelectedLayers] = useState<Record<string, boolean>>({})
  const [layerRoles, setLayerRoles] = useState<Record<string, DxfLayerRole>>({})
  const [confirmedAbsent, setConfirmedAbsent] = useState<Record<SourceConfirmationKey, boolean>>({
    buildings: false, utilities: false, roads: false, hydrography: false, parcels: false, protectionZones: false,
  })
  const [tolerance, setTolerance] = useState('0.5')
  const [georefMode, setGeorefMode] = useState<GeorefMode>('none')
  const [projString, setProjString] = useState('')
  const [cp, setCp] = useState<Record<CpKey, string>>({
    ax: '', ay: '', AX: '', AY: '', bx: '', by: '', BX: '', BY: '',
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'done' | 'error' | 'invalid' | 'georefError' | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [fromDwg, setFromDwg] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [constraintReport, setConstraintReport] = useState<ConstrainedRouteReport | null>(null)
  const [routeBlockers, setRouteBlockers] = useState<string[]>([])
  const [lnsX, setLnsX] = useState('')
  const [lnsY, setLnsY] = useState('')
  const [lnsFlow, setLnsFlow] = useState('')
  const [routingStage, setRoutingStage] = useState<string | null>(null)
  const [routeElapsedSeconds, setRouteElapsedSeconds] = useState(0)
  const routeCancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!routingStage) {
      setRouteElapsedSeconds(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => setRouteElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [routingStage])

  const canImport = source !== null

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setNotice(null)
    setUploadMessage(null)
    setReport(null)
    setConstraintReport(null)
    setRouteBlockers([])
    setParsed(null)
    setFromDwg(false)
    setLayerRoles({})
    setConfirmedAbsent({ buildings: false, utilities: false, roads: false, hydrography: false, parcels: false, protectionZones: false })
    try {
      const routed = await routeUpload(file, ['dxf', 'geojson'])
      if (routed.kind === 'dxf') {
        const { classifyDxfConstraints, parseDxfNetwork } = await import('@aquascheme/engine/dxfread')
        const data = parseDxfNetwork(routed.text ?? '')
        if (!data.ok || data.segments.length === 0) {
          setNotice('invalid')
        } else {
          const { data: savedAudit } = await supabase
            .from('datasets')
            .select('content')
            .eq('project_id', projectId)
            .eq('kind', 'route_audit')
            .maybeSingle()
          const rawSavedRoles = ((savedAudit?.content ?? {}) as { roles?: Record<string, string> }).roles ?? {}
          const allowedRoles = new Set(ROLE_OPTIONS.map((option) => option.value))
          const savedRoles = Object.fromEntries(Object.entries(rawSavedRoles).map(([name, role]) => [
            name,
            allowedRoles.has(role as DxfLayerRole) ? role as DxfLayerRole : 'unknown',
          ]))
          const constraints = classifyDxfConstraints(data, savedRoles)
          setParsed({ kind: 'dxf', data, constraints })
          setLayerRoles(constraints.roles)
          setFromDwg(routed.fromDwg === true)
          const selected: Record<string, boolean> = {}
          for (const layer of data.layers) selected[layer.name] = constraints.roles[layer.name] === 'candidateRoute'
          setSelectedLayers(selected)
        }
      } else {
        const geo = parseGeoJsonNetwork(routed.text ?? '')
        if (geo.invalid || geo.segments.length === 0) {
          setNotice('invalid')
        } else {
          setParsed({ kind: 'geojson', segments: geo.segments, treatedAsLonLat: geo.treatedAsLonLat })
        }
      }
    } catch (error) {
      const message = uploadErrorText(t, error)
      if (message) setUploadMessage(message)
      else setNotice('invalid')
    } finally {
      event.target.value = ''
    }
  }

  const num = (value: string): number => Number(value.trim().replace(',', '.'))

  const setLayerRole = async (layer: string, role: DxfLayerRole) => {
    if (!parsed || parsed.kind !== 'dxf') return
    const next = { ...layerRoles, [layer]: role }
    setLayerRoles(next)
    setSelectedLayers((previous) => ({ ...previous, [layer]: role === 'candidateRoute' }))
    const { classifyDxfConstraints } = await import('@aquascheme/engine/dxfread')
    const constraints = classifyDxfConstraints(parsed.data, next)
    setParsed({ ...parsed, constraints })
    try {
      await saveDataset(projectId, 'route_audit', {
        layers: parsed.data.layers,
        roles: constraints.roles,
        mappingStatus: 'in-progress',
        unresolved: {
          layers: Object.values(constraints.roles).filter((value) => value === 'unknown').length,
          names: Object.entries(constraints.roles).filter(([, value]) => value === 'unknown').map(([name]) => name),
        },
        drawingMetadata: parsed.data.metadata,
      }, { source: 'manual-layer-mapping' }, fromDwg ? 'converted-from-dwg.dxf' : 'source.dxf')
    } catch {
      setUploadMessage('Роль слоя применена локально, но не удалось сохранить сопоставление в проекте.')
    }
  }

  const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  const coordinateTransform = async (): Promise<((point: { x: number; y: number }) => { x: number; y: number }) | null> => {
    if (georefMode === 'none') return (point) => ({ x: point.x, y: point.y })
    if (georefMode === 'points') {
      const values = CP_KEYS.map((key) => num(cp[key]))
      if (values.some((value) => !Number.isFinite(value))) {
        setNotice('georefError')
        return null
      }
      try {
        const transform = similarityTransform(
          { from: { x: values[0], y: values[1] }, to: { x: values[2], y: values[3] } },
          { from: { x: values[4], y: values[5] }, to: { x: values[6], y: values[7] } },
        )
        return (point) => transform(point.x, point.y)
      } catch {
        setNotice('georefError')
        return null
      }
    }
    try {
      const proj4 = (await import('proj4')).default
      return (point) => {
        const [lon, lat] = proj4(projString, 'EPSG:4326', [point.x, point.y])
        const local = lonLatToLocal(lon, lat)
        return { x: local.x, y: local.y }
      }
    } catch {
      setNotice('georefError')
      return null
    }
  }

  const run = async () => {
    if (!parsed || !source || busy) return
    setBusy(true)
    setNotice(null)
    setConstraintReport(null)
    try {
      await afterPaint()
      let segments: ImportSegment[] =
        parsed.kind === 'dxf'
          ? parsed.data.segments.filter((s) => selectedLayers[s.layer ?? '0'])
          : parsed.segments

      const transform = await coordinateTransform()
      if (!transform) return
      segments = segments.map((segment) => ({
        layer: segment.layer,
        closed: segment.closed,
        sourceType: segment.sourceType,
        sourceHandle: segment.sourceHandle,
        colorNumber: segment.colorNumber,
        lineType: segment.lineType,
        points: segment.points.map(transform),
      }))

      const snap = num(tolerance)
      const { network, report: importReport } = importNetwork(
        segments,
        buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })),
        { x: source.x, y: source.y },
        points,
        { snapToleranceM: Number.isFinite(snap) && snap > 0 ? snap : 0.5 },
      )
      if (network.pipes.length === 0) {
        setReport(importReport)
        setNotice('error')
        return
      }
      await replaceNetwork(projectId, network)
      setReport(importReport)
      setNotice('done')
      await onChanged()
    } catch {
      setNotice('error')
    } finally {
      setBusy(false)
    }
  }

  const runConstrained = async () => {
    if (!parsed || parsed.kind !== 'dxf' || !source || busy) return
    setBusy(true)
    setNotice(null)
    setReport(null)
    setConstraintReport(null)
    try {
      await afterPaint()
      const transform = await coordinateTransform()
      if (!transform) return
      const primaryCorridor = parsed.constraints.corridorRings[0]
      const mapSegments = (segments: ImportSegment[]) => segments.map((segment) => ({
        layer: segment.layer,
        sourceType: segment.sourceType,
        sourceHandle: segment.sourceHandle,
        colorNumber: segment.colorNumber,
        lineType: segment.lineType,
        points: segment.points.map(transform),
      }))
      const dxfSurvey = parsed.constraints.surveyPoints.map((point) => ({ ...transform(point), z: point.z }))
      const corridorRings = parsed.constraints.corridorRings.map((ring) => ring.map(transform))
      const routeConstraints = {
        corridorRings,
        guideLines: mapSegments(parsed.constraints.guideAxis),
        georeference: georefMode === 'none'
          ? { kind: 'unreferenced' as const, source: 'DWG импортирован без геопривязки' }
          : { kind: 'local_anchor' as const, source: georefMode === 'proj4' ? `proj4: ${projString}` : 'две контрольные точки пользователя' },
        redLines: mapSegments(parsed.constraints.redLines),
        utilityLines: mapSegments(parsed.constraints.utilityLines),
        roadLines: mapSegments([...parsed.constraints.roadLines, ...parsed.constraints.railwayLines]),
        waterLines: mapSegments(parsed.constraints.hydrography),
        waterRings: parsed.constraints.hydrography
          .filter((segment) => segment.closed && segment.points.length >= 4)
          .map((segment) => segment.points.map(transform)),
        hardObstacleRings: parsed.constraints.buildingFootprints.map((ring) => ring.map(transform)),
        forbiddenRings: parsed.constraints.forbiddenZoneRings.map((ring) => ring.map(transform)),
        parcelRings: parsed.constraints.parcelRings.map((ring) => ring.map(transform)),
        protectionZoneRings: parsed.constraints.protectionZoneRings.map((ring) => ring.map(transform)),
        approvedCrossingRings: parsed.constraints.approvedCrossingRings.map((ring) => ring.map(transform)),
        surveyPoints: dxfSurvey.length > 0 ? dxfSurvey : points,
        unresolvedLayers: Object.entries(parsed.constraints.roles)
          .filter(([, role]) => role === 'unknown')
          .map(([name]) => name),
        sourceDeclarations: {
          buildings: parsed.constraints.buildingFootprints.length > 0 ? 'present' as const : confirmedAbsent.buildings ? 'confirmed_absent' as const : 'unknown' as const,
          utilities: parsed.constraints.utilityLines.length > 0 ? 'present' as const : confirmedAbsent.utilities ? 'confirmed_absent' as const : 'unknown' as const,
          roads: parsed.constraints.roadLines.length + parsed.constraints.railwayLines.length > 0 ? 'present' as const : confirmedAbsent.roads ? 'confirmed_absent' as const : 'unknown' as const,
          hydrography: parsed.constraints.hydrography.length > 0 ? 'present' as const : confirmedAbsent.hydrography ? 'confirmed_absent' as const : 'unknown' as const,
          parcels: parsed.constraints.parcelRings.length > 0 ? 'present' as const : confirmedAbsent.parcels ? 'confirmed_absent' as const : 'unknown' as const,
          protectionZones: parsed.constraints.protectionZoneRings.length + parsed.constraints.forbiddenZoneRings.length > 0 ? 'present' as const : confirmedAbsent.protectionZones ? 'confirmed_absent' as const : 'unknown' as const,
        },
      }

      if (systemType !== 'water') {
        const localLns = { x: num(lnsX), y: num(lnsY), designFlowLps: num(lnsFlow) }
        if (![localLns.x, localLns.y, localLns.designFlowLps].every(Number.isFinite)) {
          setRouteBlockers(['Стоп-фактор: задайте координаты X/Y и расчётный расход ЛНС.'])
          setNotice('error')
          return
        }
        const running = runEngineeringRouteInWorker({
          facilities: buildings.map((building) => ({
            id: building.label ?? building.id,
            label: building.label ?? building.id,
            buildingId: building.id,
            x: building.x,
            y: building.y,
            designFlowLps: building.design_flow_lps ?? building.specific_demand_lpd ?? 0,
          })),
          lns: { id: 'LNS', label: 'ЛНС', ...localLns },
          outlet: { id: 'OUTLET', label: 'Оголовок / выпуск', x: source.x, y: source.y },
          constraints: routeConstraints,
          options: { gridSizeM: 15 },
          sourceSurveyPointCount: parsed.constraints.surveyPoints.length,
          pumpHeadM: null,
        }, setRoutingStage)
        routeCancelRef.current = running.cancel
        const engineering = await running.promise
        setConstraintReport(engineering.reports.gravity)
        setRouteBlockers(engineering.blockers.map((blocker) => blocker.message))
        await saveDataset(projectId, 'route_constraints', {
          ...routeConstraints,
          lns: localLns,
          completeness: routeConstraints.unresolvedLayers.length > 0 ? 'blocked-unresolved-layers' : 'reviewed-dxf-classification',
        }, {
          roles: parsed.constraints.roles,
          rejectedSurveyPoints: parsed.constraints.rejectedSurveyPoints,
          sourceLayers: parsed.data.layers,
          drawingMetadata: parsed.data.metadata,
        }, fromDwg ? 'converted-from-dwg.dxf' : 'source.dxf')
        await saveDataset(projectId, 'route_audit', {
          layers: parsed.data.layers,
          roles: parsed.constraints.roles,
          counts: {
            corridorRings: corridorRings.length,
            redLines: routeConstraints.redLines.length,
            utilities: routeConstraints.utilityLines.length,
            roads: routeConstraints.roadLines.length,
            hydrography: routeConstraints.waterLines.length,
            buildings: routeConstraints.hardObstacleRings.length,
            protectionZones: routeConstraints.protectionZoneRings.length,
            approvedCrossings: routeConstraints.approvedCrossingRings.length,
            parcels: routeConstraints.parcelRings.length,
            surveyPoints: routeConstraints.surveyPoints.length,
          },
          unresolved: {
            layers: routeConstraints.unresolvedLayers.length,
            names: routeConstraints.unresolvedLayers,
            reason: routeConstraints.unresolvedLayers.length > 0 ? 'Требуется ручное сопоставление роли либо явное подтверждение, что слой не инженерный.' : null,
          },
          drawingMetadata: parsed.data.metadata,
        })
        const inputHash = await routeInputHash({
          facilities: buildings.map(({ id, x, y, design_flow_lps }) => ({ id, x, y, design_flow_lps })),
          lns: localLns,
          outlet: source,
          constraints: routeConstraints,
        })
        if (primaryCorridor) await replaceRightOfWay(projectId, primaryCorridor.map(transform), 'Инженерный коридор из загруженного DWG')
        await replaceNetwork(projectId, engineering.network, {
          status: engineering.status,
          algorithmVersion: engineering.algorithmVersion,
          inputHash,
          warnings: engineering.warnings,
          blockers: engineering.blockers,
          report: {
            ...engineering.reports,
            surveyCoverage: engineering.surveyCoverage,
            quality: {
              totalLengthM: engineering.network.totalLengthM,
              routedTerminals: engineering.reports.gravity.routedTerminals + engineering.reports.pressure.routedTerminals,
              outsideCorridorSegments: engineering.reports.gravity.outsideCorridorSegments + engineering.reports.pressure.outsideCorridorSegments,
            },
          },
        })
        setNotice(engineering.status === 'blocked' ? 'error' : 'done')
        await onChanged()
        return
      }
      const route = traceConstrainedNetwork(
        buildings.map((building) => ({
          id: building.label ?? building.id,
          buildingId: building.id,
          x: building.x,
          y: building.y,
        })),
        { x: source.x, y: source.y },
        routeConstraints,
        { gridSizeM: 15 },
      )
      setConstraintReport(route.report)
      if (route.network.pipes.length === 0 || route.report.routedTerminals === 0) {
        setNotice('error')
        return
      }
      await replaceNetwork(projectId, route.network)
      if (primaryCorridor) await replaceRightOfWay(projectId, primaryCorridor.map(transform), 'Инженерный коридор из загруженного DWG')
      setNotice('done')
      await onChanged()
    } catch {
      setNotice('error')
    } finally {
      routeCancelRef.current = null
      setRoutingStage(null)
      setBusy(false)
    }
  }

  const setCpField = (key: CpKey) => (e: ChangeEvent<HTMLInputElement>) =>
    setCp((prev) => ({ ...prev, [key]: e.target.value }))

  const persistedLengthM = existingPipes.reduce((sum, pipe) => sum + (pipe.length_m ?? 0), 0)

  return (
    <Panel title={t('project.import.title')} status={(report && notice === 'done') || existingPipes.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.import.hint')}</p>
      {!canImport && <p className="stat-line warn">{t('project.import.needSource')}</p>}
      {existingPipes.length > 0 && !report && (
        <p className="stat-line ok">
          Загружена трасса: {existingNodes} узлов, {existingPipes.length} участков, {Math.round(persistedLengthM)} м
        </p>
      )}
      <div className="section-actions">
        <input
          className="file-input"
          type="file"
          accept=".dxf,.dwg,.geojson,.json"
          disabled={!canImport}
          onChange={(e) => void onFile(e)}
        />
      </div>

      {fromDwg && parsed && <p className="stat-line ok">{t('upload.convertedFromDwg')}</p>}
      {parsed?.kind === 'dxf' && (
        <div style={{ marginTop: 16 }}>
          <p className="field-label">Распознано в исходном чертеже</p>
          <p className="stat-line">
            Инженерный коридор: {parsed.constraints.corridorRings.length > 0 ? 'найден' : 'не найден'} ·
            {' '}красные линии: {parsed.constraints.redLines.length} · коммуникации: {parsed.constraints.utilityLines.length} ·
            {' '}дороги: {parsed.constraints.roadLines.length} · гидрография: {parsed.constraints.hydrography.length} ·
            {' '}здания/сооружения: {parsed.constraints.buildingFootprints.length} · охранные зоны: {parsed.constraints.protectionZoneRings.length} ·
            {' '}высотные точки: {parsed.constraints.surveyPoints.length}
          </p>
          <p className="stat-line">
            Единицы DWG: {parsed.data.metadata?.insertionUnits ?? 'не указаны'} ·
            {' '}нераспознанных слоёв: {Object.values(parsed.constraints.roles).filter((role) => role === 'unknown').length}.
          </p>
          <details open={Object.values(parsed.constraints.roles).some((role) => role === 'unknown')} style={{ marginTop: 12 }}>
            <summary className="field-label">Сопоставление всех слоёв DWG</summary>
            <p className="hint">Каждому неизвестному слою назначьте инженерную роль либо явно выберите «не инженерный слой». Пока остаются неизвестные слои, расчёт будет BLOCKED.</p>
            <div className="table-wrap" style={{ maxHeight: 360 }}><table className="data-table"><thead><tr><th>Слой</th><th>Роль</th><th className="num">Линий</th><th className="num">Точек</th><th>Признаки</th></tr></thead><tbody>
              {parsed.data.layers.map((layer) => <tr key={layer.name}>
                <td className="mono">{layer.name}</td>
                <td><select className="input input-sm" value={layerRoles[layer.name] ?? parsed.constraints.roles[layer.name] ?? 'unknown'} onChange={(event) => void setLayerRole(layer.name, event.target.value as DxfLayerRole)}>{ROLE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></td>
                <td className="num">{layer.segments}</td><td className="num">{layer.points}</td>
                <td>{[
                  ...Object.entries(layer.entityTypes ?? {}).map(([kind, count]) => `${kind}: ${count}`),
                  ...(layer.textSamples ?? []).slice(0, 3).map((sample) => `«${sample}»`),
                  ...(layer.lineTypes ?? []).map((lineType) => `линия ${lineType}`),
                  ...(layer.colorNumbers ?? []).map((color) => `цвет ${color}`),
                ].join(', ') || '—'}</td>
              </tr>)}
            </tbody></table></div>
          </details>
          <details style={{ marginTop: 12 }}>
            <summary className="field-label">Подтверждение отсутствующих групп исходных данных</summary>
            <p className="hint">Ставьте отметку только после проверки всех слоёв и исходных документов. Это действие записывается в аудит проекта.</p>
            {([
              ['buildings', 'Здания и сооружения', parsed.constraints.buildingFootprints.length],
              ['utilities', 'Существующие коммуникации', parsed.constraints.utilityLines.length],
              ['roads', 'Автомобильные и железные дороги', parsed.constraints.roadLines.length + parsed.constraints.railwayLines.length],
              ['hydrography', 'Водные объекты и гидрография', parsed.constraints.hydrography.length],
              ['parcels', 'Земельные участки и сервитуты', parsed.constraints.parcelRings.length],
              ['protectionZones', 'Охранные и запрещённые зоны', parsed.constraints.protectionZoneRings.length + parsed.constraints.forbiddenZoneRings.length],
            ] as Array<[SourceConfirmationKey, string, number]>).filter(([, , count]) => count === 0).map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={confirmedAbsent[key]} onChange={(event) => setConfirmedAbsent((previous) => ({ ...previous, [key]: event.target.checked }))} /><span>Проверено: «{label}» действительно отсутствуют в пределах проектирования</span></label>)}
          </details>
          {parsed.constraints.rejectedSurveyPoints > 0 && (
            <p className="stat-line warn">Отброшено аномальных высотных отметок: {parsed.constraints.rejectedSurveyPoints}</p>
          )}
          {parsed.constraints.buildingFootprints.length === 0 && (
            <p className="notice error">Стоп-фактор финального выпуска: в DWG не распознаны замкнутые контуры зданий и сооружений. Неизвестные слои сохранены в аудите, но не используются как препятствия автоматически.</p>
          )}
          {parsed.constraints.corridorRings.length === 0 && (
            <p className="notice error">Стоп-фактор: в DWG нет замкнутого слоя инженерного коридора. Автоматическая трасса не строится.</p>
          )}
          <div className="section-actions">
              {systemType !== 'water' && (
                <div className="form-grid" style={{ width: '100%', marginBottom: 12 }}>
                  <label className="field"><span className="field-label">ЛНС X, м</span><input className="input" inputMode="decimal" value={lnsX} onChange={(event) => setLnsX(event.target.value)} /></label>
                  <label className="field"><span className="field-label">ЛНС Y, м</span><input className="input" inputMode="decimal" value={lnsY} onChange={(event) => setLnsY(event.target.value)} /></label>
                  <label className="field"><span className="field-label">Расчётный расход ЛНС, л/с</span><input className="input" inputMode="decimal" value={lnsFlow} onChange={(event) => setLnsFlow(event.target.value)} /></label>
                </div>
              )}
              <button
                type="button"
                className={`btn btn-sm${busy ? ' is-loading' : ''}`}
                disabled={busy || !canImport}
                onClick={() => void runConstrained()}
              >
                {busy && <span className="button-spinner" aria-hidden="true" />}
                {busy ? 'Проверка ограничений и поиск трассы…' : 'Построить трассу по генплану и ограничениям'}
              </button>
              {busy && systemType !== 'water' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => routeCancelRef.current?.()}>Отменить</button>}
          </div>
          <details style={{ marginTop: 16 }}>
            <summary className="field-label">Ручной импорт уже готовой оси по выбранным слоям</summary>
            <p className="hint">Этот режим не проектирует трассу, а переносит готовые полилинии. Слои коридора, рельефа и коммуникаций исключены по умолчанию.</p>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflow: 'auto' }}>
              {parsed.data.layers
                .filter((layer) => layer.segments > 0 && ['candidateRoute', 'unknown'].includes(parsed.constraints.roles[layer.name]))
                .map((layer) => (
                  <label className="check" key={layer.name}>
                    <input
                      type="checkbox"
                      checked={selectedLayers[layer.name] ?? false}
                      onChange={(event) =>
                        setSelectedLayers((prev) => ({ ...prev, [layer.name]: event.target.checked }))
                      }
                    />
                    <span className="mono" style={{ fontSize: 13 }}>
                      {layer.name} · {layer.segments}
                    </span>
                  </label>
                ))}
            </div>
          </details>
        </div>
      )}
      {parsed?.kind === 'geojson' && (
        <p className="stat-line">
          {t('project.import.parsedGeojson', { segments: parsed.segments.length })}
          {parsed.treatedAsLonLat ? ` ${t('project.import.lonlat')}` : ''}
        </p>
      )}

      {parsed && (
        <>
          <div className="form-grid" style={{ maxWidth: 560 }}>
            <label className="field">
              <span className="field-label">{t('project.import.tolerance')}</span>
              <input className="input" inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('project.import.georef')}</span>
              <select
                className="input"
                value={georefMode}
                onChange={(e) => setGeorefMode(e.target.value as GeorefMode)}
              >
                <option value="none">{t('project.import.georefNone')}</option>
                <option value="points">{t('project.import.georefPoints')}</option>
                <option value="proj4">{t('project.import.georefProj')}</option>
              </select>
            </label>
          </div>

          {georefMode === 'proj4' && (
            <label className="field" style={{ maxWidth: 560 }}>
              <span className="field-label">proj4</span>
              <input
                className="input mono"
                value={projString}
                onChange={(e) => setProjString(e.target.value)}
                placeholder="+proj=tmerc +lat_0=0 +lon_0=71.5 ..."
              />
            </label>
          )}
          {georefMode === 'points' && (
            <div style={{ marginTop: 16 }}>
              {([0, 1] as const).map((row) => (
                <div className="add-row" key={row} style={{ marginTop: row === 0 ? 0 : 8 }}>
                  <span className="stat-line" style={{ marginTop: 8, minWidth: 150 }}>
                    {t('project.import.controlPoint', { n: row + 1 })}
                  </span>
                  {(row === 0
                    ? (['ax', 'ay', 'AX', 'AY'] as CpKey[])
                    : (['bx', 'by', 'BX', 'BY'] as CpKey[])
                  ).map((key, i) => (
                    <input
                      key={key}
                      className="input input-sm"
                      inputMode="decimal"
                      placeholder={
                        i < 2
                          ? `${t('project.import.drawing')} ${i === 0 ? 'X' : 'Y'}`
                          : `${t('project.import.local')} ${i === 2 ? 'X' : 'Y'}`
                      }
                      value={cp[key]}
                      onChange={setCpField(key)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="section-actions">
            {(parsed.kind !== 'dxf' || Object.values(selectedLayers).some(Boolean)) && (
            <button type="button" className={`btn btn-sm${busy ? ' is-loading' : ''}`} disabled={busy || !canImport} onClick={() => void run()}>
              {busy && <span className="button-spinner" aria-hidden="true" />}
              {busy ? 'Обработка…' : t('project.import.run')}
            </button>
            )}
            {notice === 'done' && <span className="stat-line ok">{t('project.import.done')}</span>}
          </div>
        </>
      )}

      {uploadMessage && <p className="notice error">{uploadMessage}</p>}
      {notice === 'invalid' && <p className="notice error">{t('project.import.invalid')}</p>}
      {notice === 'georefError' && <p className="notice error">{t('project.import.georefInvalid')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.import.error')}</p>}

      {constraintReport && (
        <div style={{ marginTop: 16 }}>
          <p className={constraintReport.ok ? 'stat-line ok' : 'stat-line warn'}>
            Проложено подключений: {constraintReport.routedTerminals}; расчётных ячеек: {constraintReport.evaluatedCells};
            {' '}шаг сетки: {constraintReport.gridSizeM} м.
          </p>
          <p className="stat-line">
            Пересечения: красные линии — {constraintReport.redLineCrossings}, коммуникации — {constraintReport.utilityCrossings},
            {' '}дороги — {constraintReport.roadCrossings}, водные объекты — {constraintReport.waterCrossings};
            {' '}участки вне коридора — {constraintReport.outsideCorridorSegments}.
          </p>
          {constraintReport.warnings.map((warning) => <p className="stat-line warn" key={warning}>{warning}</p>)}
        </div>
      )}
      {routeBlockers.map((blocker) => <p className="notice error" key={blocker}>{blocker}</p>)}
      {routingStage && (
        <div className="export-progress" role="status" aria-live="polite">
          <span className="export-progress-spinner" aria-hidden="true" />
          <div className="export-progress-copy"><strong>{routingStage}</strong><span>Прошло {routeElapsedSeconds} с. Расчёт выполняется в отдельном рабочем потоке.</span></div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => routeCancelRef.current?.()}>Отменить</button>
          <span className="export-progress-bar" aria-hidden="true"><i /></span>
        </div>
      )}

      {report && (
        <div style={{ marginTop: 16 }}>
          <p className="stat-line">
            {t('project.import.report.summary', {
              nodes: report.nodes,
              pipes: report.pipes,
              length: Math.round(report.totalLengthM),
            })}
          </p>
          {report.snappedVertices > 0 && (
            <p className="stat-line">{t('project.import.report.snapped', { count: report.snappedVertices })}</p>
          )}
          {report.duplicatesRemoved > 0 && (
            <p className="stat-line warn">{t('project.import.report.duplicates', { count: report.duplicatesRemoved })}</p>
          )}
          {report.zeroLengthRemoved > 0 && (
            <p className="stat-line warn">{t('project.import.report.zero', { count: report.zeroLengthRemoved })}</p>
          )}
          {report.selfIntersections > 0 && (
            <p className="stat-line warn">{t('project.import.report.selfIntersections', { count: report.selfIntersections })}</p>
          )}
          {report.crossingsWithoutNode > 0 && (
            <p className="stat-line warn">{t('project.import.report.crossings', { count: report.crossingsWithoutNode })}</p>
          )}
          {(report.unreachableNodes.length > 0 || report.unreachablePipes > 0) && (
            <p className="stat-line warn">
              {t('project.import.report.unreachable', {
                nodes: report.unreachableNodes.length,
                pipes: report.unreachablePipes,
              })}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}
