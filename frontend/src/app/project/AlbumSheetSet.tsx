import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GravityProfile, RouteConstraintInput, SelectedManholeConstruction, SewerSchedule, SurveyPoint, TracedNetwork, WorkingDrawingSet, WorkingDrawingStatus } from '@aquascheme/engine'
import type { PlanPipeDesign } from '../../shared/planScene'
import { WorkingDrawingPreview } from './WorkingDrawingPreview'

/**
 * Ключи статусов листа, а не готовые подписи.
 *
 * Подписи были зашиты по-русски и мимо аудита: он считает текст в разметке, а
 * этот подставлялся выражением в фигурных скобках. Метрика их не видела, а
 * казахскому и английскому пользователю они всё равно показывались по-русски.
 */
const STATUS_KEY: Record<WorkingDrawingStatus, string> = {
  BLOCKED: 'blocked',
  PRELIMINARY: 'preliminary',
  CALCULATED: 'calculated',
  VERIFIED: 'verified',
  STALE: 'stale',
}

export function AlbumSheetSet({
  drawingSet,
  network,
  pipeDiameterMm,
  pipeDesign,
  buildingLabels,
  surveyPoints,
  profile,
  schedule,
  constraints,
  manholeConstructions,
  pdfBusy,
  zipBusy,
  onPdf,
  onSheetPdf,
  onSheetDxf,
  onZip,
  error,
}: {
  drawingSet: WorkingDrawingSet
  network: TracedNetwork
  pipeDiameterMm: Map<string, number>
  pipeDesign?: Map<string, PlanPipeDesign>
  buildingLabels?: Map<string, string>
  surveyPoints: SurveyPoint[]
  profile: GravityProfile | null
  schedule: SewerSchedule | null
  constraints?: RouteConstraintInput | null
  manholeConstructions: SelectedManholeConstruction[]
  pdfBusy: boolean
  zipBusy: boolean
  onPdf: () => void
  onSheetPdf: (sheetId: string) => void
  onSheetDxf: (sheetId: string) => void
  onZip: () => void
  error?: string | null
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState(drawingSet.sheets[0]?.id ?? '')
  const [zoom, setZoom] = useState(1)
  const [showTopography, setShowTopography] = useState(true)
  const [showFrame, setShowFrame] = useState(true)
  useEffect(() => {
    if (!drawingSet.sheets.some((sheet) => sheet.id === selectedId)) setSelectedId(drawingSet.sheets[0]?.id ?? '')
  }, [drawingSet, selectedId])
  const selected = useMemo(
    () => drawingSet.sheets.find((sheet) => sheet.id === selectedId) ?? drawingSet.sheets[0],
    [drawingSet.sheets, selectedId],
  )
  const busy = pdfBusy || zipBusy
  const disabled = !drawingSet.summary.finalExportAllowed

  return (
    <section className="album-sheet-set" aria-labelledby="album-sheet-set-title">
      <div className="album-sheet-set-head">
        <div>
          <p className="eyebrow">{t('project.albumSheets.registryTitle')}</p>
          <h4 id="album-sheet-set-title">Полный альбом — {drawingSet.summary.pdfPages} страниц PDF</h4>
          <p>
            {t('project.albumSheets.composition')}
          </p>
          <p className="stat-line">
            Создано расчётных листов: {drawingSet.summary.total}. Основной комплект MAIN: {drawingSet.summary.workingDrawingSheets} листов, спецификация SPEC: {drawingSet.summary.specificationSheets} листов.
          </p>
        </div>
        <div className="album-sheet-set-actions">
          <button type="button" className="btn btn-sm" disabled={busy || disabled} onClick={onPdf}>
            {pdfBusy && <span className="button-spinner" aria-hidden="true" />}
            {pdfBusy ? 'Формируется PDF' : 'Скачать проверенный PDF'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy || disabled} onClick={onZip}>
            {zipBusy && <span className="button-spinner" aria-hidden="true" />}
            {zipBusy ? 'Собирается ZIP' : 'Скачать проверенные DXF/XLSX'}
          </button>
        </div>
      </div>

      <div className="album-status-summary" aria-label={t('project.albumSheets.statusesLabel')}>
        <span className="drawing-status blocked">Заблокировано: {drawingSet.summary.blocked}</span>
        <span className="drawing-status preliminary">Предварительно: {drawingSet.summary.preliminary}</span>
        <span className="drawing-status calculated">Рассчитано: {drawingSet.summary.calculated}</span>
        <span className="drawing-status verified">Проверено: {drawingSet.summary.verified}</span>
        <span className="drawing-status stale">Устарело: {drawingSet.summary.stale}</span>
        <code>input {drawingSet.inputHash}</code>
      </div>

      {busy && (
        <div className="export-progress" role="status" aria-live="polite">
          <span className="export-progress-spinner" aria-hidden="true" />
          <div className="export-progress-copy">
            <strong>{pdfBusy ? `Формируем ${drawingSet.summary.pdfPages} страниц PDF` : 'Формируем комплект рабочих файлов'}</strong>
            <span>{t('project.albumSheets.autoDownload')}</span>
          </div>
          <span className="export-progress-bar" aria-hidden="true"><i /></span>
        </div>
      )}
      {error && <p className="stat-line warn" role="alert">{error}</p>}
      {disabled && (
        <p className="notice error">
          {t('project.albumSheets.exportBlocked')}
        </p>
      )}

      <div className="album-service-pages" aria-label={t('project.albumSheets.servicePagesLabel')}>
        {drawingSet.manifest.pages.filter((page) => !page.sheetId).map((page) => (
          <span className="drawing-status" key={page.id}>
            PDF {page.pdfPageNumber} · {page.documentSetCode && page.sheetNumber != null ? `${page.documentSetCode}/${page.sheetNumber} · ` : ''}{page.title}
          </span>
        ))}
      </div>

      <div className="drawing-workspace">
        <nav className="drawing-register" aria-label={t('project.albumSheets.registryLabel')}>
          {drawingSet.sheets.map((sheet) => (
            <button
              type="button"
              key={sheet.id}
              className={sheet.id === selected?.id ? 'active' : undefined}
              onClick={() => setSelectedId(sheet.id)}
            >
              <span className="drawing-register-number">{sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/{sheet.sheetNumber}</span>
              <span className="drawing-register-copy">
                <strong>{sheet.title}</strong>
                <small>{t('project.albumSheets.sheetStatus', { status: t(`project.albumSheets.status.${STATUS_KEY[sheet.status]}`), blockers: sheet.blockers.length })}</small>
              </span>
              <span className={`drawing-status-dot ${sheet.status.toLowerCase()}`} aria-label={t(`project.albumSheets.status.${STATUS_KEY[sheet.status]}`)} />
            </button>
          ))}
        </nav>

        {selected && (
          <article className="drawing-sheet-detail">
            <div className="drawing-preview-toolbar" aria-label={t('project.albumSheets.previewControls')}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>+</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom(1)}>{t('project.albumSheets.reset')}</button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || (selected.status !== 'CALCULATED' && selected.status !== 'VERIFIED')}
                onClick={() => onSheetPdf(selected.id)}
              >
                {t('project.albumSheets.sheetPdf')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy || (selected.status !== 'CALCULATED' && selected.status !== 'VERIFIED')}
                onClick={() => onSheetDxf(selected.id)}
              >
                {t('project.albumSheets.sheetDxf')}
              </button>
              <label className="check"><input id={`album-${drawingSet.inputHash}-topography`} name={`album-${drawingSet.inputHash}-topography`} type="checkbox" checked={showTopography} onChange={(event) => setShowTopography(event.target.checked)} /> {t('project.albumSheets.topography')}</label>
              <label className="check"><input id={`album-${drawingSet.inputHash}-frame`} name={`album-${drawingSet.inputHash}-frame`} type="checkbox" checked={showFrame} onChange={(event) => setShowFrame(event.target.checked)} /> {t('project.albumSheets.frame')}</label>
            </div>
            <div className="drawing-preview-viewport">
              <div style={{ width: `${zoom * 100}%`, minWidth: zoom > 1 ? 820 : undefined }}>
                <WorkingDrawingPreview
                  sheet={selected}
                  drawingSet={drawingSet}
                  network={network}
                  pipeDiameterMm={pipeDiameterMm}
                  pipeDesign={pipeDesign}
                  buildingLabels={buildingLabels}
                  surveyPoints={surveyPoints}
                  profile={profile}
                  schedule={schedule}
                  showTopography={showTopography}
                  showFrame={showFrame}
                  constraints={constraints}
                  manholeConstructions={manholeConstructions}
                />
              </div>
            </div>
            <div className="drawing-audit">
              <div>
                <h5>{t('project.albumSheets.blockers')}</h5>
                {selected.blockers.length > 0
                  ? selected.blockers.map((item) => <p className="notice error" key={`${item.code}-${item.elementId ?? ''}`}>{item.code}: {item.message}</p>)
                  : <p className="stat-line ok">{t('project.albumSheets.noBlockers')}</p>}
                {selected.warnings.map((item) => <p className="stat-line warn" key={`${item.code}-${item.elementId ?? ''}`}>{item.code}: {item.message}</p>)}
              </div>
              <div>
                <h5>{t('project.albumSheets.sheetSources')}</h5>
                <ul className="drawing-sources">
                  {selected.sources.map((source) => (
                    <li key={source.requirement} className={source.verified ? 'verified' : source.available ? 'available' : 'missing'}>
                      <strong>{source.label}</strong>
                      <span>{source.verified ? 'проверено' : source.available ? 'доступно, не проверено' : 'нет данных'}{source.detail ? ` · ${source.detail}` : ''}</span>
                    </li>
                  ))}
                </ul>
                <p className="drawing-hash">{t('project.albumSheets.sheetHash')} <code>{selected.inputHash}</code></p>
              </div>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
