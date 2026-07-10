import { ENGINE_VERSION } from '@aquascheme/engine'

export function AppHome() {
  return (
    <section style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Проекты</h1>
      <p style={{ marginTop: 12, color: 'var(--ink-soft)' }}>
        Рабочая область приложения. Список проектов и мастер создания появятся в следующих
        фазах.
      </p>
      <p style={{ marginTop: 24, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-soft)' }}>
        engine v{ENGINE_VERSION}
      </p>
    </section>
  )
}
