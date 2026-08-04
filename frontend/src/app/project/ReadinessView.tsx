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
  const readiness = summarizeReadiness(drawingSet)
  const { byStatus } = readiness

  return (
    <div>
      <p className={readiness.blockingIssueCount > 0 ? 'notice error' : 'notice info'}>{readiness.reason}</p>
      <p className="stat-line">
        Листов {readiness.sheetCount}: к выпуску {byStatus.VERIFIED} ({readiness.verifiedPercent}%),
        рассчитано {byStatus.CALCULATED}, предварительно {byStatus.PRELIMINARY}, заблокировано {byStatus.BLOCKED}
      </p>

      {readiness.issues.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Причина</th><th className="num">Листов</th><th>Где снимается</th><th>Код</th>
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
