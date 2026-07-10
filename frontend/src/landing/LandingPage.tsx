import { Link } from 'react-router-dom'

export function LandingPage() {
  return (
    <section style={{ maxWidth: 960, margin: '0 auto', padding: '96px 24px' }}>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          letterSpacing: '0.14em',
          color: 'var(--accent)',
        }}
      >
        НАРУЖНЫЕ СЕТИ ВОДОСНАБЖЕНИЯ
      </p>
      <h1 style={{ marginTop: 16, fontSize: 48, lineHeight: 1.1, fontWeight: 600 }}>
        Загрузите изыскания. Получите проект.
      </h1>
      <p style={{ marginTop: 24, maxWidth: 620, color: 'var(--ink-soft)' }}>
        AquaScheme трассирует кольцевую сеть от источника до каждого здания, выполняет
        гидравлический расчёт по EPANET, подбирает диаметры и материалы труб и выдаёт
        чертежи DXF, пояснительную записку и спецификацию материалов.
      </p>
      <div style={{ marginTop: 40 }}>
        <Link
          to="/app"
          style={{
            display: 'inline-block',
            padding: '12px 28px',
            background: 'var(--ink)',
            color: 'var(--bg)',
            fontWeight: 500,
          }}
        >
          Открыть приложение
        </Link>
      </div>
    </section>
  )
}
