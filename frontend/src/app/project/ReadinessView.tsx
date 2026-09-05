import { useTranslation } from 'react-i18next'
import { summarizeReadiness } from '@aquascheme/engine'
import type { WorkingDrawingSet } from '@aquascheme/engine'

/**
 * Готовность проекта к выпуску.
 *
 * Шлюз набора рабочих чертежей знал всё, что мешает выпуску, но раскладывал это
 * по листам: чтобы понять состояние проекта, надо было пролистать альбом и
 * сложить замечания в голове, притом что одна причина держит десяток листов.
 *
 * Свод берётся из того же набора, что и сам альбом. Ничего не пересчитывается —
 * иначе экран готовности разошёлся бы со шлюзом.
 */
export function ReadinessView({ drawingSet }: { drawingSet: WorkingDrawingSet }) {
  const { t } = useTranslation()
  const readiness = summarizeReadiness(drawingSet)
  const { byStatus } = readiness
  /*
    ОСТАТОК НАЗЫВАЕТСЯ, А НЕ ПРОПАДАЕТ.

    В строке стояло «Листов 5: к выпуску 0, рассчитано 0, предварительно 0,
    заблокировано 0» — арифметически невозможное для читателя. Пятый статус,
    STALE, в строке назван не был, и лист, ставший устаревшим, исчезал из
    сводки, оставаясь в общем числе.

    Пересчитывать здесь ничего нельзя — свод берётся из шлюза. Зато можно
    проверить, что перечисленное сходится с общим числом, и назвать разницу.
    Тогда следующий новый статус не спрячется так же: он выйдет строкой
    «прочие статусы», а не тихой недостачей.
  */
  const named = byStatus.VERIFIED + byStatus.CALCULATED + byStatus.PRELIMINARY
    + byStatus.BLOCKED + byStatus.STALE
  const others = readiness.sheetCount - named

  return (
    <div>
      <p className={readiness.blockingIssueCount > 0 ? 'notice error' : 'notice info'}>{readiness.reason}</p>
      <p className="stat-line">
        {t('project.readiness.summary', {
          total: readiness.sheetCount,
          verified: byStatus.VERIFIED,
          percent: readiness.verifiedPercent,
          calculated: byStatus.CALCULATED,
          preliminary: byStatus.PRELIMINARY,
          blocked: byStatus.BLOCKED,
          stale: byStatus.STALE,
        })}
      </p>
      {others !== 0 && (
        <p className="stat-line warn" role="alert" data-readiness-others="true">
          {t('project.readiness.others', { count: others })}
        </p>
      )}

      {readiness.issues.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('project.readiness.thReason')}</th>
                <th className="num">{t('project.readiness.thSheets')}</th>
                <th>{t('project.readiness.thSection')}</th>
                <th>{t('project.readiness.thAction')}</th>
                <th>{t('project.readiness.thCode')}</th>
              </tr>
            </thead>
            {/*
              Причина → раздел → действие, и раздел — ССЫЛКА, а не подпись.
              Названный словами раздел владелец искал прокруткой, а действие не
              называлось вовсе: «не решено» так и оставалось «не решено».
            */}
            <tbody>{readiness.issues.map((issue) => (
              <tr key={issue.code} className={issue.blocking ? 'row-warn' : undefined}>
                <td>{issue.message}</td>
                <td className="num">{issue.sheetCount}</td>
                <td>
                  {issue.anchor
                    ? <a href={`#${issue.anchor}`} data-readiness-jump={issue.code}>{issue.section}</a>
                    : issue.section ?? '—'}
                </td>
                <td className="hint">{issue.action ?? '—'}</td>
                <td className="mono">{issue.code}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
