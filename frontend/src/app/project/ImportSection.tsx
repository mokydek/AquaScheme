import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { importNetwork, lonLatToLocal, parseGeoJsonNetwork, similarityTransform } from '@aquascheme/engine'
import type { ImportReport, ImportSegment, SurveyPoint } from '@aquascheme/engine'
import type { DxfNetworkData } from '@aquascheme/engine/dxfread'
import { replaceNetwork } from '../../shared/network'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import type { BuildingRow } from '../../shared/datasets'
import type { PipeRow } from '../../shared/network'
import type { SourceData } from '../../shared/datasets'
import { Panel } from './Panel'

type Parsed =
  | { kind: 'dxf'; data: DxfNetworkData }
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

  const canImport = source !== null

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setNotice(null)
    setUploadMessage(null)
    setReport(null)
    setParsed(null)
    setFromDwg(false)
    try {
      const routed = await routeUpload(file, ['dxf', 'geojson'])
      if (routed.kind === 'dxf') {
        const { parseDxfNetwork } = await import('@aquascheme/engine/dxfread')
        const data = parseDxfNetwork(routed.text ?? '')
        if (!data.ok || data.segments.length === 0) {
          setNotice('invalid')
        } else {
          setParsed({ kind: 'dxf', data })
          setFromDwg(routed.fromDwg === true)
          const selected: Record<string, boolean> = {}
          for (const layer of data.layers) selected[layer.name] = layer.segments > 0
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

  const run = async () => {
    if (!parsed || !source || busy) return
    setBusy(true)
    setNotice(null)
    try {
      let segments: ImportSegment[] =
        parsed.kind === 'dxf'
          ? parsed.data.segments.filter((s) => selectedLayers[s.layer ?? '0'])
          : parsed.segments

      if (georefMode === 'points') {
        const values = CP_KEYS.map((k) => num(cp[k]))
        if (values.some((v) => !Number.isFinite(v))) {
          setNotice('georefError')
          return
        }
        let transform
        try {
          transform = similarityTransform(
            { from: { x: values[0], y: values[1] }, to: { x: values[2], y: values[3] } },
            { from: { x: values[4], y: values[5] }, to: { x: values[6], y: values[7] } },
          )
        } catch {
          setNotice('georefError')
          return
        }
        segments = segments.map((s) => ({
          layer: s.layer,
          points: s.points.map((p) => transform(p.x, p.y)),
        }))
      } else if (georefMode === 'proj4') {
        try {
          const proj4 = (await import('proj4')).default
          const convert = (p: { x: number; y: number }) => {
            const [lon, lat] = proj4(projString, 'EPSG:4326', [p.x, p.y])
            const local = lonLatToLocal(lon, lat)
            return { x: local.x, y: local.y }
          }
          segments = segments.map((s) => ({ layer: s.layer, points: s.points.map(convert) }))
        } catch {
          setNotice('georefError')
          return
        }
      }

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
          <p className="field-label">{t('project.import.layers')}</p>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {parsed.data.layers
              .filter((l) => l.segments > 0)
              .map((layer) => (
                <label className="check" key={layer.name}>
                  <input
                    type="checkbox"
                    checked={selectedLayers[layer.name] ?? false}
                    onChange={(e) =>
                      setSelectedLayers((prev) => ({ ...prev, [layer.name]: e.target.checked }))
                    }
                  />
                  <span className="mono" style={{ fontSize: 13 }}>
                    {layer.name} · {layer.segments}
                  </span>
                </label>
              ))}
          </div>
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
            <button type="button" className="btn btn-sm" disabled={busy || !canImport} onClick={() => void run()}>
              {t('project.import.run')}
            </button>
            {notice === 'done' && <span className="stat-line ok">{t('project.import.done')}</span>}
          </div>
        </>
      )}

      {uploadMessage && <p className="notice error">{uploadMessage}</p>}
      {notice === 'invalid' && <p className="notice error">{t('project.import.invalid')}</p>}
      {notice === 'georefError' && <p className="notice error">{t('project.import.georefInvalid')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.import.error')}</p>}

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
