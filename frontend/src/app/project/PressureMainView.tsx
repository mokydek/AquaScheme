import { useTranslation } from 'react-i18next'
import type { PressureMainResult } from '@aquascheme/engine'
import type { PumpCatalogContent } from './PumpCatalogSection'
import { pumpSelectionFor } from './pumpSelection'

/**
 * Напорный участок от ЛНС и подбор насосов.
 *
 * Расчёт `solvePressureMain` выполнялся и раньше, но из него на экран попадали
 * одни стоп-факторы: статический напор, потери по длине, требуемый напор и
 * запас никуда не выводились. Подбор насосов по таблице 8.2 существовал с
 * тестами и не вызывался ниоткуда.
 *
 * Требуемый напор берётся из расчёта, а не из геометрического подъёма: подъём
 * — только его часть, и подставить её вместо целого значило бы занизить насос.
 *
 * Тексты идут через словари. Казахские значения не заданы: терминологию задаёт
 * владелец словаря, а придуманный технический термин в проектном интерфейсе
 * хуже отсутствия перевода. До них i18next откатывается на русский — ровно то
 * поведение, что было при зашитых строках.
 */
export function PressureMainView({
  pressure,
  designFlowLps,
  catalog,
}: {
  pressure: PressureMainResult
  designFlowLps: number
  catalog: PumpCatalogContent
}) {
  const { t } = useTranslation()
  const requiredHeadM = pressure.requiredPumpHeadM
  const outcome = pumpSelectionFor(pressure, designFlowLps, catalog)
  const metres = (value: number | null | undefined) =>
    value == null ? '—' : `${value.toFixed(2)} м`

  return (
    <div>
      <p className="hint">{t('project.pressureMain.hint')}</p>

      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            <tr><th>{t('project.pressureMain.staticHead')}</th><td className="num">{metres(pressure.staticHeadM)}</td></tr>
            <tr><th>{t('project.pressureMain.frictionHead')}</th><td className="num">{metres(pressure.frictionHeadM)}</td></tr>
            <tr><th>{t('project.pressureMain.requiredHead')}</th><td className="num">{metres(requiredHeadM)}</td></tr>
            <tr><th>{t('project.pressureMain.declaredHead')}</th><td className="num">{metres(pressure.availablePumpHeadM)}</td></tr>
            <tr className={pressure.reserveHeadM != null && pressure.reserveHeadM < 0 ? 'row-warn' : undefined}>
              <th>{t('project.pressureMain.reserve')}</th>
              <td className="num">{metres(pressure.reserveHeadM)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {pressure.pipes.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('project.pressureMain.thSegment')}</th>
                <th className="num">{t('project.pressureMain.thLength')}</th>
                <th className="num">{t('project.pressureMain.thDiameter')}</th>
                <th className="num">{t('project.pressureMain.thBarrels')}</th>
                <th className="num">{t('project.pressureMain.thFlow')}</th>
                <th className="num">{t('project.pressureMain.thVelocity')}</th>
                <th className="num">{t('project.pressureMain.thHeadloss')}</th>
              </tr>
            </thead>
            <tbody>{pressure.pipes.map((pipe) => (
              <tr key={pipe.id}>
                <td>{pipe.id}</td>
                <td className="num">{pipe.lengthM.toFixed(1)}</td>
                <td className="num">{pipe.diameterMm}</td>
                <td className="num">{pipe.parallelCount ?? 1}</td>
                <td className="num">{pipe.flowLps.toFixed(1)}</td>
                <td className="num">{pipe.velocityMs.toFixed(2)}</td>
                <td className="num">{pipe.headlossM.toFixed(2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <h4>{t('project.pressureMain.pumpsTitle')}</h4>
      {!outcome.ok ? (
        <p className="notice">{t('project.pressureMain.notSelected', { missing: outcome.missing.join('; ') })}</p>
      ) : (
        <div>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                <tr><th>{t('project.pressureMain.designation')}</th><td>{outcome.selection.pump?.designation ?? '—'}</td></tr>
                <tr><th>{t('project.pressureMain.designationSource')}</th><td>{outcome.selection.pump?.source ?? '—'}</td></tr>
                <tr><th>{t('project.pressureMain.perPumpFlow')}</th><td className="num">{outcome.selection.perPumpFlowLps.toFixed(2)} л/с</td></tr>
                <tr><th>{t('project.pressureMain.working')}</th><td className="num">{outcome.selection.workingCount}</td></tr>
                <tr><th>{t('project.pressureMain.standby')}</th><td className="num">{outcome.selection.standbyCount}</td></tr>
                <tr><th>{t('project.pressureMain.totalInstalled')}</th><td className="num">{outcome.selection.totalInstalled}</td></tr>
                <tr><th>{t('project.pressureMain.spareOnStore')}</th><td className="num">{outcome.selection.spareOnStoreCount}</td></tr>
                <tr>
                  <th>{t('project.pressureMain.installedPower')}</th>
                  <td className="num">
                    {outcome.selection.pump?.powerKw == null
                      ? t('project.pressureMain.powerUnknown')
                      : `${(outcome.selection.pump.powerKw * outcome.selection.totalInstalled).toFixed(1)} кВт`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {outcome.selection.notes.map((note) => <p className="stat-line" key={note}>{note}</p>)}
          {outcome.selection.blockers.map((blocker) => <p className="notice error" key={blocker}>{blocker}</p>)}
        </div>
      )}
    </div>
  )
}
