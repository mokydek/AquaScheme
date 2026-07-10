import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../i18n'

export function RootLayout() {
  const { t, i18n } = useTranslation()

  return (
    <div className="site">
      <header className="header">
        <div className="container header-inner">
          <Link to="/" className="wordmark">
            <span className="wordmark-mark" aria-hidden="true" />
            AQUASCHEME
          </Link>
          <nav className="nav">
            <Link to="/app">{t('nav.app')}</Link>
            <div className="lang-group" role="group" aria-label="Language">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  className={`lang-btn${i18n.language === lang.code ? ' active' : ''}`}
                  onClick={() => void i18n.changeLanguage(lang.code)}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </nav>
        </div>
      </header>
      <main className="site-main">
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <span>{t('footer.disclaimer')}</span>
          <span>{t('footer.norms')}</span>
        </div>
      </footer>
    </div>
  )
}
