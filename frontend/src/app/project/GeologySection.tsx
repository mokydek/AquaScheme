import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  extractTable,
  GEOLOGY_TEMPLATE_EXAMPLE,
  GEOLOGY_TEMPLATE_HEADERS,
  guessGeologyField,
  hasTextLayer,
  parseGeologyRows,
  parseGeologyReportSummary,
  summarizeGeology,
} from '@aquascheme/engine'
import type {
  Aggressiveness, Borehole, DiscardedScanRow, GeologyIssue, GeologyReportSummary,
  ScanTableRefusal, SurveyPoint, TextItem,
} from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { replaceGeology } from '../../shared/geology'
import { loadPdfTextByPage } from '../../shared/pdfText'
import type { OcrProgress } from '../../shared/ocr'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import { GeologyPdfImport } from './GeologyPdfImport'
import { Panel } from './Panel'
import { ExtractionAgeNotice } from './ExtractionAgeNotice'
import { extractionAge } from '@aquascheme/engine'
import { extractGeologyDocument } from '../../shared/documentExtraction'
import { saveBasisFile } from '../../shared/basisFiles'
import { formatAppError } from '../../shared/errorFormatting'

type SoilType = 'sand' | 'loam' | 'clay' | 'rock'
type Corrosivity = 'low' | 'medium' | 'high'
type SubsidenceType = '' | 'I' | 'II'

