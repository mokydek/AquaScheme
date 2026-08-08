import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeEvent } from 'react'
import type { ConditionsFromBrief, ConditionsFromTu, UnparsedNumericLine } from '@aquascheme/engine'
import { Panel } from './Panel'
import { saveTechnicalCondition } from '../../shared/technicalConditions'
import type { DatasetRow } from '../../shared/datasets'
import { LOW_CONFIDENCE, confidenceOfQuote } from '../../shared/ocr'
import type { OcrPage, OcrProgress } from '../../shared/ocr'

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
  // ТУ и задание приходят одним комплектом, поэтому разбираются вместе:
  // отдельная секция ради двух величин была бы лишним экраном.
  const [brief, setBrief] = useState<ConditionsFromBrief | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<string[]>([])
  /**
   * Скан, отложенный до нажатия «Распознать».
   *
   * Распознавание — секунды на страницу и 2,6 МБ языковых данных, поэтому оно
   * не запускается само: инженер видит, что текстового слоя нет, и решает.
   */
  const [scan, setScan] = useState<File | null>(null)
  const [ocrPages, setOcrPages] = useState<OcrPage[] | null>(null)
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  /**
   * Строки с числами, которые шаблоны не разобрали.
   *
   * Собираются только для распознанного текста: на цифровом документе величина
   * прочитана шаблоном, и звать инженера проверять её незачем.
   */
  const [unparsed, setUnparsed] = useState<UnparsedNumericLine[]>([])

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
        // Текстового слоя нет — но это больше не тупик: предлагается
        // распознавание. Само оно не запускается: секунды на страницу и
        // 2,6 МБ словаря — решение инженера, а не побочный эффект загрузки.
        setScan(file)
        setFileName(file.name)
        setMessage(t('project.tu.noTextLayerOffer'))
        return
      }
      const { extractConditionsFromTu, extractConditionsFromBrief } = await import('@aquascheme/engine')
      setFound(extractConditionsFromTu(pages))
      setBrief(extractConditionsFromBrief(pages))
      setFileName(file.name)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  /** Распознаёт отложенный скан и прогоняет через ТОТ ЖЕ извлекатель. */
  const recognize = async () => {
    if (!scan) return
    setBusy(true)
    setMessage(null)
    setProgress(null)
    try {
      const { recognizeScan } = await import('../../shared/ocr')
      const pages = await recognizeScan(scan, setProgress)
      const {
        extractConditionsFromTu, extractConditionsFromBrief, unparsedNumericLines,
      } = await import('@aquascheme/engine')
      // Шаблоны, ограничения и экран подтверждения переиспользуются целиком:
      // распознанный текст — это тот же текст, только худшего качества.
      const asPages = pages.map((page) => ({ page: page.page, text: page.text }))
      const conditions = extractConditionsFromTu(asPages)
      setFound(conditions)
      setBrief(extractConditionsFromBrief(asPages))
      // Буква «Д» со скана теряется, и верно прочитанное число иначе не дошло
      // бы до инженера вовсе. Программа при этом ничего не утверждает.
      setUnparsed(unparsedNumericLines(asPages, conditions))
      setOcrPages(pages)
      if (pages.every((page) => page.text.trim() === '')) {
        setMessage(t('project.tu.ocrEmpty'))
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const confirm = async (
    key: 'designDiameterMm' | 'requiredClearanceM' | 'allowedDiametersMm'
      | 'reliabilityCategory' | 'effluentKind',
    value: number | number[] | string,
    page: number,
    quote: string,
    id: string,
    assignedByHand = false,
    /**
     * Оговорка документа. Попадает в источник, чтобы приближение не осталось
     * в проекте неотличимым от контрактной величины.
     */
    preliminary?: string,
  ) => {
    setBusy(true)
    try {
      await saveTechnicalCondition(projectId, conditionsDataset, key, {
        value: value as never,
        // Скан не должен быть неотличим от цифрового документа в аудите.
        origin: ocrPages ? 'ocr' : 'stated',
        source: (preliminary ? t('project.tu.preliminaryPrefix', { mark: preliminary }) + ' ' : '') + (assignedByHand
          ? t('project.tu.assignedSource', { file: fileName ?? '', page })
          : ocrPages
            ? t('project.tu.ocrSource', { file: fileName ?? '', page })
            : t('project.tu.source', { file: fileName ?? '', page })),
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
      | 'reliabilityCategory' | 'effluentKind'
    label: string
    shown: string
    value: number | number[] | string
    page: number
    quote: string
    /** Уверенность строки-источника: `null` для цифрового документа. */
    confidence: number | null
    /** Оговорка документа, делающая величину предварительной. */
    preliminary?: string
  }> = found
    ? [
      ...found.designDiameterMm.map((item, index) => ({
        id: `d${index}`, key: 'designDiameterMm' as const, label: t('project.tu.diameter'),
        shown: String(item.value), value: item.value, page: item.page, quote: item.quote,
        confidence: ocrPages ? confidenceOfQuote(ocrPages, item.page, item.quote) : null,
        preliminary: item.preliminary,
      })),
      ...found.allowedDiametersMm.map((item, index) => ({
        id: `a${index}`, key: 'allowedDiametersMm' as const, label: t('project.tu.allowed'),
        shown: item.value.join(', '), value: item.value, page: item.page, quote: item.quote,
        confidence: ocrPages ? confidenceOfQuote(ocrPages, item.page, item.quote) : null,
        preliminary: item.preliminary,
      })),
      ...found.requiredClearanceM.map((item, index) => ({
        id: `c${index}`, key: 'requiredClearanceM' as const, label: t('project.tu.clearance'),
        shown: String(item.value), value: item.value, page: item.page, quote: item.quote,
        confidence: ocrPages ? confidenceOfQuote(ocrPages, item.page, item.quote) : null,
        preliminary: item.preliminary,
      })),
      ...(brief?.category ?? []).map((item, index) => ({
        id: `k${index}`, key: 'reliabilityCategory' as const, label: t('project.tu.category'),
        shown: t(`project.tu.categoryValue.${item.value}`), value: item.value as string,
        page: item.page, quote: item.quote,
        confidence: ocrPages ? confidenceOfQuote(ocrPages, item.page, item.quote) : null,
      })),
      ...(brief?.effluent ?? []).map((item, index) => ({
        id: `e${index}`, key: 'effluentKind' as const, label: t('project.tu.effluent'),
        shown: t(`project.tu.effluentValue.${item.value}`), value: item.value as string,
        page: item.page, quote: item.quote,
        confidence: ocrPages ? confidenceOfQuote(ocrPages, item.page, item.quote) : null,
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

      {/*
        Распознавание не запускается само: секунды на страницу и 2,6 МБ
        словаря — решение инженера, а не побочный эффект загрузки файла.
      */}
      {scan && !found && (
        <div className="section-actions">
          <button
            type="button"
            className={`btn btn-sm${busy ? ' is-loading' : ''}`}
            disabled={busy}
            aria-busy={busy}
            onClick={() => void recognize()}
          >
            {busy ? t('project.tu.recognizing') : t('project.tu.recognize')}
          </button>
        </div>
      )}
      {progress && (
        <p className="stat-line">
          {t('project.tu.progress', { page: progress.page, total: progress.totalPages })}
        </p>
      )}
      {ocrPages && (
        <p className="stat-line warn">
          {t('project.tu.ocrWarning', { confidence: Math.round(
            ocrPages.reduce((sum, page) => sum + page.confidence, 0) / Math.max(ocrPages.length, 1)) })}
        </p>
      )}
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
                  <td className="hint">
                    «{row.quote}»
                    {row.preliminary && (
                      <span className="warn">
                        {' '}
                        {t('project.tu.preliminary', { mark: row.preliminary })}
                      </span>
                    )}
                    {row.confidence !== null && (
                      <span className={row.confidence < LOW_CONFIDENCE ? ' warn' : ' ok'}>
                        {' '}
                        {t(row.confidence < LOW_CONFIDENCE
                          ? 'project.tu.doubtful'
                          : 'project.tu.recognisedOk', { confidence: Math.round(row.confidence) })}
                      </span>
                    )}
                  </td>
                  <td>
                    {confirmed.includes(row.id)
                      ? <span className="ok">{t('project.tu.confirmed')}</span>
                      : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => void confirm(row.key, row.value, row.page, row.quote, row.id, false, row.preliminary)}
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

      {/*
        Неразобранные строки. Список — предложение посмотреть, а НЕ кандидат:
        программа не утверждает, что число в строке является диаметром или
        просветом. Назначает инженер, и назначение помечается как ручное.
      */}
      {unparsed.length > 0 && (
        <>
          <h5>{t('project.tu.unparsedTitle')}</h5>
          <p className="stat-line warn">{t('project.tu.unparsedHint')}</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="num">{t('project.tu.thPage')}</th>
                  <th scope="col">{t('project.tu.thQuote')}</th>
                  <th scope="col">{t('project.tu.thTrace')}</th>
                  <th scope="col">{t('project.tu.thAssign')}</th>
                </tr>
              </thead>
              <tbody>
                {unparsed.map((line, index) => (
                  <tr key={`u${index}`}>
                    <td className="num mono">{line.page}</td>
                    <td className="hint">«{line.quote}»</td>
                    <td className="hint">{line.trace}</td>
                    <td>
                      {line.numbers.map((number) => (
                        <span key={number}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy || confirmed.includes(`u${index}-${number}`)}
                            onClick={() => void confirm(
                              'designDiameterMm', number, line.page, line.quote,
                              `u${index}-${number}`, true, line.preliminary,
                            )}
                          >
                            {t('project.tu.assignDiameter', { value: number })}
                          </button>
                          {' '}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {found && found.missing.length > 0 && (
        <p className="stat-line warn">{t('project.tu.missing', { list: found.missing.join(', ') })}</p>
      )}
    </Panel>
  )
}
