import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { looksLikeDatasetKindRejection } from '../../shared/errorFormatting'
import type { DatasetRow } from '../../shared/datasets'
import { saveDataset } from '../../shared/datasets'
import { titleBlockContentFrom } from './titleBlockContent'
import type { TitleBlockContent } from './titleBlockContent'
import { Panel } from './Panel'

/**
 * Организация и подписанты основной надписи (ГОСТ Р 21.101-2020, форма 3).
 *
 * Модель штампа была написана и проверена, графы 9–13 в ней предусмотрены, но
 * заполнять их было нечем: данных организации и ответственных проект нигде не
 * хранил, и на каждом листе альбома эти графы оставались пустыми.
 *
 * Ничего не подставляется по умолчанию. Пустая графа честнее выдуманной
 * фамилии: подпись под проектным документом — это ответственность конкретного
 * человека, и приложение её не назначает. Сами подписи не воспроизводятся —
 * их ставит человек, приложение печатает только фамилию и дату.
 */

/** Графа 10: характер работы. Состав ролей — по стандарту. */
const ROLES = ['Разраб.', 'Пров.', 'Н.контр.', 'ГИП'] as const

export function TitleBlockSection({
  projectId,
  dataset,
  onSaved,
}: {
  projectId: string
  dataset?: DatasetRow
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const saved = (dataset?.content ?? {}) as TitleBlockContent
  const [organisation, setOrganisation] = useState(saved.organisation ?? '')
  const [names, setNames] = useState<Record<string, string>>({})
  const [dates, setDates] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOrganisation(saved.organisation ?? '')
    const byRole = new Map((saved.signatories ?? []).map((item) => [item.role, item]))
    setNames(Object.fromEntries(ROLES.map((role) => [role, byRole.get(role)?.name ?? ''])))
    setDates(Object.fromEntries(ROLES.map((role) => [role, byRole.get(role)?.date ?? ''])))
    // Пересобирается при смене набора: правки другого пользователя должны
    // приходить в поля, а не оставаться перекрытыми состоянием экрана.
  }, [dataset])

  const filled = ROLES.filter((role) => (names[role] ?? '').trim() !== '').length

  const commit = async () => {
    setBusy(true)
    setError(null)
    try {
      const content = titleBlockContentFrom(organisation, ROLES, names, dates)
      await saveDataset(projectId, 'title_block', content)
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('project.titleBlock.title')} status={organisation.trim() && filled > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.titleBlock.hint')}</p>

      <div className="form-grid">
        <label className="field" htmlFor={`title-block-${projectId}-organisation`}>
          <span className="field-label">{t('project.titleBlock.organisation')}</span>
          <input
            id={`title-block-${projectId}-organisation`}
            name={`title-block-${projectId}-organisation`}
            className="input"
            type="text"
            value={organisation}
            disabled={busy}
            onChange={(event) => setOrganisation(event.target.value)}
            onBlur={() => void commit()}
          />
        </label>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <th>{t('project.titleBlock.thRole')}</th>
            <th>{t('project.titleBlock.thName')}</th>
            <th>{t('project.titleBlock.thDate')}</th>
          </tr></thead>
          <tbody>{ROLES.map((role) => (
            <tr key={role}>
              <td>{role}</td>
              <td>
                <input
                  id={`title-block-${projectId}-name-${role}`}
                  name={`title-block-${projectId}-name-${role}`}
                  className="input"
                  type="text"
                  aria-label={t('project.titleBlock.nameLabel', { role })}
                  value={names[role] ?? ''}
                  disabled={busy}
                  onChange={(event) => setNames((prev) => ({ ...prev, [role]: event.target.value }))}
                  onBlur={() => void commit()}
                />
              </td>
              <td>
                <input
                  id={`title-block-${projectId}-date-${role}`}
                  name={`title-block-${projectId}-date-${role}`}
                  className="input"
                  type="text"
                  aria-label={t('project.titleBlock.dateLabel', { role })}
                  placeholder="ММ.ГГ"
                  value={dates[role] ?? ''}
                  disabled={busy}
                  onChange={(event) => setDates((prev) => ({ ...prev, [role]: event.target.value }))}
                  onBlur={() => void commit()}
                />
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <p className="stat-line">
        {t('project.titleBlock.filled', { filled, total: ROLES.length })}
        {organisation.trim() === '' ? t('project.titleBlock.noOrganisation') : ''}
      </p>
      {error && <p className="notice error">{error}</p>}
      {/* Подсказка администратору — только когда база действительно отказала. */}
      {looksLikeDatasetKindRejection(error) && <p className="hint">{t('project.titleBlock.migrationHint')}</p>}
    </Panel>
  )
}
