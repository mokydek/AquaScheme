import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { importNetwork, lonLatToLocal, parseGeoJsonNetwork, similarityTransform, traceConstrainedNetwork } from '@aquascheme/engine'
import type { ConstrainedRouteReport, ImportReport, ImportSegment, SurveyPoint } from '@aquascheme/engine'
import type { DxfConstraintData, DxfNetworkData } from '@aquascheme/engine/dxfread'
import { replaceNetwork } from '../../shared/network'
import { replaceRightOfWay } from '../../shared/parcels'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import type { BuildingRow } from '../../shared/datasets'
import type { PipeRow } from '../../shared/network'
import type { SourceData } from '../../shared/datasets'
import { Panel } from './Panel'

type Parsed =
  | { kind: 'dxf'; data: DxfNetworkData; constraints: DxfConstraintData }
  | { kind: 'geojson'; segments: ImportSegment[]; treatedAsLonLat: boolean }

type GeorefMode = 'none' | 'points' | 'proj4'

const CP_KEYS = ['ax', 'ay', 'AX', 'AY', 'bx', 'by', 'BX', 'BY'] as const
type CpKey = (typeof CP_KEYS)[number]

export function ImportSection({
  projectId,
  buildings,
  source,
  points,
  existingNodes,
  existingPipes,
  onChanged,
}: {
  projectId: string
  buildings: BuildingRow[]
  source: SourceData | null
  points: SurveyPoint[]
  existingNodes: number
  existingPipes: PipeRow[]
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [selectedLayers, setSelectedLayers] = useState<Record<string, boolean>>({})
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

  const canImport = source !== null

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setNotice(null)
    setUploadMessage(null)
    setReport(null)
    setConstraintReport(null)
    setParsed(null)
    setFromDwg(false)
    try {
      const routed = await routeUpload(file, ['dxf', 'geojson'])
      if (routed.kind === 'dxf') {
        const { classifyDxfConstraints, parseDxfNetwork } = await import('@aquascheme/engine/dxfread')
        const data = parseDxfNetwork(routed.text ?? '')
        if (!data.ok || data.segments.length === 0) {
          setNotice('invalid')
        } else {
          const constraints = classifyDxfConstraints(data)
          setParsed({ kind: 'dxf', data, constraints })
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
      if (!primaryCorridor || buildings.length === 0) {
        setNotice('error')
        return
      }
      const mapSegments = (segments: ImportSegment[]) => segments.map((segment) => ({
        layer: segment.layer,
        points: segment.points.map(transform),
      }))
      const dxfSurvey = parsed.constraints.surveyPoints.map((point) => ({ ...transform(point), z: point.z }))
      const route = traceConstrainedNetwork(
        buildings.map((building) => ({
          id: building.label ?? building.id,
          buildingId: building.id,
          x: building.x,
          y: building.y,
        })),
        { x: source.x, y: source.y },
        {
          corridorRings: [primaryCorridor.map(transform)],
          redLines: mapSegments(parsed.constraints.redLines),
          utilityLines: mapSegments(parsed.constraints.utilityLines),
          roadLines: mapSegments(parsed.constraints.roadLines),
          waterLines: mapSegments(parsed.constraints.hydrography),
          surveyPoints: dxfSurvey.length > 0 ? dxfSurvey : points,
        },
        { gridSizeM: 15 },
      )
      setConstraintReport(route.report)
      if (route.network.pipes.length === 0 || route.report.routedTerminals === 0) {
        setNotice('error')
        return
      }
      await replaceNetwork(projectId, route.network)
      await replaceRightOfWay(projectId, primaryCorridor.map(transform), 'Инженерный коридор из загруженного DWG')
      setNotice('done')
      await onChanged()
    } catch {
      setNotice('error')
    } finally {
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
            {' '}высотные точки: {parsed.constraints.surveyPoints.length}
          </p>
          {parsed.constraints.rejectedSurveyPoints > 0 && (
            <p className="stat-line warn">Отброшено аномальных высотных отметок: {parsed.constraints.rejectedSurveyPoints}</p>
          )}
          {parsed.constraints.corridorRings.length === 0 ? (
            <p className="notice error">Стоп-фактор: в DWG нет замкнутого слоя инженерного коридора. Автоматическая трасса не строится.</p>
          ) : (
            <div className="section-actions">
              <button
                type="button"
                className={`btn btn-sm${busy ? ' is-loading' : ''}`}
                disabled={busy || !canImport}
                onClick={() => void runConstrained()}
              >
                {busy && <span className="button-spinner" aria-hidden="true" />}
                {busy ? 'Проверка ограничений и поиск трассы…' : 'Построить трассу по генплану и ограничениям'}
              </button>
            </div>
          )}
          <details style={{ marginTop: 16 }}>
            <summary className="field-label">Ручной импорт уже готовой оси по выбранным слоям</summary>
            <p className="hint">Этот режим не проектирует трассу, а переносит готовые полилинии. Слои коридора, рельефа и коммуникаций исключены по умолчанию.</p>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflow: 'auto' }}>
              {parsed.data.layers
                .filter((layer) => layer.segments > 0 && ['candidateRoute', 'other'].includes(parsed.constraints.roles[layer.name]))
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
