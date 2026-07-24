export const PROJECT_ALBUM_GROUPS = [
  { range: '1–3', count: 3, title: 'Общие данные', detail: 'Титульный лист, ведомость листов, общие указания и ситуационная схема' },
  { range: '4–32', count: 29, title: 'Планы трассы', detail: 'Планы К2 по пикетам, узлы пересечений и обзорная схема положения листа' },
  { range: '33–52', count: 20, title: 'Продольные профили', detail: 'Профили по пикетам с отметками земли, лотка, глубиной и диаметрами' },
  { range: '53–57', count: 5, title: 'Колодцы', detail: 'Ведомости расхода материалов по ТПР 902-09-22.84' },
  { range: '58', count: 1, title: 'Узлы и детали', detail: 'Защитная решётка и конструктивный узел колодца' },
  { range: '59–61', count: 3, title: 'Спецификации', detail: 'Подводящие и отводящие трубопроводы, материалы и стандарты' },
] as const

export function AlbumSheetSet({
  pdfBusy,
  zipBusy,
  onPdf,
  onZip,
  error,
}: {
  pdfBusy: boolean
  zipBusy: boolean
  onPdf: () => void
  onZip: () => void
  error?: string | null
}) {
  const busy = pdfBusy || zipBusy
  return (
    <section className="album-sheet-set" aria-labelledby="album-sheet-set-title">
      <div className="album-sheet-set-head">
        <div>
          <p className="eyebrow">ТОМ 2 · АЛЬБОМ 1 · 2024-51-НК</p>
          <h4 id="album-sheet-set-title">Комплект рабочих чертежей — 61 лист</h4>
          <p>Структура зафиксирована по исходному альбому, а значения на листах формируются из текущего расчёта проекта.</p>
        </div>
        <div className="album-sheet-set-actions">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onPdf}>
            {pdfBusy && <span className="button-spinner" aria-hidden="true" />}
            {pdfBusy ? 'Формируется PDF' : 'Скачать альбом PDF'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={onZip}>
            {zipBusy && <span className="button-spinner" aria-hidden="true" />}
            {zipBusy ? 'Собирается ZIP' : 'Скачать рабочие DXF/XLSX'}
          </button>
        </div>
      </div>
      {busy && (
        <div className="export-progress" role="status" aria-live="polite">
          <span className="export-progress-spinner" aria-hidden="true" />
          <div className="export-progress-copy">
            <strong>{pdfBusy ? 'Собираем и нумеруем 61 лист' : 'Формируем комплект рабочих файлов'}</strong>
            <span>Окно можно оставить открытым — готовый файл начнёт скачиваться автоматически.</span>
          </div>
          <span className="export-progress-bar" aria-hidden="true"><i /></span>
        </div>
      )}
      {error && <p className="stat-line warn" role="alert">{error}</p>}
      <div className="album-sheet-groups">
        {PROJECT_ALBUM_GROUPS.map((group) => (
          <article key={group.range}>
            <span className="album-sheet-range">Листы {group.range}</span>
            <strong>{group.title}</strong>
            <p>{group.detail}</p>
            <span className="album-sheet-count">{group.count} {group.count === 1 ? 'лист' : group.count < 5 ? 'листа' : 'листов'}</span>
          </article>
        ))}
      </div>
    </section>
  )
}
