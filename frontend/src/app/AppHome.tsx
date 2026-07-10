import { useEffect, useState } from 'react'
import { ENGINE_VERSION } from '@aquascheme/engine'
import { supabase } from '../shared/supabase'

type DbStatus = 'checking' | 'ok' | 'no_schema' | 'error'

const STATUS_TEXT: Record<DbStatus, string> = {
  checking: 'Проверка соединения с базой данных',
  ok: 'База данных подключена',
  no_schema: 'Схема БД не найдена. Выполните backend/migrations/0001_init.sql в Supabase SQL Editor',
  error: 'Нет соединения с базой данных',
}

export function AppHome() {
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
        } else if (error.code === 'PGRST205' || error.code === '42P01' || /schema cache|does not exist/i.test(error.message)) {
          setDbStatus('no_schema')
        } else {
          setDbStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Проекты</h1>
      <p style={{ marginTop: 12, color: 'var(--ink-soft)' }}>
        Рабочая область приложения. Список проектов и мастер создания появятся в следующих
        фазах.
      </p>
      <div style={{ marginTop: 32, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-soft)' }}>
          engine v{ENGINE_VERSION}
        </p>
        <p
          style={{
            marginTop: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: dbStatus === 'ok' ? 'var(--accent)' : 'var(--ink-soft)',
          }}
        >
          {STATUS_TEXT[dbStatus]}
        </p>
      </div>
    </section>
  )
}
