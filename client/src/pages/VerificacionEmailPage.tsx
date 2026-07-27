import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

type Estado = 'verificando' | 'exito' | 'error';

export default function VerificacionEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>('verificando');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setEstado('error');
      setMensaje('Enlace de verificación incompleto — falta el token.');
      return;
    }
    fetch(`${API_BASE}/auth/confirmar-verificacion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(body => {
        setEstado(body?.success ? 'exito' : 'error');
        setMensaje(body?.message || (body?.success ? 'Correo verificado correctamente.' : 'No se pudo verificar el correo.'));
      })
      .catch(() => {
        setEstado('error');
        setMensaje('No se pudo conectar con el servidor. Intenta de nuevo más tarde.');
      });
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md text-center">
        {estado === 'verificando' && (
          <>
            <div className="text-4xl mb-4">⏳</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Verificando tu correo...</h2>
          </>
        )}
        {estado === 'exito' && (
          <>
            <div className="text-4xl mb-4">✅</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Correo verificado</h2>
            <p className="text-gray-600 mb-6">{mensaje}</p>
          </>
        )}
        {estado === 'error' && (
          <>
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">No se pudo verificar</h2>
            <p className="text-gray-600 mb-6">{mensaje}</p>
          </>
        )}
        {estado !== 'verificando' && (
          <button onClick={() => navigate('/login')} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
            Ir al login
          </button>
        )}
      </div>
    </div>
  );
}
