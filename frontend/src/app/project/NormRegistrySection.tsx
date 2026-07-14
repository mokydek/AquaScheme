import { useTranslation } from 'react-i18next'
import { NORM_REGISTRY, unverifiedClauses } from '@aquascheme/engine'
import { Panel } from './Panel'

/**
 * The norm registry and a checklist of unverified entries (requirements
 * update 2, N3). Unverified clauses were derived from general engineering
 * knowledge and must be confirmed against the official SP RK / GOST text.
 */
export function NormRegistrySection() {
  const { t } = useTranslation()
  const unverified = unverifiedClauses()

  return (
    <Panel title={t('project.norm.registry.title')} status={unverified.length === 0 ? 'filled' : 'default'}>
      <p className="hint">{t('project.norm.registry.hint')}</p>
      <p className={`stat-line${unverified.length === 0 ? ' ok' : ' warn'}`}>
        {unverified.length === 0
          ? t('project.norm.registry.allVerified')
          : t('project.norm.registry.unverifiedCount', { count: unverified.length, total: NORM_REGISTRY.length })}
      </p>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('project.norm.registry.thDoc')}</th>
              <th>{t('project.norm.registry.thClause')}</th>
              <th>{t('project.norm.registry.thRequirement')}</th>
              <th className="num">{t('project.norm.registry.thValue')}</th>
              <th className="num">{t('project.norm.registry.thPage')}</th>
              <th>{t('project.norm.registry.thStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {NORM_REGISTRY.map((c) => (
              <tr key={c.id} className={c.status === 'unverified' ? 'row-warn' : undefined}>
                <td className="mono" style={{ fontSize: 11 }}>{c.documentCode}</td>
                <td className="mono">{c.clause ?? 'TODO'}</td>
                <td>{c.requirement}</td>
                <td className="num mono">{c.valueText}</td>
                <td className="num mono">{c.sourcePage ?? ''}</td>
                <td>
                  {c.status === 'verified'
                    ? t('project.norm.registry.verified')
                    : t('project.norm.registry.unverified')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
