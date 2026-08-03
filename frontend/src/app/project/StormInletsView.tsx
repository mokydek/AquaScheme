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
  const plan = planStormInlets(profile, streetWidthM)

  return (
    <div>
      <p className="hint">
        Шаг дождеприёмников по п. 7.6.6 зависит от продольного уклона лотка, а при ширине улицы более 30 м
        ограничен 60 м независимо от уклона. Уклон берётся по земле между узлами профиля — лоток идёт по
        поверхности, а не по трубе. Число приёмников округляется вверх: шаг предельный, превышать его нельзя.
      </p>
      <div className="form-grid">
        <label className="field" htmlFor={fieldId}>
          <span className="field-label">Ширина улицы, м</span>
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
            Дождеприёмников: {plan.totalInlets} на {plan.runs.length} участках профиля.
          </p>
          {plan.notes.map((note) => <p className="stat-line warn" key={note}>{note}</p>)}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Участок</th><th className="num">Длина, м</th><th className="num">Уклон лотка</th>
                  <th className="num">Шаг по п. 7.6.6, м</th><th className="num">Приёмников</th>
                  <th className="num">Фактический шаг, м</th><th>Пикетаж, м</th>
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
