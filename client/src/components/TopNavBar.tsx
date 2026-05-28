import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

const NAV_LINKS = [
  { to: '/',           label: 'Inicio',           end: true  },
  { to: '/radar',      label: 'Radar',            end: false },
  { to: '/directorio', label: 'Directorio',       end: false },
  { to: '/apis',       label: 'APIs',             end: false },
  { to: '/settings',   label: 'Panel de control', end: false },
] as const;

type ReportState = 'idle' | 'open' | 'sending' | 'sent' | 'error';

function ReportErrorButton() {
  const { token } = useAuth();
  const [state, setState]     = useState<ReportState>('idle');
  const [message, setMessage] = useState('');

  async function send() {
    if (!message.trim()) return;
    setState('sending');
    try {
      const r = await fetch('/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: message.trim(),
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });
      setState(r.ok ? 'sent' : 'error');
      if (r.ok) { setMessage(''); setTimeout(() => setState('idle'), 3000); }
    } catch { setState('error'); }
  }

  if (state === 'idle' || state === 'sent') {
    return (
      <button
        onClick={() => state === 'sent' ? setState('idle') : setState('open')}
        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
          state === 'sent'
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'text-[#76777d] hover:text-[#191c1e] hover:bg-[#f2f4f6] border border-transparent'
        }`}
        title="Reportar un problema al administrador"
      >
        {state === 'sent'
          ? <><span className="text-[13px]">✓</span> Enviado</>
          : <><span className="text-[13px]">⚑</span> Reportar error</>
        }
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        type="text"
        value={message}
        onChange={e => setMessage(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') send(); if (e.key === 'Escape') setState('idle'); }}
        placeholder="Describe brevemente el problema…"
        className="w-52 px-2.5 py-1 text-[11px] border border-[#c6c6cd] rounded outline-none focus:border-[#0058be] bg-white"
        disabled={state === 'sending'}
        maxLength={500}
      />
      <button
        onClick={send}
        disabled={state === 'sending' || !message.trim()}
        className="px-2.5 py-1 text-[11px] bg-[#0058be] text-white rounded hover:bg-[#004caa] disabled:opacity-50 transition-colors"
      >
        {state === 'sending' ? '…' : state === 'error' ? 'Error' : 'Enviar'}
      </button>
      <button
        onClick={() => setState('idle')}
        className="px-1.5 py-1 text-[11px] text-[#76777d] hover:text-[#191c1e]"
      >
        ✕
      </button>
    </div>
  );
}

export default function TopNavBar() {
  const { token } = useAuth();

  return (
    <nav className="bg-white border-b border-[#e2e8f0] px-6 h-12 flex items-center gap-8 shrink-0">
      <span className="text-[#191c1e] font-semibold text-sm tracking-tight mr-2">
        GGIE <span className="text-[#76777d] font-normal">Radar de Fondos</span>
      </span>
      <div className="flex items-center gap-1 flex-1">
        {NAV_LINKS.map(({ to, label, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[rgba(0,88,190,0.08)] text-[#0058be]'
                  : 'text-[#45464d] hover:text-[#191c1e] hover:bg-[#f2f4f6]'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
      {token && <ReportErrorButton />}
    </nav>
  );
}
