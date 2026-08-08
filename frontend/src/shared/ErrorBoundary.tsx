import { Component } from 'react'
import i18n from '../i18n'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Catches render errors anywhere below it and shows a recovery screen
 * instead of a blank page. Deliberately dependency free (no i18n, no router)
 * so it still works when those are the cause of the crash.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '96px 24px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
          {i18n.t('errorBoundary.badge')}
        </p>
        <h1 style={{ marginTop: 12, fontSize: 28, fontWeight: 600 }}>{i18n.t('errorBoundary.title')}</h1>
        <p style={{ marginTop: 12, color: 'var(--ink-soft)' }}>
          {i18n.t('errorBoundary.text')}
        </p>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 24 }}
          onClick={() => window.location.reload()}
        >
          {i18n.t('errorBoundary.reload')}
        </button>
      </div>
    )
  }
}
