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
        })}
      </p>

      {readiness.issues.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('project.readiness.thReason')}</th>
                <th className="num">{t('project.readiness.thSheets')}</th>
                <th>{t('project.readiness.thSection')}</th>
                <th>{t('project.readiness.thCode')}</th>
              </tr>
            </thead>
            <tbody>{readiness.issues.map((issue) => (
              <tr key={issue.code} className={issue.blocking ? 'row-warn' : undefined}>
                <td>{issue.message}</td>
                <td className="num">{issue.sheetCount}</td>
                <td>{issue.section ?? '—'}</td>
                <td className="mono">{issue.code}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