interface GeologyContent {
  soilType: SoilType
  groundwaterDepthM: number
  corrosivity: Corrosivity
  freezingDepthM?: number
  freezingDepthSource?: string
  freezingDepthVerified?: boolean
  /**
   * Кандидаты промерзания из отчёта: грунт и величина.
   *
   * Отчёт даёт глубину по нескольким грунтам и не говорит, какой лежит на
   * отметке лотка. Программа выбирать не вправе — кандидаты выводятся списком,
   * инженер называет свой.
   */
  freezingDepthCandidates?: Array<{ soil: string; valueM: number }>
  freezingDepthQuote?: string
  profileGeologyMaxOffsetM?: number
  profileGeologySource?: string
  profileGeologyVerified?: boolean
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
  basisDataset,
  boreholes,
  surveyPoints,
  onChanged,
}: {
  projectId: string
  dataset: DatasetRow | undefined
  /**
   * Набор basis-файлов: в нём лежит РАЗБОР геологического отчёта, положенного
   * в мастер комплекта.
   *
   * Предложение разбора живёт рядом с документом, а не в наборе геологии:
   * в наборе — величины, подтверждённые инженером, и разбор их не трогает.
   * Здесь оба источника кандидатов сходятся на экране, а выбор остаётся за
   * человеком. Проп передаётся явно и не имеет умолчания: непереданная связь
   * с данными уже стоила проекту пути загрузки объекта.
   */
  basisDataset: DatasetRow | undefined
  boreholes: Borehole[]
  /** Границы площадки для отбраковки врезок на геологическом чертеже. */
  surveyPoints: SurveyPoint[]
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const content = (dataset?.content ?? null) as GeologyContent | null
  const fieldId = (field: string) => `geology-${projectId}-${field}`
  const fieldName = (field: string) => `geology.${projectId}.${field}`

  const [busy, setBusy] = useState(false)
  const [issues, setIssues] = useState<GeologyIssue[]>([])
  const [notice, setNotice] = useState<'imported' | 'empty' | 'saved' | 'error' | 'migrationNeeded' | 'scan' | 'pdfError' | 'prose' | 'drawingNoBoreholes' | 'drawingNoMatch' | null>(null)
  const [drawingReport, setDrawingReport] = useState<{
    found: number
    matched: number
    unlocated: string[]
    unmatched: string[]
    ambiguous: number
    outsideBounds: number
    reason: string
    fileName: string
  } | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [pdfTable, setPdfTable] = useState<{ grid: string[][]; columnCount: number } | null>(null)
  /**
   * Скан, у которого нет текстового слоя.
   *
   * Файл держится, чтобы инженер мог запустить распознавание, не выбирая его
   * заново. Само распознавание не запускается автоматически: это минуты работы
   * и 2,6 МБ языковых данных, и решает инженер.
   */
  const [scanFile, setScanFile] = useState<File | null>(null)
  const [scanProgress, setScanProgress] = useState<OcrProgress | null>(null)
  const [scanRefusal, setScanRefusal] = useState<ScanTableRefusal | null>(null)
  const [scanDiscarded, setScanDiscarded] = useState<DiscardedScanRow[]>([])
  const [scanRecognized, setScanRecognized] = useState(false)
  const [pdfReport, setPdfReport] = useState<GeologyReportSummary | null>(null)

  // Summary form (GeologyInput + project attributes) persisted to the dataset.
  const [soilType, setSoilType] = useState<SoilType>(content?.soilType ?? 'loam')
  const [groundwater, setGroundwater] = useState(String(content?.groundwaterDepthM ?? ''))
  const [corrosivity, setCorrosivity] = useState<Corrosivity>(content?.corrosivity ?? 'medium')
  /**
   * Кандидаты промерзания: из разбора отчёта и из набора проекта.
   *
   * Разбор кладёт их в запись basis-файла с цитатой и грунтом; набор может
   * нести свои (например, посев объекта). Показываются оба, дубли по величине
   * снимаются — выбирает инженер.
   */
  const reportGeology = ((basisDataset?.content ?? {}) as {
    extracted?: Record<string, {
      freezingDepthCandidates?: Array<{ valueM: number; soil: string | null; quote: string; form: string }>
      freezingDepthUnitlessRows?: Array<{ raw: number; soil: string | null; quote: string; form: string }>
      ige?: Array<{ code: string; name: string }>
      groundwater?: { minM: number; maxM: number } | null
    } | undefined>
  }).extracted?.geology
  const freezingCandidates = [
    ...(reportGeology?.freezingDepthCandidates ?? []).map((candidate) => ({
      soil: candidate.soil ?? '—', valueM: candidate.valueM, quote: candidate.quote,
    })),
    ...(content?.freezingDepthCandidates ?? []).map((candidate) => ({
      soil: candidate.soil, valueM: candidate.valueM, quote: content?.freezingDepthQuote ?? '',
    })),
  ].filter((candidate, index, all) => all.findIndex((other) => other.valueM === candidate.valueM) === index)
  /*
    Строки, где число есть, а единицы нет.

    Кнопкой не становятся и в кандидаты не попадают: разбор не может отличить
    номер столбца от глубины по одному числу. Но и молчать о них нельзя —
    молчаливая потеря кандидата не лучше молчаливой выдумки. Показываются
    цитатой: по ней инженер решает за один взгляд.
  */
  const freezingUnitlessRows = reportGeology?.freezingDepthUnitlessRows ?? []
  /*
    Возраст сохранённого разбора. Считается по тому, что лежит в базе, а не по
    тому, что умеет этот код: величины на экране — сохранённые.
  */
  const geologyAge = extractionAge('geology', reportGeology)
  const geologyFileName = ((basisDataset?.content ?? {}) as { files?: Record<string, string> })
    .files?.geology
  const [reparseBusy, setReparseBusy] = useState(false)
  const [reparseError, setReparseError] = useState<string | null>(null)
  /**
   * Перезапуск разбора — РЕШЕНИЕМ ИНЖЕНЕРА, а не сам по себе.
   *
   * Пере-разбор меняет данные проекта, и делать это молча при открытии
   * страницы нельзя. Пишется только `extracted.geology`: набор геологии, где
   * живут подтверждённые инженером величины, не трогается вовсе.
   */
  const reparseGeology = async (file: File) => {
    setReparseBusy(true)
    setReparseError(null)
    try {
      const { payload } = await extractGeologyDocument(file, t('project.kit.docxNoText'))
      await saveBasisFile(projectId, 'geology', file.name, {}, payload)
      await onChanged()
    } catch (cause) {
      setReparseError(formatAppError(cause))
    } finally {
      setReparseBusy(false)
    }
  }
  /*
    Выбранная величина, которой среди свежих кандидатов нет.

    Пере-разбор не отменяет выбор человека — но и не притворяется, что выбор
    относится к новым величинам. Именно так исчезает 2,00 м: он был выбран из
    отчёта, а сегодняшний разбор его кандидатом не считает.
  */
  const chosenFreezing = content?.freezingDepthM ?? null
  const chosenMissing = geologyAge?.kind === 'current' && chosenFreezing !== null
    && freezingCandidates.length > 0
    && !freezingCandidates.some((candidate) => candidate.valueM === chosenFreezing)

  const [freezing, setFreezing] = useState(content?.freezingDepthM == null ? '' : String(content.freezingDepthM))
  const [freezingSource, setFreezingSource] = useState(content?.freezingDepthSource ?? content?.sourceFile ?? '')
  const [freezingVerified, setFreezingVerified] = useState(content?.freezingDepthVerified === true)
  const [geologyMaxOffset, setGeologyMaxOffset] = useState(content?.profileGeologyMaxOffsetM == null ? '' : String(content.profileGeologyMaxOffsetM))
  const [geologyCoverageSource, setGeologyCoverageSource] = useState(content?.profileGeologySource ?? '')
  const [geologyCoverageVerified, setGeologyCoverageVerified] = useState(content?.profileGeologyVerified === true)
  const [subsidence, setSubsidence] = useState<SubsidenceType>(content?.subsidenceType ?? '')
  const [heaving, setHeaving] = useState(Boolean(content?.heaving))
  const [swelling, setSwelling] = useState(Boolean(content?.swelling))

  useEffect(() => {
    setSoilType(content?.soilType ?? 'loam')
    setGroundwater(String(content?.groundwaterDepthM ?? ''))
    setCorrosivity(content?.corrosivity ?? 'medium')
    setFreezing(content?.freezingDepthM == null ? '' : String(content.freezingDepthM))
    setFreezingSource(content?.freezingDepthSource ?? content?.sourceFile ?? '')
    setFreezingVerified(content?.freezingDepthVerified === true)
    setGeologyMaxOffset(content?.profileGeologyMaxOffsetM == null ? '' : String(content.profileGeologyMaxOffsetM))
    setGeologyCoverageSource(content?.profileGeologySource ?? '')
    setGeologyCoverageVerified(content?.profileGeologyVerified === true)
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

  /**
   * Координаты скважин с геологического чертежа.
   *
   * В реальном комплекте план расположения выработок приходит отдельным DWG, и
   * координаты есть только там: отчёт и лабораторный журнал дают слои, но не
   * привязку. Без координат продольный профиль геологию построить не может.
   *
   * Скважины отсюда не создаются, а только дополняются координатами. Скважина
   * без слоёв прошла бы шлюз выпуска, а рисовать по ней было бы нечего — это
   * обход проверки, а не данные.
   */
  /**
   * Распознавание скана геологического отчёта.
   *
   * Результат идёт на ТОТ ЖЕ экран сопоставления колонок и обязательной сверки,
   * что и цифровой PDF: ни одно распознанное значение не попадает в проект
   * мимо подтверждения инженером.
   */
  const onRecognizeScan = async () => {
    if (!scanFile) return
    setBusy(true)
    setScanProgress(null)
    setScanRefusal(null)
    setScanDiscarded([])
    try {
      const { recognizeScan } = await import('../../shared/ocr')
      const { recoverTableFromScan } = await import('@aquascheme/engine')
      const pages = await recognizeScan(scanFile, setScanProgress)
      const table = recoverTableFromScan(pages.map((page) => ({
        page: page.page,
        lines: page.lines.map((line) => ({ words: line.words })),
      })))
      setScanRecognized(true)
      setScanDiscarded(table.discarded)
      if (table.refusal !== null) {
        // Честный отказ с причиной вместо таблицы-догадки.
        setScanRefusal(table.refusal)
        return
      }
      setNotice(null)
      setPdfTable({ grid: table.rows, columnCount: table.columnCount })
    } catch (error) {
      const message = uploadErrorText(t, error)
      if (message) setUploadMessage(message)
      else setNotice('pdfError')
    } finally {
      setBusy(false)
      setScanProgress(null)
    }
  }

  const onGeologyDrawing = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setNotice(null)
    setUploadMessage(null)
    setDrawingReport(null)
    try {
      if (boreholes.length === 0) {
        setNotice('drawingNoBoreholes')
        return
      }
      const routed = await routeUpload(file, ['dxf'])
      const [{ parseDxfNetwork }, { boreholesFromDrawing, mergeBoreholePositions }] = await Promise.all([
        import('@aquascheme/engine/dxfread'),
        import('@aquascheme/engine'),
      ])
      // Границы площадки берутся из топосъёмки: план выработок обычно несёт
      // врезку с теми же подписями, и без границ каждая метка встречается
      // дважды — модуль честно отбрасывает такие как неоднозначные, и
      // координат не получает никто.
      const bounds = surveyPoints.length >= 2
        ? {
          minX: Math.min(...surveyPoints.map((p) => p.x)),
          maxX: Math.max(...surveyPoints.map((p) => p.x)),
          minY: Math.min(...surveyPoints.map((p) => p.y)),
          maxY: Math.max(...surveyPoints.map((p) => p.y)),
        }
        : undefined
      const extraction = boreholesFromDrawing(parseDxfNetwork(routed.text ?? ''), { bounds })
      const merged = mergeBoreholePositions(boreholes, extraction.boreholes)
      const matched = boreholes.length - merged.unlocated.length
      setDrawingReport({
        found: extraction.boreholes.length,
        matched,
        unlocated: merged.unlocated,
        unmatched: merged.unmatched,
        ambiguous: extraction.ambiguous.length,
        outsideBounds: extraction.outsideBounds,
        reason: extraction.reason,
        fileName: file.name,
      })
      if (matched === 0) {
        setNotice('drawingNoMatch')
        return
      }
      await replaceGeology(projectId, merged.boreholes)
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
      setScanFile(routed.file)
      setScanRefusal(null)
      setScanDiscarded([])
      setScanRecognized(false)
      setFreezingSource(file.name)
      setFreezingVerified(false)
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
    const fzSource = freezingSource.trim()
    const maxOffsetText = geologyMaxOffset.trim()
    const maxOffset = maxOffsetText === '' ? undefined : Number(maxOffsetText.replace(',', '.'))
    const coverageSource = geologyCoverageSource.trim()
    if (!Number.isFinite(gw) || !Number.isFinite(fz) || fz <= 0 || (freezingVerified && !fzSource)
      || (maxOffset !== undefined && (!Number.isFinite(maxOffset) || maxOffset <= 0))
      || (geologyCoverageVerified && (maxOffset === undefined || !coverageSource))) {
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
        freezingDepthSource: fzSource || undefined,
        freezingDepthVerified: freezingVerified,
        profileGeologyMaxOffsetM: maxOffset,
        profileGeologySource: coverageSource || undefined,
        profileGeologyVerified: geologyCoverageVerified,
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
    <Panel anchor="geology" title={t('project.geology.title')} status={dataset || boreholes.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.geology.hint')}</p>

      <div className="section-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadTemplate()}>
          {t('project.geology.template')}
        </button>
        <input
          id={fieldId('table-file')}
          name={fieldName('tableFile')}
          className="file-input"
          type="file"
          accept=".xlsx,.xls,.csv"
          aria-label={`${t('project.geology.title')}: XLSX/CSV`}
          disabled={busy}
          onChange={(e) => void onFile(e)}
        />
      </div>
      <div className="section-actions">
        <label htmlFor={fieldId('drawing-file')} className="stat-line" style={{ marginTop: 0 }}>
          {t('project.geology.drawing.label')}
        </label>
        <input
          id={fieldId('drawing-file')}
          name={fieldName('drawingFile')}
          className="file-input"
          type="file"
          accept=".dxf,.dwg"
          aria-label={`${t('project.geology.title')}: DXF/DWG`}
          disabled={busy}
          onChange={(e) => void onGeologyDrawing(e)}
        />
      </div>
      <p className="hint">{t('project.geology.drawing.hint')}</p>

      <div className="section-actions">
        <label htmlFor={fieldId('pdf-file')} className="stat-line" style={{ marginTop: 0 }}>{t('project.geology.pdf.label')}</label>
        <input
          id={fieldId('pdf-file')}
          name={fieldName('pdfFile')}
          className="file-input"
          type="file"
          accept=".pdf"
          disabled={busy || pdfTable !== null}
          onChange={(e) => void onPdf(e)}
        />
      </div>

      {uploadMessage && <p className="notice error">{uploadMessage}</p>}
      {notice === 'imported' && <span className="stat-line ok">{t('project.geology.imported')}</span>}
      {notice === 'empty' && <p className="notice error">{t('project.geology.empty')}</p>}
      {notice === 'migrationNeeded' && <p className="notice error">{t('project.geology.migrationNeeded')}</p>}
      {notice === 'scan' && (
        <>
          <p className="notice error">{t('project.geology.pdf.scan')}</p>
          <div className="section-actions">
            <button type="button" className="btn btn-sm" disabled={busy || !scanFile} onClick={() => void onRecognizeScan()}>
              {t('project.geology.pdf.recognize')}
            </button>
          </div>
          <p className="hint">{t('project.geology.pdf.recognizeHint')}</p>
        </>
      )}
      {scanProgress && (
        <p className="stat-line">
          {t('project.geology.pdf.recognizeProgress', {
            page: scanProgress.page, total: scanProgress.totalPages,
          })}
        </p>
      )}
      {scanRefusal && (
        <p className="notice error">{t(`project.geology.pdf.refusal.${scanRefusal}`)}</p>
      )}
      {scanRecognized && scanDiscarded.length > 0 && (
        <>
          <p className="stat-line warn">
            {t('project.geology.pdf.discardedTitle', { count: scanDiscarded.length })}
          </p>
          <ul className="hint">
            {scanDiscarded.slice(0, 20).map((row, index) => (
              <li key={index}>{t('project.geology.pdf.discardedRow', { page: row.page, text: row.text })}</li>
            ))}
          </ul>
        </>
      )}
      {notice === 'pdfError' && <p className="notice error">{t('project.geology.pdf.error')}</p>}
      {notice === 'prose' && <p className="notice warn">{t('project.geology.pdf.prose')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.saveError')}</p>}
      {notice === 'drawingNoBoreholes' && <p className="notice error">{t('project.geology.drawing.noBoreholes')}</p>}
      {notice === 'drawingNoMatch' && <p className="notice error">{t('project.geology.drawing.noMatch')}</p>}

      {drawingReport && (
        <div className="parse-report">
          <p className="stat-line">{drawingReport.fileName}</p>
          <p className="stat-line">
            {t('project.geology.drawing.result', {
              found: drawingReport.found,
              matched: drawingReport.matched,
            })}
          </p>
          {drawingReport.unlocated.length > 0 && (
            <p className="stat-line warn">
              {t('project.geology.drawing.unlocated', { list: drawingReport.unlocated.join(', ') })}
            </p>
          )}
          {drawingReport.unmatched.length > 0 && (
            <p className="stat-line warn">
              {t('project.geology.drawing.unmatched', { list: drawingReport.unmatched.join(', ') })}
            </p>
          )}
          {drawingReport.ambiguous > 0 && (
            <p className="stat-line warn">
              {t('project.geology.drawing.ambiguous', { count: drawingReport.ambiguous })}
            </p>
          )}
          <p className="hint">{drawingReport.reason}</p>
        </div>
      )}

      {content?.reportIge && content.reportIge.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p className="stat-line ok">
            Источник: {content.sourceFile ?? 'инженерно-геологический отчёт'}
            {content.sourceArchiveNumber ? ` · арх. №${content.sourceArchiveNumber}` : ''}
          </p>
          <div className="kv-list" style={{ marginTop: 8 }}>
            <div className="kv">
              <span className="kv-label">{t('project.geology.gwDepth')}</span>
              <span className="kv-value">
                {content.groundwaterRangeM ? `${content.groundwaterRangeM.min}–${content.groundwaterRangeM.max} м` : '—'}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.geology.gwAbsolute')}</span>
              <span className="kv-value">
                {content.groundwaterElevationM ? `${content.groundwaterElevationM.min.toFixed(2)}–${content.groundwaterElevationM.max.toFixed(2)} м` : '—'}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.geology.gwRise')}</span>
              <span className="kv-value">{content.groundwaterDesignRiseM ?? '—'} м</span>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead><tr><th>{t('project.geology.thIge')}</th><th>{t('project.geology.thSoil')}</th><th>{t('project.geology.thFrom')}</th><th>{t('project.geology.thThickness')}</th></tr></thead>
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
            {t('project.geology.noXlsxColumns')}
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
          discardedCount={scanDiscarded.length}
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
          <select
            id={fieldId('soil-type')}
            name={fieldName('soilType')}
            className="input"
            value={soilType}
            onChange={(e) => setSoilType(e.target.value as SoilType)}
          >
            {(['sand', 'loam', 'clay', 'rock'] as const).map((soil) => (
              <option key={soil} value={soil}>
                {t(`project.geology.soils.${soil}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.groundwater')}</span>
          <input
            id={fieldId('groundwater-depth')}
            name={fieldName('groundwaterDepthM')}
            className="input"
            inputMode="decimal"
            value={groundwater}
            onChange={(e) => setGroundwater(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.corrosivity')}</span>
          <select
            id={fieldId('corrosivity')}
            name={fieldName('corrosivity')}
            className="input"
            value={corrosivity}
            onChange={(e) => setCorrosivity(e.target.value as Corrosivity)}
          >
            {(['low', 'medium', 'high'] as const).map((level) => (
              <option key={level} value={level}>
                {t(`project.geology.corrosivityLevels.${level}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.freezing')}</span>
          <input
            id={fieldId('freezing-depth')}
            name={fieldName('freezingDepthM')}
            className="input"
            inputMode="decimal"
            value={freezing}
            placeholder={t('project.geology.frostValueHint')}
            onChange={(e) => {
              setFreezing(e.target.value)
              setFreezingVerified(false)
            }}
          />
        </label>
        {/*
          ВЫБОР ГРУНТА — ЗА ИНЖЕНЕРОМ. Раздел готовности давно обещал «выберите
          одну глубину промерзания из кандидатов отчёта — с грунтом и цитатой»,
          а показать кандидаты было негде: посев тихо брал суглинок, и величина
          приезжала на экран уже выбранной, с рангом «принято по умолчанию».
          Нажатие подставляет величину и подписывает её грунтом и строкой
          отчёта — тем, на что можно сослаться.
        */}
        <ExtractionAgeNotice
          age={geologyAge}
          itemId="geology"
          fileName={geologyFileName}
          accept=".docx"
          busy={reparseBusy}
          error={reparseError}
          onReparse={(file) => { void reparseGeology(file) }}
        />
        {chosenMissing && (
          <p className="stat-line warn" role="alert" data-freezing-chosen-missing="true">
            {t('project.geology.frostChosenMissing', { value: (chosenFreezing ?? 0).toFixed(2) })}
          </p>
        )}
        {freezingCandidates.length > 0 && (
          <div className="field" data-freezing-candidates="true">
            <span className="field-label">{t('project.geology.frostCandidates')}</span>
            <div className="chip-row">
              {freezingCandidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.soil}
                  className={`btn btn-sm${freezing === String(candidate.valueM) ? '' : ' btn-ghost'}`}
                  data-freezing-candidate={candidate.soil}
                  onClick={() => {
                    setFreezing(String(candidate.valueM))
                    setFreezingSource(candidate.quote
                      ? `${candidate.soil}; ${candidate.quote}`
                      : candidate.soil)
                    // Выбор — ещё не подтверждение: инженер жмёт «подтверждено»
                    // отдельно, увидев, что подставилось.
                    setFreezingVerified(false)
                  }}
                >
                  {candidate.soil}: {candidate.valueM.toFixed(2)} м
                </button>
              ))}
            </div>
            <p className="hint">{t('project.geology.frostCandidatesHint')}</p>
          </div>
        )}
        {freezingUnitlessRows.length > 0 && (
          <div className="field" data-freezing-unitless="true">
            <span className="field-label">{t('project.geology.frostUnitless')}</span>
            <ul className="hint">
              {freezingUnitlessRows.map((row) => (
                <li key={row.quote}>
                  {t('project.geology.frostUnitlessRow', {
                    raw: row.raw, soil: row.soil ?? '—', quote: row.quote.replace(/	/g, ' | '),
                  })}
                </li>
              ))}
            </ul>
            <p className="hint">{t('project.geology.frostUnitlessHint')}</p>
          </div>
        )}
        <label className="field">
          <span className="field-label">{t('project.geology.frostSource')}</span>
          <input
            id={fieldId('freezing-source')}
            name={fieldName('freezingDepthSource')}
            className="input"
            value={freezingSource}
            placeholder={t('project.geology.frostSourceHint')}
            onChange={(e) => {
              setFreezingSource(e.target.value)
              setFreezingVerified(false)
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.maxOffset')}</span>
          <input
            id={fieldId('profile-max-offset')}
            name={fieldName('profileGeologyMaxOffsetM')}
            className="input"
            inputMode="decimal"
            value={geologyMaxOffset}
            placeholder={t('project.geology.offsetHint')}
            onChange={(e) => {
              setGeologyMaxOffset(e.target.value)
              setGeologyCoverageVerified(false)
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.coverageSource')}</span>
          <input
            id={fieldId('profile-source')}
            name={fieldName('profileGeologySource')}
            className="input"
            value={geologyCoverageSource}
            placeholder={t('project.geology.coverageSourceHint')}
            onChange={(e) => {
              setGeologyCoverageSource(e.target.value)
              setGeologyCoverageVerified(false)
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('project.geology.subsidence')}</span>
          <select
            id={fieldId('subsidence-type')}
            name={fieldName('subsidenceType')}
            className="input"
            value={subsidence}
            onChange={(e) => setSubsidence(e.target.value as SubsidenceType)}
          >
            <option value="">{t('project.geology.subsidenceNone')}</option>
            <option value="I">{t('project.geology.subsidenceI')}</option>
            <option value="II">{t('project.geology.subsidenceII')}</option>
          </select>
        </label>
        <label className="check">
          <input
            id={fieldId('heaving')}
            name={fieldName('heaving')}
            type="checkbox"
            checked={heaving}
            onChange={(e) => setHeaving(e.target.checked)}
          />
          <span>{t('project.geology.heaving')}</span>
        </label>
        <label className="check">
          <input
            id={fieldId('swelling')}
            name={fieldName('swelling')}
            type="checkbox"
            checked={swelling}
            onChange={(e) => setSwelling(e.target.checked)}
          />
          <span>{t('project.geology.swelling')}</span>
        </label>
        <label className="check">
          <input
            id={fieldId('freezing-verified')}
            name={fieldName('freezingDepthVerified')}
            type="checkbox"
            checked={freezingVerified}
            disabled={!freezing.trim() || !freezingSource.trim()}
            onChange={(e) => setFreezingVerified(e.target.checked)}
          />
          <span>{t('project.geology.frostConfirmed')}</span>
        </label>
        <label className="check">
          <input
            id={fieldId('profile-verified')}
            name={fieldName('profileGeologyVerified')}
            type="checkbox"
            checked={geologyCoverageVerified}
            disabled={!geologyMaxOffset.trim() || !geologyCoverageSource.trim()}
            onChange={(e) => setGeologyCoverageVerified(e.target.checked)}
          />
          <span>{t('project.geology.coverageConfirmed')}</span>
        </label>
      </div>
      {!freezingVerified && (
        <p className="notice warn">
          {t('project.geology.frostBlocker')}
        </p>
      )}
      {!geologyCoverageVerified && (
        <p className="notice warn">
          {t('project.geology.coverageBlocker')}
        </p>
      )}
      <div className="section-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void saveSummary()}>
          {t('project.save')}
        </button>
        {notice === 'saved' && <span className="stat-line ok">{t('project.saved')}</span>}
      </div>
    </Panel>
  )
}
