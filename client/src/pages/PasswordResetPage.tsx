import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const CARD = 'min-h-screen bg-[#0b1326] flex items-center justify-center p-4 font-sans';
const BOX  = 'bg-[#0a1426] border border-[#1a3a50] rounded-2xl w-full max-w-md p-8 shadow-2xl';
const H2   = 'text-xl font-bold text-[#c8d8e8] mb-2';
const P    = 'text-sm text-[#557997] mb-6';
const INPUT = 'w-full px-3.5 py-2.5 bg-[#0b1326] border border-[#1a3a50] rounded-lg text-[#c8d8e8] text-sm placeholder-[#4a6280] focus:outline-none focus:border-[#38bdf8] focus:ring-1 focus:ring-[#38bdf8] transition-colors mb-4';
const BTN_PRIMARY = 'w-full bg-gradient-to-r from-[#38bdf8] to-[#0284c7] text-[#001c2e] py-2.5 rounded-lg font-mono font-bold text-xs uppercase tracking-widest disabled:opacity-40 transition-opacity';
const BTN_LINK = 'w-full mt-4 text-xs text-[#38bdf8] hover:text-[#7dd3fc] transition-colors';
const ERR = 'bg-[rgba(248,113,113,0.1)] border border-[rgba(248,113,113,0.3)] text-[#f87171] text-xs p-3 rounded-lg mb-4';

/** Paso 1: solicitar el enlace (sin token en la URL). */
function SolicitarEnlace() {
  const { sendPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]   = useState('');
  const [sent, setSent]     = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try { await sendPasswordReset(email); } finally { setSent(true); setLoading(false); }
  }

  if (sent) {
    return (
      <div className={CARD}>
        <div className={`${BOX} text-center`}>
          <div className="text-4xl mb-4">✉</div>
          <h2 className={H2}>Correo enviado</h2>
          <p className={P}>Si <strong className="text-[#c8d8e8]">{email}</strong> tiene una cuenta, te llegará un enlace para restablecer la contraseña.</p>
          <button onClick={() => navigate('/login')} className={BTN_PRIMARY}>Volver al login</button>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <div className={BOX}>
        <h2 className={H2}>Recuperar contraseña</h2>
        <p className={P}>Ingresa tu correo y te enviaremos un enlace para restablecerla.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="tu@correo.com" aria-label="Correo electrónico" required autoComplete="email" className={INPUT}
          />
          <button type="submit" disabled={loading || !email.trim()} className={BTN_PRIMARY}>
            {loading ? 'Enviando…' : 'Enviar enlace de recuperación'}
          </button>
        </form>
        <button type="button" onClick={() => navigate('/login')} className={BTN_LINK}>Volver al login</button>
      </div>
    </div>
  );
}

/** Paso 2: aplicar la nueva contraseña (llegó con ?token= desde el correo). */
function AplicarNuevaContrasena({ token }: { token: string }) {
  const navigate = useNavigate();
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.message || 'No se pudo restablecer la contraseña.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className={CARD}>
        <div className={`${BOX} text-center`}>
          <div className="text-4xl mb-4">✅</div>
          <h2 className={H2}>Contraseña actualizada</h2>
          <p className={P}>Ya puedes iniciar sesión con tu nueva contraseña.</p>
          <button onClick={() => navigate('/login')} className={BTN_PRIMARY}>Ir al login</button>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <div className={BOX}>
        <h2 className={H2}>Nueva contraseña</h2>
        <p className={P}>Elige una contraseña nueva para tu cuenta.</p>
        {error && <div className={ERR}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Nueva contraseña (mínimo 8 caracteres)" aria-label="Nueva contraseña" required minLength={8}
            autoComplete="new-password" className={INPUT}
          />
          <input
            type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Repite la nueva contraseña" aria-label="Repite la nueva contraseña" required minLength={8}
            autoComplete="new-password" className={INPUT}
          />
          <button type="submit" disabled={loading || !password || !confirm} className={BTN_PRIMARY}>
            {loading ? 'Guardando…' : 'Actualizar contraseña'}
          </button>
        </form>
        <button type="button" onClick={() => navigate('/login')} className={BTN_LINK}>Cancelar</button>
      </div>
    </div>
  );
}

export default function PasswordResetPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  return token ? <AplicarNuevaContrasena token={token} /> : <SolicitarEnlace />;
}
