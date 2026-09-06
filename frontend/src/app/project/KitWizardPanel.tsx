import { useTranslation } from 'react-i18next'
import type { ChangeEvent } from 'react'
import { STANKEVICHA_KIT_SLOTS, kitProgress } from '../../shared/kitWizard'
import type { KitSlotDefinition, KitState } from '../../shared/kitWizard'
import type { UploadStage } from '../../shared/upload'

/**
 * Панель мастера комплекта.
 *
 * Только разметка: состав, порядок и состояния приходят из ядра `kitWizard`,
 * разбор — из штатных конвейеров, которые подставляет владелец панели. Поэтому
 * панель проверяется отрисовкой без Supabase и без чтения файлов.
 *
 * Слот без файла показывает «не загружено» ЯВНО, а не пропадает из списка:
 * комплект должен быть виден целиком, иначе непонятно, чего не хватает.
 */
export function KitWizardPanel({
  state,
  picked,
  busySlotId,
  busyStage,
  onPick,
  onRun,
  slots = STANKEVICHA_KIT_SLOTS,
}: {
  state: KitState
  /** Выбранные, но ещё не прогнанные файлы: имя по слоту. */
  picked: Record<string, string | undefined>
  busySlotId: string | null
  /**
   * Чего ждём, пока слот занят. `null` — обычный разбор.
   *
   * Конвертация — не разбор, и называть их одним «прогон…» значит скрывать
   * минуту пробуждения сервиса за тем же многоточием, что и секунду чтения
   * файла. Процентов и обратного отсчёта здесь нет: их никто не считает.
   */
  busyStage?: UploadStage | null
  onPick: (slotId: string, event: ChangeEvent<HTMLInputElement>) => void
  onRun: () => void
  slots?: readonly KitSlotDefinition[]
}) {
  const { t } = useTranslation()
  const progress = kitProgress(state, slots)
  const pickedCount = slots.filter((slot) => picked[slot.id]).length

  const status = (slot: KitSlotDefinition) => {
    const value = state[slot.id] ?? { kind: 'empty' as const }
    if (value.kind === 'parsed') {
      return (
        <>
          <span className="ok">{t('project.kit.statusParsed', { file: value.fileName })}</span>
          {/*
            Разобран не выбранный файл, а его конвертация. Тот же текст, что в
            разделе импорта: одно событие — одно название.
          */}
          {value.convertedFromDwg && (
            <span className="hint" data-kit-converted={slot.id}>{t('upload.convertedFromDwg')}</span>
          )}
          <span className="hint" data-kit-counters={slot.id}>
            {value.counters.map((counter) => `${counter.label}: ${counter.value}`).join('; ')}
          </span>
        </>
      )
    }
    if (value.kind === 'stored') {
      return (
        <span className="warn">
          {t('project.kit.statusStored', { file: value.fileName, stage: value.parsedAtStage })}
        </span>
      )
    }
    if (value.kind === 'covered') {
      return (
        <span className="ok">
          {t('project.kit.statusCovered', { by: t(`project.kit.slot.${value.byId}`) })}
        </span>
      )
    }
    if (value.kind === 'unverified') {
      // Не «ок» и не «ошибка»: собственный вид, чтобы взгляд не засчитал его
      // ни туда, ни сюда.
      return (
        <span className="warn" role="alert" data-kit-unverified={slot.id}>
          {t('project.kit.statusUnverified', { file: value.fileName, reason: value.reason })}
        </span>
      )
    }
    if (value.kind === 'failed') {
      return (
        <span className="error" role="alert">
          {t('project.kit.statusFailed', { file: value.fileName, reason: value.reason })}
        </span>
      )
    }
    return <span className="hint">{t('project.kit.statusEmpty')}</span>
  }

  return (
    <div className="panel" data-kit-wizard="true">
      <h4>{t('project.kit.title')}</h4>
      <p className="hint">{t('project.kit.hint')}</p>
      <p className="stat-line">
        {t('project.kit.progress', {
          filled: progress.filled, total: progress.total, failed: progress.failed,
          covered: progress.covered, unverified: progress.unverified,
        })}
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('project.kit.thOrder')}</th>
              <th scope="col">{t('project.kit.thSlot')}</th>
              <th scope="col">{t('project.kit.thFile')}</th>
              <th scope="col">{t('project.kit.thStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, index) => (
              <tr key={slot.id} data-kit-slot={slot.id}>
                <td className="num">{index + 1}</td>
                <td>
                  <span>{t(`project.kit.slot.${slot.id}`)}</span>
                  <span className="hint">{slot.hint}</span>
                </td>
                <td>
                  {/*
                    Идентификатор и имя обязательны по контракту форм проекта:
                    без них поле не адресуемо ни подписью, ни автотестом. Имя
                    берётся из идентификатора слота, а не из порядкового номера —
                    порядок может измениться, слот нет.
                  */}
                  <label className="field" htmlFor={`kit-file-${slot.id}`}>
                    <span className="field-label">{t(`project.kit.slot.${slot.id}`)}</span>
                    <input
                      id={`kit-file-${slot.id}`}
                      name={`kit-file-${slot.id}`}
                      type="file"
                      accept={slot.accept}
                      disabled={busySlotId !== null}
                      onChange={(event) => onPick(slot.id, event)}
                    />
                  </label>
                  <span className="hint">{picked[slot.id] ?? t('project.kit.notPicked')}</span>
                </td>
                <td>
                  {busySlotId === slot.id ? (
                    <span className="hint" data-kit-busy={busyStage ?? 'running'}>
                      {busyStage === 'converting' ? t('project.kit.converting') : t('project.kit.running')}
                    </span>
                  ) : status(slot)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="secondary"
        disabled={pickedCount === 0 || busySlotId !== null}
        onClick={onRun}
      >
        {t('project.kit.run', { count: pickedCount })}
      </button>
    </div>
  )
}
