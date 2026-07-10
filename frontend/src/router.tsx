import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from './shared/RootLayout'
import { RequireAuth } from './shared/RequireAuth'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
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
        ],
      },
      {
        path: '*',
        lazy: () => import('./shared/NotFoundPage').then((m) => ({ Component: m.NotFoundPage })),
      },
    ],
  },
])
