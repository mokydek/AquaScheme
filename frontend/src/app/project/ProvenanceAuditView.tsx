import { useTranslation } from 'react-i18next'
import { provenanceLabel } from '@aquascheme/engine'
import type { ProjectProvenance } from '@aquascheme/engine'

/**
 * Происхождение исходных величин проекта.
 *
 * Отрисовка отделена от сборки входа: набор величин у систем разный — у
 * водопровода нет ни каталога конструкций колодцев, ни расчёта дождевого
 * стока, — а показывается он одинаково. Пока разметка лежала внутри
 * самотёчной секции, В1 этой сводки не видел вовсе, хотя аудит системе не
 * специфичен.
 */
export function ProvenanceAuditView({ provenance }: { provenance: ProjectProvenance }) {
  const { t } = useTranslation()
  return (
    <div>
      <h5>{t('project.provenanceAudit.title')}</h5>
      <p className={`stat-line${provenance.blockers.length === 0 ? ' ok' : ' warn'}`}>
        {t('project.provenanceAudit.share', {
          percent: Math.round(provenance.verifiedShare * 100),
          ready: provenance.total - provenance.blockers.length,
          total: provenance.total,
        })}
      </p>
      <p className="hint">{t('project.provenanceAudit.hint')}</p>
      <div className="table-wrap" style={{ maxHeight: 300 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('project.provenanceAudit.thValue')}</th>
              <th scope="col">{t('project.provenanceAudit.thKind')}</th>
              <th scope="col">{t('project.provenanceAudit.thSource')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(provenance.fields).map(([field, item]) => (
              <tr key={field} className={item.provenance.verified ? undefined : 'row-warn'}>
                <td>{field}</td>
                <td>{provenanceLabel(item.provenance.kind)}</td>
                <td>
                  {item.provenance.source}
                  {item.provenance.note ? ` — ${item.provenance.note}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
