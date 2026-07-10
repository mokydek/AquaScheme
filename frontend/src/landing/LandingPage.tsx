import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function LandingPage() {
  const { t } = useTranslation()

  return (
    <section className="hero">
      <div className="container">
        <p className="kicker">{t('landing.kicker')}</p>
        <h1>{t('landing.title')}</h1>
        <p className="lead">{t('landing.description')}</p>
        <div className="hero-cta">
          <Link to="/app" className="btn">
            {t('landing.cta')}
          </Link>
        </div>
      </div>
    </section>
  )
}
