import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { DxfLayerRole, DxfLayerInfo } from '@aquascheme/engine/dxfread'
import { layerPreview, segmentsExtent, type LayerPreview as LayerPreviewResult, type PreviewSegment } from './layerPreview'

/**
 * Сопоставление слоёв чертежа инженерным ролям.
 *
 * Общая для импорта чертежа и реконструкции по съёмке. Пока остаются
 * нераспознанные слои, выпуск заблокирован, и снять блок можно только здесь —
 * поэтому таблица обязана быть на каждом пути, которым чертёж попадает в
 * проект. Раньше она существовала только в импорте, и путь реконструкции был
 * тупиковым: всё считалось, но выпустить было нельзя никогда.
 */

/** Роли и ключи их названий. Значения ролей — договор с движком, не текст. */
export const DXF_ROLE_OPTIONS: Array<{ value: DxfLayerRole; labelKey: string }> = [
  { value: 'corridor', labelKey: 'project.dxfLayers.roleCorridor' },
  { value: 'guideAxis', labelKey: 'project.dxfLayers.roleGuideAxis' },
  { value: 'redLine', labelKey: 'project.dxfLayers.roleRedLine' },
  { value: 'utility', labelKey: 'project.dxfLayers.roleUtility' },
  { value: 'road', labelKey: 'project.dxfLayers.roleRoad' },
  { value: 'railway', labelKey: 'project.dxfLayers.roleRailway' },
  { value: 'hydrography', labelKey: 'project.dxfLayers.roleHydrography' },
  { value: 'terrain', labelKey: 'project.dxfLayers.roleTerrain' },
  { value: 'terrainBreakline', labelKey: 'project.dxfLayers.roleTerrainBreakline' },
  { value: 'building', labelKey: 'project.dxfLayers.roleBuilding' },
  { value: 'structure', labelKey: 'project.dxfLayers.roleStructure' },
  { value: 'parcel', labelKey: 'project.dxfLayers.roleParcel' },
  { value: 'protectionZone', labelKey: 'project.dxfLayers.roleProtectionZone' },
  { value: 'forbiddenZone', labelKey: 'project.dxfLayers.roleForbiddenZone' },
  { value: 'approvedCrossing', labelKey: 'project.dxfLayers.roleApprovedCrossing' },
  { value: 'candidateRoute', labelKey: 'project.dxfLayers.roleCandidateRoute' },
  { value: 'ignore', labelKey: 'project.dxfLayers.roleIgnore' },
  { value: 'unknown', labelKey: 'project.dxfLayers.roleUnknown' },
]

/**
 * Ниже этого размера в общем кадре форма слоя уже не читается: на Талдыколе
 * при площадке 3,6 × 10,1 км так выглядят 24 слоя из 59.
 */
const TOO_SMALL_PX = 24

function Sketch({ preview, label }: { preview: LayerPreviewResult; label: string }) {
  const { t } = useTranslation()
  const { width, height, box } = preview
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={t('project.dxfLayers.sketchAria', {
        label,
        segments: preview.totalSegments,
        spanX: preview.spanXM,
        spanY: preview.spanYM,
      })}
      style={{ border: '1px solid var(--border, #ccc)', borderRadius: 2, flex: '0 0 auto' }}
    >
      {preview.frame === 'drawing' && (
        // Габарит слоя обведён рамкой: слой из четырёх линий на площадке в
        // километр иначе неотличим от пустого — линии короче штриха.
        <rect
          x={box.x - 2}
          y={box.y - 2}
          width={Math.max(box.width + 4, 5)}
          height={Math.max(box.height + 4, 5)}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.35}
        />
      )}
      {/* Все линии слоя одним элементом: на Талдыколе их 9 тысяч, и столько
          узлов разметки на таблицу из 98 строк браузер не тянет. */}
      <path d={preview.paths.join(' ')} fill="none" stroke="currentColor" strokeWidth={0.7} />
    </svg>
  )
}

/**
 * Набросок геометрии слоя.
 *
 * Слева — слой в общем кадре чертежа: отвечает на вопрос «где и насколько
 * велик». Справа, если в общем кадре слой вышел с ноготь, — он же в
 * собственных границах: отвечает на вопрос «какой формы». Один набросок на оба
 * вопроса не отвечает, а вопроса при назначении роли именно два.
 */
