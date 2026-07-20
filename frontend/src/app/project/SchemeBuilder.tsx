import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildSituationSteps, visibleStepIds } from '@aquascheme/engine'
import type { SituationStepsInput } from '@aquascheme/engine'
import { SchemeView } from './SchemeView'
import type { SchemeViewProps } from './SchemeView'

/**
 * Step-by-step construction of the situational scheme: the sheet is drawn
 * stage by stage (подоснова → коридор → трасса → диаметры → выпуск →
 * легенда) with playback controls, and every stage names the project data it
 * is drawn from — so the user watches the scheme appear and sees the
 * provenance of each layer. Absent data is reported honestly, not skipped.
 */

const STEP_MS = 1300

export interface SchemeBuilderProps {
  scheme: Omit<SchemeViewProps, 'visibleSteps'>
  steps: SituationStepsInput
}

export function SchemeBuilder({ scheme, steps: stepsInput }: SchemeBuilderProps) {
  const { t } = useTranslation()
  const steps = useMemo(() => buildSituationSteps(stepsInput), [stepsInput])
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    if (!playing || position >= steps.length) return
    const timer = setTimeout(() => setPosition((p) => Math.min(p + 1, steps.length)), STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, position, steps.length])

  const visible = useMemo(() => visibleStepIds(steps, position), [steps, position])
  const finished = position >= steps.length

  const replay = () => {
    setPosition(0)
    setPlaying(true)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(220px, 1fr)', gap: 16 }}>
      <div>
        <SchemeView {...scheme} visibleSteps={visible} />
        <div className="section-actions" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={replay}>
            {t('project.gravity.builder.replay')}
          </button>
          {!finished && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlaying((p) => !p)}>
              {playing ? t('project.gravity.builder.pause') : t('project.gravity.builder.play')}
            </button>
          )}
          {!finished && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPosition(steps.length)}>
              {t('project.gravity.builder.toEnd')}
            </button>
          )}
        </div>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, i) => {
          const state = i < position ? 'done' : i === position && !finished ? 'current' : 'pending'
          return (
            <li
              key={step.id}
              style={{
                border: '1px solid var(--border, #d9d9d9)',
                borderLeft: state === 'current' ? '3px solid #0033cc' : '1px solid var(--border, #d9d9d9)',
                padding: '8px 10px',
                opacity: state === 'pending' ? 0.45 : 1,
                background: state === 'done' ? 'var(--panel, #fafafa)' : '#ffffff',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="mono" style={{ fontSize: 12 }}>{step.order}</span>
                <strong style={{ fontSize: 13 }}>{t(`project.gravity.builder.step.${step.id}`)}</strong>
                {!step.present && (
                  <span className="stat-line warn" style={{ marginTop: 0, fontSize: 11 }}>
                    {t('project.gravity.builder.noData')}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                {t(`project.gravity.builder.source.${step.sourceKey}`, step.stats)}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
