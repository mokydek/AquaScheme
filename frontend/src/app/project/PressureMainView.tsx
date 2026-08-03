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
  const requiredHeadM = pressure.requiredPumpHeadM
  const outcome = pumpSelectionFor(pressure, designFlowLps, catalog)

  return (
    <div>
      <p className="hint">
        Напор считается по Дарси — Вейсбаху с коэффициентом Свами — Джейна. Требуемый напор складывается из
        геометрического подъёма, потерь по длине и местных потерь: подъём сам по себе насос не определяет.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            <tr><th>Геометрический подъём</th><td className="num">{pressure.staticHeadM.toFixed(2)} м</td></tr>
            <tr><th>Потери по длине</th><td className="num">{pressure.frictionHeadM.toFixed(2)} м</td></tr>
            <tr>
              <th>Требуемый напор насоса</th>
              <td className="num">{requiredHeadM == null ? '—' : `${requiredHeadM.toFixed(2)} м`}</td>
            </tr>
            <tr>
              <th>Заявлено по ЛНС</th>
              <td className="num">{pressure.availablePumpHeadM == null ? '—' : `${pressure.availablePumpHeadM.toFixed(2)} м`}</td>
            </tr>
            <tr className={pressure.reserveHeadM != null && pressure.reserveHeadM < 0 ? 'row-warn' : undefined}>
              <th>Запас</th>
              <td className="num">{pressure.reserveHeadM == null ? '—' : `${pressure.reserveHeadM.toFixed(2)} м`}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {pressure.pipes.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Участок</th><th className="num">Длина, м</th><th className="num">Ø, мм</th>
                <th className="num">Ниток</th><th className="num">Расход, л/с</th>
                <th className="num">Скорость, м/с</th><th className="num">Потери, м</th>
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

      <h4>Насосное оборудование</h4>
      {!outcome.ok ? (
        <p className="notice">Подбор не выполняется: {outcome.missing.join('; ')}.</p>
      ) : (
        <div>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                <tr><th>Марка</th><td>{outcome.selection.pump?.designation ?? '—'}</td></tr>
                <tr><th>Источник марки</th><td>{outcome.selection.pump?.source ?? '—'}</td></tr>
                <tr><th>Подача одного агрегата</th><td className="num">{outcome.selection.perPumpFlowLps.toFixed(2)} л/с</td></tr>
                <tr><th>Рабочих</th><td className="num">{outcome.selection.workingCount}</td></tr>
                <tr><th>Резервных (устанавливаются)</th><td className="num">{outcome.selection.standbyCount}</td></tr>
                <tr><th>Всего монтируется</th><td className="num">{outcome.selection.totalInstalled}</td></tr>
                <tr><th>Хранится на складе</th><td className="num">{outcome.selection.spareOnStoreCount}</td></tr>
                <tr>
                  <th>Установленная мощность</th>
                  <td className="num">
                    {outcome.selection.pump?.powerKw == null
                      ? 'не задана каталогом'
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
