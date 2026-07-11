import { useTranslation } from 'react-i18next'
import { BUILDING_PRESETS, SOURCE_PRESETS } from '@aquascheme/engine'
import { Panel } from './Panel'

export interface Placement {
  type: 'building' | 'source'
  presetId: string
}

/**
 * Library of ready made objects (requirements update 1, change 4). Selecting
 * a preset arms placement mode; the user then clicks the map to drop it. The
 * object renders immediately (live model); heavy recalculation stays behind
 * the calculate button.
 */
export function ObjectLibrary({
  active,
  onSelect,
}: {
  active: Placement | null
  onSelect: (placement: Placement | null) => void
}) {
  const { t } = useTranslation()

  const isActive = (type: Placement['type'], presetId: string) =>
    active?.type === type && active.presetId === presetId

  const toggle = (placement: Placement) => {
    onSelect(isActive(placement.type, placement.presetId) ? null : placement)
  }

  return (
    <Panel title={t('project.library.title')} status={active ? 'filled' : 'default'}>
      <p className="hint">
        {active ? t('project.library.placing', { name: activeName(active, t) }) : t('project.library.hint')}
      </p>

      <p className="field-label" style={{ marginTop: 16 }}>
        {t('project.library.buildings')}
      </p>
      <div className="preset-grid">
        {BUILDING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`preset-chip${isActive('building', preset.id) ? ' active' : ''}`}
            onClick={() => toggle({ type: 'building', presetId: preset.id })}
          >
            <span className="preset-mark">{preset.labelPrefix}</span>
            <span>{t(`project.library.building.${preset.id}`)}</span>
            {preset.normPending && <span className="preset-flag">{t('project.library.pending')}</span>}
          </button>
        ))}
      </div>

      <p className="field-label" style={{ marginTop: 16 }}>
        {t('project.library.sources')}
      </p>
      <div className="preset-grid">
        {SOURCE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`preset-chip${isActive('source', preset.id) ? ' active' : ''}`}
            onClick={() => toggle({ type: 'source', presetId: preset.id })}
          >
            <span className="preset-mark">{preset.mark}</span>
            <span>{t(`project.library.source.${preset.id}`)}</span>
          </button>
        ))}
      </div>

      {active && (
        <div className="section-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(null)}>
            {t('project.library.stop')}
          </button>
        </div>
      )}
    </Panel>
  )
}

function activeName(placement: Placement, t: (key: string) => string): string {
  return t(`project.library.${placement.type}.${placement.presetId}`)
}
