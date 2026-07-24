import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from './shared/auth'
import { ErrorBoundary } from './shared/ErrorBoundary'
import { UpdateNotice } from './shared/UpdateNotice'
import { router } from './router'
import './i18n'
import './styles/global.css'

// Recover from stale chunks after a redeploy: when a lazy route's hashed chunk
// no longer exists (Vite raises 'vite:preloadError'), reload once to fetch the
// current index.html and chunk graph. A short cooldown avoids reload loops if
// the deployment is genuinely broken.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const now = Number(new Date())
  const last = Number(sessionStorage.getItem('preloadReloadAt') ?? 0)
  if (now - last < 10000) return
  sessionStorage.setItem('preloadReloadAt', String(now))
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <UpdateNotice />
        <RouterProvider router={router} />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