function LayerSketch({
  framed,
  close,
}: {
  framed: LayerPreviewResult | null
  close: LayerPreviewResult | null
}) {
  const { t } = useTranslation()
  if (!framed) return <span className="hint">{t('project.dxfLayers.sketchNoLines')}</span>
  return (
    <span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Sketch preview={framed} label={t('project.dxfLayers.sketchOnSite')} />
        {close && <Sketch preview={close} label={t('project.dxfLayers.sketchClose')} />}
      </span>
      <span className="hint">
        {t('project.dxfLayers.sketchSpan', { spanX: framed.spanXM, spanY: framed.spanYM })}
        {close ? t('project.dxfLayers.sketchCloseNote') : ''}
        {framed.shownSegments < framed.totalSegments
          ? t('project.dxfLayers.sketchShown', {
            shown: framed.shownSegments,
            total: framed.totalSegments,
          })
          : ''}
      </span>
    </span>
  )
}

export function DxfLayerRoleTable({
  idPrefix,
  layers,
  segments,
  roles,
  onChange,
  disabled = false,
}: {
  /** Префикс идентификаторов полей: на странице может быть две таблицы. */
  idPrefix: string
  layers: DxfLayerInfo[]
  /** Линии чертежа для наброска. Без них графа наброска не рисуется вовсе:
   * пустая клетка честнее пустой рамки, которую примут за пустой слой. */
  segments?: PreviewSegment[]
  roles: Record<string, DxfLayerRole>
  onChange: (layer: string, role: DxfLayerRole) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  /** Признаки слоя: по ним инженер и решает, что это такое. */
  const layerEvidence = (layer: DxfLayerInfo): string =>
    [
      ...Object.entries(layer.entityTypes ?? {}).map(([kind, count]) => `${kind}: ${count}`),
      ...(layer.textSamples ?? []).slice(0, 3).map((sample) => `«${sample}»`),
      ...(layer.lineTypes ?? []).map((lineType) =>
        t('project.dxfLayers.evidenceLineType', { lineType })),
      ...(layer.colorNumbers ?? []).map((color) =>
        t('project.dxfLayers.evidenceColor', { color })),
    ].join(', ') || '—'

  const unresolved = layers.filter((layer) => (roles[layer.name] ?? 'unknown') === 'unknown')
  // Кадр и наброски считаются один раз на разбор чертежа, а не на каждую
  // перерисовку: на Талдыколе это 15 тысяч линий и 98 слоёв, около 60 мс.
  const previews = useMemo(() => {
    if (!segments || segments.length === 0) return null
    const extent = segmentsExtent(segments)
    return new Map(layers.map((layer) => {
      const framed = layerPreview(segments, layer.name, { extent })
      const tiny = framed !== null
        && Math.max(framed.box.width, framed.box.height) < TOO_SMALL_PX
      return [layer.name, {
        framed,
        close: tiny ? layerPreview(segments, layer.name) : null,
      }]
    }))
  }, [segments, layers])
  return (
    <details open={unresolved.length > 0} style={{ marginTop: 12 }}>
      <summary className="field-label">
        {unresolved.length > 0
          ? t('project.dxfLayers.titleUnresolved', { count: unresolved.length })
          : t('project.dxfLayers.title')}
      </summary>
      <p className="hint">{t('project.dxfLayers.hint')}</p>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('project.dxfLayers.thLayer')}</th>
              <th scope="col">{t('project.dxfLayers.thRole')}</th>
              <th scope="col" className="num">{t('project.dxfLayers.thSegments')}</th>
              <th scope="col" className="num">{t('project.dxfLayers.thPoints')}</th>
              {previews && <th scope="col">{t('project.dxfLayers.thSketch')}</th>}
              <th scope="col">{t('project.dxfLayers.thEvidence')}</th>
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
                      aria-label={t('project.dxfLayers.roleAria', { layer: layer.name })}
                      className="input input-sm"
                      disabled={disabled}
                      value={roles[layer.name] ?? 'unknown'}
                      onChange={(event) => onChange(layer.name, event.target.value as DxfLayerRole)}
                    >
                      {DXF_ROLE_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>{t(option.labelKey)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{layer.segments}</td>
                  <td className="num">{layer.points}</td>
                  {previews && (
                    <td>
                      <LayerSketch
                        framed={previews.get(layer.name)?.framed ?? null}
                        close={previews.get(layer.name)?.close ?? null}
                      />
                    </td>
                  )}
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
