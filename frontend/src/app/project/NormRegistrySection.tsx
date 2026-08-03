import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  NORM_REGISTRY,
  auditClauseHierarchy,
  createNormLock,
  isCompleteConfirmation,
  unverifiedClauses,
  verifyNormLock,
} from '@aquascheme/engine'
import type { NormClauseConfirmation, NormLock } from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { Panel } from './Panel'

/**
 * Реестр нормативных пунктов и сверка неподтверждённых.
 *
 * Реестр помечает пункт неподтверждённым, когда официального документа нет в
 * комплекте репозитория. Но у проектировщика он есть, и сверка по бумаге —
 * такое же законное подтверждение, как транскрипция из PDF: разница лишь в том,
 * кто её выполнил. Поэтому запись обязана нести, по чему сверяли — редакцию,
 * найденный номер пункта, страницу и кто сверял; неполная запись не
 * засчитывается.
 *
 * Сверка живёт в проекте, а не в реестре: она не меняет ни значение, ни статус
 * пункта для других проектов. Если по документу значение иное — это не сверка,
 * а исправление реестра.
 */
export function NormRegistrySection({
  projectId,
  dataset,
  onSaved,
}: {
  projectId: string
  dataset: DatasetRow | undefined
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const content = (dataset?.content ?? {}) as {
    clauseConfirmations?: NormClauseConfirmation[]
    normLock?: NormLock
  }
  const stored = content.clauseConfirmations ?? []

  /**
   * Замок нормативной базы: слепок редакций и статусов на день расчёта.
   *
   * Норматив может смениться, а у правила появиться подтверждённый пункт вместо
   * «неизвестно» — и расчёт полугодовой давности молча перестаёт отвечать тому,
   * на что ссылается пояснительная записка. Замок ничего не блокирует: он
   * показывает, что изменилось с той даты, а решение о пересчёте принимает
   * инженер.
   */
  const drift = content.normLock ? verifyNormLock(content.normLock) : null

  /**
   * Не опирается ли правило реестра на вытеснённый документ.
   *
   * Внутри семейства действует позднейшее издание, а СНиП рядом с действующим
   * СП РК — методический источник, а не основание. Раньше выбор издания держался
   * на внимательности того, кто добавлял запись.
   */
  const hierarchy = auditClauseHierarchy()

  const [confirmations, setConfirmations] = useState<Record<string, NormClauseConfirmation>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'saveError' | null>(null)

  useEffect(() => {
    setConfirmations(Object.fromEntries(stored.map((item) => [item.clauseId, item])))
    setNotice(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.id, dataset?.content])

  const list = Object.values(confirmations)
  const unverified = unverifiedClauses(list)
  const registryUnverified = unverifiedClauses()

  const edit = (clauseId: string, patch: Partial<NormClauseConfirmation>) => {
    setNotice(null)
    setConfirmations((previous) => {
      const base: NormClauseConfirmation = previous[clauseId]
        ?? { clauseId, edition: '', clause: '', page: 0, confirmedBy: '' }
      return { ...previous, [clauseId]: { ...base, ...patch, clauseId } }
    })
  }

  /**
   * @param relock переснять замок нормативной базы.
   *
   * По умолчанию замок сохраняется как есть: если пересоздавать его при каждом
   * сохранении, расхождение обнулялось бы само собой и никогда не показалось
   * бы. Переснять его — осознанное действие инженера после того, как он
   * расхождение увидел.
   */
  const save = async (relock = false) => {
    setBusy(true)
    setNotice(null)
    try {
      await saveDataset(projectId, 'normative', {
        ...((dataset?.content ?? {}) as Record<string, unknown>),
        // Незаполненные черновики в проект не пишутся.
        clauseConfirmations: list.filter((item) => isCompleteConfirmation(item)),
        normLock: relock || !content.normLock
          ? createNormLock(new Date().toISOString())
          : content.normLock,
      })
      setNotice('saved')
      await onSaved()
    } catch {
      setNotice('saveError')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('project.norm.registry.title')} status={unverified.length === 0 ? 'filled' : 'default'}>
      <p className="hint">{t('project.norm.registry.hint')}</p>
      <p className={`stat-line${unverified.length === 0 ? ' ok' : ' warn'}`}>
        {unverified.length === 0
          ? t('project.norm.registry.allVerified')
          : t('project.norm.registry.unverifiedCount', {
            count: unverified.length,
            total: NORM_REGISTRY.length,
          })}
      </p>

      {hierarchy.length > 0 && (
        <div className="parse-report" style={{ marginTop: 12 }}>
          <p className="stat-line warn">
            Правил, опирающихся на вытеснённый или неизвестный документ: {hierarchy.length}.
          </p>
          <p className="hint">
            Внутри семейства действует позднейшее издание; СНиП рядом с действующим СП РК —
            методический источник, а не основание. Это проверка самого реестра, а не вашего
            проекта: исправляется записью реестра.
          </p>
          <ul>
            {hierarchy.slice(0, 10).map((issue) => (
              <li key={issue.clauseId}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {drift && drift.drift.length > 0 && (
        <div className="parse-report" style={{ marginTop: 12 }}>
          <p className={`stat-line${drift.designAffectingCount > 0 ? ' warn' : ''}`}>{drift.reason}</p>
          <p className="hint">
            База зафиксирована {new Date(drift.lockedAtIso).toLocaleDateString('ru-RU')}. Замок ничего
            не блокирует: пересчитывать ли проект, решает инженер.
          </p>
          <ul>
            {drift.drift.slice(0, 12).map((item) => (
              <li key={`${item.kind}-${item.subject}`} className={item.affectsDesign ? 'warn' : undefined}>
                {item.message}
              </li>
            ))}
          </ul>
          <div className="section-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Зафиксировать базу заново
            </button>
          </div>
        </div>
      )}
      {drift && drift.drift.length === 0 && (
        <p className="stat-line ok">
          Нормативная база не менялась с {new Date(drift.lockedAtIso).toLocaleDateString('ru-RU')}.
        </p>
      )}

      {registryUnverified.length > 0 && (
        <details open={unverified.length > 0} style={{ marginTop: 12 }}>
          <summary className="field-label">
            {t('project.norm.registry.checkTitle', { count: registryUnverified.length })}
          </summary>
          <p className="hint">{t('project.norm.registry.checkHint')}</p>
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('project.norm.registry.thDoc')}</th>
                  <th scope="col">{t('project.norm.registry.thRequirement')}</th>
                  <th scope="col" className="num">{t('project.norm.registry.thValue')}</th>
                  <th scope="col">{t('project.norm.registry.thEdition')}</th>
                  <th scope="col">{t('project.norm.registry.thFoundClause')}</th>
                  <th scope="col" className="num">{t('project.norm.registry.thPage')}</th>
                  <th scope="col">{t('project.norm.registry.thConfirmedBy')}</th>
                  <th scope="col">{t('project.norm.registry.thStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {registryUnverified.map((clause) => {
                  const current = confirmations[clause.id]
                  const complete = isCompleteConfirmation(current)
                  const field = (key: string) => `norm-confirm-${encodeURIComponent(clause.id)}-${key}`
                  return (
                    <tr key={clause.id} className={complete ? undefined : 'row-warn'}>
                      <td className="mono" style={{ fontSize: 11 }}>{clause.documentCode}</td>
                      <td>{clause.requirement}</td>
                      <td className="num mono">{clause.valueText}</td>
                      <td>
                        <input
                          id={field('edition')} name={field('edition')} className="input input-sm" type="text"
                          aria-label={`${t('project.norm.registry.thEdition')}: ${clause.id}`}
                          value={current?.edition ?? ''}
                          onChange={(event) => edit(clause.id, { edition: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          id={field('clause')} name={field('clause')} className="input input-sm" type="text"
                          aria-label={`${t('project.norm.registry.thFoundClause')}: ${clause.id}`}
                          placeholder={clause.clause ?? ''}
                          value={current?.clause ?? ''}
                          onChange={(event) => edit(clause.id, { clause: event.target.value })}
                        />
                      </td>
                      <td className="num">
                        <input
                          id={field('page')} name={field('page')} className="input input-sm"
                          type="number" min="1" inputMode="numeric"
                          aria-label={`${t('project.norm.registry.thPage')}: ${clause.id}`}
                          value={current?.page ? String(current.page) : ''}
                          onChange={(event) => edit(clause.id, { page: Number(event.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          id={field('by')} name={field('by')} className="input input-sm" type="text"
                          aria-label={`${t('project.norm.registry.thConfirmedBy')}: ${clause.id}`}
                          value={current?.confirmedBy ?? ''}
                          onChange={(event) => edit(clause.id, { confirmedBy: event.target.value })}
                        />
                      </td>
                      <td>
                        {complete
                          ? t('project.norm.registry.checked')
                          : t('project.norm.registry.unverified')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="section-actions">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>
              {t('project.save')}
            </button>
          </div>
          {notice && (
            <p className={`notice ${notice === 'saved' ? 'info' : 'error'}`}>{t(`project.${notice}`)}</p>
          )}
        </details>
      )}

      <details style={{ marginTop: 12 }}>
        <summary className="field-label">{t('project.norm.registry.allTitle')}</summary>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('project.norm.registry.thDoc')}</th>
                <th scope="col">{t('project.norm.registry.thClause')}</th>
                <th scope="col">{t('project.norm.registry.thRequirement')}</th>
                <th scope="col" className="num">{t('project.norm.registry.thValue')}</th>
                <th scope="col" className="num">{t('project.norm.registry.thPage')}</th>
                <th scope="col">{t('project.norm.registry.thStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {NORM_REGISTRY.map((c) => {
                const checkedHere = isCompleteConfirmation(confirmations[c.id])
                return (
                  <tr key={c.id} className={c.status === 'unverified' && !checkedHere ? 'row-warn' : undefined}>
                    <td className="mono" style={{ fontSize: 11 }}>{c.documentCode}</td>
                    <td className="mono">{confirmations[c.id]?.clause || c.clause || 'TODO'}</td>
                    <td>{c.requirement}</td>
                    <td className="num mono">{c.valueText}</td>
                    <td className="num mono">{confirmations[c.id]?.page || c.sourcePage || ''}</td>
                    <td>
                      {c.status === 'verified'
                        ? t('project.norm.registry.verified')
                        : checkedHere
                          ? t('project.norm.registry.checked')
                          : t('project.norm.registry.unverified')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </Panel>
  )
}
