import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { SystemType, WorkType } from '@aquascheme/engine'
import { supabase } from '../shared/supabase'
import { useAuth } from '../shared/auth'

const WORK_TYPES: WorkType[] = ['new', 'reconstruction']
const SYSTEM_TYPES: SystemType[] = ['water', 'sewer', 'storm']
const SYSTEM_MARKS: Record<SystemType, string> = { water: 'В1', sewer: 'К1', storm: 'К2' }

/**
 * Project creation wizard (requirements update 1): a strict sequence of
 * steps — kind of works, then system type in its own view, then the name.
 */
export function NewProjectPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [workType, setWorkType] = useState<WorkType | null>(null)
  const [systemType, setSystemType] = useState<SystemType | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session || !workType || !systemType || !name.trim() || busy) return
    setBusy(true)
    setFailed(false)
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        owner_id: session.user.id,
        work_type: workType,
        system_type: systemType,
      })
      .select('id')
      .single()
    setBusy(false)
    if (error || !data) {
      setFailed(true)
      return
    }
    navigate(`/app/projects/${data.id}`)
  }

  return (
    <section className="page">
      <div className="container">
        <p>
          <Link to="/app" className="back-link">
            {t('project.back')}
          </Link>
        </p>
        <p className="kicker" style={{ marginTop: 16 }}>
          {t('wizard.step', { n: step })}
        </p>
        <h1 style={{ marginTop: 8 }}>
          {step === 1
            ? t('wizard.workTypeTitle')
            : step === 2
              ? t('wizard.systemTypeTitle')
              : t('wizard.nameTitle')}
        </h1>

        {step === 1 && (
          <div className="option-grid">
            {WORK_TYPES.map((wt) => (
              <button
                key={wt}
                type="button"
                className={`option-card${workType === wt ? ' active' : ''}`}
                onClick={() => {
                  setWorkType(wt)
                  setStep(2)
                }}
              >
                <span className="option-title">{t(`wizard.workType.${wt}`)}</span>
                <span className="option-hint">{t(`wizard.workTypeHint.${wt}`)}</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <>
            <div className="option-grid">
              {SYSTEM_TYPES.map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`option-card${systemType === st ? ' active' : ''}`}
                  onClick={() => {
                    setSystemType(st)
                    setStep(3)
                  }}
                >
                  <span className="option-mark">{SYSTEM_MARKS[st]}</span>
                  <span className="option-title">{t(`wizard.systemType.${st}`)}</span>
                  <span className="option-hint">{t(`wizard.systemTypeNote.${st}`)}</span>
                </button>
              ))}
            </div>
            <div className="section-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>
                {t('wizard.backStep')}
              </button>
            </div>
          </>
        )}

        {step === 3 && workType && systemType && (
          <form onSubmit={(e) => void create(e)}>
            <p style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <span className="badge">{t(`wizard.workType.${workType}`)}</span>
              <span className="badge ok">
                {SYSTEM_MARKS[systemType]} · {t(`wizard.systemType.${systemType}`)}
              </span>
            </p>
            <div style={{ maxWidth: 400 }}>
              <label className="field">
                <span className="field-label">{t('app.namePlaceholder')}</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </label>
            </div>
            {failed && <p className="notice error">{t('wizard.error')}</p>}
            <div className="section-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(2)}>
                {t('wizard.backStep')}
              </button>
              <button className="btn btn-sm" type="submit" disabled={busy}>
                {t('wizard.create')}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
