import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <section className="page">
      <div className="container">
        <p className="kicker">404</p>
        <h1 style={{ marginTop: 12 }}>{t('notFound.title')}</h1>
        <p style={{ marginTop: 16 }}>
          <Link to="/" style={{ color: 'var(--accent)' }}>
            {t('notFound.back')}
          </Link>
        </p>
      </div>
    </section>
  )
}
