import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { PUMP_CATALOG_EXAMPLE, PUMP_CATALOG_HEADERS, parsePumpCatalogRows } from '@aquascheme/engine'
import type { EffluentKind, PumpCatalogueItem, ReliabilityCategory } from '@aquascheme/engine'
import type { DatasetRow } from '../../shared/datasets'
import { saveDataset } from '../../shared/datasets'
import { routeUpload } from '../../shared/upload'
import { Panel } from './Panel'

export interface PumpCatalogContent {
  entries?: PumpCatalogueItem[]
  /** Категория надёжности ЛНС — п. 8.2, таблица 8.2. */
  category?: ReliabilityCategory
  /** Характер стоков: от него зависит правило резерва. */
  effluent?: EffluentKind
  /** Число рабочих агрегатов, если проект делит приток между насосами. */
  workingCount?: number
  /** Для ливневой станции: аварийный сброс невозможен (примечание 1). */
  stormOverflowImpossible?: boolean
  uploadedAt?: string
}

const CATEGORIES: Array<{ value: ReliabilityCategory; label: string }> = [
  { value: 'first', label: 'I категория' },
  { value: 'second', label: 'II категория' },
  { value: 'third', label: 'III категория' },
]

const EFFLUENTS: Array<{ value: EffluentKind; label: string }> = [
  { value: 'domestic', label: 'бытовые' },
  { value: 'aggressive', label: 'агрессивные' },
  { value: 'storm', label: 'дождевые' },
]

export function PumpCatalogSection({
  projectId,
  dataset,
  onSaved,
}: {
  projectId: string
  dataset?: DatasetRow
  onSaved: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const content = (dataset?.content ?? {}) as PumpCatalogContent
  const entries = content.entries ?? []

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.json_to_sheet([PUMP_CATALOG_EXAMPLE], { header: [...PUMP_CATALOG_HEADERS] })
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Насосы')
    XLSX.writeFile(book, 'aquascheme_pump_catalog_template.xlsx')
  }

  const save = async (next: PumpCatalogContent, fileName?: string) => {
    await saveDataset(projectId, 'pump_catalog', { ...content, ...next }, {
      entries: (next.entries ?? entries).length,
    }, fileName ?? dataset?.file_name ?? undefined)
    await onSaved()
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setNotice(null)
    try {
      const routed = await routeUpload(file, ['xlsx', 'csv'])
      const XLSX = await import('xlsx')
      const book = XLSX.read(await routed.file.arrayBuffer())
      const sheet = book.Sheets[book.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      const parsed = parsePumpCatalogRows(rows)
      if (parsed.entries.length === 0) {
        setNotice(`Нет пригодных строк. Отклонено: ${parsed.issues.length}. Строка без источника не принимается.`)
        return
      }
      await save({ entries: parsed.entries, uploadedAt: new Date().toISOString() }, file.name)
      setNotice(parsed.issues.length === 0
        ? `Сохранено агрегатов: ${parsed.entries.length}.`
        : `Сохранено агрегатов: ${parsed.entries.length}; отклонено строк: ${parsed.issues.length}`
          + ` (${parsed.issues.map((issue) => issue.row).join(', ')}).`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ошибка загрузки')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const choose = async (next: PumpCatalogContent) => {
    setBusy(true)
    setNotice(null)
    try {
      await save(next)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Каталог насосов и условия резервирования ЛНС" status={entries.length > 0 && content.category ? 'filled' : 'empty'}>
      <p className="hint">
        Марки насосов в расчёт не встроены: подача, напор и мощность зависят от завода, и подставленный по умолчанию
        агрегат попал бы в спецификацию как подтверждённый. Каталог задаёт проект, каждая строка несёт источник.
        Категория надёжности и характер стоков — исходные данные ЛНС; по ним таблица 8.2 определяет число резервных
        агрегатов, поэтому по умолчанию они не выбираются.
      </p>
      <div className="section-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadTemplate()}>Скачать шаблон</button>
        <input
          id={`pump-catalog-${projectId}-file`}
          name={`pump-catalog-${projectId}-file`}
          className="file-input"
          type="file"
          accept=".xlsx,.xls,.csv"
          aria-label="Каталог насосов: XLSX/CSV"
          disabled={busy}
          onChange={(event) => void onFile(event)}
        />
      </div>

      <div className="form-grid">
        <label className="field" htmlFor={`pump-category-${projectId}`}>
          <span className="field-label">Категория надёжности ЛНС</span>
          <select
            id={`pump-category-${projectId}`}
            name={`pump-category-${projectId}`}
            className="input"
            value={content.category ?? ''}
            disabled={busy}
            onChange={(event) => void choose({ category: (event.target.value || undefined) as ReliabilityCategory | undefined })}
          >
            <option value="">не выбрана</option>
            {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="field" htmlFor={`pump-effluent-${projectId}`}>
          <span className="field-label">Характер сточных вод</span>
          <select
            id={`pump-effluent-${projectId}`}
            name={`pump-effluent-${projectId}`}
            className="input"
            value={content.effluent ?? ''}
            disabled={busy}
            onChange={(event) => void choose({ effluent: (event.target.value || undefined) as EffluentKind | undefined })}
          >
            <option value="">не выбран</option>
            {EFFLUENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="field" htmlFor={`pump-working-${projectId}`}>
          <span className="field-label">Рабочих агрегатов</span>
          <input
            id={`pump-working-${projectId}`}
            name={`pump-working-${projectId}`}
            className="input"
            type="number"
            min={1}
            step={1}
            value={content.workingCount ?? 1}
            disabled={busy}
            onChange={(event) => void choose({ workingCount: Math.max(1, Math.floor(Number(event.target.value) || 1)) })}
          />
        </label>
      </div>
      {content.effluent === 'storm' && (
        <label className="field" htmlFor={`pump-storm-${projectId}`}>
          <input
            id={`pump-storm-${projectId}`}
            name={`pump-storm-${projectId}`}
            type="checkbox"
            checked={content.stormOverflowImpossible ?? false}
            disabled={busy}
            onChange={(event) => void choose({ stormOverflowImpossible: event.target.checked })}
          />
          Аварийный сброс дождевых вод в водный объект невозможен
        </label>
      )}

      <p className="stat-line">Агрегатов в каталоге: {entries.length}</p>
      {entries.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Марка</th><th className="num">Подача, л/с</th><th className="num">Напор, м</th><th className="num">Мощность, кВт</th><th>Погружной</th><th>Источник</th></tr></thead>
            <tbody>{entries.map((entry) => (
              <tr key={`${entry.designation}-${entry.flowLps}-${entry.headM}`}>
                <td>{entry.designation}</td>
                <td className="num">{entry.flowLps}</td>
                <td className="num">{entry.headM}</td>
                <td className="num">{entry.powerKw ?? '—'}</td>
                <td>{entry.submersible ? 'да' : 'нет'}</td>
                <td>{entry.source}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}
      <p className="hint">Если Supabase сообщает об ограничении kind, примените миграцию backend/migrations/0016_pump_catalog.sql.</p>
    </Panel>
  )
}
