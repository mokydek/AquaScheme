import { useTranslation } from 'react-i18next'
import type { ChangeEvent } from 'react'
import type { ExtractionAge } from '@aquascheme/engine'

/**
 * Предупреждение о том, что величины получены не сегодняшним разбором.
 *
 * СТОИТ НАД ВЕЛИЧИНАМИ, А НЕ СНОСКОЙ ВНИЗУ. Три захода подряд чинили
 * извлечение, и все три на живом объекте выглядели так, будто их не было:
 * экран показывает сохранённое, а сохранённое сделано вчерашним кодом.
 * Владелец видел 2,00 м из таблицы нумерации ИГЭ уже после того, как разбор
 * научился её отбрасывать.
 *
 * ВЕЛИЧИНЫ НЕ ПРЯЧУТСЯ. Инженер мог на них уже сослаться, и молчаливое
 * исчезновение хуже устаревшего значения: устаревшее видно и обсуждаемо,
 * исчезнувшее — нет.
 *
 * СОДЕРЖИМОЕ ДОКУМЕНТА В ПРОЕКТЕ НЕ ХРАНИТСЯ. Мастер комплекта кладёт в базу
 * имя файла и результат разбора; сам файл остаётся у инженера. Поэтому
 * перезапуск — это выбор того же файла заново, и так и написано. Заводить
 * хранение файлов ради одной кнопки — отдельная работа и другой разговор.
 */
export function ExtractionAgeNotice({
  age,
  fileName,
  accept,
  busy,
  error,
  onReparse,
  itemId,
}: {
  /** Возраст сохранённого разбора; `null` или «действующий» — ничего не рисуется. */
  age: ExtractionAge | null
  /** Имя документа, каким оно записано в наборе. */
  fileName: string | undefined
  /** Расширения, которые принимает разбор этого документа. */
  accept: string
  busy: boolean
  /** Причина неудавшегося перезапуска, показывается дословно. */
  error: string | null
  onReparse: (file: File) => void
  /** Идентификатор документа — им адресуется поле и проверка. */
  itemId: string
}) {
  const { t } = useTranslation()
  if (age === null || age.kind === 'current') return null

  const inputId = `reparse-${itemId}`
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onReparse(file)
  }

  return (
    <div className="notice warn" role="alert" data-extraction-age={age.kind} data-extraction-item={itemId}>
      <p className="stat-line warn">
        {age.kind === 'outdated' && t('project.extraction.outdated', {
          stored: age.storedVersion, current: age.currentVersion,
        })}
        {age.kind === 'unknown' && t('project.extraction.unknown', { current: age.currentVersion })}
        {age.kind === 'ahead' && t('project.extraction.ahead', {
          stored: age.storedVersion, current: age.currentVersion,
        })}
      </p>
      <p className="hint">{t('project.extraction.kept')}</p>
      {/*
        Ветка «разбор новее кода» перезапуском не лечится: этот код и есть
        старый. Предлагать здесь кнопку значило бы предлагать откатить чужую
        работу своей.
      */}
      {age.kind !== 'ahead' && (
        <>
          <p className="hint">
            {t('project.extraction.noStoredFile', { file: fileName ?? t('project.extraction.unnamedFile') })}
          </p>
          <label className="field" htmlFor={inputId}>
            <span className="field-label">{t('project.extraction.reparse')}</span>
            <input
              id={inputId}
              name={inputId}
              type="file"
              accept={accept}
              disabled={busy}
              onChange={pick}
            />
          </label>
          {busy && <p className="hint">{t('project.extraction.running')}</p>}
        </>
      )}
      {error !== null && (
        <p className="stat-line error" role="alert" data-extraction-error={itemId}>
          {t('project.extraction.failed', { reason: error })}
        </p>
      )}
    </div>
  )
}
