import { buildGeologySection, projectBoreholesOntoPath } from '@aquascheme/engine'
import type { Borehole } from '@aquascheme/engine'

/**
 * Геологический разрез вдоль трассы.
 *
 * На профиле стояли колонки отдельных скважин, а между ними — пусто. Разрез
 * строится только там, где состав слоёв в соседних скважинах совпадает: иначе
 * выклинивание слоя было бы решением приложения, а не инженера. За пределы
 * крайних скважин разрез не продолжается.
 */
export function GeologySectionView({
  boreholes,
  path,
  maxOffsetM,
  routeLengthM,
}: {
  boreholes: Borehole[]
  path: Array<{ x: number; y: number; chainageM: number }>
  maxOffsetM?: number
  routeLengthM: number
}) {
  const projection = projectBoreholesOntoPath(boreholes, path, maxOffsetM)
  const section = buildGeologySection(projection.projected, routeLengthM)
  const codes = [...new Set(section.stations.flatMap((s) => s.layers.map((l) => l.igeCode)))]

  return (
    <div>
      <h4>Геологический разрез вдоль трассы</h4>
      <p className="stat-line">{projection.reason}</p>
      <p className={section.coveragePercent > 0 ? 'stat-line' : 'notice'}>{section.reason}</p>

      {section.gaps.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Промежуток</th><th>Почему разрез не построен</th></tr></thead>
            <tbody>{section.gaps.map((gap) => (
              <tr key={`${gap.fromChainageM}-${gap.toChainageM}`} className="row-warn">
                <td className="mono">ПК{(gap.fromChainageM / 100).toFixed(2)} — ПК{(gap.toChainageM / 100).toFixed(2)}</td>
                <td>{gap.reason}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {codes.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">Пикетаж, м</th><th className="num">Поверхность, м</th>
                {codes.map((code) => <th key={code} className="num">Подошва {code}, м</th>)}
                <th>Источник</th>
              </tr>
            </thead>
            <tbody>{section.stations.map((station) => (
              <tr key={station.chainageM}>
                <td className="num">{station.chainageM.toFixed(1)}</td>
                <td className="num">{station.surfaceElevationM.toFixed(2)}</td>
                {codes.map((code) => {
                  const layer = station.layers.find((item) => item.igeCode === code)
                  return <td key={code} className="num">{layer ? layer.bottomElevationM.toFixed(2) : '—'}</td>
                })}
                <td>{station.measured ? 'скважина' : 'интерполяция'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
