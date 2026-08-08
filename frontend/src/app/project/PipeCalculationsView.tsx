import { useTranslation } from 'react-i18next'
import type { GravityPipeResult } from '@aquascheme/engine'

export function PipeCalculationsView({
  pipes,
  nodeLabel,
}: {
  pipes: GravityPipeResult[]
  nodeLabel: (nodeId: string) => string
}) {
  const { t } = useTranslation()
  return (
    <div className="pipe-calculations-view">
      <div className="pipe-calculations-summary">
        <strong>{t('project.pipeCalc.title')}</strong>
        <span>{t('project.pipeCalc.summary', { count: pipes.length })}</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>№</th><th>{t('project.pipeCalc.thPipe')}</th><th className="num">{t('project.pipeCalc.thLength')}</th><th className="num">{t('project.pipeCalc.thFlow')}</th>
              <th className="num">{t('project.pipeCalc.thDiameter')}</th><th className="num">{t('project.pipeCalc.thSlope')}</th><th className="num">h/D</th>
              <th className="num">{t('project.pipeCalc.thVelocity')}</th><th>{t('project.pipeCalc.thCheck')}</th>
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
        {t('project.pipeCalc.note')}
      </p>
    </div>
  )
}
