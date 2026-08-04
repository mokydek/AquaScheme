import { useTranslation } from 'react-i18next'
import { buildQuantityBill } from '@aquascheme/engine'
import type { DropWell, GravityProfile, SelectedManholeConstruction, SewerSchedule } from '@aquascheme/engine'

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
  dropWells,
  settings,
  onSettingsChange,
  onExport,
  exporting,
  fieldPrefix,
}: {
  profile: GravityProfile
  schedule: SewerSchedule
  constructions: SelectedManholeConstruction[]
  dropWells: DropWell[]
  settings: QuantityBillSettings
  onSettingsChange: (next: QuantityBillSettings) => void
  onExport: () => void
  exporting?: boolean
  fieldPrefix: string
}) {
  const { t } = useTranslation()
  const bill = buildQuantityBill({ profile, schedule, constructions, dropWells, ...settings })
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
      <p className="hint">{t('project.quantityBill.hint')}</p>
      <div className="form-grid">
        {numberField('trenchAllowanceM', t('project.quantityBill.trenchAllowance'), 0.05)}
        {numberField('sideSlopeRatio', t('project.quantityBill.sideSlope'), 0.05)}
        {numberField('beddingThicknessM', t('project.quantityBill.bedding'), 0.05)}
      </div>

      <div className="section-actions">
        <button
          type="button"
          className={`btn btn-sm${exporting ? ' is-loading' : ''}`}
          disabled={exporting || bill.rows.length === 0}
          aria-busy={exporting}
          onClick={onExport}
        >
          {t('project.quantityBill.exportXlsx')}
        </button>
      </div>

      <p className="stat-line">
        {t('project.quantityBill.summary', {
          length: bill.totalLengthM, rows: bill.rows.length, gaps: bill.gaps.length,
        })}
      </p>

      {bill.rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>{t('project.quantityBill.thName')}</th>
              <th>{t('project.quantityBill.thUnit')}</th>
              <th className="num">{t('project.quantityBill.thQuantity')}</th>
              <th>{t('project.quantityBill.thDerivedFrom')}</th>
            </tr></thead>
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
            <thead><tr>
              <th>{t('project.quantityBill.thGapName')}</th>
              <th>{t('project.quantityBill.thGapMissing')}</th>
            </tr></thead>
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
