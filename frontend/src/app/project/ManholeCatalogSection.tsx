import { useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  MANHOLE_CATALOG_EXAMPLE,
  MANHOLE_CATALOG_HEADERS,
  parseManholeCatalogRows,
} from '@aquascheme/engine'
import type { ManholeCatalogEntry } from '@aquascheme/engine'
import type { DatasetRow } from '../../shared/datasets'
import { saveDataset } from '../../shared/datasets'
import { routeUpload } from '../../shared/upload'
import { Panel } from './Panel'

interface ManholeCatalogContent {
  entries?: ManholeCatalogEntry[]
  uploadedAt?: string
}

export function ManholeCatalogSection({
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
  const content = (dataset?.content ?? {}) as ManholeCatalogContent
  const entries = content.entries ?? []
  const verified = entries.filter((entry) => entry.verified).length

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.json_to_sheet([MANHOLE_CATALOG_EXAMPLE], { header: [...MANHOLE_CATALOG_HEADERS] })
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Конструкции')
    XLSX.writeFile(book, 'aquascheme_manhole_catalog_template.xlsx')
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
      const parsed = parseManholeCatalogRows(rows)
      if (parsed.entries.length === 0) {
        setNotice(`Нет пригодных строк. Ошибок: ${parsed.issues.length}.`)
        return
      }
      await saveDataset(projectId, 'manhole_catalog', {
        entries: parsed.entries,
        uploadedAt: new Date().toISOString(),
      }, {
        rows: rows.length,
        issues: parsed.issues,
        verified: parsed.entries.filter((entry) => entry.verified).length,
      }, file.name)
      setNotice(`Сохранено конструкций: ${parsed.entries.length}; подтверждено: ${parsed.entries.filter((entry) => entry.verified).length}.`)
      await onSaved()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ошибка загрузки')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  return (
    <Panel title="Параметрический каталог колодцев и камер" status={verified > 0 ? 'filled' : entries.length > 0 ? 'default' : 'empty'}>
      <p className="hint">Каталог задаёт диапазоны глубин и диаметров, состав элементов и точный источник. Неподтверждённые строки не разрешают выпуск ведомости.</p>
      <div className="section-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadTemplate()}>Скачать шаблон</button>
        <input id={`manhole-catalog-${projectId}-file`} name={`manhole-catalog-${projectId}-file`} className="file-input" type="file" accept=".xlsx,.xls,.csv" aria-label="Каталог колодцев: XLSX/CSV" disabled={busy} onChange={(event) => void onFile(event)} />
      </div>
      <p className="stat-line">Конструкций: {entries.length} · подтверждено источником: {verified}</p>
      {entries.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Тип</th><th>Диапазон труб</th><th>Глубина</th><th>Камера</th><th>Источник</th><th>Статус</th></tr></thead>
            <tbody>{entries.map((entry) => (
              <tr key={entry.typeCode} className={entry.verified ? undefined : 'row-warn'}>
                <td>{entry.typeCode}</td><td>Ø{entry.minPipeDiameterMm}–{entry.maxPipeDiameterMm}</td>
                <td>{entry.minDepthM}–{entry.maxDepthM} м</td><td>Ø{entry.chamberDiameterMm}</td>
                <td>{entry.source}</td><td>{entry.verified ? 'подтверждено' : 'требует проверки'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}
      <p className="hint">Если Supabase сообщает об ограничении kind, примените миграцию backend/migrations/0013_manhole_catalog.sql.</p>
    </Panel>
  )
}
