import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type PanelStatus = 'filled' | 'empty' | 'default'

export function Panel({
  title,
  status,
  children,
}: {
  title: string
  status: PanelStatus
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className={`badge${status === 'filled' ? ' ok' : ''}`}>
          {t(`project.status.${status}`)}
        </span>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  )
}
