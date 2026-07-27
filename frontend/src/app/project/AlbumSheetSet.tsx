import { useEffect, useMemo, useState } from 'react'
import type { GravityProfile, RouteConstraintInput, SelectedManholeConstruction, SewerSchedule, SurveyPoint, WorkingDrawingSet, WorkingDrawingStatus } from '@aquascheme/engine'
import { WorkingDrawingPreview } from './WorkingDrawingPreview'

const STATUS_LABEL: Record<WorkingDrawingStatus, string> = {
  BLOCKED: 'Заблокирован',
  PRELIMINARY: 'Предварительный',
  CALCULATED: 'Рассчитан',
  VERIFIED: 'Проверен',
  STALE: 'Устарел',
}

export function AlbumSheetSet({
  drawingSet,
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
          <p className="eyebrow">РАБОЧИЕ ЧЕРТЕЖИ · РЕЕСТР ИСТОЧНИКОВ</p>
          <h4 id="album-sheet-set-title">Расчётный комплект — {drawingSet.summary.total} листов</h4>
          <p>
            Состав определяется протяжённостью трассы и объёмом ведомостей. Эталонный альбом используется только для проверки состава и оформления, а не как источник геометрии.
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

      <div className="album-status-summary" aria-label="Статусы листов">
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
            <strong>{pdfBusy ? `Формируем ${drawingSet.summary.total} листов` : 'Формируем комплект рабочих файлов'}</strong>
            <span>Файл начнёт скачиваться автоматически после проверки и сборки.</span>
          </div>
          <span className="export-progress-bar" aria-hidden="true"><i /></span>
        </div>
      )}
      {error && <p className="stat-line warn" role="alert">{error}</p>}
      {disabled && (
        <p className="notice error">
          Финальный экспорт заблокирован. Выберите лист ниже: программа показывает точные отсутствующие исходные данные и не подменяет их вымышленной геометрией.
        </p>
      )}

      <div className="drawing-workspace">
        <nav className="drawing-register" aria-label="Реестр рабочих листов">
          {drawingSet.sheets.map((sheet) => (
            <button
              type="button"
              key={sheet.id}
              className={sheet.id === selected?.id ? 'active' : undefined}
              onClick={() => setSelectedId(sheet.id)}
            >
              <span className="drawing-register-number">{sheet.sheetNumber}</span>
              <span className="drawing-register-copy">
                <strong>{sheet.title}</strong>
                <small>{STATUS_LABEL[sheet.status]} · блокеров {sheet.blockers.length}</small>
              </span>
              <span className={`drawing-status-dot ${sheet.status.toLowerCase()}`} aria-label={STATUS_LABEL[sheet.status]} />
            </button>
          ))}
        </nav>

        {selected && (
          <article className="drawing-sheet-detail">
            <div className="drawing-preview-toolbar" aria-label="Управление предпросмотром">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>+</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom(1)}>Сбросить</button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || (selected.status !== 'CALCULATED' && selected.status !== 'VERIFIED')}
                onClick={() => onSheetPdf(selected.id)}
              >
                Скачать лист PDF
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy || (selected.status !== 'CALCULATED' && selected.status !== 'VERIFIED')}
                onClick={() => onSheetDxf(selected.id)}
              >
                Скачать лист DXF
              </button>
              <label className="check"><input type="checkbox" checked={showTopography} onChange={(event) => setShowTopography(event.target.checked)} /> Топосъёмка</label>
              <label className="check"><input type="checkbox" checked={showFrame} onChange={(event) => setShowFrame(event.target.checked)} /> Рамка</label>
            </div>
            <div className="drawing-preview-viewport">
              <div style={{ width: `${zoom * 100}%`, minWidth: zoom > 1 ? 820 : undefined }}>
                <WorkingDrawingPreview
                  sheet={selected}
                  drawingSet={drawingSet}
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
                <h5>Стоп-факторы</h5>
                {selected.blockers.length > 0
                  ? selected.blockers.map((item) => <p className="notice error" key={`${item.code}-${item.elementId ?? ''}`}>{item.code}: {item.message}</p>)
                  : <p className="stat-line ok">Стоп-факторов листа нет.</p>}
                {selected.warnings.map((item) => <p className="stat-line warn" key={`${item.code}-${item.elementId ?? ''}`}>{item.code}: {item.message}</p>)}
              </div>
              <div>
                <h5>Исходные данные листа</h5>
                <ul className="drawing-sources">
                  {selected.sources.map((source) => (
                    <li key={source.requirement} className={source.verified ? 'verified' : source.available ? 'available' : 'missing'}>
                      <strong>{source.label}</strong>
                      <span>{source.verified ? 'проверено' : source.available ? 'доступно, не проверено' : 'нет данных'}{source.detail ? ` · ${source.detail}` : ''}</span>
                    </li>
                  ))}
                </ul>
                <p className="drawing-hash">Хэш листа: <code>{selected.inputHash}</code></p>
              </div>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
