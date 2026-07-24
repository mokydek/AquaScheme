import type { GravityPipeResult } from '@aquascheme/engine'

export function PipeCalculationsView({
  pipes,
  nodeLabel,
}: {
  pipes: GravityPipeResult[]
  nodeLabel: (nodeId: string) => string
}) {
  return (
    <div className="pipe-calculations-view">
      <div className="pipe-calculations-summary">
        <strong>Гидравлический расчёт всех участков</strong>
        <span>{pipes.length} участков · диаметры выбираются по расходу, уклону, наполнению и скорости</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>№</th><th>Участок</th><th className="num">Длина, м</th><th className="num">Расход, л/с</th>
              <th className="num">Ø, мм</th><th className="num">Уклон, ‰</th><th className="num">h/D</th>
              <th className="num">Скорость, м/с</th><th>Проверка</th>
            </tr>
          </thead>
          <tbody>
            {pipes.map((pipe, index) => (
              <tr key={pipe.id} className={pipe.issues.length > 0 ? 'row-warn' : undefined}>
                <td className="mono">{index + 1}</td>
                <td>{nodeLabel(pipe.fromNode)} → {nodeLabel(pipe.toNode)}</td>
                <td className="num mono">{pipe.lengthM.toFixed(1)}</td>
                <td className="num mono">{pipe.flowLps.toFixed(2)}</td>
                <td className="num mono pipe-diameter-cell">Ø{pipe.diameterMm}</td>
                <td className="num mono">{(pipe.slope * 1000).toFixed(2)}</td>
                <td className="num mono">{pipe.fillRatio.toFixed(3)}</td>
                <td className="num mono">{pipe.velocityMs.toFixed(2)}</td>
                <td>{pipe.issues.length ? pipe.issues.map((issue) => issue.message).join('; ') : 'Соответствует'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="reference-source-note">
        Расчётная таблица строится из текущей сети. Проектная спецификация 2024-51-НК.С остаётся отдельной контрольной таблицей и не подменяется автоматическим подбором.
      </p>
    </div>
  )
}
