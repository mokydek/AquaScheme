import { Link, Outlet } from 'react-router-dom'

export function RootLayout() {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          height: 56,
          borderBottom: '1px solid var(--line)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link to="/" style={{ fontWeight: 600, letterSpacing: '0.1em' }}>
          AQUASCHEME
        </Link>
        <nav style={{ display: 'flex', gap: 24 }}>
          <Link to="/app">Приложение</Link>
        </nav>
      </header>
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
    </div>
  )
}
