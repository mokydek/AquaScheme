import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_FREEZING_DEPTH_M,
  extractTable,
  GEOLOGY_TEMPLATE_EXAMPLE,
  GEOLOGY_TEMPLATE_HEADERS,
  guessGeologyField,
  hasTextLayer,
  parseGeologyRows,
  parseGeologyReportSummary,
  summarizeGeology,
} from '@aquascheme/engine'
import type { Aggressiveness, Borehole, GeologyIssue, GeologyReportSummary, TextItem } from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { replaceGeology } from '../../shared/geology'
import { loadPdfTextByPage } from '../../shared/pdfText'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import { GeologyPdfImport } from './GeologyPdfImport'
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
  reportIge?: Array<{ code: string; name: string; openingDepthM?: string; thicknessM?: string }>
  groundwaterRangeM?: { min: number; max: number }
  groundwaterElevationM?: { min: number; max: number }
  groundwaterDesignRiseM?: number
  sourceFile?: string
  sourceArchiveNumber?: string
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
  const [notice, setNotice] = useState<'imported' | 'empty' | 'saved' | 'error' | 'migrationNeeded' | 'scan' | 'pdfError' | 'prose' | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [pdfTable, setPdfTable] = useState<{ grid: string[][]; columnCount: number } | null>(null)
  const [pdfReport, setPdfReport] = useState<GeologyReportSummary | null>(null)

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

  const onPdf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setNotice(null)
    setUploadMessage(null)
    setIssues([])
    setPdfTable(null)
    setPdfReport(null)
    try {
      const routed = await routeUpload(file, ['pdf'])
      const pages = await loadPdfTextByPage(routed.file)
      const items: TextItem[] = pages.flatMap((p) => p.items)
      if (!hasTextLayer(items)) {
        setNotice('scan')
        return
      }

      const fullText = pages.map((page) => page.items.map((item) => item.str).join(' ')).join('\n')
      const report = parseGeologyReportSummary(fullText)
      const hasReportFacts = report.ige.length > 0 || report.groundwater !== null || report.freezingDepthM !== null
      if (hasReportFacts) {
        setPdfReport(report)
        if (report.groundwater) setGroundwater(String(report.groundwater.minDepthM))
        if (report.freezingDepthM !== null) setFreezing(String(report.freezingDepthM))
        if (report.maxAggressiveness) setCorrosivity(report.maxAggressiveness)
      }

      // A multi-page report contains unrelated tables and profile drawings.
      // Only offer the column wizard for a page whose header maps to at least
      // two geology fields; combining every page creates a convincing-looking
      // but unusable mega-table on the real 73-page report.
      const candidates = pages
        .map((page) => {
          const table = extractTable(page.items)
          const known = table.rows[0]?.filter((cell) => guessGeologyField(cell) !== null).length ?? 0
          return { table, known }
        })
        .filter((candidate) => candidate.known >= 2 && candidate.table.rows.length >= 2)
        .sort((a, b) => b.known - a.known || b.table.rows.length - a.table.rows.length)
      const table = candidates[0]?.table
      if (!table) {
        if (hasReportFacts) setNotice('prose')
        else setNotice('scan')
        return
      }
      if (table.rows.length === 0 || table.columnCount === 0) {
        setNotice('scan')
        return
      }
      setPdfTable({ grid: table.rows, columnCount: table.columnCount })
    } catch (error) {
      const message = uploadErrorText(t, error)
      if (message) setUploadMessage(message)
      else setNotice('pdfError')
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
        ...content,
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
      <div className="section-actions">
        <label className="stat-line" style={{ marginTop: 0 }}>{t('project.geology.pdf.label')}</label>
        <input className="file-input" type="file" accept=".pdf" disabled={busy || pdfTable !== null} onChange={(e) => void onPdf(e)} />
      </div>

      {uploadMessage && <p className="notice error">{uploadMessage}</p>}
      {notice === 'imported' && <span className="stat-line ok">{t('project.geology.imported')}</span>}
      {notice === 'empty' && <p className="notice error">{t('project.geology.empty')}</p>}
      {notice === 'migrationNeeded' && <p className="notice error">{t('project.geology.migrationNeeded')}</p>}
      {notice === 'scan' && <p className="notice error">{t('project.geology.pdf.scan')}</p>}
      {notice === 'pdfError' && <p className="notice error">{t('project.geology.pdf.error')}</p>}
      {notice === 'prose' && <p className="notice warn">{t('project.geology.pdf.prose')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.saveError')}</p>}

      {content?.reportIge && content.reportIge.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p className="stat-line ok">
            Источник: {content.sourceFile ?? 'инженерно-геологический отчёт'}
            {content.sourceArchiveNumber ? ` · арх. №${content.sourceArchiveNumber}` : ''}
          </p>
          <div className="kv-list" style={{ marginTop: 8 }}>
            <div className="kv">
              <span className="kv-label">УГВ, глубина</span>
              <span className="kv-value">
                {content.groundwaterRangeM ? `${content.groundwaterRangeM.min}–${content.groundwaterRangeM.max} м` : '—'}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">Абсолютные отметки УГВ</span>
              <span className="kv-value">
                {content.groundwaterElevationM ? `${content.groundwaterElevationM.min.toFixed(2)}–${content.groundwaterElevationM.max.toFixed(2)} м` : '—'}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">Расчётное повышение</span>
              <span className="kv-value">{content.groundwaterDesignRiseM ?? '—'} м</span>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead><tr><th>ИГЭ</th><th>Грунт</th><th>Вскрыт с глубины, м</th><th>Мощность, м</th></tr></thead>
              <tbody>
                {content.reportIge.map((layer) => (
                  <tr key={layer.code}>
                    <td className="mono">{layer.code}</td>
                    <td>{layer.name}</td>
                    <td className="num">{layer.openingDepthM ?? '—'}</td>
                    <td className="num">{layer.thicknessM ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Скважинные колонки не подменяются строками из XLSX: приложенный XLSX является незаполненным шаблоном с демонстрационными примерами.
          </p>
        </div>
      )}

      {pdfReport && (
        <div className="kv-list" style={{ marginTop: 12 }}>
          <div className="kv">
            <span className="kv-label">{t('project.geology.pdf.reportIge')}</span>
            <span className="kv-value">{pdfReport.ige.map((item) => item.code).join(', ') || '—'}</span>
          </div>
          <div className="kv">
            <span className="kv-label">{t('project.geology.pdf.reportWater')}</span>
            <span className="kv-value">
              {pdfReport.groundwater
                ? `${pdfReport.groundwater.minDepthM}–${pdfReport.groundwater.maxDepthM} м`
                : '—'}
            </span>
          </div>
          <div className="kv">
            <span className="kv-label">{t('project.geology.pdf.reportSeismic')}</span>
            <span className="kv-value">
              {pdfReport.seismicInactive === null
                ? '—'
                : t(pdfReport.seismicInactive ? 'project.geology.pdf.seismicInactive' : 'project.geology.pdf.seismicMentioned')}
            </span>
          </div>
        </div>
      )}

      {pdfTable && (
        <GeologyPdfImport
          projectId={projectId}
          grid={pdfTable.grid}
          columnCount={pdfTable.columnCount}
          onCancel={() => setPdfTable(null)}
          onDone={async () => {
            setPdfTable(null)
            setNotice('imported')
            await onChanged()
          }}
        />
      )}

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
