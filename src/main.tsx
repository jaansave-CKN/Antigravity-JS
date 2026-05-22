import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContextNew'
import { DashboardProvider } from './contexts/DashboardContext'
import { Dashboard } from './components/Dashboard'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import './index.css'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()
  
  if (loading) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-white">Cargando...</div>
    </div>
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}

function AppRoutes() {
  const { isAuthenticated } = useAuth()
  
  return (
    <Routes>
      <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <Navigate to="/" replace />} />
      <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <Navigate to="/" replace />} />
      <Route path="/" element={
        <RequireAuth>
          <DashboardProvider>
            <Dashboard />
          </DashboardProvider>
        </RequireAuth>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  </BrowserRouter>
)