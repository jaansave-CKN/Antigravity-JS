import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    this.logError(error, errorInfo);
  }

  logError = (error: Error, errorInfo: React.ErrorInfo) => {
    const log = {
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    console.error('🔴 ERROR CAPTURADO:', log);

    try {
      const logs = JSON.parse(localStorage.getItem('antigravity_error_logs') || '[]');
      logs.push(log);
      localStorage.setItem('antigravity_error_logs', JSON.stringify(logs.slice(-50)));
    } catch (e) {
      console.error('Error guardando logs:', e);
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  clearLogs = () => {
    localStorage.removeItem('antigravity_error_logs');
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#f8fafc',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{
            maxWidth: '600px',
            textAlign: 'center',
          }}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
            }}>
              <AlertTriangle size={40} color="white" />
            </div>

            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Algo salió mal
            </h1>

            <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
              La aplicación encontró un error inesperado. Por favor intenta de nuevo.
            </p>

            {this.state.error && (
              <div style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '1rem',
                marginBottom: '1.5rem',
                textAlign: 'left',
                fontSize: '0.875rem',
                overflow: 'auto',
              }}>
                <strong style={{ color: '#f87171' }}>Error:</strong>
                <code style={{ color: '#cbd5e1', display: 'block', marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
                  {this.state.error.message}
                </code>
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={this.handleReload}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem 1.5rem',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={18} />
                Recargar página
              </button>

              <button
                onClick={this.handleGoHome}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem 1.5rem',
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Home size={18} />
                Ir al inicio
              </button>

              <button
                onClick={this.clearLogs}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: 'transparent',
                  color: '#94a3b8',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Limpiar errores
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function getErrorLogs() {
  try {
    return JSON.parse(localStorage.getItem('antigravity_error_logs') || '[]');
  } catch {
    return [];
  }
}

export function clearErrorLogs() {
  localStorage.removeItem('antigravity_error_logs');
}