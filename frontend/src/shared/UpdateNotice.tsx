import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

function entryScript(documentRoot: Document): string | null {
  const script = documentRoot.querySelector<HTMLScriptElement>('script[type="module"][src]')
  return script ? new URL(script.src, window.location.origin).pathname : null
}

/** Warn users whose already-open tab is still running an older Vercel bundle. */
export function UpdateNotice() {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return
    const currentEntry = entryScript(document)
    if (!currentEntry) return
    let stopped = false

    const check = async () => {
      try {
        const response = await fetch(`/?version-check=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok || stopped) return
        const latest = new DOMParser().parseFromString(await response.text(), 'text/html')
        const latestEntry = entryScript(latest)
        if (latestEntry && latestEntry !== currentEntry) setAvailable(true)
      } catch {
        // Being offline is not an application error; retry later.
      }
    }

    const timer = window.setInterval(() => void check(), 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    void check()
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!available) return null
  return (
    <div className="update-notice" role="alert">
      <span>{t('nav.updateAvailable')}</span>
      <button type="button" onClick={() => window.location.reload()}>{t('nav.update')}</button>
    </div>
  )
}
