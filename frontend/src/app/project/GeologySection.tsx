import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_FREEZING_DEPTH_M,
  GEOLOGY_TEMPLATE_EXAMPLE,
  GEOLOGY_TEMPLATE_HEADERS,
  parseGeologyRows,
  summarizeGeology,
} from '@aquascheme/engine'
import type { Aggressiveness, Borehole, GeologyIssue } from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { replaceGeology } from '../../shared/geology'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import { Panel } from './Panel'

type SoilType = 'sand' | 'loam' | 'clay' | 'rock'
type Corrosivity = 'low' | 'medium' | 'high'
type SubsidenceType = '' | 'I' | 'II'

interface GeologyContent {
  soilType: SoilType
  groundwaterDepthM: number
  corrosivity: Corrosivity
  freezingDepthM: number
  subsidenceType?: 'I' | 'II' | null
  heaving?: boolean
  swelling?: boolean
}

const AGGRESSIVENESS_LABEL: Record<Aggressiveness, string> = { low: 'low', medium: 'medium', high: 'high' }

export function GeologySection({
  projectId,
  dataset,
  boreholes,
  onChanged,
}: {
  projectId: string
  dataset: DatasetRow | undefined
  boreholes: Borehole[]
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const content = (dataset?.content ?? null) as GeologyContent | null

  const [busy, setBusy] = useState(false)
  const [issues, setIssues] = useState<GeologyIssue[]>([])
  const [notice, setNotice] = useState<'imported' | 'empty' | 'saved' | 'error' | 'migrationNeeded' | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)

  // Summary form (GeologyInput + project attributes) persisted to the dataset.
  const [soilType, setSoilType] = useState<SoilType>(content?.soilType ?? 'loam')
  const [groundwater, setGroundwater] = useState(String(content?.groundwaterDepthM ?? ''))
  const [corrosivity, setCorrosivity] = useState<Corrosivity>(content?.corrosivity ?? 'medium')
  const [freezing, setFreezing] = useState(String(content?.freezingDepthM ?? DEFAULT_FREEZING_DEPTH_M))
  const [subsidence, setSubsidence] = useState<SubsidenceType>(content?.subsidenceType ?? '')
  const [heaving, setHeaving] = useState(Boolean(content?.heaving))
  const [swelling, setSwelling] = useState(Boolean(content?.swelling))

  useEffect(() => {
    setSoilType(content?.soilType ?? 'loam')
    setGroundwater(String(content?.groundwaterDepthM ?? ''))
    setCorrosivity(content?.corrosivity ?? 'medium')
    setFreezing(String(content?.freezingDepthM ?? DEFAULT_FREEZING_DEPTH_M))
    setSubsidence(content?.subsidenceType ?? '')
    setHeaving(Boolean(content?.heaving))
    setSwelling(Boolean(content?.swelling))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.id, dataset?.content])

  const summary = summarizeGeology({ boreholes })

  const failNotice = (error: unknown) => {
    const code = (error as { code?: string } | null)?.code
    setNotice(code === '23514' ? 'migrationNeeded' : 'error')
  }

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.json_to_sheet(GEOLOGY_TEMPLATE_EXAMPLE, { header: [...GEOLOGY_TEMPLATE_HEADERS] })
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Геология')
    XLSX.writeFile(book, 'aquascheme_geology_template.xlsx')
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setNotice(null)
    setUploadMessage(null)
    setIssues([])
    try {
      const routed = await routeUpload(file, ['xlsx', 'csv'])
      const XLSX = await import('xlsx')
      const book = XLSX.read(await routed.file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: '' })
      const parsed = parseGeologyRows(rows)
      setIssues(parsed.issues)
      if (parsed.boreholes.length === 0) {
        setNotice('empty')
        return
      }
      await replaceGeology(projectId, parsed.boreholes)
      // Prefill the summary groundwater from the shallowest reported water.
      const geoSummary = summarizeGeology({ boreholes: parsed.boreholes })
      if (geoSummary.minWaterDepthM !== null) setGroundwater(String(geoSummary.minWaterDepthM))
      if (geoSummary.maxAggressiveness) setCorrosivity(geoSummary.maxAggressiveness)
      setNotice('imported')
      await onChanged()
    } catch (error) {
      const message = uploadErrorText(t, error)
      if (message) setUploadMessage(message)
      else failNotice(error)
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const saveSummary = async () => {
    const gw = Number(groundwater.replace(',', '.'))
    const fz = Number(freezing.replace(',', '.'))
    if (!Number.isFinite(gw) || !Number.isFinite(fz)) {
      setNotice('error')
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      await saveDataset(projectId, 'geology', {
        soilType,
        groundwaterDepthM: gw,
        corrosivity,
        freezingDepthM: fz,
        subsidenceType: subsidence === '' ? null : subsidence,
        heaving,
        swelling,
      })
      setNotice('saved')
      await onChanged()
    } catch {
      setNotice('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('project.geology.title')} status={dataset || boreholes.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.geology.hint')}</p>

      <div className="section-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadTemplate()}>
          {t('project.geology.template')}
        </button>
        <input className="file-input" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(e) => void onFile(e)} />
      </div>

      {uploadMessage && <p className="notice error">{uploadMessage}</p>}
      {notice === 'imported' && <span className="stat-line ok">{t('project.geology.imported')}</span>}
      {notice === 'empty' && <p className="notice error">{t('project.geology.empty')}</p>}
      {notice === 'migrationNeeded' && <p className="notice error">{t('project.geology.migrationNeeded')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.saveError')}</p>}

      {issues.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="stat-line warn">{t('project.geology.issuesTitle', { count: issues.length })}</p>
          {issues.slice(0, 8).map((issue, i) => (
            <p className="stat-line warn" key={i}>
              {t('project.geology.issueRow', { row: issue.row })}: {t(`project.geology.issue.${issue.code}`)}
            </p>
          ))}
        </div>
      )}

      {boreholes.length > 0 && (
        <>
          <div className="kv-list" style={{ marginTop: 16 }}>
            <div className="kv">
              <span className="kv-label">{t('project.geology.summary.boreholes')}</span>
              <span className="kv-value">{summary.boreholes}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.geology.summary.layers')}</span>
              <span className="kv-value">{summary.layers}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.geology.summary.ige')}</span>
              <span className="kv-value">{summary.igeCodes.join(', ') || '—'}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.geology.summary.water')}</span>
              <span className="kv-value">
                {summary.minWaterDepthM !== null ? summary.minWaterDepthM.toFixed(1) : '—'}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.geology.summary.aggressiveness')}</span>
              <span className="kv-value">
                {summary.maxAggressiveness
                  ? t(`project.geology.corrosivityLevels.${AGGRESSIVENESS_LABEL[summary.maxAggressiveness]}`)
                  : '—'}
              </span>
            </div>
          </div>

          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('project.geology.th.borehole')}</th>
                  <th className="num">X</th>
                  <th className="num">Y</th>
                  <th className="num">{t('project.geology.th.mouth')}</th>
                  <th className="num">{t('project.geology.th.layers')}</th>
                  <th className="num">{t('project.geology.th.water')}</th>
                </tr>
              </thead>
              <tbody>
                {boreholes.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td className="num">{b.x != null ? b.x.toFixed(1) : '—'}</td>
                    <td className="num">{b.y != null ? b.y.toFixed(1) : '—'}</td>
                    <td className="num">{b.mouthElevationM != null ? b.mouthElevationM.toFixed(2) : '—'}</td>
                    <td className="num">{b.layers.length}</td>
                    <td className="num">{b.water.depthM != null ? b.water.depthM.toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('project.geology.th.borehole')}</th>
                  <th>{t('project.geology.th.ige')}</th>
                  <th>{t('project.geology.th.soil')}</th>
                  <th className="num">{t('project.geology.th.top')}</th>
                  <th className="num">{t('project.geology.th.bottom')}</th>
                  <th className="num">{t('project.geology.th.friction')}</th>
                  <th className="num">{t('project.geology.th.cohesion')}</th>
                  <th className="num">{t('project.geology.th.modulus')}</th>
                  <th className="num">{t('project.geology.th.filtration')}</th>
                </tr>
              </thead>
              <tbody>
                {boreholes.flatMap((b) =>
                  b.layers.map((l, i) => (
                    <tr key={`${b.label}-${i}`}>
                      <td>{b.label}</td>
                      <td>{l.igeCode ?? '—'}</td>
                      <td>{l.soilName ?? '—'}</td>
                      <td className="num">{l.topDepthM.toFixed(1)}</td>
                      <td className="num">{l.bottomDepthM.toFixed(1)}</td>
                      <td className="num">{l.frictionAngleDeg != null ? l.frictionAngleDeg : '—'}</td>
                      <td className="num">{l.cohesionKpa != null ? l.cohesionKpa : '—'}</td>
                      <td className="num">{l.deformationModulusMpa != null ? l.deformationModulusMpa : '—'}</td>
                      <td className="num">{l.filtrationMDay != null ? l.filtrationMDay : '—'}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="field-label" style={{ marginTop: 20 }}>
        {t('project.geology.summaryTitle')}
      </p>
      <p className="hint">{t('project.geology.summaryHint')}</p>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t('project.geology.soil')}</span>
          <select className="input" value={soilType} onChange={(e) => setSoilType(e.target.value as SoilType)}>
            {(['sand', 'loam', 'clay', 'rock'] as const).map((soil) => (
              <option key={soil} value={soil}>
                {t(`project.geology.soils.${soil}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.groundwater')}</span>
          <input className="input" inputMode="decimal" value={groundwater} onChange={(e) => setGroundwater(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.corrosivity')}</span>
          <select className="input" value={corrosivity} onChange={(e) => setCorrosivity(e.target.value as Corrosivity)}>
            {(['low', 'medium', 'high'] as const).map((level) => (
              <option key={level} value={level}>
                {t(`project.geology.corrosivityLevels.${level}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.freezing')}</span>
          <input className="input" inputMode="decimal" value={freezing} onChange={(e) => setFreezing(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.subsidence')}</span>
          <select className="input" value={subsidence} onChange={(e) => setSubsidence(e.target.value as SubsidenceType)}>
            <option value="">{t('project.geology.subsidenceNone')}</option>
            <option value="I">{t('project.geology.subsidenceI')}</option>
            <option value="II">{t('project.geology.subsidenceII')}</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={heaving} onChange={(e) => setHeaving(e.target.checked)} />
          <span>{t('project.geology.heaving')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={swelling} onChange={(e) => setSwelling(e.target.checked)} />
          <span>{t('project.geology.swelling')}</span>
        </label>
      </div>
      <div className="section-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void saveSummary()}>
          {t('project.save')}
        </button>
        {notice === 'saved' && <span className="stat-line ok">{t('project.saved')}</span>}
      </div>
    </Panel>
  )
}
