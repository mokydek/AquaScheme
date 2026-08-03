import { buildQuantityBill } from '@aquascheme/engine'
import type { GravityProfile, SelectedManholeConstruction, SewerSchedule } from '@aquascheme/engine'

/**
 * Ведомость объёмов работ.
 *
 * Величины земляных работ вводит инженер: норматива на ширину траншеи и
 * заложение откоса в реестре проекта нет, а принятые «по практике» значения
 * дали бы объём, неотличимый от расчётного, и попали бы прямо в смету.
 * Незаполненные строки не исчезают — они показываются с указанием, чего им не
 * хватает.
 */
export interface QuantityBillSettings {
  trenchAllowanceM?: number
  sideSlopeRatio?: number
  beddingThicknessM?: number
}

export function QuantityBillView({
  profile,
  schedule,
  constructions,
  settings,
  onSettingsChange,
  onExport,
  exporting,
  fieldPrefix,
}: {
  profile: GravityProfile
  schedule: SewerSchedule
  constructions: SelectedManholeConstruction[]
  settings: QuantityBillSettings
  onSettingsChange: (next: QuantityBillSettings) => void
  onExport: () => void
  exporting?: boolean
  fieldPrefix: string
}) {
  const bill = buildQuantityBill({ profile, schedule, constructions, ...settings })
  const numberField = (
    key: keyof QuantityBillSettings,
    label: string,
    step: number,
  ) => (
    <label className="field" htmlFor={`${fieldPrefix}-${key}`}>
      <span className="field-label">{label}</span>
      <input
        id={`${fieldPrefix}-${key}`}
        name={`${fieldPrefix}-${key}`}
        className="input"
        type="number"
        min={0}
        step={step}
        value={settings[key] ?? ''}
        onChange={(event) => {
          const raw = event.target.value.trim()
          const parsed = Number(raw)
          onSettingsChange({
            ...settings,
            [key]: raw === '' || !Number.isFinite(parsed) || parsed < 0 ? undefined : parsed,
          })
        }}
      />
    </label>
  )

  return (
    <div>
      <p className="hint">
        Длины по диаметрам и колодцы по типам выводятся из расчёта. Земляные работы зависят от ширины траншеи и
        заложения откоса: норматива на них в реестре проекта нет, поэтому величины задаёт инженер, а по умолчанию
        не принимаются — иначе объём попал бы в смету неотличимым от расчётного.
      </p>
      <div className="form-grid">
        {numberField('trenchAllowanceM', 'Зазор от трубы до стенки траншеи, м', 0.05)}
        {numberField('sideSlopeRatio', 'Заложение откоса m (0 — вертикальные стенки)', 0.05)}
        {numberField('beddingThicknessM', 'Толщина песчаного основания, м', 0.05)}
      </div>

      <div className="section-actions">
        <button
          type="button"
          className={`btn btn-sm${exporting ? ' is-loading' : ''}`}
          disabled={exporting || bill.rows.length === 0}
          aria-busy={exporting}
          onClick={onExport}
        >
          Ведомость объёмов XLSX
        </button>
      </div>

      <p className="stat-line">Трасса {bill.totalLengthM} м · строк посчитано {bill.rows.length} · не посчитано {bill.gaps.length}</p>

      {bill.rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Наименование</th><th>Ед.</th><th className="num">Кол-во</th><th>Из чего получено</th></tr></thead>
            <tbody>{bill.rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.unit}</td>
                <td className="num">{row.quantity}</td>
                <td>{row.derivedFrom}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {bill.gaps.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Не посчитано</th><th>Чего не хватает</th></tr></thead>
            <tbody>{bill.gaps.map((item) => (
              <tr key={item.name} className="row-warn">
                <td>{item.name}</td>
                <td>{item.missing}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
