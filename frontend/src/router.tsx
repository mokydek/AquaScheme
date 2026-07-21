import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from './shared/RootLayout'
import { RequireAuth } from './shared/RequireAuth'

/**
 * Shown while the initial lazy route chunk loads. Providing it on the root
 * route satisfies React Router 7's hydration requirement (без него в консоли
 * предупреждение «No HydrateFallback element provided»).
 */
function HydrateFallback() {
  return (
    <div role="status" aria-busy="true" style={{ minHeight: '60vh' }} />
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    HydrateFallback,
    children: [
      {
        index: true,
        lazy: () => import('./landing/LandingPage').then((m) => ({ Component: m.LandingPage })),
      },
      {
        path: 'auth',
        lazy: () => import('./auth/AuthPage').then((m) => ({ Component: m.AuthPage })),
      },
      {
        Component: RequireAuth,
        children: [
          {
            path: 'app',
            lazy: () => import('./app/AppHome').then((m) => ({ Component: m.AppHome })),
          },
          {
            path: 'app/new',
            lazy: () =>
              import('./app/NewProjectPage').then((m) => ({ Component: m.NewProjectPage })),
          },
          {
            path: 'app/projects/:id',
            lazy: () => import('./app/ProjectPage').then((m) => ({ Component: m.ProjectPage })),
          },
        ],
      },
      {
        path: '*',
        lazy: () => import('./shared/NotFoundPage').then((m) => ({ Component: m.NotFoundPage })),
      },
    ],
  },
])
