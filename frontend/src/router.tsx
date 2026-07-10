import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from './shared/RootLayout'

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
        path: 'app',
        lazy: () => import('./app/AppHome').then((m) => ({ Component: m.AppHome })),
      },
      {
        path: '*',
        lazy: () => import('./shared/NotFoundPage').then((m) => ({ Component: m.NotFoundPage })),
      },
    ],
  },
])
