import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section style={{ maxWidth: 960, margin: '0 auto', padding: '96px 24px' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-soft)' }}>404</p>
      <h1 style={{ marginTop: 16, fontSize: 32, fontWeight: 600 }}>Страница не найдена</h1>
      <p style={{ marginTop: 16 }}>
        <Link to="/" style={{ color: 'var(--accent)' }}>
          Вернуться на главную
        </Link>
      </p>
    </section>
  )
}
