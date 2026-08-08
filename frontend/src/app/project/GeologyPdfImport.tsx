import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GEOLOGY_FIELDS,
  guessGeologyField,
  parseGeologyRows,
  summarizeGeology,
} from '@aquascheme/engine'
import type { GeologyFieldId } from '@aquascheme/engine'
import { replaceGeology } from '../../shared/geology'

/**
 * PDF geology import wizard (requirements update 3, change 1, G2). Extraction
 * from PDF is unreliable, so nothing is trusted silently: the user maps the
 * detected columns to model fields, then a MANDATORY review screen shows every
 * extracted value in an editable grid. The data reaches the geo_* tables only
 * after the user confirms on that screen.
 */

const FIELD_HEADER = new Map(GEOLOGY_FIELDS.map((f) => [f.id, f.header]))

function looksLikeHeaderRow(row: string[]): boolean {
  const matched = row.filter((cell) => guessGeologyField(cell) !== null).length
  return matched >= 2
}

export function GeologyPdfImport({
  projectId,
  grid,
  columnCount,
  discardedCount = 0,
  onCancel,
  onDone,
}: {
  projectId: string
  grid: string[][]
  columnCount: number
  /** Сколько строк отброшено при восстановлении таблицы со скана. */
  discardedCount?: number
  onCancel: () => void
  onDone: () => Promise<void>
}) {
  const { t } = useTranslation()
  const fieldId = (field: string) => `geology-pdf-${projectId}-${field}`
  const fieldName = (field: string) => `geologyPdf.${projectId}.${field}`
  const [step, setStep] = useState<'map' | 'review'>('map')
  const [hasHeaderRow, setHasHeaderRow] = useState(grid.length > 0 && looksLikeHeaderRow(grid[0]))
  const [mapping, setMapping] = useState<Array<GeologyFieldId | null>>(() =>
    Array.from({ length: columnCount }, (_, col) =>
      grid.length > 0 ? guessGeologyField(grid[0][col] ?? '') : null,
    ),
  )
  const [reviewRows, setReviewRows] = useState<string[][]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'none' | 'noFields' | 'save' | 'migration'>('none')

  const mappedCols = useMemo(
    () => mapping.map((field, col) => ({ field, col })).filter((m): m is { field: GeologyFieldId; col: number } => m.field !== null),
    [mapping],
  )

  const previewRows = grid.slice(0, 6)

  const toReview = () => {
    if (mappedCols.length === 0) {
      setError('noFields')
      return
    }
    setError('none')
    const dataRows = hasHeaderRow ? grid.slice(1) : grid
    setReviewRows(dataRows.map((row) => mappedCols.map((m) => (row[m.col] ?? '').trim())))
    setStep('review')
  }

  const records = useMemo(
    () =>
      reviewRows.map((cells) => {
        const record: Record<string, string> = {}
        mappedCols.forEach((m, j) => {
          const header = FIELD_HEADER.get(m.field)
          if (header) record[header] = cells[j] ?? ''
        })
        return record
      }),
    [reviewRows, mappedCols],
  )

  const parsed = useMemo(() => parseGeologyRows(records), [records])
  const summary = useMemo(() => summarizeGeology({ boreholes: parsed.boreholes }), [parsed])

  const editCell = (rowIdx: number, colIdx: number, value: string) => {
    setReviewRows((prev) => {
      const next = prev.map((r) => [...r])
      next[rowIdx][colIdx] = value
      return next
    })
  }

  const confirm = async () => {
    if (parsed.boreholes.length === 0) {
      setError('noFields')
      return
    }
    setBusy(true)
    setError('none')
    try {
      await replaceGeology(projectId, parsed.boreholes)
      await onDone()
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      setError(code === '23514' ? 'migration' : 'save')
    } finally {
      setBusy(false)
    }
  }

  const fieldLabel = (id: GeologyFieldId) => t(`project.geology.pdf.field.${id}`)

  return (
    <div className="pdf-wizard" style={{ marginTop: 16, border: '1px solid var(--line, #d8d8d8)', padding: 16 }}>
      <div className="section-actions" style={{ justifyContent: 'space-between' }}>
        <strong>{t(step === 'map' ? 'project.geology.pdf.mapTitle' : 'project.geology.pdf.reviewTitle')}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          {t('project.geology.pdf.cancel')}
        </button>
      </div>

      {step === 'map' && (
        <>
          <p className="hint">{t('project.geology.pdf.mapHint')}</p>
          <label htmlFor={fieldId('header-row')} className="check" style={{ marginTop: 8 }}>
            <input
              id={fieldId('header-row')}
              name={fieldName('hasHeaderRow')}
              type="checkbox"
              checked={hasHeaderRow}
              onChange={(e) => setHasHeaderRow(e.target.checked)}
            />
            <span>{t('project.geology.pdf.headerRow')}</span>
          </label>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  {Array.from({ length: columnCount }, (_, col) => (
                    <th key={col}>
                      <select
                        id={fieldId(`mapping-${col}`)}
                        name={fieldName(`mapping.${col}`)}
                        className="input input-sm"
                        aria-label={`${t('project.geology.pdf.mapTitle')}: ${col + 1}`}
                        value={mapping[col] ?? ''}
                        onChange={(e) =>
                          setMapping((prev) => {
                            const next = [...prev]
                            next[col] = (e.target.value || null) as GeologyFieldId | null
                            return next
                          })
                        }
                      >
                        <option value="">{t('project.geology.pdf.skip')}</option>
                        {GEOLOGY_FIELDS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {fieldLabel(f.id)}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {Array.from({ length: columnCount }, (_, col) => (
                      <td key={col} className="mono" style={{ fontSize: 12 }}>
                        {row[col] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error === 'noFields' && <p className="notice error">{t('project.geology.pdf.noFields')}</p>}
          <div className="section-actions">
            <button type="button" className="btn btn-sm" onClick={toReview}>
              {t('project.geology.pdf.toReview')}
            </button>
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          <p className="hint">{t('project.geology.pdf.reviewHint')}</p>
          <div className="table-wrap" style={{ marginTop: 12, maxHeight: 360, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  {mappedCols.map((m) => (
                    <th key={m.field}>{fieldLabel(m.field)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((cells, rowIdx) => (
                  <tr key={rowIdx}>
                    <td className="num">{rowIdx + 1}</td>
                    {cells.map((value, colIdx) => (
                      <td key={colIdx}>
                        <input
                          id={fieldId(`review-${rowIdx}-${mappedCols[colIdx]?.col ?? colIdx}`)}
                          name={fieldName(`review.${rowIdx}.${mappedCols[colIdx]?.col ?? colIdx}`)}
                          className="input input-sm"
                          style={{ minWidth: 70 }}
                          aria-label={`${mappedCols[colIdx] ? fieldLabel(mappedCols[colIdx].field) : t('project.geology.pdf.reviewTitle')}: ${rowIdx + 1}`}
                          value={value}
                          onChange={(e) => editCell(rowIdx, colIdx, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="kv-list" style={{ marginTop: 12 }}>
            <div className="kv">
              <span className="kv-label">{t('project.geology.summary.boreholes')}</span>
              <span className="kv-value">{summary.boreholes}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.geology.summary.layers')}</span>
              <span className="kv-value">{summary.layers}</span>
            </div>
          </div>
          {parsed.issues.length > 0 && (
            <p className="stat-line warn">{t('project.geology.pdf.reviewIssues', { count: parsed.issues.length })}</p>
          )}
          {discardedCount > 0 && (
            <p className="stat-line warn">{t('project.geology.pdf.discardedInReview', { count: discardedCount })}</p>
          )}
          {/*
            Скважина с непоследовательными глубинами показывается сомнительной,
            а её слои не пересортированы: порядок стал бы правильным на вид,
            а разрез — выдуманным.
          */}
          {parsed.doubtful.length > 0 && (
            <>
              <p className="stat-line warn">
                {t('project.geology.pdf.doubtfulTitle', { count: parsed.doubtful.length })}
              </p>
              <ul className="hint">
                {parsed.doubtful.map((item) => (
                  <li key={item.label}>
                    {t('project.geology.pdf.doubtfulRow', { label: item.label, depth: item.atDepthM })}
                  </li>
                ))}
              </ul>
            </>
          )}

          {error === 'noFields' && <p className="notice error">{t('project.geology.pdf.noRows')}</p>}
          {error === 'save' && <p className="notice error">{t('project.saveError')}</p>}
          {error === 'migration' && <p className="notice error">{t('project.geology.migrationNeeded')}</p>}

          <div className="section-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('map')} disabled={busy}>
              {t('project.geology.pdf.back')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void confirm()} disabled={busy || summary.boreholes === 0}>
              {t('project.geology.pdf.confirm')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
