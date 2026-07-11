import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getClause } from '@aquascheme/engine'
import type { Basis } from '@aquascheme/engine'

/**
 * Norm basis marker next to a decision or a warning (requirements update 2,
 * N3). Shows the document and clause; unverified clauses are flagged; a
 * decision the norms do not regulate is labelled as a project or engineering
 * decision instead of being masked as normative. Click expands the clause
 * requirement text.
 */
export function NormBadge({ refs, basis = 'normative' }: { refs?: string[]; basis?: Basis }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const clauses = (refs ?? []).map((id) => getClause(id)).filter((c): c is NonNullable<typeof c> => !!c)

  if (clauses.length === 0) {
    if (basis === 'economic') return <span className="norm-badge norm-project">{t('project.norm.project')}</span>
    if (basis === 'engineering') return <span className="norm-badge norm-project">{t('project.norm.engineering')}</span>
    return null
  }

  const primary = clauses[0]
  const anyUnverified = clauses.some((c) => c.status === 'unverified')
  const clauseText = primary.clause
    ? `${t('project.norm.clausePrefix')} ${primary.clause}`
    : t('project.norm.todoClause')

  return (
    <span className="norm-badge-wrap">
      <button
        type="button"
        className={`norm-badge${anyUnverified ? ' norm-unverified' : ' norm-ok'}`}
        onClick={() => setOpen((v) => !v)}
      >
        {t('project.norm.basisLabel')}: {primary.documentCode} {clauseText}
        {anyUnverified ? ` · ${t('project.norm.unverified')}` : ''}
      </button>
      {open && (
        <span className="norm-detail">
          {clauses.map((c) => (
            <span className="norm-detail-row" key={c.id}>
              <span className="mono">
                {c.documentCode} {c.clause ? `${t('project.norm.clausePrefix')} ${c.clause}` : t('project.norm.todoClause')}
              </span>
              {' — '}
              {c.requirement}
              {c.valueText ? ` (${c.valueText}${c.units && c.units !== '—' ? ' ' + c.units : ''})` : ''}
              {c.status === 'unverified' ? ` · ${t('project.norm.unverified')}` : ''}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
