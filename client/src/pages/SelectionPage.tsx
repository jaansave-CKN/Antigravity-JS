/**
 * SelectionPage — INICIO · Calco pixel-perfect del plano Stitch
 * Fuente: proyecto 3791086755596777919 · frame "INICIO"
 * Tokens: bg #0b1326, cyan #38bdf8, purple #bdc2ff, font Hanken Grotesk + JetBrains Mono
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';
import { useSubscription } from '../contexts/SubscriptionContext';

// ── CSS ────────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Hanken+Grotesk:wght@400;600;700&display=swap');

  @keyframes sp-blink  { 0%,100%{opacity:1}   50%{opacity:.3} }
  @keyframes sp-fadein { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
  @keyframes sp-glow   { 0%,100%{opacity:.6}  50%{opacity:1} }

  /* ── Viewport ── */
  .sp-root {
    position: relative;
    width: 100%;
    min-height: calc(100vh - 48px);
    background: #0b1326;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
  }

  /* ── Dark architectural backdrop ── */
  .sp-backdrop {
    position: absolute;
    inset: 0;
    background-image: url('/INICIO.jpg');
    background-size: cover;
    background-position: center center;
    background-repeat: no-repeat;
  }
  .sp-backdrop::after {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(11, 19, 38, 0.88);
  }

  /* ── Ambient glows (atmosphere) ── */
  .sp-glow-left {
    position: absolute;
    left: 8%;
    top: 18%;
    width: 480px;
    height: 480px;
    background: radial-gradient(circle, rgba(56,189,248,0.08) 0%, transparent 65%);
    pointer-events: none;
    z-index: 1;
  }
  .sp-glow-right {
    position: absolute;
    right: 8%;
    top: 18%;
    width: 480px;
    height: 480px;
    background: radial-gradient(circle, rgba(189,194,255,0.08) 0%, transparent 65%);
    pointer-events: none;
    z-index: 1;
  }

  /* ── Brand header ── */
  .sp-brand {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding-top: 24px;
    animation: sp-fadein .5s ease both;
  }
  .sp-brand-name {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 700;
    color: #38bdf8;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .sp-brand-sep { color: #1a3a50; margin: 0 6px; }
  .sp-brand-em  { font-style: normal; color: #8bafcf; font-weight: 400; }

  /* ── Main title ── */
  .sp-title {
    position: relative;
    z-index: 10;
    margin-top: 10px;
    text-align: center;
    animation: sp-fadein .5s ease .1s both;
  }
  .sp-title h1 {
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(18px, 2.6vw, 30px);
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #c8d8e8;
    margin: 0 0 5px;
    text-shadow:
      0 0 30px rgba(56,189,248,0.25),
      0 1px 0 rgba(255,255,255,0.06);
  }
  .sp-title-line {
    width: 120px;
    height: 1px;
    margin: 0 auto;
    background: linear-gradient(90deg, transparent, #38bdf866, transparent);
  }

  /* ── Status pill ── */
  .sp-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 9999px;
    padding: 3px 11px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid;
    margin-top: 6px;
  }
  .sp-status-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    display: block; flex-shrink: 0;
  }

  /* ── Cards area ── */
  .sp-cards {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: stretch;
    justify-content: center;
    gap: 32px;
    width: min(720px, 85vw);
    margin-top: 78px;
    flex: 1;
    max-height: 504px;
    animation: sp-fadein .55s ease .15s both;
  }

  /* ── Individual card ── */
  .sp-card {
    flex: 1;
    padding: 32px 28px 26px;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    cursor: pointer;
    transition: background .2s;
  }
  .sp-card:focus-visible { outline: 2px solid rgba(56,189,248,0.5); }

  .sp-card-a {
    background: rgba(10, 20, 38, 0.82);
    border: 3px solid #86efac;
    box-shadow: 0 0 30px rgba(134,239,172,0.3), inset 0 1px 0 rgba(134,239,172,0.2);
    border-radius: 16px;
  }
  .sp-card-a:hover {
    background: rgba(14, 28, 52, 0.90);
    border-color: #bbf7d0;
    box-shadow: 0 0 45px rgba(134,239,172,0.5), inset 0 1px 0 rgba(134,239,172,0.4);
  }

  .sp-card-b {
    background: rgba(12, 10, 34, 0.82);
    border: 3px solid #d8b4fe;
    box-shadow: 0 0 30px rgba(216,180,254,0.3), inset 0 1px 0 rgba(216,180,254,0.2);
    border-radius: 16px;
  }
  .sp-card-b:hover {
    background: rgba(18, 12, 46, 0.90);
    border-color: #e9d5ff;
    box-shadow: 0 0 45px rgba(216,180,254,0.5), inset 0 1px 0 rgba(216,180,254,0.4);
  }

  .sp-card-disabled { opacity: .38; cursor: not-allowed; pointer-events: none; }

  /* ── Divider ── */
  .sp-divider {
    display: none;
  }

  /* ── Icon ── */
  .sp-icon { width: 68px; height: 68px; margin-bottom: 14px; flex-shrink: 0; }

  /* ── Module badge ── */
  .sp-module-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #2d4a60;
    margin-bottom: 8px;
  }

  /* ── Card title ── */
  .sp-card-title {
    font-size: clamp(18px, 2vw, 24px);
    font-weight: 700;
    margin-bottom: 4px;
    text-align: center;
  }
  .sp-card-a .sp-card-title { color: #38bdf8; }
  .sp-card-b .sp-card-title { color: #bdc2ff; }

  /* ── Card subtitle ── */
  .sp-card-subtitle {
    font-size: 11px;
    color: #557997;
    margin-bottom: 16px;
    text-align: center;
    letter-spacing: 0.02em;
  }

  /* ── HR ── */
  .sp-hr {
    width: 100%;
    height: 1px;
    background: #0d2a3d;
    margin-bottom: 14px;
    flex-shrink: 0;
  }

  /* ── Features list ── */
  .sp-features {
    list-style: none;
    padding: 0; margin: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }
  .sp-features li {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    color: #3a5e7a;
    letter-spacing: 0.02em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sp-feat-icon { font-size: 10px; flex-shrink: 0; }
  .sp-card-a .sp-feat-icon { color: rgba(56,189,248,0.55); }
  .sp-card-b .sp-feat-icon { color: rgba(189,194,255,0.55); }

  /* ── CTA button — anclado en la base de su tarjeta ── */
  .sp-cta {
    width: 100%;
    height: 48px;
    border-radius: 10px;
    border: 1px solid transparent;
    cursor: pointer;
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-top: auto;
    padding: 0;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    transition: all 0.2s ease-in-out;
    pointer-events: all;
  }
  .sp-cta:hover  { transform: translateY(-2px); }
  .sp-cta:active { transform: scale(0.97) translateY(1px); }
  .sp-cta:disabled { opacity: .3; cursor: not-allowed; transform: none; }

  /* Cyan — Módulo A */
  .sp-cta-a {
    background: #172133;
    color: #38bdf8;
    border-color: rgba(56,189,248,0.35);
    border-radius: 10px;
    box-shadow: inset 0 1px 0 rgba(56,189,248,0.12);
  }
  .sp-cta-a:hover {
    background: #1a2a40;
    border-color: rgba(56,189,248,0.70);
    box-shadow: 0 0 15px rgba(56,189,248,0.40), 0 4px 16px rgba(56,189,248,0.15), inset 0 1px 0 rgba(56,189,248,0.20);
    transform: translateY(-2px);
  }
  .sp-cta-a:active {
    transform: scale(0.97) translateY(1px);
    box-shadow: 0 0 4px rgba(56,189,248,0.20);
  }

  /* Purple — Módulo B */
  .sp-cta-b {
    background: #13102e;
    color: #bdc2ff;
    border-color: rgba(189,194,255,0.35);
    border-radius: 10px;
    box-shadow: inset 0 1px 0 rgba(189,194,255,0.12);
  }
  .sp-cta-b:hover {
    background: #191535;
    border-color: rgba(189,194,255,0.70);
    box-shadow: 0 0 15px rgba(189,194,255,0.40), 0 4px 16px rgba(189,194,255,0.15), inset 0 1px 0 rgba(189,194,255,0.20);
    transform: translateY(-2px);
  }
  .sp-cta-b:active {
    transform: scale(0.97) translateY(1px);
    box-shadow: 0 0 4px rgba(189,194,255,0.20);
  }

  /* ── Auth bar (bottom) ── */
  .sp-auth-bar {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding: 14px 0 10px;
    animation: sp-fadein .6s ease .25s both;
  }

  .sp-pill {
    padding: 7px 18px;
    border-radius: 9999px;
    background: rgba(0,0,0,0.52);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.18);
    color: rgba(255,255,255,0.82);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 700;
    letter-spacing: .07em; text-transform: uppercase;
    cursor: pointer;
    transition: background .2s, border-color .2s;
  }
  .sp-pill:hover { background: rgba(0,0,0,0.75); border-color: rgba(255,255,255,.38); }
  .sp-pill-cyan { border-color: rgba(56,189,248,.44); color: #38bdf8; }
  .sp-pill-cyan:hover { background: rgba(56,189,248,.10); border-color: rgba(56,189,248,.82); }
  .sp-pill:disabled { opacity:.32; cursor:not-allowed; }

  .sp-footer {
    font-family: 'JetBrains Mono', monospace;
    font-size: 7px; color: rgba(255,255,255,.18);
    letter-spacing: .14em; text-transform: uppercase;
    padding-bottom: 8px;
    position: relative; z-index: 10;
  }

  /* ── Mobile ── */
  @media (max-width: 600px) {
    .sp-cards { flex-direction: column; max-height: none; gap: 12px; }
    .sp-card-a { border-radius: 16px; }
    .sp-card-b { border-radius: 16px; border-left: 1px solid rgba(189,194,255,0.22); }
    .sp-divider { display: none; }
  }
`;

// ── Root status ───────────────────────────────────────────────────────────────
type RootStatus = 'checking' | 'online' | 'offline';

function useRootStatus(): RootStatus {
  const [s, setS] = useState<RootStatus>('checking');
  useEffect(() => {
    let ok = true;
    const run = async () => {
      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
        if (ok) setS(r.ok ? 'online' : 'offline');
      } catch { if (ok) setS('offline'); }
    };
    run();
    const t = setInterval(run, 30_000);
    return () => { ok = false; clearInterval(t); };
  }, []);
  return s;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SelectionPage() {
  const navigate   = useNavigate();
  const { user, token, startTrial } = useAuth();
  const { subscription }            = useSubscription();
  const root       = useRootStatus();
  const [starting, setStarting] = useState(false);

  // isRealAuth: verdadero solo si hay usuario real con token JWT válido (no demo, no trial)
  const isRealAuth = !!(user && token && token !== 'demo-mode-token' && user.role !== 'trial');
  const isOnline   = root === 'online';

  const goRadar = () => {
    if (!isRealAuth) {
      navigate('/login', { state: { from: { pathname: '/radar' }, reason: 'requires-auth', module: 'A', moduleName: 'Radar 360' } });
      return;
    }
    navigate('/radar');
  };
  const goForm  = () => {
    if (!isRealAuth) {
      navigate('/login', { state: { from: { pathname: '/checklist' }, reason: 'requires-auth', module: 'B', moduleName: 'Formulador AI' } });
      return;
    }
    navigate('/checklist');
  };
  const goTrial = async () => {
    setStarting(true);
    try { await startTrial(); navigate('/radar'); }
    catch { navigate('/login'); }
    finally { setStarting(false); }
  };

  const statusCfg = {
    online:   { color: '#22c55e', label: 'Sistema Activo',   shadow: '0 0 6px #22c55e' },
    offline:  { color: '#f87171', label: 'Sistema Offline',  shadow: 'none' },
    checking: { color: '#6b7280', label: 'Verificando…',     shadow: 'none' },
  }[root];

  return (
    <div className="sp-root">
      <style>{CSS}</style>

      {/* ── Dark architectural backdrop ─────────────────────────────────────── */}
      <div className="sp-backdrop" aria-hidden="true" />

      {/* ── Ambient glows ───────────────────────────────────────────────────── */}
      <div className="sp-glow-left"  aria-hidden="true" />
      <div className="sp-glow-right" aria-hidden="true" />

      {/* ── Brand header ────────────────────────────────────────────────────── */}
      <div className="sp-brand">
        <div className="sp-brand-name">
          GGIE<span className="sp-brand-sep">·</span>
          <em className="sp-brand-em">RadarFondos</em>
        </div>
        <div
          className="sp-status"
          style={{
            borderColor: statusCfg.color + '44',
            color: statusCfg.color,
          }}
        >
          <span
            className="sp-status-dot"
            style={{
              background:  statusCfg.color,
              boxShadow:   statusCfg.shadow,
              animation:   root === 'online' ? 'sp-blink 2s infinite' : 'none',
            }}
          />
          {statusCfg.label}
        </div>
      </div>

      {/* ── Main title ──────────────────────────────────────────────────────── */}
      <div className="sp-title">
        <h1>RadFor-360<span style={{ fontSize: '0.35em', verticalAlign: 'top', lineHeight: 1, marginLeft: 2, position: 'relative', top: '0.2em' }}>®</span></h1>
        <div className="sp-title-line" />
      </div>

      {/* ── Cards ───────────────────────────────────────────────────────────── */}
      <div className="sp-cards">

        {/* ── Pilar A: RADAR 360 ─────────────────────────────────────────── */}
        <div
          className="sp-card sp-card-a"
          onClick={goRadar}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && goRadar()}
          title={isRealAuth ? 'Rastrear Ahora' : 'Iniciar sesión para acceder'}
        >
          {/* Radar SVG (from Stitch export) */}
          <svg className="sp-icon" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="36" cy="36" r="33" stroke="rgba(56,189,248,0.15)" strokeWidth="1.5"/>
            <circle cx="36" cy="36" r="22" stroke="rgba(56,189,248,0.20)" strokeWidth="1.5"/>
            <circle cx="36" cy="36" r="11" stroke="rgba(56,189,248,0.30)" strokeWidth="1.5"/>
            <circle cx="36" cy="36" r="3"  fill="#38bdf8"/>
            <line x1="36" y1="3" x2="36" y2="36" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
            <path d="M36 36 L58 20" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" opacity="0.35"/>
            <path d="M36 36 L60 28 A28 28 0 0 0 36 8 Z" fill="rgba(56,189,248,0.07)"/>
            <circle cx="54" cy="22" r="2.5" fill="#38bdf8" opacity="0.8"/>
            <circle cx="44" cy="12" r="1.8" fill="#38bdf8" opacity="0.5"/>
            <circle cx="20" cy="50" r="1.5" fill="#38bdf8" opacity="0.35"/>
          </svg>

          <div className="sp-module-badge">Módulo A</div>
          <div className="sp-card-title">Radar 360</div>
          <div className="sp-card-subtitle">Inteligencia de Fondos</div>
          <div className="sp-hr" />

          <ul className="sp-features">
            <li><span className="sp-feat-icon">◎</span>Convocatorias activas en tiempo real</li>
            <li><span className="sp-feat-icon">⊗</span>Match semántico IA · pgvector HNSW</li>
            <li><span className="sp-feat-icon">⊟</span>Directorio de 400+ entidades</li>
            <li><span className="sp-feat-icon">♥</span>Favoritos y seguimiento personalizado</li>
            <li><span className="sp-feat-icon">◈</span>Calendario de cierres y alertas</li>
          </ul>

          {/* CTA anclado en la base de la tarjeta A */}
          <button
            className="sp-cta sp-cta-a"
            onClick={e => { e.stopPropagation(); goRadar(); }}
            disabled={false}
            aria-label="Rastrear Ahora — Módulo A Radar 360"
          >
            Rastrear Ahora
          </button>
        </div>

        {/* ── Divisor vertical ─────────────────────────────────────────────── */}
        <div className="sp-divider" />

        {/* ── Pilar B: FORMULADOR AI ───────────────────────────────────────── */}
        <div
          className="sp-card sp-card-b"
          onClick={goForm}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && goForm()}
          title={isRealAuth ? 'Empezar Formulación' : 'Iniciar sesión para acceder'}
        >
          {/* Spark SVG (from Stitch export) */}
          <svg className="sp-icon" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon points="36,6 40,30 64,30 44,46 52,70 36,54 20,70 28,46 8,30 32,30"
              fill="rgba(189,194,255,0.08)" stroke="rgba(189,194,255,0.35)"
              strokeWidth="1.5" strokeLinejoin="round"/>
            <polygon points="36,18 38.5,29 50,29 41,35.5 44,46 36,40 28,46 31,35.5 22,29 33.5,29"
              fill="rgba(189,194,255,0.15)" stroke="rgba(189,194,255,0.5)"
              strokeWidth="1" strokeLinejoin="round"/>
            <circle cx="36" cy="34" r="3.5" fill="#bdc2ff"/>
            <line x1="36" y1="2"  x2="36" y2="10" stroke="#bdc2ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
            <line x1="36" y1="62" x2="36" y2="70" stroke="#bdc2ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
            <line x1="2"  y1="36" x2="10" y2="36" stroke="#bdc2ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
            <line x1="62" y1="36" x2="70" y2="36" stroke="#bdc2ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
          </svg>

          <div className="sp-module-badge">Módulo B</div>
          <div className="sp-card-title">Formulador AI</div>
          <div className="sp-card-subtitle">Propuestas con Inteligencia Artificial</div>
          <div className="sp-hr" />

          <ul className="sp-features">
            <li><span className="sp-feat-icon">①</span>Entrada de datos del proyecto (M1–M2)</li>
            <li><span className="sp-feat-icon">✦</span>Árbol de objetivos con IA Gemini (M3)</li>
            <li><span className="sp-feat-icon">◧</span>APU + Presupuesto detallado (M4–M5)</li>
            <li><span className="sp-feat-icon">◫</span>Ficha Técnica Maestra + Sello SHA (M12)</li>
            <li><span className="sp-feat-icon">◨</span>Dialéctica · Normativa · Compliance</li>
          </ul>

          {/* CTA anclado en la base de la tarjeta B */}
          <button
            className="sp-cta sp-cta-b"
            onClick={e => { e.stopPropagation(); goForm(); }}
            disabled={false}
            aria-label="Empezar Formulación — Módulo B Formulador AI"
          >
            Empezar Formulación
          </button>
        </div>

      </div>

      {/* ── Auth bar — solo controles de sesión, sin CTAs duplicadas ────────── */}
      <div className="sp-auth-bar">
        {isRealAuth ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
            {subscription.plan !== 'free' && (
              <div className="sp-status" style={{
                borderColor: 'rgba(34,197,94,.30)', color: '#22c55e',
              }}>
                <span className="sp-status-dot" style={{ background: '#22c55e' }} />
                {subscription.plan.toUpperCase()}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="sp-pill sp-pill-cyan"
              onClick={goTrial}
              disabled={starting || !isOnline}
            >
              {starting ? 'Iniciando…' : '⚡ Modo Visitante · Periodo de Evaluación Activo'}
            </button>
            <button className="sp-pill" onClick={() => navigate('/login')}>
              Iniciar sesión →
            </button>
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="sp-footer">
        RadarFondos 360 &nbsp;·&nbsp; EGIOC5 &nbsp;·&nbsp; {new Date().getFullYear()}
      </div>
    </div>
  );
}
