import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './auth'

export function RequireAuth() {
  const { session, loading } = useAuth()

  if (loading) return null
  if (!session) return <Navigate to="/auth" replace />
  return <Outlet />
}
