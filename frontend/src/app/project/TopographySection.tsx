import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { parseTopographyCsv, parseTopographyGeoJson } from '@aquascheme/engine'
import type { TopoParseResult } from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import { Panel } from './Panel'

interface TopoMeta {
  total?: number
  accepted?: number
  zMin?: number
  zMax?: number
}

/**
 * Какую поверхность описывает загружаемый файл.
 *
 * Разбор у обеих одинаковый — точки x, y, z, — а смысл разный: съёмка
 * измерена, планировка назначена проектом, и глубины заложения считаются от
 * второй. Поэтому выбор явный, а не по имени файла.
 */
type Surface = 'existing' | 'design'

export function TopographySection({
  projectId,
  dataset,
  verticalPlanDataset,
  onSaved,
}: {
  projectId: string
  dataset: DatasetRow | undefined
  /** Проектные отметки вертикальной планировки, если загружены. */
  verticalPlanDataset?: DatasetRow | undefined
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [result, setResult] = useState<TopoParseResult | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'saveError' | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [surface, setSurface] = useState<Surface>('existing')

  const meta = ((surface === 'design' ? verticalPlanDataset : dataset)?.meta ?? null) as TopoMeta | null

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setNotice(null)
    setUploadMessage(null)
    try {
      const routed = await routeUpload(file, ['csv', 'geojson', 'dxf'])
      if (routed.kind === 'dxf') {
        const { parseTopographyDxf } = await import('@aquascheme/engine/dxfread')
        setResult(parseTopographyDxf(routed.text ?? ''))
      } else if (routed.kind === 'geojson') {
        setResult(parseTopographyGeoJson(routed.text ?? ''))
      } else {
        setResult(parseTopographyCsv(routed.text ?? ''))
      }
      setFileName(file.name)
    } catch (error) {
      const message = uploadErrorText(t, error)
      setUploadMessage(message ?? t('upload.unknown'))
      setResult(null)
    } finally {
      event.target.value = ''
    }
  }

  const issueCounts = result
    ? (['missingZ', 'badNumber', 'badColumns', 'invalidFormat'] as const)
        .map((kind) => ({ kind, count: result.issues.filter((i) => i.kind === kind).length }))
        .filter((entry) => entry.count > 0)
    : []

  const save = async () => {
    if (!result || result.points.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      const zs = result.points.map((p) => p.z)
      await saveDataset(
        projectId,
        surface === 'design' ? 'vertical_plan' : 'topography',
        { points: result.points },
        {
          total: result.total,
          accepted: result.points.length,
          zMin: Math.min(...zs),
          zMax: Math.max(...zs),
        },
        fileName,
      )
      setResult(null)
      setNotice('saved')
      await onSaved()
    } catch {
      setNotice('saveError')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel anchor="topography" title={t('project.topo.title')} status={dataset ? 'filled' : 'empty'}>
      <p className="hint">{t('project.topo.hint')}</p>
      {meta && (
        <p className="stat-line">
          {t('project.topo.stats', {
            count: meta.accepted ?? 0,
            min: (meta.zMin ?? 0).toFixed(2),
            max: (meta.zMax ?? 0).toFixed(2),
          })}
        </p>
      )}
      {/*
        Разбор у съёмки и у вертикальной планировки один, а поверхности разные:
        первая измерена, вторая назначена проектом. Определять её по имени файла
        нельзя — от выбора зависит, от чего считаются глубины заложения.
      */}
      <div className="form-grid">
        <label className="field" htmlFor={`topography-${projectId}-surface`}>
          <span className="field-label">{t('project.topo.surfaceLabel')}</span>
          <select
            id={`topography-${projectId}-surface`}
            name={`topography-${projectId}-surface`}
            className="input"
            value={surface}
            onChange={(event) => setSurface(event.target.value as Surface)}
          >
            <option value="existing">{t('project.topo.surfaceExisting')}</option>
            <option value="design">{t('project.topo.surfaceDesign')}</option>
          </select>
        </label>
      </div>
      <div className="section-actions">
        <input
          id={`topography-${projectId}-file`}
          name={`topography-${projectId}-file`}
          className="file-input"
          type="file"
          accept=".csv,.txt,.json,.geojson,.dxf,.dwg"
          aria-label={`${t('project.topo.title')}: CSV/GeoJSON/DXF/DWG`}
          onChange={(e) => void onFile(e)}
        />
      </div>
      {uploadMessage && <p className="notice error">{uploadMessage}</p>}
      {result && (
        <div className="parse-report">
          <p className="stat-line">
            {result.points.length === 0
              ? t('project.topo.empty')
              : t('project.topo.parsed', { count: result.points.length, total: result.total })}
          </p>
          {issueCounts.map(({ kind, count }) => (
            <p className="stat-line warn" key={kind}>
              {t(`project.topo.${kind}`, { count })}
            </p>
          ))}
          <div className="section-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || result.points.length === 0}
              onClick={() => void save()}
            >
              {t('project.save')}
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className={`notice ${notice === 'saved' ? 'info' : 'error'}`}>
          {t(`project.${notice}`)}
        </p>
      )}
    </Panel>
  )
}
