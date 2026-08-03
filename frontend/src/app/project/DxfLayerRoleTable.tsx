import type { DxfLayerRole, DxfLayerInfo } from '@aquascheme/engine/dxfread'

/**
 * Сопоставление слоёв чертежа инженерным ролям.
 *
 * Общая для импорта чертежа и реконструкции по съёмке. Пока остаются
 * нераспознанные слои, выпуск заблокирован, и снять блок можно только здесь —
 * поэтому таблица обязана быть на каждом пути, которым чертёж попадает в
 * проект. Раньше она существовала только в импорте, и путь реконструкции был
 * тупиковым: всё считалось, но выпустить было нельзя никогда.
 */

export const DXF_ROLE_OPTIONS: Array<{ value: DxfLayerRole; label: string }> = [
  { value: 'corridor', label: 'Коридор' },
  { value: 'guideAxis', label: 'Направляющая ось' },
  { value: 'redLine', label: 'Красная линия' },
  { value: 'utility', label: 'Существующая коммуникация' },
  { value: 'road', label: 'Автомобильная дорога' },
  { value: 'railway', label: 'Железная дорога' },
  { value: 'hydrography', label: 'Гидрография' },
  { value: 'terrain', label: 'Высоты/рельеф' },
  { value: 'terrainBreakline', label: 'Структурная линия рельефа' },
  { value: 'building', label: 'Здание' },
  { value: 'structure', label: 'Сооружение' },
  { value: 'parcel', label: 'Земельный участок' },
  { value: 'protectionZone', label: 'Охранная зона' },
  { value: 'forbiddenZone', label: 'Запрещённая зона' },
  { value: 'approvedCrossing', label: 'Согласованное окно пересечения' },
  { value: 'candidateRoute', label: 'Готовая ось (только импорт)' },
  { value: 'ignore', label: 'Проверено: не инженерный слой' },
  { value: 'unknown', label: 'Не классифицировано' },
]

/** Признаки слоя: по ним инженер и решает, что это такое. */
function layerEvidence(layer: DxfLayerInfo): string {
  return [
    ...Object.entries(layer.entityTypes ?? {}).map(([kind, count]) => `${kind}: ${count}`),
    ...(layer.textSamples ?? []).slice(0, 3).map((sample) => `«${sample}»`),
    ...(layer.lineTypes ?? []).map((lineType) => `линия ${lineType}`),
    ...(layer.colorNumbers ?? []).map((color) => `цвет ${color}`),
  ].join(', ') || '—'
}

export function DxfLayerRoleTable({
  idPrefix,
  layers,
  roles,
  onChange,
  disabled = false,
}: {
  /** Префикс идентификаторов полей: на странице может быть две таблицы. */
  idPrefix: string
  layers: DxfLayerInfo[]
  roles: Record<string, DxfLayerRole>
  onChange: (layer: string, role: DxfLayerRole) => void
  disabled?: boolean
}) {
  const unresolved = layers.filter((layer) => (roles[layer.name] ?? 'unknown') === 'unknown')
  return (
    <details open={unresolved.length > 0} style={{ marginTop: 12 }}>
      <summary className="field-label">
        Сопоставление всех слоёв DWG{unresolved.length > 0 ? ` — не классифицировано ${unresolved.length}` : ''}
      </summary>
      <p className="hint">
        Каждому неизвестному слою назначьте инженерную роль либо явно выберите «не инженерный слой».
        Пока остаются неизвестные слои, расчёт будет BLOCKED.
      </p>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Слой</th>
              <th scope="col">Роль</th>
              <th scope="col" className="num">Линий</th>
              <th scope="col" className="num">Точек</th>
              <th scope="col">Признаки</th>
            </tr>
          </thead>
          <tbody>
            {layers.map((layer) => {
              const fieldId = `${idPrefix}-layer-role-${encodeURIComponent(layer.name)}`
              return (
                <tr key={layer.name}>
                  <td className="mono">{layer.name}</td>
                  <td>
                    <select
                      id={fieldId}
                      name={fieldId}
                      aria-label={`Роль слоя DWG: ${layer.name}`}
                      className="input input-sm"
                      disabled={disabled}
                      value={roles[layer.name] ?? 'unknown'}
                      onChange={(event) => onChange(layer.name, event.target.value as DxfLayerRole)}
                    >
                      {DXF_ROLE_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{layer.segments}</td>
                  <td className="num">{layer.points}</td>
                  <td>{layerEvidence(layer)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}
