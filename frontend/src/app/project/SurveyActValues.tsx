import { useTranslation } from 'react-i18next'
import type { SurveyActFacts, SurveyActValue } from '@aquascheme/engine'

/**
 * Величины из акта технического обследования — экран подтверждения.
 *
 * Устроен так же, как подтверждение величин ТУ, и по той же причине:
 * ИЗВЛЕЧЁННОЕ НЕ РАВНО ПОДТВЕРЖДЁННОМУ. Каждая находка показывается с цитатой
 * строки и страницей, инженер подтверждает её поштучно, и только подтверждённая
 * ложится в модель АТО. Несколько кандидатов на одну величину показываются все:
 * акт бывает противоречив сам себе, и выбор первого попавшегося был бы
 * догадкой в контрактной величине.
 *
 * Отдельно помечается кандидат ИЗ ССЫЛКИ НА НОРМАТИВ. В настоящем акте труба
 * описана керамической, а рядом стоят два упоминания асбоцемента — оба в
 * ссылках на срок службы по норме. Выбросить их значило бы спрятать
 * противоречие документа; принять молча — подменить материал объекта
 * материалом нормы. Поэтому они видны и помечены.
 *
 * Компонент только показывает: ни чтения файлов, ни записи в базу здесь нет,
 * поэтому его можно проверить отрисовкой.
 */

/** Одна строка таблицы кандидатов. */
export interface SurveyActRow {
  id: string
  key: 'diameterMm' | 'material' | 'lengthM' | 'depthRangeM' | 'category' | 'verdict'
  label: string
  shown: string
  value: number | string | { fromM: number; toM: number }
  page: number | null
  quote: string
  fromNormReference: boolean
}

/** Разворачивает факты акта в строки таблицы, сохраняя порядок величин. */
export function surveyActRows(facts: SurveyActFacts, labels: Record<SurveyActRow['key'], string>): SurveyActRow[] {
  const rows: SurveyActRow[] = []
  const push = <T,>(
    key: SurveyActRow['key'],
    list: Array<SurveyActValue<T>>,
    show: (value: T) => string,
  ) => {
    list.forEach((item, index) => {
      rows.push({
        id: `${key}-${index}`,
        key,
        label: labels[key],
        shown: show(item.value),
        value: item.value as SurveyActRow['value'],
        page: item.page ?? null,
        quote: item.quote,
        fromNormReference: item.fromNormReference === true,
      })
    })
  }
  push('diameterMm', facts.diameterMm, (value) => String(value))
  push('material', facts.material, (value) => value)
  push('lengthM', facts.lengthM, (value) => value.toFixed(2))
  push('depthRangeM', facts.depthRangeM, (value) => `${value.fromM.toFixed(2)}…${value.toM.toFixed(2)}`)
  push('category', facts.category, (value) => value)
  push('verdict', facts.verdicts, (value) => value)
  return rows
}

export function SurveyActValues({
  facts,
  fileName,
  confirmed,
  busy = false,
  onConfirm,
}: {
  facts: SurveyActFacts
  fileName: string
  /** Идентификаторы уже подтверждённых строк. */
  confirmed: string[]
  busy?: boolean
  onConfirm: (row: SurveyActRow) => void
}) {
  const { t } = useTranslation()
  const rows = surveyActRows(facts, {
    diameterMm: t('project.existing.act.valueDiameter'),
    material: t('project.existing.act.valueMaterial'),
    lengthM: t('project.existing.act.valueLength'),
    depthRangeM: t('project.existing.act.valueDepth'),
    category: t('project.existing.act.valueCategory'),
    verdict: t('project.existing.act.valueVerdict'),
  })

  return (
    <div data-survey-act="true">
      <h5>{t('project.existing.act.title')}</h5>
      <p className="hint">{t('project.existing.act.hint')}</p>
      <p className="stat-line">{t('project.existing.act.file', { name: fileName, count: rows.length })}</p>

      {rows.length === 0 && <p className="stat-line warn">{t('project.existing.act.nothingFound')}</p>}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('project.existing.act.thValue')}</th>
                <th scope="col" className="num">{t('project.existing.act.thFound')}</th>
                <th scope="col" className="num">{t('project.existing.act.thPage')}</th>
                <th scope="col">{t('project.existing.act.thQuote')}</th>
                <th scope="col">{t('project.existing.act.thAction')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-survey-act-row={row.id}>
                  <td>{row.label}</td>
                  <td className="num mono">{row.shown}</td>
                  <td className="num mono">{row.page ?? ''}</td>
                  <td className="hint">
                    «{row.quote}»
                    {row.fromNormReference && (
                      <span className="warn" data-from-norm={row.id}>
                        {' '}
                        {t('project.existing.act.fromNorm')}
                      </span>
                    )}
                  </td>
                  <td>
                    {confirmed.includes(row.id)
                      ? <span className="ok">{t('project.existing.act.confirmed')}</span>
                      : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => onConfirm(row)}
                        >
                          {t('project.existing.act.confirm')}
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
        Ненайденное называется вслух. Шероховатости в акте нет ни разу — это не
        пробел разбора, а свойство документа: он о несущей способности
        конструкций, а не о гидравлике. Молчаливой оценки «по износу» здесь не
        появится, величину принимает инженер.
      */}
      {facts.missing.length > 0 && (
        <p className="stat-line warn" data-survey-act-missing="true">
          {t('project.existing.act.missing', { list: facts.missing.join('; ') })}
        </p>
      )}
    </div>
  )
}
