import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type PanelStatus = 'filled' | 'empty' | 'default'

export function Panel({
  title,
  status,
  anchor,
  children,
}: {
  title: string
  status: PanelStatus
  /**
   * Якорь раздела для перехода из списка готовности.
   *
   * Замечание, называющее раздел словами, оставляет владельца искать его
   * прокруткой. Значения ведёт `READINESS_SECTIONS` в движке, и соответствие
   * проверяется тестом отрисовки: якорь без раздела — ссылка в никуда.
   */
  anchor?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <section className="panel" id={anchor} data-panel-anchor={anchor}>
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
