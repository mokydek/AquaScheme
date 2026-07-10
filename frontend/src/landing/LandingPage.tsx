import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, Droplets, Gauge, Layers, Network, Wrench } from 'lucide-react'
import { NetworkFigure } from './NetworkFigure'

const STEPS = ['s1', 's2', 's3', 's4'] as const

const FEATURES = [
  { id: 'f1', Icon: Droplets },
  { id: 'f2', Icon: Network },
  { id: 'f3', Icon: Gauge },
  { id: 'f4', Icon: Layers },
  { id: 'f5', Icon: Activity },
  { id: 'f6', Icon: Wrench },
] as const

const OUTPUTS = [
  { id: 'o1', ext: '.DXF' },
  { id: 'o2', ext: '.PDF' },
  { id: 'o3', ext: '.XLSX' },
] as const

const NORMS = ['n1', 'n2', 'n3', 'n4'] as const

export function LandingPage() {
  const { t } = useTranslation()

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="kicker">{t('landing.kicker')}</p>
            <h1>{t('landing.title')}</h1>
            <p className="lead">{t('landing.description')}</p>
            <div className="hero-cta">
              <Link to="/app" className="btn">
                {t('landing.cta')}
              </Link>
              <a href="#how" className="btn btn-ghost">
                {t('landing.ctaSecondary')}
              </a>
            </div>
          </div>
          <figure className="hero-figure">
            <figcaption className="hero-figure-head">
              <span>{t('landing.figure.caption')}</span>
              <span>{t('landing.figure.sheet')}</span>
            </figcaption>
            <NetworkFigure />
          </figure>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <div className="section-head">
            <p className="kicker">{t('landing.how.kicker')}</p>
            <h2>{t('landing.how.title')}</h2>
          </div>
          <div className="grid-lines steps-grid">
            {STEPS.map((id, i) => (
              <div className="cell" key={id}>
                <p className="step-num">{String(i + 1).padStart(2, '0')}</p>
                <h3>{t(`landing.how.steps.${id}.title`)}</h3>
                <p className="cell-text">{t(`landing.how.steps.${id}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <p className="kicker">{t('landing.features.kicker')}</p>
            <h2>{t('landing.features.title')}</h2>
          </div>
          <div className="grid-lines features-grid">
            {FEATURES.map(({ id, Icon }) => (
              <div className="cell" key={id}>
                <Icon size={18} strokeWidth={1.5} className="feature-icon" aria-hidden="true" />
                <h3>{t(`landing.features.items.${id}.title`)}</h3>
                <p className="cell-text">{t(`landing.features.items.${id}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <p className="kicker">{t('landing.outputs.kicker')}</p>
            <h2>{t('landing.outputs.title')}</h2>
          </div>
          <div className="grid-lines outputs-grid">
            {OUTPUTS.map(({ id, ext }) => (
              <div className="cell" key={id}>
                <p className="output-ext">{ext}</p>
                <h3>{t(`landing.outputs.items.${id}.title`)}</h3>
                <p className="cell-text">{t(`landing.outputs.items.${id}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <p className="kicker">{t('landing.norms.kicker')}</p>
            <h2>{t('landing.norms.title')}</h2>
          </div>
          <div className="norms-list">
            {NORMS.map((id) => (
              <div className="norm-row" key={id}>
                <span className="norm-code">{t(`landing.norms.items.${id}.code`)}</span>
                <span className="norm-name">{t(`landing.norms.items.${id}.name`)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="container cta-band-inner">
          <h2>{t('landing.ctaBand.title')}</h2>
          <Link to="/app" className="btn btn-inverse">
            {t('landing.ctaBand.button')}
          </Link>
        </div>
      </section>
    </>
  )
}
