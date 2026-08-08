import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeEvent } from 'react'
import type { ConditionsFromTu } from '@aquascheme/engine'
import { Panel } from './Panel'
import { saveTechnicalCondition } from '../../shared/technicalConditions'
import type { DatasetRow } from '../../shared/datasets'

/**
 * Разбор документа технических условий.
 *
 * ТУ загружается в проект и лежит мёртвым грузом: инженер перепечатывает из
 * него цифры руками, хотя проектный диаметр и требуемый просвет написаны там
 * прямым текстом.
 *
 * Извлечённое НЕ равно подтверждённому. Каждая находка показывается с цитатой
 * строки и номером страницы; инженер подтверждает или отклоняет её по
 * отдельности, и только подтверждённая идёт в расчёт — с происхождением
 * `stated` и ссылкой на файл и страницу. Несколько кандидатов на одну величину
 * показываются все: документ бывает противоречив, и выбор первого попавшегося
 * был бы догадкой в контрактной величине.
 *
 * Скан без текстового слоя — честное сообщение: распознавание образов
 * отложено владельцем, и угадывать вместо него нельзя.
 */

export function TuImportSection({
  projectId,
  conditionsDataset,
  onSaved,
}: {
  projectId: string
  conditionsDataset?: DatasetRow
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [found, setFound] = useState<ConditionsFromTu | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<string[]>([])

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setMessage(null)
    setFound(null)
    try {
      const { loadPdfTextByPage } = await import('../../shared/pdfText')
      const pages = /\.pdf$/i.test(file.name)
        ? (await loadPdfTextByPage(file)).map((page, index) => ({
          page: index + 1,
          text: page.items.map((item) => item.str).join(' '),
        }))
        : [{ page: 1, text: await file.text() }]
      if (pages.every((page) => page.text.trim() === '')) {
        setMessage(t('project.tu.noTextLayer'))
        return
      }
      const { extractConditionsFromTu } = await import('@aquascheme/engine')
      setFound(extractConditionsFromTu(pages))
      setFileName(file.name)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const confirm = async (
    key: 'designDiameterMm' | 'requiredClearanceM' | 'allowedDiametersMm',
    value: number | number[],
    page: number,
    quote: string,
    id: string,
  ) => {
    setBusy(true)
    try {
      await saveTechnicalCondition(projectId, conditionsDataset, key, {
        value: value as never,
        origin: 'stated',
        source: t('project.tu.source', { file: fileName ?? '', page }),
        page,
        quote,
      })
      setConfirmed((previous) => [...previous, id])
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  const rows: Array<{
    id: string
    key: 'designDiameterMm' | 'requiredClearanceM' | 'allowedDiametersMm'
    label: string
    shown: string
    value: number | number[]
    page: number
    quote: string
  }> = found
    ? [
      ...found.designDiameterMm.map((item, index) => ({
        id: `d${index}`, key: 'designDiameterMm' as const, label: t('project.tu.diameter'),
        shown: String(item.value), value: item.value, page: item.page, quote: item.quote,
      })),
      ...found.allowedDiametersMm.map((item, index) => ({
        id: `a${index}`, key: 'allowedDiametersMm' as const, label: t('project.tu.allowed'),
        shown: item.value.join(', '), value: item.value, page: item.page, quote: item.quote,
      })),
      ...found.requiredClearanceM.map((item, index) => ({
        id: `c${index}`, key: 'requiredClearanceM' as const, label: t('project.tu.clearance'),
        shown: String(item.value), value: item.value, page: item.page, quote: item.quote,
      })),
    ]
    : []

  return (
    <Panel title={t('project.tu.title')} status={found ? 'filled' : 'empty'}>
      <p className="hint">{t('project.tu.hint')}</p>

      <div className="section-actions">
        <input
          id={`tu-file-${projectId}`}
          name={`tu-file-${projectId}`}
          className="file-input"
          type="file"
          accept=".pdf,.txt"
          aria-label={t('project.tu.fileLabel')}
          disabled={busy}
          onChange={(event) => void onFile(event)}
        />
      </div>
      {message && <p className="notice error">{message}</p>}
      {fileName && <p className="stat-line">{t('project.tu.file', { name: fileName })}</p>}

      {found && rows.length === 0 && <p className="stat-line warn">{t('project.tu.nothingFound')}</p>}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('project.tu.thValue')}</th>
                <th scope="col" className="num">{t('project.tu.thFound')}</th>
                <th scope="col" className="num">{t('project.tu.thPage')}</th>
                <th scope="col">{t('project.tu.thQuote')}</th>
                <th scope="col">{t('project.tu.thAction')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.label}</td>
                  <td className="num mono">{row.shown}</td>
                  <td className="num mono">{row.page}</td>
                  <td className="hint">«{row.quote}»</td>
                  <td>
                    {confirmed.includes(row.id)
                      ? <span className="ok">{t('project.tu.confirmed')}</span>
                      : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => void confirm(row.key, row.value, row.page, row.quote, row.id)}
                        >
                          {t('project.tu.confirm')}
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {found && found.missing.length > 0 && (
        <p className="stat-line warn">{t('project.tu.missing', { list: found.missing.join(', ') })}</p>
      )}
    </Panel>
  )
}
