import { useTranslation } from 'react-i18next'
import { planStormInlets } from '@aquascheme/engine'
import type { GravityProfile } from '@aquascheme/engine'

/**
 * Дождеприёмники К2 по п. 7.6.6.
 *
 * Ширину улицы вводит инженер: в топосъёмке её нет, а подставленное умолчание
 * задало бы шаг, который попал бы в ведомость как расчётный. Пока ширина не
 * задана, расстановка не выполняется и прямо об этом говорит.
 */
export function StormInletsView({
  profile,
  streetWidthM,
  onStreetWidthChange,
  disabled,
  fieldId,
}: {
  profile: GravityProfile
  streetWidthM: number | null
  onStreetWidthChange: (value: number | null) => void
  disabled?: boolean
  fieldId: string
}) {
  const { t } = useTranslation()
  const plan = planStormInlets(profile, streetWidthM)

  return (
    <div>
      <p className="hint">{t('project.stormInlets.hint')}</p>
      <div className="form-grid">
        <label className="field" htmlFor={fieldId}>
          <span className="field-label">{t('project.stormInlets.streetWidth')}</span>
          <input
            id={fieldId}
            name={fieldId}
            className="input"
            type="number"
            min={0}
            step={0.5}
            value={streetWidthM ?? ''}
            disabled={disabled}
            onChange={(event) => {
              const raw = event.target.value.trim()
              const parsed = Number(raw)
              onStreetWidthChange(raw === '' || !Number.isFinite(parsed) || parsed <= 0 ? null : parsed)
            }}
          />
        </label>
      </div>

      {!plan.ok ? (
        plan.blockers.map((blocker) => <p className="notice error" key={blocker}>{blocker}</p>)
      ) : (
        <div>
          <p className="stat-line">
            {t('project.stormInlets.summary', { total: plan.totalInlets, runs: plan.runs.length })}
          </p>
          {plan.notes.map((note) => <p className="stat-line warn" key={note}>{note}</p>)}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('project.stormInlets.thSegment')}</th>
                  <th className="num">{t('project.stormInlets.thLength')}</th>
                  <th className="num">{t('project.stormInlets.thSlope')}</th>
                  <th className="num">{t('project.stormInlets.thSpacing')}</th>
                  <th className="num">{t('project.stormInlets.thCount')}</th>
                  <th className="num">{t('project.stormInlets.thActual')}</th>
                  <th>{t('project.stormInlets.thChainages')}</th>
                </tr>
              </thead>
              <tbody>{plan.runs.map((run) => (
                <tr key={`${run.fromNodeId}-${run.toNodeId}`}>
                  <td>{run.fromNodeId} — {run.toNodeId}</td>
                  <td className="num">{run.lengthM.toFixed(1)}</td>
                  <td className="num">{(run.slope * 1000).toFixed(1)} ‰</td>
                  <td className="num">{run.spacing.value}</td>
                  <td className="num">{run.inletCount}</td>
                  <td className="num">{run.actualSpacingM.toFixed(1)}</td>
                  <td className="mono">{run.chainagesM.join(', ')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
