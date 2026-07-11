import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CATALOG_TEMPLATE_EXAMPLE,
  CATALOG_TEMPLATE_HEADERS,
  parseCatalogRows,
} from '@aquascheme/engine'
import type { CatalogIssue } from '@aquascheme/engine'
import {
  deleteCatalog,
  saveCatalog,
  setActiveCatalog,
} from '../../shared/catalog'
import type { CatalogRow } from '../../shared/catalog'
import { Panel } from './Panel'

export function CatalogSection({
  projectId,
  catalogs,
  activeCatalogId,
  onChanged,
}: {
  projectId: string
  catalogs: CatalogRow[]
  activeCatalogId: string | null
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [issues, setIssues] = useState<CatalogIssue[]>([])
  const [notice, setNotice] = useState<'saved' | 'empty' | 'error' | null>(null)

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.json_to_sheet(CATALOG_TEMPLATE_EXAMPLE, {
      header: [...CATALOG_TEMPLATE_HEADERS],
    })
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Каталог')
    XLSX.writeFile(book, 'aquascheme_catalog_template.xlsx')
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setNotice(null)
    setIssues([])
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer())
      const sheet = book.Sheets[book.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      const parsed = parseCatalogRows(rows)
      setIssues(parsed.issues)
      if (parsed.items.length === 0) {
        setNotice('empty')
        return
      }
      const catalogId = await saveCatalog(projectId, file.name.replace(/\.[^.]+$/, ''), file.name, parsed.items)
      await setActiveCatalog(projectId, catalogId)
      setNotice('saved')
      await onChanged()
    } catch {
      setNotice('error')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const activate = async (catalogId: string | null) => {
    await setActiveCatalog(projectId, catalogId)
    await onChanged()
  }

  const remove = async (catalogId: string) => {
    await deleteCatalog(projectId, catalogId)
    await onChanged()
  }

  return (
    <Panel title={t('project.catalog.title')} status="default">
      <p className="hint">{t('project.catalog.hint')}</p>
      <div className="section-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadTemplate()}>
          {t('project.catalog.template')}
        </button>
        <input className="file-input" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(e) => void onFile(e)} />
      </div>

      <div className="row-list" style={{ marginTop: 16 }}>
        <div className="row">
          <label className="check" style={{ cursor: 'pointer' }}>
            <input type="radio" checked={activeCatalogId === null} onChange={() => void activate(null)} />
            <span className="row-name">{t('project.catalog.builtin')}</span>
          </label>
          <span className="row-meta">ПЭ100 SDR17</span>
        </div>
        {catalogs.map((c) => (
          <div className="row" key={c.id}>
            <label className="check" style={{ cursor: 'pointer' }}>
              <input type="radio" checked={activeCatalogId === c.id} onChange={() => void activate(c.id)} />
              <span className="row-name">{c.name}</span>
            </label>
            <div className="row-actions">
              <button type="button" className="link-btn" onClick={() => void remove(c.id)}>
                {t('project.catalog.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {notice === 'saved' && <span className="stat-line ok">{t('project.catalog.saved')}</span>}
      {notice === 'empty' && <p className="notice error">{t('project.catalog.empty')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.saveError')}</p>}

      {issues.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="stat-line warn">{t('project.catalog.issuesTitle', { count: issues.length })}</p>
          {issues.slice(0, 8).map((issue, i) => (
            <p className="stat-line warn" key={i}>
              {t('project.catalog.issueRow', { row: issue.row })}: {t(`project.catalog.issue.${issue.code}`)}
            </p>
          ))}
        </div>
      )}
    </Panel>
  )
}
