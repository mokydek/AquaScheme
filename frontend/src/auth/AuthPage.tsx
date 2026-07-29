import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../shared/supabase'
import { useAuth } from '../shared/auth'

type Mode = 'signin' | 'signup'

interface Notice {
  kind: 'error' | 'info'
  text: string
}

export function AuthPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  if (!loading && session) return <Navigate to="/app" replace />

  const mapError = (message: string): string => {
    if (/invalid login credentials/i.test(message)) return t('auth.errors.invalidCredentials')
    if (/already registered/i.test(message)) return t('auth.errors.userExists')
    if (/password should be at least/i.test(message)) return t('auth.errors.weakPassword')
    return t('auth.errors.generic')
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setNotice(null)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          setNotice({ kind: 'error', text: mapError(error.message) })
          return
        }
        navigate('/app')
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) {
          setNotice({ kind: 'error', text: mapError(error.message) })
          return
        }
        if (data.session) {
          navigate('/app')
        } else {
          setNotice({ kind: 'info', text: t('auth.confirmationPending') })
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-page">
      <div className="container">
        <div className="auth-card">
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={`auth-tab${mode === 'signin' ? ' active' : ''}`}
              onClick={() => switchMode('signin')}
            >
              {t('auth.signIn')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`auth-tab${mode === 'signup' ? ' active' : ''}`}
              onClick={() => switchMode('signup')}
            >
              {t('auth.signUp')}
            </button>
          </div>
          <form onSubmit={(e) => void onSubmit(e)}>
            <label className="field">
              <span className="field-label">{t('auth.email')}</span>
              <input
                id="auth-email"
                name="email"
                className="input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('auth.password')}</span>
              <input
                id="auth-password"
                name="password"
                className="input"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}
            <button className="btn auth-submit" type="submit" disabled={busy}>
              {mode === 'signin' ? t('auth.submitSignIn') : t('auth.submitSignUp')}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
