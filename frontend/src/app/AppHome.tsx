import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ENGINE_VERSION } from '@aquascheme/engine'
import { supabase } from '../shared/supabase'

type DbStatus = 'checking' | 'ok' | 'noSchema' | 'error'

export function AppHome() {
  const { t } = useTranslation()
  const [dbStatus, setDbStatus] = useState<DbStatus>('checking')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .then(({ error }) => {
        if (cancelled) return
        if (!error) {
          setDbStatus('ok')
        } else if (
          error.code === 'PGRST205' ||
          error.code === '42P01' ||
          /schema cache|does not exist/i.test(error.message)
        ) {
          setDbStatus('noSchema')
        } else {
          setDbStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="page">
      <div className="container">
        <h1>{t('app.title')}</h1>
        <p className="lead">{t('app.placeholder')}</p>
        <div className="status-block">
          <p className="status-line">{t('app.engine', { version: ENGINE_VERSION })}</p>
          <p className={`status-line${dbStatus === 'ok' ? ' ok' : ''}`}>
            {t(`app.db.${dbStatus}`)}
          </p>
        </div>
      </div>
    </section>
  )
}
