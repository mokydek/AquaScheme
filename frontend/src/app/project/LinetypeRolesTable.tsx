import { useTranslation } from 'react-i18next'
import { summarizeLinetypeRoles } from '@aquascheme/engine'
import type { DxfLayerRole } from '@aquascheme/engine/dxfread'

/**
 * Роль, выведенная из типа линии, для слоёв без роли.
 *
 * На топооснове Талдыколя слой «0» — 4217 сегментов, который инженер помечает
 * как не инженерный, — несёт напорную канализацию, водопровод и газ: типы
 * линий внутри него названы прямо. Настоящая сеть выбрасывалась вместе со
 * слоем.
 *
 * Цвет для этого не годится и не используется: у Станкевича один и тот же цвет
 * несут канализация, связь, теплотрасса и ограждения.
 */
export function LinetypeRolesTable({
  segments,
  roles,
}: {
  segments: Array<{ layer?: string; lineType?: string }>
  roles: Readonly<Record<string, DxfLayerRole>>
}) {
  const { t } = useTranslation()
  const summary = summarizeLinetypeRoles(segments, roles)
  if (summary.byRole.length === 0 && summary.unrecognized.length === 0) return null

  return (
    <div style={{ marginTop: 12 }}>
      <h5>{t('project.linetypeRoles.title')}</h5>
      <p className="stat-line">{summary.reason}</p>

      {summary.byRole.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>{t('project.linetypeRoles.thRole')}</th>
              <th className="num">{t('project.linetypeRoles.thSegments')}</th>
              <th>{t('project.linetypeRoles.thLineTypes')}</th>
            </tr></thead>
            <tbody>
              {summary.byRole.map((item) => (
                <tr key={item.role}>
                  <td>{item.role}</td>
                  <td className="num">{item.segments}</td>
                  <td className="mono">{item.lineTypes.join(', ')}</td>
                </tr>
              ))}
              {summary.nonEngineering.length > 0 && (
                <tr>
                  <td>{t('project.linetypeRoles.nonEngineering')}</td>
                  <td className="num">
                    {summary.nonEngineering.reduce((sum, item) => sum + item.segments, 0)}
                  </td>
                  <td className="mono">{summary.nonEngineering.map((item) => item.lineType).join(', ')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {summary.unrecognized.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="field-label">
            {t('project.linetypeRoles.unknownSummary', { count: summary.unrecognized.length })}
          </summary>
          <p className="hint">{t('project.linetypeRoles.unknownHint')}</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>
                <th>{t('project.linetypeRoles.thLineType')}</th>
                <th className="num">{t('project.linetypeRoles.thSegments')}</th>
                <th>{t('project.linetypeRoles.thLayers')}</th>
              </tr></thead>
              <tbody>{summary.unrecognized.slice(0, 30).map((item) => (
                <tr key={item.lineType}>
                  <td className="mono">{item.lineType}</td>
                  <td className="num">{item.segments}</td>
                  <td className="mono">{item.layers.join(', ')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
