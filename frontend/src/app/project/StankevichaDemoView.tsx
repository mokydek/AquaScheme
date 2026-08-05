import { useTranslation } from 'react-i18next'
import {
  STANKEVICHA_CHAMBERS,
  STANKEVICHA_CONDITIONS as TU,
  STANKEVICHA_GEOLOGY as GEO,
  STANKEVICHA_MIN_MAIN_DEPTH_M,
  stankevichaChainLengthM,
} from '../../shared/stankevichaDemo'

/**
 * Демонстрация на настоящем объекте.
 *
 * Учебная сеть показывает, что расчёт работает. Настоящий объект показывает
 * то, чего она показать не может: где программа расходится с документами и на
 * чём стоит шлюз выпуска. Поэтому расхождение здесь выведено первой строкой, а
 * не спрятано в подвале.
 *
 * Величины производные, исходники объекта в репозиторий не входят.
 */
export function StankevichaDemoView() {
  const { t } = useTranslation()
  const lengthM = stankevichaChainLengthM()
  const deltaM = lengthM - TU.declaredLengthM
  const deltaPercent = (deltaM / TU.declaredLengthM) * 100
  const depths = STANKEVICHA_CHAMBERS.map((chamber) => chamber.depthM)

  return (
    <div>
      <p className="stat-line">{TU.objectName}</p>
      <p className="hint">{t('project.stankevicha.sources')}</p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('project.stankevicha.thMetric')}</th>
              <th scope="col" className="num">{t('project.stankevicha.thDocuments')}</th>
              <th scope="col" className="num">{t('project.stankevicha.thProgram')}</th>
              <th scope="col">{t('project.stankevicha.thDelta')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('project.stankevicha.metricDiameter')}</td>
              <td className="num">{TU.designDiameterMm}</td>
              <td className="num">{TU.designDiameterMm}</td>
              <td><span className="ok">{t('project.stankevicha.matches')}</span></td>
            </tr>
            <tr>
              <td>{t('project.stankevicha.metricChambers')}</td>
              <td className="num">{TU.declaredChambers}</td>
              <td className="num">{STANKEVICHA_CHAMBERS.length}</td>
              <td>
                {STANKEVICHA_CHAMBERS.length === TU.declaredChambers
                  ? <span className="ok">{t('project.stankevicha.matches')}</span>
                  : <span className="warn">{STANKEVICHA_CHAMBERS.length - TU.declaredChambers}</span>}
              </td>
            </tr>
            <tr>
              <td>{t('project.stankevicha.metricLength')}</td>
              <td className="num">{TU.declaredLengthM}</td>
              <td className="num">{lengthM}</td>
              <td>
                <span className="warn">
                  {deltaM > 0 ? '+' : ''}{deltaM.toFixed(2)} ({deltaPercent > 0 ? '+' : ''}{deltaPercent.toFixed(1)}%)
                </span>
              </td>
            </tr>
            <tr>
              <td>{t('project.stankevicha.metricDepth')}</td>
              <td className="num">{TU.declaredDepthRangeM[0]}…{TU.declaredDepthRangeM[1]}</td>
              <td className="num">{Math.min(...depths).toFixed(2)}…{Math.max(...depths).toFixed(2)}</td>
              <td><span className="hint">{t('project.stankevicha.depthNote')}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="stat-line warn">{t('project.stankevicha.lengthGap')}</p>

      <p className="stat-line">
        {t('project.stankevicha.decisions', { depth: STANKEVICHA_MIN_MAIN_DEPTH_M })}
      </p>
      <p className="stat-line">
        {t('project.stankevicha.geology', {
          boreholes: GEO.boreholes,
          layers: GEO.layers.map((layer) => layer.code).join(', '),
          seismicity: GEO.seismicityPoints,
          freezing: GEO.freezingDepthM.suglinok,
        })}
      </p>
      <p className="stat-line">{t('project.stankevicha.customer', { customer: TU.customer })}</p>
    </div>
  )
}
